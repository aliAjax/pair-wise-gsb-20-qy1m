export type UploadStatus = "registered" | "uploaded" | "failed";
export type ConclusionState = "unconfirmed" | "confirmed" | "invalidated";
export type ReviewStatus = "legacy" | "pending" | "reviewed" | "invalidated";

export interface Sample {
  id: string;
  name: string;
  kind: string;
  stain: string;
}

export interface Slide {
  id: string;
  sampleId: string;
  code: string;
}

export interface FieldView {
  id: string;
  slideId: string;
  label: string;
  magnification: string;
}

/** 焦面层：同一视野下某一层焦面的记录 */
export interface FocalLayer {
  id: string;
  fieldId: string;
  zIndex: number; // 层号（同一视野内唯一，重传同层号不生成副本）
  focalPosition: number; // 焦面位置，单位 µm
  sharpness: number; // 清晰度 0-100
  observer: string;
  upload: UploadStatus; // 已登记 / 已上传 / 补传失败
  conflict: boolean; // 并发提交冲突标记
  updatedAt: number;
}

/** 结构结论：依附于某焦面层（旧记录可能无焦面信息） */
export interface Conclusion {
  id: string;
  fieldId: string;
  layerId: string | null; // null = 旧记录，缺少焦面信息，标待核
  structure: string;
  note: string;
  observer: string;
  state: ConclusionState;
  conflict: boolean;
  supersededBy: string | null; // 失效后被哪条重算结论取代
  recalculatedFrom: string | null; // 由哪条失效结论重算而来
  createdAt: number;
  confirmedBy: string | null;
}

/** 操作日志：可恢复记录的审计链 */
export interface AuditEvent {
  id: string;
  at: number;
  actor: string;
  action: string;
  detail: string;
}

export interface AppState {
  samples: Sample[];
  slides: Slide[];
  fields: FieldView[];
  layers: FocalLayer[];
  conclusions: Conclusion[];
  audit: AuditEvent[];
}

export const uploadLabels: Record<UploadStatus, string> = {
  registered: "已登记",
  uploaded: "已上传",
  failed: "补传失败",
};

export const stateLabels: Record<ConclusionState, string> = {
  unconfirmed: "未确认",
  confirmed: "已确认",
  invalidated: "已失效",
};

export const reviewLabels: Record<ReviewStatus, string> = {
  legacy: "待核",
  pending: "待复核",
  reviewed: "已复核",
  invalidated: "已失效",
};

/** 复核状态：缺焦面信息的旧记录优先标待核 */
export function reviewStatusOf(c: Conclusion): ReviewStatus {
  if (c.layerId === null) return "legacy";
  if (c.state === "confirmed") return "reviewed";
  if (c.state === "invalidated") return "invalidated";
  return "pending";
}
