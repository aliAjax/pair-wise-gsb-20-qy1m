import { useMemo, useState, type ReactNode } from "react";
import "./styles.css";
import type {
  Clarity,
  FocalLayer,
  RecorderDB,
  SlideRecord,
  StructureConclusion,
} from "./types";
import {
  computeStats,
  confirmConclusion,
  importLegacySlide,
  loadDB,
  registerLayer,
  resetDB,
  reviewSlide,
  saveDB,
  submitConcurrent,
  submitConclusion,
  updateClarity,
  uploadLayer,
  type ActionResult,
} from "./store";
import { seedDB } from "./seed";

const OBSERVERS = ["学生甲", "学生乙", "学生丙"];
const TEACHER = "王老师";
const ROLES = [TEACHER, ...OBSERVERS];
const CLARITIES: Clarity[] = ["清晰", "可用", "模糊"];

interface Notice {
  ok: boolean;
  text: string;
}

function timeLabel(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function layerLabel(layer: FocalLayer | undefined): string {
  if (!layer) return "无焦面";
  return `z=${layer.z}μm · ${layer.clarity}`;
}

function Badge({ tone, children }: { tone: string; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

function reviewBadges(slide: SlideRecord) {
  if (slide.reviewStatus === "pending") return <Badge tone="danger">待核</Badge>;
  return <Badge tone="ok">已复核</Badge>;
}

function conclusionBadges(conclusion: StructureConclusion) {
  return (
    <>
      {conclusion.unlayered && <Badge tone="danger">待核 · 无焦面</Badge>}
      {conclusion.status === "confirmed" ? (
        <Badge tone="ok">已确认 · 保留原层</Badge>
      ) : (
        <Badge tone="watch">未确认</Badge>
      )}
      {conclusion.conflict && <Badge tone="danger">冲突待裁决</Badge>}
      {conclusion.recomputeCount > 0 && (
        <Badge tone="info">失效重算 ×{conclusion.recomputeCount}</Badge>
      )}
    </>
  );
}

function App() {
  const [db, setDb] = useState<RecorderDB>(() => loadDB(seedDB));
  const [role, setRole] = useState<string>(TEACHER);
  const [selectedId, setSelectedId] = useState<string>(db.slides[0]?.id ?? "");
  const [notice, setNotice] = useState<Notice | null>(null);

  const isTeacher = role === TEACHER;

  const mutate = (fn: (draft: RecorderDB) => ActionResult): ActionResult => {
    const draft = structuredClone(db) as RecorderDB;
    let result: ActionResult;
    try {
      result = fn(draft);
    } catch (error) {
      result = { ok: false, message: error instanceof Error ? error.message : "操作失败" };
    }
    setDb(draft);
    saveDB(draft);
    setNotice({ ok: result.ok, text: result.message });
    return result;
  };

  const stats = useMemo(() => computeStats(db), [db]);
  const selected = db.slides.find((slide) => slide.id === selectedId) ?? db.slides[0];

  const sampleName = (sampleId: string) =>
    db.samples.find((sample) => sample.id === sampleId)?.name ?? "未知样本";

  const layerMap = useMemo(() => {
    const map = new Map<string, FocalLayer>();
    for (const slide of db.slides) {
      for (const layer of slide.layers) map.set(layer.id, layer);
    }
    return map;
  }, [db]);

  const views = useMemo(
    () => Array.from(new Set(selected?.layers.map((layer) => layer.viewLabel) ?? [])),
    [selected],
  );

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">hxwl-06 · port 5106</p>
          <h1>显微镜玻片观察 · 焦面复核记录</h1>
          <p className="subtitle">
            样本 → 玻片 → 焦面层（位置/清晰度/补传状态）→ 结构结论 全链可恢复：
            清晰度更新后未确认结论失效重算、已确认结论保留原层；同视野双人提交两边都留并标冲突；
            补传失败保留已登记层可重试、同层重传不生成副本；旧记录无焦面信息一律先标待核。
          </p>
        </div>
        <div className="stack-card">
          <span>当前身份（可切换演示）</span>
          <div className="role-row">
            {ROLES.map((item) => (
              <button
                key={item}
                className={item === role ? "role active" : "role"}
                onClick={() => setRole(item)}
              >
                {item}
              </button>
            ))}
          </div>
          <strong>{isTeacher ? "可复核玻片、裁决/确认结论" : "可登记焦面层、补传图像、提交结论"}</strong>
        </div>
      </section>

      {notice && (
        <div className={notice.ok ? "notice notice-ok" : "notice notice-danger"}>
          <span>{notice.ok ? "操作结果" : "未通过"}</span>
          <p>{notice.text}</p>
          <button onClick={() => setNotice(null)}>×</button>
        </div>
      )}

      <section className="metrics-grid">
        <article className="metric-card">
          <span>玻片记录（复核状态）</span>
          <strong>{stats.slides}</strong>
          <p className="metric-sub">
            <b className="text-ok">{stats.reviewed} 已复核</b> ·{" "}
            <b className={stats.pending ? "text-danger" : ""}>{stats.pending} 待核</b>
          </p>
          <i className="status-ok" />
        </article>
        <article className="metric-card">
          <span>焦面层</span>
          <strong>{stats.layers}</strong>
          <p className="metric-sub">
            补传失败 <b className={stats.failedUploads ? "text-danger" : ""}>{stats.failedUploads}</b>
          </p>
          <i className="status-watch" />
        </article>
        <article className="metric-card">
          <span>结构结论</span>
          <strong>{stats.conclusions}</strong>
          <p className="metric-sub">
            <b className="text-ok">{stats.confirmed} 已确认</b> · {stats.unconfirmed} 未确认
          </p>
          <i className="status-danger" />
        </article>
        <article className="metric-card">
          <span>待处理事项</span>
          <strong>{stats.pending + stats.conflicts + stats.failedUploads}</strong>
          <p className="metric-sub">
            待核 {stats.pending} · 冲突 {stats.conflicts} · 补传失败 {stats.failedUploads}
          </p>
          <i className="status-watch" />
        </article>
      </section>

      <section className="workspace">
        <aside className="panel narrow">
          <div className="section-heading compact">
            <h2>样本 / 玻片</h2>
            <button
              onClick={() => {
                const result = mutate((draft) =>
                  importLegacySlide(draft, {
                    sampleId: "sample-paramecium",
                    code: `OLD-2025-${String(draft.slides.length + 1).padStart(3, "0")}`,
                    magnification: "200x",
                    stain: "活体观察",
                    legacyConclusions: [
                      { structure: "伸缩泡", observer: "往届学生", text: "端部可见周期性收缩（旧记录，无焦面）" },
                    ],
                  }),
                );
                if (result.ok && result.slideId) setSelectedId(result.slideId);
              }}
            >
              迁入旧记录
            </button>
          </div>
          <div className="slide-nav">
            {db.slides.map((slide) => {
              const conflicts = slide.conclusions.filter((c) => c.conflict).length;
              const failed = slide.layers.filter((l) => l.uploadStatus === "failed").length;
              return (
                <button
                  key={slide.id}
                  className={selected?.id === slide.id ? "slide-item active" : "slide-item"}
                  onClick={() => setSelectedId(slide.id)}
                >
                  <span className="slide-item-head">
                    <strong>{slide.code}</strong>
                    {reviewBadges(slide)}
                  </span>
                  <span className="slide-item-meta">
                    {sampleName(slide.sampleId)} · {slide.magnification}
                  </span>
                  <span className="slide-item-flags">
                    {slide.legacy && <em>旧记录</em>}
                    {conflicts > 0 && <em className="flag-danger">冲突 {conflicts}</em>}
                    {failed > 0 && <em className="flag-danger">补传失败 {failed}</em>}
                    {slide.layers.length > 0 && <em>{slide.layers.length} 层</em>}
                  </span>
                </button>
              );
            })}
          </div>
          <button
            className="reset-btn"
            onClick={() => {
              const fresh = resetDB(seedDB);
              setDb(fresh);
              saveDB(fresh);
              setSelectedId(fresh.slides[0].id);
              setNotice({ ok: true, text: "已恢复课堂演示数据。" });
            }}
          >
            重置演示数据
          </button>
        </aside>

        {selected && <SlideDetail
          key={selected.id}
          db={db}
          slide={selected}
          role={role}
          isTeacher={isTeacher}
          views={views}
          mutate={mutate}
        />}
      </section>

      <AllConclusions db={db} layerMap={layerMap} isTeacher={isTeacher} mutate={mutate} />

      <section className="records panel">
        <div className="section-heading">
          <div>
            <p>课堂统计</p>
            <h2>复核状态总览</h2>
          </div>
        </div>
        <div className="stats-grid">
          <div className="stat-box">
            <h3>玻片复核</h3>
            <p><Badge tone="danger">待核 {stats.pending}</Badge> <Badge tone="ok">已复核 {stats.reviewed}</Badge></p>
            <p className="stat-hint">旧记录缺焦面信息时进入待核，补登焦面并经教师复核后转为已复核</p>
          </div>
          <div className="stat-box">
            <h3>结论状态</h3>
            <p>
              <Badge tone="ok">已确认 {stats.confirmed}</Badge>
              <Badge tone="watch">未确认 {stats.unconfirmed}</Badge>
              <Badge tone="danger">冲突 {stats.conflicts}</Badge>
            </p>
            <p className="stat-hint">
              无焦面旧结论 <Badge tone="danger">{stats.unlayered} 待核</Badge>，
              因清晰度更新重算过 <Badge tone="info">{stats.recomputed}</Badge>
            </p>
          </div>
          <div className="stat-box">
            <h3>焦面图像</h3>
            <p>
              共 {stats.layers} 层，
              <Badge tone="danger">补传失败 {stats.failedUploads}</Badge>
            </p>
            <p className="stat-hint">失败后已登记层保留、可重试；重传同一焦面位置不会生成副本</p>
          </div>
        </div>
      </section>

      <section className="records panel">
        <div className="section-heading">
          <div>
            <p>可恢复记录日志</p>
            <h2>操作轨迹</h2>
          </div>
        </div>
        <ul className="log-list">
          {db.log.map((entry) => (
            <li key={entry.id} className={`log-${entry.kind}`}>
              <time>{timeLabel(entry.at)}</time>
              <span>{entry.text}</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

/* ---------------- 玻片详情 ---------------- */

function SlideDetail({
  db,
  slide,
  role,
  isTeacher,
  views,
  mutate,
}: {
  db: RecorderDB;
  slide: SlideRecord;
  role: string;
  isTeacher: boolean;
  views: string[];
  mutate: (fn: (draft: RecorderDB) => ActionResult) => ActionResult;
}) {
  const [viewInput, setViewInput] = useState(slide.layers[0]?.viewLabel ?? "视野A");
  const [zInput, setZInput] = useState("20");
  const [clarityInput, setClarityInput] = useState<Clarity>("清晰");

  const [submitView, setSubmitView] = useState(slide.layers[0]?.viewLabel ?? "");
  const [structureInput, setStructureInput] = useState("");
  const [textInput, setTextInput] = useState("");
  const observerDefault = ROLES.includes(role) && role !== TEACHER ? role : "学生甲";
  const [observer, setObserver] = useState(observerDefault);

  const grouped = views.map((view) => ({
    view,
    layers: slide.layers
      .filter((layer) => layer.viewLabel === view)
      .sort((a, b) => a.z - b.z),
  }));

  const submitDisabled =
    views.length === 0 || !structureInput.trim() || !textInput.trim() || !submitView;

  const doSubmit = (concurrent: boolean) => {
    const base = {
      slideId: slide.id,
      viewLabel: submitView,
      structure: structureInput.trim(),
      text: textInput.trim(),
    };
    const result = mutate((draft) =>
      concurrent
        ? submitConcurrent(draft, base, ["学生甲", "学生丙"])
        : submitConclusion(draft, { ...base, observer }),
    );
    if (result.ok) {
      setStructureInput("");
      setTextInput("");
    }
  };

  return (
    <section className="panel detail-panel">
      <div className="section-heading">
        <div>
          <p>{slide.legacy ? "旧记录迁入" : "课堂记录"}</p>
          <h2>
            {slide.code} · {db.samples.find((s) => s.id === slide.sampleId)?.name}
          </h2>
          <p className="detail-meta">
            {slide.magnification} · {slide.stain} · 登记于 {timeLabel(slide.createdAt)}
          </p>
        </div>
        <div className="heading-actions">
          {reviewBadges(slide)}
          <button
            className="primary-action"
            disabled={!isTeacher || slide.reviewStatus === "reviewed"}
            title={!isTeacher ? "仅教师可复核" : slide.layers.length === 0 ? "仍无焦面层，无法通过复核" : ""}
            onClick={() => mutate((draft) => reviewSlide(draft, slide.id, TEACHER))}
          >
            {slide.reviewStatus === "reviewed" ? "复核已完成" : "教师复核通过"}
          </button>
        </div>
      </div>

      {slide.reviewStatus === "pending" && (
        <div className="callout callout-danger">
          <strong>待核：</strong>{slide.reviewNote}
          {slide.layers.length === 0
            ? "请在下方补登焦面层（含焦面位置与清晰度）后，再由教师复核。"
            : `已补登 ${slide.layers.length} 个焦面层，可由教师复核通过。`}
        </div>
      )}

      {/* 焦面层 */}
      <div className="block">
        <div className="block-head">
          <h3>焦面层</h3>
          <p>每层记录焦面位置 z(μm)、清晰度与补传状态；同视野同 z 即同一层，重传不生成副本。</p>
        </div>

        <div className="register-form">
          <label>
            <span>视野</span>
            <input list="view-options" value={viewInput} onChange={(e) => setViewInput(e.target.value)} />
            <datalist id="view-options">
              {Array.from(new Set([...views, "视野A", "视野B", "中央视野"])).map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
          </label>
          <label className="z-field">
            <span>焦面位置 z(μm)</span>
            <input type="number" value={zInput} onChange={(e) => setZInput(e.target.value)} />
          </label>
          <label>
            <span>清晰度</span>
            <select value={clarityInput} onChange={(e) => setClarityInput(e.target.value as Clarity)}>
              {CLARITIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
          <button
            className="primary-action"
            disabled={!viewInput.trim()}
            onClick={() =>
              mutate((draft) =>
                registerLayer(draft, {
                  slideId: slide.id,
                  viewLabel: viewInput.trim(),
                  z: Number(zInput),
                  clarity: clarityInput,
                }),
              )
            }
          >
            登记 / 重登焦面层
          </button>
        </div>

        {grouped.length === 0 && (
          <p className="empty-hint">该玻片还没有焦面层 —— 旧记录在此状态下保持“待核”。</p>
        )}

        <div className="view-groups">
          {grouped.map((group) => (
            <div key={group.view} className="view-group">
              <h4>{group.view}</h4>
              <div className="layer-list">
                {group.layers.map((layer) => (
                  <article key={layer.id} className="layer-card">
                    <div className="layer-main">
                      <strong>z = {layer.z} μm</strong>
                      <label className="clarity-edit">
                        清晰度
                        <select
                          value={layer.clarity}
                          onChange={(e) =>
                            mutate((draft) =>
                              updateClarity(draft, { layerId: layer.id, clarity: e.target.value as Clarity }),
                            )
                          }
                        >
                          {CLARITIES.map((c) => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div className="layer-status">
                      {layer.uploadStatus === "uploaded" && <Badge tone="ok">图像已传</Badge>}
                      {layer.uploadStatus === "registered" && <Badge tone="watch">已登记 · 待补传</Badge>}
                      {layer.uploadStatus === "failed" && <Badge tone="danger">补传失败 · 层已保留</Badge>}
                      {layer.imageName && <span className="image-name">{layer.imageName}</span>}
                    </div>
                    {layer.uploadError && <p className="layer-error">{layer.uploadError}</p>}
                    <div className="layer-actions">
                      {layer.uploadStatus !== "uploaded" && (
                        <>
                          <button
                            onClick={() =>
                              mutate((draft) =>
                                uploadLayer(
                                  draft,
                                  layer.id,
                                  `${slide.code}-${layer.viewLabel}-z${layer.z}.jpg`,
                                  false,
                                ),
                              )
                            }
                          >
                            {layer.uploadStatus === "failed" ? "重试补传" : "补传图像"}
                          </button>
                          {layer.uploadStatus === "registered" && (
                            <button
                              className="ghost-danger"
                              onClick={() =>
                                mutate((draft) => uploadLayer(draft, layer.id, "", true))
                              }
                            >
                              模拟补传失败
                            </button>
                          )}
                        </>
                      )}
                      {layer.uploadStatus === "uploaded" && (
                        <button
                          onClick={() =>
                            mutate((draft) =>
                              uploadLayer(
                                draft,
                                layer.id,
                                `${slide.code}-${layer.viewLabel}-z${layer.z}-v2.jpg`,
                                false,
                              ),
                            )
                          }
                        >
                          重传本层（不生成副本）
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 结论提交 */}
      <div className="block">
        <div className="block-head">
          <h3>提交结构结论</h3>
          <p>
            两名观察员对同一视野同一结构提交时两边都留并标冲突；后到者不能覆盖已确认结论。
          </p>
        </div>
        {views.length === 0 ? (
          <p className="empty-hint">待核旧记录尚无焦面/视野，补登焦面层后才能提交结构结论。</p>
        ) : (
          <div className="conclusion-form">
            <label>
              <span>观察员</span>
              <select value={observer} onChange={(e) => setObserver(e.target.value)}>
                {OBSERVERS.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </label>
            <label>
              <span>视野</span>
              <select value={submitView} onChange={(e) => setSubmitView(e.target.value)}>
                <option value="">选择视野</option>
                {views.map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </label>
            <label>
              <span>观察结构</span>
              <input
                placeholder="如：细胞核 / 细胞壁 / 白细胞"
                value={structureInput}
                onChange={(e) => setStructureInput(e.target.value)}
              />
            </label>
            <label className="grow">
              <span>结论描述</span>
              <input
                placeholder="描述该结构在所选焦面层的形态"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
              />
            </label>
            <button className="primary-action" disabled={submitDisabled} onClick={() => doSubmit(false)}>
              提交结论
            </button>
            <button
              disabled={submitDisabled}
              title="模拟学生甲与学生丙几乎同时提交同一视野"
              onClick={() => doSubmit(true)}
            >
              两人同时提交（甲 + 丙）
            </button>
          </div>
        )}
      </div>

      {/* 本玻片结论 */}
      <div className="block">
        <div className="block-head">
          <h3>结构结论（本玻片）</h3>
          <p>清晰度更新后，未确认结论自动失效重算到当前最清晰层；已确认结论始终保留原层。</p>
        </div>
        <div className="conclusion-list">
          {slide.conclusions.map((conclusion) => (
            <ConclusionRow
              key={conclusion.id}
              slide={slide}
              conclusion={conclusion}
              layerById={(id) => slide.layers.find((l) => l.id === id)}
              isTeacher={isTeacher}
              mutate={mutate}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function ConclusionRow({
  slide,
  conclusion,
  layerById,
  isTeacher,
  mutate,
}: {
  slide: SlideRecord;
  conclusion: StructureConclusion;
  layerById: (id: string) => FocalLayer | undefined;
  isTeacher: boolean;
  mutate: (fn: (draft: RecorderDB) => ActionResult) => ActionResult;
}) {
  const current = layerById(conclusion.layerId);
  const source = layerById(conclusion.sourceLayerId);
  const moved = !conclusion.unlayered && current && source && current.id !== source.id;

  return (
    <article className={`conclusion-card ${conclusion.status === "confirmed" ? "locked" : ""}`}>
      <div className="conclusion-head">
        <strong>
          {conclusion.structure}
          <em>· {conclusion.observer}</em>
        </strong>
        <div className="badge-row">{conclusionBadges(conclusion)}</div>
      </div>
      <p className="conclusion-text">{conclusion.text}</p>
      <div className="conclusion-meta">
        <span>视野：{conclusion.viewLabel || "—（旧记录未标注）"}</span>
        {conclusion.unlayered ? (
          <span className="text-danger">依据焦面：待核，旧记录无焦面信息</span>
        ) : conclusion.status === "confirmed" ? (
          <span className="text-ok">依据层（锁定原层）：{layerLabel(source ?? current)}</span>
        ) : (
          <span>
            当前依据层：{layerLabel(current)}
            {moved && <em className="moved-note">（提交时原层 {layerLabel(source)}，已失效重算）</em>}
          </span>
        )}
        <span>提交 {timeLabel(conclusion.createdAt)}</span>
        {conclusion.confirmedAt && <span>确认 {timeLabel(conclusion.confirmedAt)} · {conclusion.confirmedBy}</span>}
      </div>
      {conclusion.conflictNote && <p className="conflict-note">⚠ {conclusion.conflictNote}</p>}
      {isTeacher && conclusion.status !== "confirmed" && !conclusion.unlayered && (
        <div className="conclusion-actions">
          <button
            className="primary-action"
            onClick={() => mutate((draft) => confirmConclusion(draft, conclusion.id, TEACHER))}
          >
            采纳并确认（锁定本层）
          </button>
          <span className="hint-inline">玻片：{slide.code} · 确认后保留 {layerLabel(source ?? current)}，不再随清晰度重算</span>
        </div>
      )}
    </article>
  );
}

/* ---------------- 全部结论（详情之外也显示复核状态） ---------------- */

function AllConclusions({
  db,
  layerMap,
  isTeacher,
  mutate,
}: {
  db: RecorderDB;
  layerMap: Map<string, FocalLayer>;
  isTeacher: boolean;
  mutate: (fn: (draft: RecorderDB) => ActionResult) => ActionResult;
}) {
  const rows = db.slides.flatMap((slide) =>
    slide.conclusions.map((conclusion) => ({ slide, conclusion })),
  );

  return (
    <section className="records panel">
      <div className="section-heading">
        <div>
          <p>结论列表（全部玻片）</p>
          <h2>结构结论与复核状态</h2>
        </div>
      </div>
      <div className="table-wrap">
        <table className="conclusion-table">
          <thead>
            <tr>
              <th>玻片</th>
              <th>复核状态</th>
              <th>视野 / 结构</th>
              <th>观察员</th>
              <th>依据焦面层</th>
              <th>结论状态</th>
              <th>{isTeacher ? "裁决" : ""}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ slide, conclusion }) => {
              const layer = layerMap.get(conclusion.layerId);
              return (
                <tr key={conclusion.id} className={conclusion.conflict ? "row-conflict" : ""}>
                  <td>
                    <strong>{slide.code}</strong>
                    {slide.legacy && <em className="flag-danger"> 旧</em>}
                  </td>
                  <td>{reviewBadges(slide)}</td>
                  <td>
                    {conclusion.viewLabel || "—"}
                    <br />
                    <strong>{conclusion.structure}</strong>
                  </td>
                  <td>{conclusion.observer}</td>
                  <td>
                    {conclusion.unlayered ? (
                      <Badge tone="danger">待核 · 无焦面</Badge>
                    ) : (
                      <>
                        {layerLabel(layer)}
                        {conclusion.status === "confirmed" && (
                          <span className="text-ok">（锁定）</span>
                        )}
                        {conclusion.recomputeCount > 0 && (
                          <em className="moved-note"> 重算×{conclusion.recomputeCount}</em>
                        )}
                      </>
                    )}
                  </td>
                  <td>
                    <div className="badge-row">{conclusionBadges(conclusion)}</div>
                    {conclusion.conflictNote && <p className="conflict-note tight">⚠ {conclusion.conflictNote}</p>}
                  </td>
                  <td>
                    {isTeacher && conclusion.status !== "confirmed" && !conclusion.unlayered && (
                      <button
                        onClick={() => mutate((draft) => confirmConclusion(draft, conclusion.id, TEACHER))}
                      >
                        确认
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default App;
