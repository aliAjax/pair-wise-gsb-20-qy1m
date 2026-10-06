import { reviewStatusOf } from "./types";
import type { AppState, AuditEvent, Conclusion, FocalLayer } from "./types";

let seq = 0;
const uid = (prefix: string) =>
  `${prefix}_${Date.now().toString(36)}_${(seq++).toString(36)}`;

export interface LayerInput {
  zIndex: number;
  focalPosition: number;
  sharpness: number;
  observer: string;
  upload?: FocalLayer["upload"];
}

export interface ConclusionInput {
  structure: string;
  note: string;
  layerZIndex?: number;
}

function log(state: AppState, actor: string, action: string, detail: string): AppState {
  const event: AuditEvent = { id: uid("ev"), at: Date.now(), actor, action, detail };
  return { ...state, audit: [event, ...state.audit].slice(0, 200) };
}

function fieldName(state: AppState, fieldId: string): string {
  return state.fields.find((f) => f.id === fieldId)?.label ?? fieldId;
}

/** 视野内最佳可用层（补传失败的层不参与重算） */
export function bestLayerId(layers: FocalLayer[], fieldId: string): string | null {
  const usable = layers.filter((l) => l.fieldId === fieldId && l.upload !== "failed");
  if (usable.length === 0) return null;
  return usable.reduce((a, b) => (b.sharpness > a.sharpness ? b : a)).id;
}

/**
 * 清晰度更新：未确认结论失效并按最佳可用层重算；已确认结论保留原层不动。
 */
function applySharpnessChange(
  state: AppState,
  layerId: string,
  sharpness: number,
  actor: string
): AppState {
  const layer = state.layers.find((l) => l.id === layerId);
  if (!layer || layer.sharpness === sharpness) return state;

  let next: AppState = {
    ...state,
    layers: state.layers.map((l) =>
      l.id === layerId ? { ...l, sharpness, updatedAt: Date.now() } : l
    ),
  };

  const affected = next.conclusions.filter(
    (c) => c.layerId === layerId && c.state === "unconfirmed"
  );
  const where = `${fieldName(next, layer.fieldId)} 第 ${layer.zIndex} 层`;

  if (affected.length === 0) {
    return log(
      next,
      actor,
      "清晰度更新",
      `${where}清晰度 ${layer.sharpness} → ${sharpness}；无未确认结论受影响，已确认结论保留原层`
    );
  }

  const targetLayerId = bestLayerId(next.layers, layer.fieldId) ?? layerId;
  const recalculated: Conclusion[] = affected.map((old) => ({
    id: uid("cc"),
    fieldId: old.fieldId,
    layerId: targetLayerId,
    structure: old.structure,
    note: old.note,
    observer: old.observer,
    state: "unconfirmed" as const,
    conflict: old.conflict,
    supersededBy: null,
    recalculatedFrom: old.id,
    createdAt: Date.now(),
    confirmedBy: null,
  }));
  const newIdByOld = new Map(affected.map((old, i) => [old.id, recalculated[i].id]));

  next = {
    ...next,
    conclusions: [
      ...next.conclusions.map((c) =>
        newIdByOld.has(c.id)
          ? { ...c, state: "invalidated" as const, supersededBy: newIdByOld.get(c.id) ?? null }
          : c
      ),
      ...recalculated,
    ],
  };

  const target = next.layers.find((l) => l.id === targetLayerId);
  return log(
    next,
    actor,
    "清晰度更新",
    `${where}清晰度 ${layer.sharpness} → ${sharpness}；${affected.length} 条未确认结论失效，已重算至第 ${target?.zIndex ?? "?"} 层；已确认结论保留原层`
  );
}

export function updateSharpness(
  state: AppState,
  layerId: string,
  sharpness: number,
  actor: string
): AppState {
  return applySharpnessChange(state, layerId, sharpness, actor);
}

/**
 * 登记/重传焦面层：同一视野同一层号原地更新，不生成副本（幂等）。
 */
export function registerLayer(
  state: AppState,
  fieldId: string,
  input: LayerInput,
  actor: string
): AppState {
  const existing = state.layers.find(
    (l) => l.fieldId === fieldId && l.zIndex === input.zIndex
  );

  if (existing) {
    let next: AppState = {
      ...state,
      layers: state.layers.map((l) =>
        l.id === existing.id
          ? {
              ...l,
              focalPosition: input.focalPosition,
              observer: input.observer,
              upload: input.upload ?? l.upload,
              updatedAt: Date.now(),
            }
          : l
      ),
    };
    next = log(
      next,
      actor,
      "重传焦面层",
      `${fieldName(next, fieldId)} 第 ${input.zIndex} 层原地更新，未生成副本`
    );
    if (input.sharpness !== existing.sharpness) {
      next = applySharpnessChange(next, existing.id, input.sharpness, actor);
    }
    return next;
  }

  const layer: FocalLayer = {
    id: uid("ly"),
    fieldId,
    zIndex: input.zIndex,
    focalPosition: input.focalPosition,
    sharpness: input.sharpness,
    observer: input.observer,
    upload: input.upload ?? "registered",
    conflict: false,
    updatedAt: Date.now(),
  };
  return log(
    { ...state, layers: [...state.layers, layer] },
    actor,
    "登记焦面层",
    `${fieldName(state, fieldId)} 新增第 ${input.zIndex} 层（${input.focalPosition} µm，清晰度 ${input.sharpness}）`
  );
}

/** 补传失败：保留已登记层，允许重试 */
export function markUploadFailed(state: AppState, layerId: string, actor: string): AppState {
  const layer = state.layers.find((l) => l.id === layerId);
  if (!layer || layer.upload === "failed") return state;
  const next: AppState = {
    ...state,
    layers: state.layers.map((l) =>
      l.id === layerId ? { ...l, upload: "failed", updatedAt: Date.now() } : l
    ),
  };
  return log(
    next,
    actor,
    "补传失败",
    `${fieldName(next, layer.fieldId)} 第 ${layer.zIndex} 层图像补传失败；登记信息保留，可重试`
  );
}

/** 重试补传：同一层恢复为已上传，不生成副本 */
export function retryUpload(state: AppState, layerId: string, actor: string): AppState {
  const layer = state.layers.find((l) => l.id === layerId);
  if (!layer || layer.upload !== "failed") return state;
  const next: AppState = {
    ...state,
    layers: state.layers.map((l) =>
      l.id === layerId ? { ...l, upload: "uploaded", updatedAt: Date.now() } : l
    ),
  };
  return log(
    next,
    actor,
    "重试补传",
    `${fieldName(next, layer.fieldId)} 第 ${layer.zIndex} 层补传成功；同一层未生成副本`
  );
}

/**
 * 提交观察：若同一视野已有其他观察员的记录，视为并发提交——
 * 双方记录均保留并标记冲突；后到者的结论不覆盖已确认结论，仅以未确认入库。
 */
export function submitObservation(
  state: AppState,
  fieldId: string,
  observer: string,
  layers: LayerInput[],
  conclusions: ConclusionInput[]
): AppState {
  const hasOthers =
    state.layers.some((l) => l.fieldId === fieldId && l.observer !== observer) ||
    state.conclusions.some((c) => c.fieldId === fieldId && c.observer !== observer);

  let next = state;
  if (hasOthers) {
    next = {
      ...next,
      layers: next.layers.map((l) => (l.fieldId === fieldId ? { ...l, conflict: true } : l)),
      conclusions: next.conclusions.map((c) =>
        c.fieldId === fieldId ? { ...c, conflict: true } : c
      ),
    };
    next = log(
      next,
      observer,
      "并发提交",
      `${fieldName(next, fieldId)} 出现两名观察员同时提交：双方记录均保留并标记冲突，已确认结论不被覆盖`
    );
  }

  for (const l of layers) {
    next = registerLayer(next, fieldId, { ...l, observer }, observer);
  }
  if (hasOthers) {
    next = {
      ...next,
      layers: next.layers.map((l) => (l.fieldId === fieldId ? { ...l, conflict: true } : l)),
    };
  }

  for (const c of conclusions) {
    const layer =
      c.layerZIndex != null
        ? next.layers.find((l) => l.fieldId === fieldId && l.zIndex === c.layerZIndex)
        : undefined;
    const blockedByConfirmed = next.conclusions.some(
      (x) => x.fieldId === fieldId && x.structure === c.structure && x.state === "confirmed"
    );
    const conclusion: Conclusion = {
      id: uid("cc"),
      fieldId,
      layerId: layer ? layer.id : null,
      structure: c.structure,
      note: c.note,
      observer,
      state: "unconfirmed",
      conflict: hasOthers,
      supersededBy: null,
      recalculatedFrom: null,
      createdAt: Date.now(),
      confirmedBy: null,
    };
    next = { ...next, conclusions: [...next.conclusions, conclusion] };
    next = log(
      next,
      observer,
      "提交结论",
      blockedByConfirmed
        ? `「${c.structure}」已存在已确认结论，后到提交保留为未确认，不覆盖已确认结论`
        : `「${c.structure}」登记为未确认结论，待教师复核`
    );
  }
  return next;
}

/** 教师复核确认：确认后保留原层作为依据层 */
export function confirmConclusion(
  state: AppState,
  conclusionId: string,
  reviewer: string
): AppState {
  const c = state.conclusions.find((x) => x.id === conclusionId);
  if (!c || c.state !== "unconfirmed") return state;
  const next: AppState = {
    ...state,
    conclusions: state.conclusions.map((x) =>
      x.id === conclusionId
        ? { ...x, state: "confirmed" as const, confirmedBy: reviewer }
        : x
    ),
  };
  const layer = c.layerId ? next.layers.find((l) => l.id === c.layerId) : undefined;
  return log(
    next,
    reviewer,
    "复核确认",
    layer
      ? `「${c.structure}」结论已确认，保留第 ${layer.zIndex} 层作为依据层`
      : `「${c.structure}」结论已确认；该结论缺少焦面信息，仍标记待核`
  );
}

export interface Summary {
  total: number;
  legacy: number;
  pending: number;
  reviewed: number;
  invalidated: number;
  conflicts: number;
}

export function summarize(conclusions: Conclusion[]): Summary {
  const s: Summary = {
    total: conclusions.length,
    legacy: 0,
    pending: 0,
    reviewed: 0,
    invalidated: 0,
    conflicts: 0,
  };
  for (const c of conclusions) {
    s[reviewStatusOf(c)] += 1;
    if (c.conflict) s.conflicts += 1;
  }
  return s;
}
