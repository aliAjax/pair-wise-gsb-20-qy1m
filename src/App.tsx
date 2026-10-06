import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import "./styles.css";
import { reviewLabels, reviewStatusOf, stateLabels, uploadLabels } from "./domain/types";
import type { AppState, Conclusion } from "./domain/types";
import {
  bestLayerId,
  confirmConclusion,
  markUploadFailed,
  registerLayer,
  retryUpload,
  submitObservation,
  summarize,
  updateSharpness,
} from "./domain/store";
import { seedState } from "./domain/seed";

const STORAGE_KEY = "hxwl-06-state-v1";
const TEACHER = "实验课教师";
const STUDENTS = ["学生小李", "学生小王"];

function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AppState;
      if (parsed && Array.isArray(parsed.layers) && Array.isArray(parsed.conclusions)) {
        return parsed;
      }
    }
  } catch {
    /* 缓存损坏时回退到示例数据 */
  }
  return seedState();
}

const fmtTime = (ts: number) =>
  new Date(ts).toLocaleString("zh-CN", {
    hour12: false,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

const reviewTone: Record<string, string> = {
  reviewed: "ok",
  pending: "warn",
  legacy: "danger",
  invalidated: "muted",
};

function Badge({ tone, children }: { tone: string; children: ReactNode }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

function SharpnessEditor({ value, onSave }: { value: number; onSave: (v: number) => void }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  return (
    <span className="sharp-edit">
      <input
        type="number"
        min={0}
        max={100}
        value={v}
        onChange={(e) => setV(e.target.value)}
      />
      <button
        className="mini"
        onClick={() => {
          const n = Number(v);
          if (Number.isFinite(n)) onSave(Math.max(0, Math.min(100, Math.round(n))));
        }}
      >
        更新清晰度
      </button>
    </span>
  );
}

function NewLayerForm({
  defaultZ,
  onAdd,
}: {
  defaultZ: number;
  onAdd: (z: number, pos: number, sharp: number) => void;
}) {
  const [z, setZ] = useState(String(defaultZ));
  const [pos, setPos] = useState("14.5");
  const [sharp, setSharp] = useState("80");
  useEffect(() => setZ(String(defaultZ)), [defaultZ]);
  return (
    <div className="form-row">
      <label>
        <span>层号</span>
        <input type="number" min={1} value={z} onChange={(e) => setZ(e.target.value)} />
      </label>
      <label>
        <span>焦面位置 (µm)</span>
        <input
          type="number"
          step="0.1"
          value={pos}
          onChange={(e) => setPos(e.target.value)}
        />
      </label>
      <label>
        <span>清晰度</span>
        <input
          type="number"
          min={0}
          max={100}
          value={sharp}
          onChange={(e) => setSharp(e.target.value)}
        />
      </label>
      <button
        className="primary-action"
        onClick={() => {
          const zi = Math.max(1, Math.round(Number(z) || defaultZ));
          const p = Number(pos);
          const sh = Number(sharp);
          if (Number.isFinite(p) && Number.isFinite(sh)) {
            onAdd(zi, p, Math.max(0, Math.min(100, Math.round(sh))));
          }
        }}
      >
        登记 / 重传该层
      </button>
    </div>
  );
}

function StatBar({
  label,
  count,
  total,
  tone,
}: {
  label: string;
  count: number;
  total: number;
  tone: string;
}) {
  const pct = total === 0 ? 0 : Math.round((count / total) * 100);
  return (
    <div className="stat-bar">
      <span className="stat-label">{label}</span>
      <span className="stat-track">
        <i className={tone} style={{ width: `${pct}%` }} />
      </span>
      <span className="stat-count">{count}</span>
    </div>
  );
}

function ConclusionCard({
  c,
  layerText,
  chainText,
  onConfirm,
}: {
  c: Conclusion;
  layerText: string;
  chainText?: string;
  onConfirm: (id: string) => void;
}) {
  const review = reviewStatusOf(c);
  return (
    <article className={`conclusion-card ${c.state}`}>
      <div className="conclusion-head">
        <strong>{c.structure}</strong>
        <div className="badge-row">
          <Badge tone={reviewTone[review]}>{reviewLabels[review]}</Badge>
          <Badge
            tone={
              c.state === "confirmed" ? "ok" : c.state === "invalidated" ? "muted" : "info"
            }
          >
            {stateLabels[c.state]}
          </Badge>
          {c.conflict && <Badge tone="danger">冲突</Badge>}
        </div>
      </div>
      <p className="note">{c.note}</p>
      <p className="meta">
        {chainText ? `${chainText} · ` : ""}
        {layerText} · {c.observer}
        {c.confirmedBy ? ` · 复核人：${c.confirmedBy}` : ""}
      </p>
      {(c.recalculatedFrom || c.supersededBy) && (
        <p className="meta recalc">
          {c.recalculatedFrom ? "由失效结论按最新清晰度重算而来" : ""}
          {c.supersededBy ? "已失效，结论已重算至最佳可用层" : ""}
        </p>
      )}
      {c.state === "unconfirmed" && (
        <div>
          <button className="mini primary" onClick={() => onConfirm(c.id)}>
            教师复核确认
          </button>
        </div>
      )}
    </article>
  );
}

export default function App() {
  const [state, setState] = useState<AppState>(loadState);
  const [actor, setActor] = useState<string>(STUDENTS[0]);
  const [selectedFieldId, setSelectedFieldId] = useState<string>("fv1");

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* 存储失败不影响当前会话 */
    }
  }, [state]);

  const lookups = useMemo(
    () => ({
      layerById: new Map(state.layers.map((l) => [l.id, l])),
      fieldById: new Map(state.fields.map((f) => [f.id, f])),
      slideById: new Map(state.slides.map((s) => [s.id, s])),
      sampleById: new Map(state.samples.map((s) => [s.id, s])),
    }),
    [state]
  );

  const field = lookups.fieldById.get(selectedFieldId) ?? state.fields[0];

  const fieldLayers = useMemo(
    () =>
      state.layers
        .filter((l) => l.fieldId === field.id)
        .sort((a, b) => a.zIndex - b.zIndex),
    [state.layers, field.id]
  );
  const fieldConclusions = useMemo(
    () =>
      state.conclusions
        .filter((c) => c.fieldId === field.id)
        .sort((a, b) => b.createdAt - a.createdAt),
    [state.conclusions, field.id]
  );
  const allConclusions = useMemo(
    () => [...state.conclusions].sort((a, b) => b.createdAt - a.createdAt),
    [state.conclusions]
  );
  const fieldSummary = useMemo(() => summarize(fieldConclusions), [fieldConclusions]);
  const totalSummary = useMemo(() => summarize(state.conclusions), [state.conclusions]);
  const bestId = bestLayerId(state.layers, field.id);

  const slide = lookups.slideById.get(field.slideId);
  const sample = slide ? lookups.sampleById.get(slide.sampleId) : undefined;
  const chainText = `${sample?.name ?? "未知样本"} / 玻片 ${slide?.code ?? "?"} / ${field.label} / ${field.magnification}`;

  const chainTextOf = (fieldId: string) => {
    const f = lookups.fieldById.get(fieldId);
    const sl = f ? lookups.slideById.get(f.slideId) : undefined;
    const sp = sl ? lookups.sampleById.get(sl.sampleId) : undefined;
    return `${sp?.name ?? "?"} · ${sl?.code ?? "?"} · ${f?.label ?? "?"}`;
  };

  const layerText = (layerId: string | null) => {
    if (layerId === null) return "无焦面信息";
    const l = lookups.layerById.get(layerId);
    return l
      ? `第 ${l.zIndex} 层 · ${l.focalPosition.toFixed(1)} µm · 清晰度 ${l.sharpness}`
      : "依据层缺失";
  };

  const otherObserver = fieldLayers.some((l) => l.observer === STUDENTS[1])
    ? STUDENTS[0]
    : STUDENTS[1];
  const maxZ = fieldLayers.reduce((m, l) => Math.max(m, l.zIndex), 0);

  const layerUploadCount = (status: string) =>
    state.layers.filter((l) => l.upload === status).length;

  const handleAddLayer = (z: number, pos: number, sharp: number) =>
    setState((s) =>
      registerLayer(
        s,
        field.id,
        { zIndex: z, focalPosition: pos, sharpness: sharp, observer: actor, upload: "registered" },
        actor
      )
    );

  const handleConcurrent = () => {
    const lastPos = fieldLayers.length
      ? fieldLayers[fieldLayers.length - 1].focalPosition
      : 10;
    const confirmed = fieldConclusions.find((c) => c.state === "confirmed");
    setState((s) =>
      submitObservation(
        s,
        field.id,
        otherObserver,
        [
          {
            zIndex: maxZ + 1,
            focalPosition: Math.round((lastPos + 0.6) * 10) / 10,
            sharpness: 79,
            observer: otherObserver,
            upload: "registered",
          },
        ],
        [
          {
            structure: confirmed ? confirmed.structure : "细胞膜",
            note: confirmed
              ? `${otherObserver}复测：${confirmed.note}`
              : `${otherObserver}复测：结构边界可见`,
            layerZIndex: maxZ + 1,
          },
        ]
      )
    );
  };

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "显微观察记录.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleReset = () => {
    setState(seedState());
    setSelectedFieldId("fv1");
  };

  const metrics: Array<[string, number]> = [
    ["样本数", state.samples.length],
    ["视野记录", state.fields.length],
    ["焦面层", state.layers.length],
    ["待复核 / 待核", totalSummary.pending + totalSummary.legacy],
  ];

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">hxwl-06 · port 5106</p>
          <h1>显微镜玻片观察</h1>
          <p className="subtitle">
            样本 → 玻片 → 视野 → 焦面层 → 结构结论的可恢复记录链：每层记录焦面位置与清晰度；
            清晰度更新后未确认结论自动失效重算、已确认结论保留原层；两名观察员并发提交双方保留并标冲突；
            补传失败保留登记层可重试，重传同一层不生成副本；旧记录缺焦面信息先标待核。
          </p>
        </div>
        <div className="stack-card">
          <span>可恢复记录</span>
          <strong>本地持久化 + 操作日志</strong>
          <div className="toolbar">
            <button onClick={handleExport}>导出记录 JSON</button>
            <button onClick={handleReset}>恢复示例数据</button>
          </div>
        </div>
      </section>

      <section className="metrics-grid">
        {metrics.map(([label, value], index) => (
          <article className="metric-card" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
            <i className={["status-ok", "status-ok", "status-watch", "status-danger"][index]} />
          </article>
        ))}
      </section>

      <section className="main-grid">
        <aside className="panel narrow">
          <h2>当前身份</h2>
          <div className="chips">
            {STUDENTS.map((s) => (
              <button
                key={s}
                className={actor === s ? "chip active" : "chip"}
                onClick={() => setActor(s)}
              >
                {s}
              </button>
            ))}
          </div>
          <h2>样本 · 玻片 · 视野</h2>
          <div className="tree">
            {state.samples.map((sp) => (
              <div key={sp.id} className="tree-sample">
                <div className="tree-sample-name">
                  {sp.name}
                  <span>
                    {sp.kind} · {sp.stain}
                  </span>
                </div>
                {state.slides
                  .filter((sl) => sl.sampleId === sp.id)
                  .map((sl) => (
                    <div key={sl.id} className="tree-slide">
                      <div className="tree-slide-code">玻片 {sl.code}</div>
                      {state.fields
                        .filter((f) => f.slideId === sl.id)
                        .map((f) => {
                          const fs = summarize(
                            state.conclusions.filter((c) => c.fieldId === f.id)
                          );
                          const todo = fs.pending + fs.legacy;
                          return (
                            <button
                              key={f.id}
                              className={
                                f.id === field.id ? "tree-field active" : "tree-field"
                              }
                              onClick={() => setSelectedFieldId(f.id)}
                            >
                              <span>
                                {f.label} · {f.magnification}
                              </span>
                              {todo > 0 && <em>{todo} 待复核</em>}
                              {fs.conflicts > 0 && <em className="conflict">冲突</em>}
                            </button>
                          );
                        })}
                    </div>
                  ))}
              </div>
            ))}
          </div>
        </aside>

        <section className="panel">
          <div className="section-heading">
            <div>
              <p>{chainText}</p>
              <h2>{field.label} · 焦面层与结论</h2>
            </div>
            <div className="badge-row">
              <Badge tone="warn">待复核 {fieldSummary.pending}</Badge>
              <Badge tone="ok">已复核 {fieldSummary.reviewed}</Badge>
              <Badge tone="danger">待核 {fieldSummary.legacy}</Badge>
              {fieldSummary.conflicts > 0 && (
                <Badge tone="danger">冲突 {fieldSummary.conflicts}</Badge>
              )}
            </div>
          </div>

          <h3 className="subhead">焦面层（焦面位置 / 清晰度 / 上传状态）</h3>
          <div className="table-wrap">
            <table className="layer-table">
              <thead>
                <tr>
                  <th>层</th>
                  <th>焦面位置</th>
                  <th>清晰度</th>
                  <th>上传状态</th>
                  <th>观察员</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {fieldLayers.map((l) => (
                  <tr key={l.id} className={l.upload === "failed" ? "row-failed" : ""}>
                    <td>
                      第 {l.zIndex} 层
                      {l.id === bestId && <span className="best">最佳层</span>}
                      {l.conflict && <Badge tone="danger">冲突</Badge>}
                    </td>
                    <td>{l.focalPosition.toFixed(1)} µm</td>
                    <td>
                      <SharpnessEditor
                        value={l.sharpness}
                        onSave={(v) =>
                          setState((s) => updateSharpness(s, l.id, v, actor))
                        }
                      />
                    </td>
                    <td>
                      <Badge
                        tone={
                          l.upload === "uploaded"
                            ? "ok"
                            : l.upload === "failed"
                              ? "danger"
                              : "info"
                        }
                      >
                        {uploadLabels[l.upload]}
                      </Badge>
                    </td>
                    <td>{l.observer}</td>
                    <td>
                      {l.upload === "failed" ? (
                        <button
                          className="mini"
                          onClick={() => setState((s) => retryUpload(s, l.id, actor))}
                        >
                          重试补传
                        </button>
                      ) : (
                        <button
                          className="mini"
                          onClick={() => setState((s) => markUploadFailed(s, l.id, actor))}
                        >
                          模拟补传失败
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {fieldLayers.length === 0 && (
                  <tr>
                    <td colSpan={6} className="empty">
                      暂无焦面层 —— 旧记录缺少焦面信息，相关结论已标待核
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <NewLayerForm defaultZ={maxZ + 1} onAdd={handleAddLayer} />
          <p className="hint">
            同一视野同一层号重传只更新原层，不生成副本；更新清晰度会使该层未确认结论失效并按最佳可用层重算，已确认结论保留原层。
          </p>

          <div className="toolbar">
            <button onClick={handleConcurrent}>
              模拟并发提交（{otherObserver} 提交同一视野）
            </button>
            <span className="hint-inline">
              双方记录均保留并标冲突，后到者不覆盖已确认结论
            </span>
          </div>

          <h3 className="subhead">本视野结构结论</h3>
          <div className="conclusion-list">
            {fieldConclusions.map((c) => (
              <ConclusionCard
                key={c.id}
                c={c}
                layerText={layerText(c.layerId)}
                onConfirm={(id) => setState((s) => confirmConclusion(s, id, TEACHER))}
              />
            ))}
            {fieldConclusions.length === 0 && <p className="meta">暂无结论</p>}
          </div>
        </section>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p>结论列表</p>
            <h2>全部结构结论（含复核状态）</h2>
          </div>
          <div className="badge-row">
            <Badge tone="ok">已复核 {totalSummary.reviewed}</Badge>
            <Badge tone="warn">待复核 {totalSummary.pending}</Badge>
            <Badge tone="danger">待核 {totalSummary.legacy}</Badge>
            <Badge tone="muted">已失效 {totalSummary.invalidated}</Badge>
          </div>
        </div>
        <div className="conclusion-list">
          {allConclusions.map((c) => (
            <ConclusionCard
              key={c.id}
              c={c}
              chainText={chainTextOf(c.fieldId)}
              layerText={layerText(c.layerId)}
              onConfirm={(id) => setState((s) => confirmConclusion(s, id, TEACHER))}
            />
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p>课堂统计</p>
            <h2>复核状态总览</h2>
          </div>
        </div>
        <div className="stats-grid">
          <div>
            <h3 className="subhead">结论复核状态</h3>
            <StatBar label="已复核" count={totalSummary.reviewed} total={totalSummary.total} tone="ok" />
            <StatBar label="待复核" count={totalSummary.pending} total={totalSummary.total} tone="warn" />
            <StatBar label="待核（缺焦面）" count={totalSummary.legacy} total={totalSummary.total} tone="danger" />
            <StatBar label="已失效" count={totalSummary.invalidated} total={totalSummary.total} tone="muted" />
            <p className="meta">
              冲突结论 {totalSummary.conflicts} 条 · 结论总数 {totalSummary.total}
            </p>
          </div>
          <div>
            <h3 className="subhead">焦面层上传状态</h3>
            <StatBar label="已上传" count={layerUploadCount("uploaded")} total={state.layers.length} tone="ok" />
            <StatBar label="已登记" count={layerUploadCount("registered")} total={state.layers.length} tone="warn" />
            <StatBar label="补传失败" count={layerUploadCount("failed")} total={state.layers.length} tone="danger" />
            <p className="meta">
              补传失败的层保留登记信息，可重试；重传同一层不生成副本。
            </p>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p>可恢复记录</p>
            <h2>操作日志</h2>
          </div>
          <span className="meta">记录持久化于本地，刷新后可恢复 · 共 {state.audit.length} 条</span>
        </div>
        <ul className="log-list">
          {state.audit.slice(0, 14).map((ev) => (
            <li key={ev.id}>
              <time>{fmtTime(ev.at)}</time>
              <strong>
                {ev.actor} · {ev.action}
              </strong>
              <span>{ev.detail}</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
