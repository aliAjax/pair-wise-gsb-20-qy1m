import type {
  Clarity,
  ConclusionStatus,
  FocalLayer,
  LogEntry,
  LogKind,
  RecorderDB,
  SlideRecord,
  StructureConclusion,
} from "./types";

const STORAGE_KEY = "hxwl-06-recorder-v1";
const CLARITY_SCORE: Record<Clarity, number> = { 清晰: 3, 可用: 2, 模糊: 1 };

export interface ActionResult {
  ok: boolean;
  message: string;
  /** 重传/登记命中已存在层时返回，便于界面说明“不生成副本” */
  layerId?: string;
  conclusionIds?: string[];
  slideId?: string;
}

let seq = 0;
export function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq}`;
}

function now(): number {
  return Date.now();
}

function pushLog(db: RecorderDB, kind: LogKind, text: string): void {
  const entry: LogEntry = { id: nextId("log"), at: now(), kind, text };
  db.log = [entry, ...db.log].slice(0, 60);
}

function findSlide(db: RecorderDB, slideId: string): SlideRecord {
  const slide = db.slides.find((item) => item.id === slideId);
  if (!slide) throw new Error("找不到玻片记录");
  return slide;
}

function bestLayer(slide: SlideRecord, viewLabel: string): FocalLayer | undefined {
  return slide.layers
    .filter((layer) => layer.viewLabel === viewLabel)
    .sort((a, b) => {
      const gap = CLARITY_SCORE[b.clarity] - CLARITY_SCORE[a.clarity];
      if (gap !== 0) return gap;
      if (a.z !== b.z) return a.z - b.z;
      return a.registeredAt - b.registeredAt;
    })[0];
}

/**
 * 清晰度更新后：同玻片同视野的“未确认”结论失效重算到当前最优层；
 * 已确认结论保留原层（sourceLayerId），不参与重算；
 * 旧记录无层结论（unlayered）无法绑定层，不参与重算。
 */
function recomputeView(slide: SlideRecord, viewLabel: string): number {
  const best = bestLayer(slide, viewLabel);
  let changed = 0;
  for (const conclusion of slide.conclusions) {
    if (conclusion.viewLabel !== viewLabel) continue;
    if (conclusion.status === "confirmed" || conclusion.unlayered) continue;
    conclusion.recomputeCount += 1;
    if (best) conclusion.layerId = best.id;
    changed += 1;
  }
  return changed;
}

function sameStructure(a: StructureConclusion, b: StructureConclusion): boolean {
  return a.viewLabel === b.viewLabel && a.structure.trim() === b.structure.trim();
}

function markConflictPair(
  slide: SlideRecord,
  incoming: StructureConclusion,
): boolean {
  let flagged = false;
  for (const existing of slide.conclusions) {
    if (existing.id === incoming.id || !sameStructure(existing, incoming)) continue;
    if (existing.observer === incoming.observer) continue;
    // 后到者不能覆盖已确认结论：已确认的一方保持不动
    if (existing.status === "confirmed") {
      incoming.conflict = true;
      incoming.conflictNote = `与已确认结论（${existing.observer}）冲突，待教师裁决，未覆盖原结论`;
    } else {
      existing.conflict = true;
      existing.conflictNote = `与 ${incoming.observer} 的同视野提交并存，待教师裁决`;
      incoming.conflict = true;
      incoming.conflictNote = `与 ${existing.observer} 的同视野提交并存，待教师裁决`;
    }
    flagged = true;
  }
  return flagged;
}

export function loadDB(seed: () => RecorderDB): RecorderDB {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as RecorderDB;
  } catch {
    // 存储不可用时回退到种子数据
  }
  return seed();
}

export function saveDB(db: RecorderDB): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch {
    // 忽略持久化失败，界面状态仍可继续演示
  }
}

export function resetDB(seed: () => RecorderDB): RecorderDB {
  return seed();
}

/* ---------------- 焦面层 ---------------- */

export interface RegisterLayerInput {
  slideId: string;
  viewLabel: string;
  z: number;
  clarity: Clarity;
}

/** 登记焦面层。同玻片同视野同 z 视为同一层：不生成副本，只回填清晰度。 */
export function registerLayer(db: RecorderDB, input: RegisterLayerInput): ActionResult {
  const slide = findSlide(db, input.slideId);
  const existed = slide.layers.find(
    (layer) => layer.viewLabel === input.viewLabel && layer.z === input.z,
  );
  if (existed) {
    existed.clarity = input.clarity;
    const count = recomputeView(slide, input.viewLabel);
    pushLog(
      db,
      "info",
      `${slide.code} ${input.viewLabel} z=${input.z}μm 已登记，未生成副本；清晰度更新，${count} 条未确认结论重算`,
    );
    return {
      ok: true,
      layerId: existed.id,
      message: "该焦面层已登记，重传同一层不会生成副本；清晰度已更新，相关未确认结论已重算。",
    };
  }
  const layer: FocalLayer = {
    id: nextId("layer"),
    slideId: input.slideId,
    viewLabel: input.viewLabel,
    z: input.z,
    clarity: input.clarity,
    uploadStatus: "registered",
    registeredAt: now(),
  };
  slide.layers.push(layer);
  pushLog(db, "info", `${slide.code} ${input.viewLabel} 登记焦面层 z=${input.z}μm（${input.clarity}），待补传图像`);
  return { ok: true, layerId: layer.id, message: "焦面层已登记，等待补传图像。" };
}

/** 补传图像：可指定 fail=true 模拟补传失败——层保留、可重试，不生成副本。 */
export function uploadLayer(
  db: RecorderDB,
  layerId: string,
  imageName: string,
  fail = false,
): ActionResult {
  const slide = db.slides.find((item) => item.layers.some((layer) => layer.id === layerId));
  if (!slide) return { ok: false, message: "找不到焦面层" };
  const layer = slide.layers.find((item) => item.id === layerId);
  if (!layer) return { ok: false, message: "找不到焦面层" };

  if (fail) {
    layer.uploadStatus = "failed";
    layer.uploadError = "网络中断，补传失败（层已保留，可重试）";
    pushLog(db, "danger", `${slide.code} ${layer.viewLabel} z=${layer.z}μm 补传失败，已登记层保留，可重试`);
    return { ok: false, layerId, message: "补传失败：已登记的焦面层仍然保留，可随时重试，不会生成副本。" };
  }

  layer.uploadStatus = "uploaded";
  layer.imageName = imageName;
  layer.uploadError = undefined;
  layer.uploadedAt = now();
  pushLog(db, "ok", `${slide.code} ${layer.viewLabel} z=${layer.z}μm 补传成功：${imageName}`);
  return { ok: true, layerId, message: "补传成功。同一层重传只会更新该层，不生成副本。" };
}

export interface ClarityUpdate {
  layerId: string;
  clarity: Clarity;
}

/** 清晰度更新：写入新值后，同视野未确认结论失效重算，已确认结论保留原层。 */
export function updateClarity(db: RecorderDB, update: ClarityUpdate): ActionResult {
  const slide = db.slides.find((item) => item.layers.some((layer) => layer.id === update.layerId));
  const layer = slide?.layers.find((item) => item.id === update.layerId);
  if (!slide || !layer) return { ok: false, message: "找不到焦面层" };
  layer.clarity = update.clarity;
  const count = recomputeView(slide, layer.viewLabel);
  const best = bestLayer(slide, layer.viewLabel);
  const locked = slide.conclusions.filter(
    (item) => item.viewLabel === layer.viewLabel && item.status === "confirmed",
  ).length;
  pushLog(
    db,
    "warn",
    `${slide.code} ${layer.viewLabel} z=${layer.z}μm 清晰度更新为「${update.clarity}」：${count} 条未确认结论失效重算${best ? `（新依据 z=${best.z}μm）` : ""}，${locked} 条已确认结论保留原层`,
  );
  return {
    ok: true,
    message: `清晰度已更新：${count} 条未确认结论失效并按当前最清晰层重算${best ? `（z=${best.z}μm，${best.clarity}）` : ""}；${locked} 条已确认结论仍锁定原层。`,
  };
}

/* ---------------- 结构结论 ---------------- */

export interface SubmitConclusionInput {
  slideId: string;
  viewLabel: string;
  structure: string;
  text: string;
  observer: string;
}

function makeConclusion(
  input: SubmitConclusionInput,
  layer: FocalLayer | undefined,
): StructureConclusion {
  return {
    id: nextId("conclusion"),
    slideId: input.slideId,
    viewLabel: input.viewLabel,
    structure: input.structure,
    observer: input.observer,
    text: input.text,
    layerId: layer?.id ?? "",
    sourceLayerId: layer?.id ?? "",
    status: "unconfirmed",
    conflict: false,
    recomputeCount: 0,
    unlayered: false,
    createdAt: now(),
  };
}

/** 单方提交：同一观察员对同一结构重复提交视为修订（更新自己那条）；不同观察员并存并标冲突。 */
export function submitConclusion(db: RecorderDB, input: SubmitConclusionInput): ActionResult {
  const slide = findSlide(db, input.slideId);
  const own = slide.conclusions.find(
    (item) =>
      item.viewLabel === input.viewLabel &&
      item.structure.trim() === input.structure.trim() &&
      item.observer === input.observer,
  );
  if (own) {
    if (own.status === "confirmed") {
      pushLog(db, "warn", `${input.observer} 的修订未写入：「${input.structure}」已经教师确认并锁定`);
      return { ok: false, message: "该结论已经教师确认并锁定，提交不能覆盖已确认结论。" };
    }
    own.text = input.text;
    const best = bestLayer(slide, input.viewLabel);
    if (best) own.layerId = best.id;
    pushLog(db, "info", `${input.observer} 修订了「${input.structure}」结论（未新增记录）`);
    return { ok: true, conclusionIds: [own.id], message: "已更新你本人此前的结论，没有产生重复记录。" };
  }

  const conclusion = makeConclusion(input, bestLayer(slide, input.viewLabel));
  const flagged = markConflictPair(slide, conclusion);
  slide.conclusions.push(conclusion);
  if (flagged) {
    pushLog(db, "warn", `${slide.code} ${input.viewLabel}：${input.observer} 提交「${input.structure}」与另一观察员并存，双方均标冲突，后到者未覆盖任何结论`);
    return { ok: true, conclusionIds: [conclusion.id], message: "检测到另一观察员的同结构结论：两边都保留并标记冲突，待教师裁决。" };
  }
  pushLog(db, "ok", `${input.observer} 在 ${slide.code} ${input.viewLabel} 提交结论「${input.structure}」`);
  return { ok: true, conclusionIds: [conclusion.id], message: "结论已登记，等待教师复核确认。" };
}

/**
 * 两名观察员同时提交同一视野：两条都登记、都标冲突；
 * 若该结构已有已确认结论，两条都挂冲突且都不能覆盖它。
 */
export function submitConcurrent(
  db: RecorderDB,
  base: Omit<SubmitConclusionInput, "observer">,
  observers: [string, string],
): ActionResult {
  const slide = findSlide(db, base.slideId);
  const incoming = observers.map((observer) =>
    makeConclusion({ ...base, observer }, bestLayer(slide, base.viewLabel)),
  );

  const confirmed = slide.conclusions.find(
    (item) =>
      item.viewLabel === base.viewLabel &&
      item.structure.trim() === base.structure.trim() &&
      item.status === "confirmed",
  );

  if (confirmed) {
    for (const conclusion of incoming) {
      conclusion.conflict = true;
      conclusion.conflictNote = `与已确认结论（${confirmed.observer}）冲突，待教师裁决，未覆盖原结论`;
    }
    slide.conclusions.push(...incoming);
    pushLog(
      db,
      "danger",
      `${slide.code} ${base.viewLabel}：${observers.join("、")} 同时提交「${base.structure}」，双方并存标冲突；已确认结论（${confirmed.observer}）保留原层未被覆盖`,
    );
    return {
      ok: true,
      conclusionIds: incoming.map((item) => item.id),
      message: "两条提交均已保留并标冲突；该结构已有教师确认结论，后到者未覆盖它。",
    };
  }

  incoming[0].conflict = true;
  incoming[1].conflict = true;
  const note = `与另一观察员同时提交，并存待教师裁决`;
  incoming[0].conflictNote = note;
  incoming[1].conflictNote = note;
  // 同时也与历史中第三方观察员的同结构结论两两标冲突
  for (const conclusion of incoming) markConflictPair(slide, conclusion);
  slide.conclusions.push(...incoming);
  pushLog(db, "warn", `${slide.code} ${base.viewLabel}：${observers.join("、")} 同时提交「${base.structure}」，两边都留并标冲突`);
  return {
    ok: true,
    conclusionIds: incoming.map((item) => item.id),
    message: "两名观察员的提交都已保留，双方标记为冲突，等待教师裁决，任一方都未覆盖对方。",
  };
}

/** 教师确认：结论锁定当前层（保留原层），冲突随之裁决。 */
export function confirmConclusion(
  db: RecorderDB,
  conclusionId: string,
  reviewer: string,
): ActionResult {
  const slide = db.slides.find((item) => item.conclusions.some((c) => c.id === conclusionId));
  const conclusion = slide?.conclusions.find((item) => item.id === conclusionId);
  if (!slide || !conclusion) return { ok: false, message: "找不到结论" };
  if (conclusion.status === "confirmed") {
    return { ok: false, message: "该结论此前已确认，仍保留原层。" };
  }
  conclusion.status = "confirmed" satisfies ConclusionStatus;
  conclusion.confirmedAt = now();
  conclusion.confirmedBy = reviewer;
  // 锁定原层：以提交时来源层为准（sourceLayerId），不再随清晰度漂移
  conclusion.layerId = conclusion.sourceLayerId;
  for (const other of slide.conclusions) {
    if (other.id !== conclusion.id && sameStructure(other, conclusion)) {
      other.conflict = true;
      other.conflictNote = `教师已采纳 ${conclusion.observer} 的结论，本条未被覆盖，保留备查`;
    }
  }
  pushLog(
    db,
    "ok",
    `${reviewer} 确认 ${slide.code}「${conclusion.structure}」（${conclusion.observer}），结论保留原层，冲突已裁决`,
  );
  return { ok: true, message: "结论已确认并锁定原层；后续清晰度更新不再重算本条。" };
}

/* ---------------- 旧记录迁入与复核 ---------------- */

export interface LegacySlideInput {
  sampleId: string;
  code: string;
  magnification: string;
  stain: string;
  /** 旧记录里的文字结论，没有对应焦面层 */
  legacyConclusions: { structure: string; observer: string; text: string }[];
}

/** 旧记录迁入：没有焦面信息一律先标“待核”，结论挂 unlayered。 */
export function importLegacySlide(db: RecorderDB, input: LegacySlideInput): ActionResult {
  const createdAt = now();
  const slideId = nextId("slide");
  const slide: SlideRecord = {
    id: slideId,
    sampleId: input.sampleId,
    code: input.code,
    magnification: input.magnification,
    stain: input.stain,
    legacy: true,
    reviewStatus: "pending",
    reviewNote: "旧记录缺少焦面位置与清晰度信息，需补登焦面后复核",
    layers: [],
    conclusions: input.legacyConclusions.map((item) => ({
      id: nextId("conclusion"),
      slideId,
      viewLabel: "",
      structure: item.structure,
      observer: item.observer,
      text: item.text,
      layerId: "",
      sourceLayerId: "",
      status: "unconfirmed",
      conflict: false,
      recomputeCount: 0,
      unlayered: true,
      createdAt,
    })),
    createdAt,
  };
  db.slides.push(slide);
  pushLog(db, "warn", `旧记录 ${input.code} 迁入：无焦面信息，已标记待核`);
  return { ok: true, slideId, message: "旧记录已迁入并标记待核：补登焦面层并通过教师复核后生效。" };
}

/** 教师复核玻片：仍无任何焦面层的待核记录不能通过。 */
export function reviewSlide(db: RecorderDB, slideId: string, reviewer: string): ActionResult {
  const slide = findSlide(db, slideId);
  if (slide.reviewStatus === "reviewed") {
    return { ok: false, message: "该玻片已完成复核。" };
  }
  if (slide.layers.length === 0) {
    pushLog(db, "danger", `${slide.code} 复核未通过：仍缺少焦面层信息`);
    return { ok: false, message: "复核未通过：该记录仍无任何焦面信息，请先补登焦面层。" };
  }
  slide.reviewStatus = "reviewed";
  slide.reviewNote = `${reviewer} 已核对焦面层与图像（${slide.layers.length} 层）`;
  pushLog(db, "ok", `${slide.code} 复核通过：${slide.reviewNote}`);
  return { ok: true, message: `复核通过：${slide.reviewNote}` };
}

/* ---------------- 统计 ---------------- */

export interface ClassroomStats {
  slides: number;
  pending: number;
  reviewed: number;
  layers: number;
  conclusions: number;
  confirmed: number;
  unconfirmed: number;
  conflicts: number;
  unlayered: number;
  recomputed: number;
  failedUploads: number;
}

export function computeStats(db: RecorderDB): ClassroomStats {
  const stats: ClassroomStats = {
    slides: db.slides.length,
    pending: 0,
    reviewed: 0,
    layers: 0,
    conclusions: 0,
    confirmed: 0,
    unconfirmed: 0,
    conflicts: 0,
    unlayered: 0,
    recomputed: 0,
    failedUploads: 0,
  };
  for (const slide of db.slides) {
    if (slide.reviewStatus === "pending") stats.pending += 1;
    else stats.reviewed += 1;
    stats.layers += slide.layers.length;
    stats.failedUploads += slide.layers.filter((layer) => layer.uploadStatus === "failed").length;
    for (const conclusion of slide.conclusions) {
      stats.conclusions += 1;
      if (conclusion.status === "confirmed") stats.confirmed += 1;
      else stats.unconfirmed += 1;
      if (conclusion.conflict) stats.conflicts += 1;
      if (conclusion.unlayered) stats.unlayered += 1;
      if (conclusion.recomputeCount > 0) stats.recomputed += 1;
    }
  }
  return stats;
}

export function layerById(db: RecorderDB, layerId: string): FocalLayer | undefined {
  for (const slide of db.slides) {
    const layer = slide.layers.find((item) => item.id === layerId);
    if (layer) return layer;
  }
  return undefined;
}
