// 显微观察可恢复记录：样本 / 玻片 / 焦面层 / 结构结论

export type Clarity = "清晰" | "可用" | "模糊";

export type LayerUploadStatus = "registered" | "uploaded" | "failed";

export type ReviewStatus = "pending" | "reviewed";

export type ConclusionStatus = "unconfirmed" | "confirmed";

/** 焦面层：同一玻片同一视野内，z（焦面位置）唯一 */
export interface FocalLayer {
  id: string;
  slideId: string;
  viewLabel: string;
  /** 焦面位置，单位 μm */
  z: number;
  clarity: Clarity;
  /** registered=已登记待补传，uploaded=图像已传，failed=补传失败（层保留，可重试） */
  uploadStatus: LayerUploadStatus;
  imageName?: string;
  uploadError?: string;
  registeredAt: number;
  uploadedAt?: number;
}

export interface StructureConclusion {
  id: string;
  slideId: string;
  /** 所属视野；旧记录无焦面信息时为空串 */
  viewLabel: string;
  structure: string;
  observer: string;
  text: string;
  /** 当前依据层；清晰度更新触发重算时可能改变 */
  layerId: string;
  /** 提交时原层；已确认结论锁定在该层，不参与重算 */
  sourceLayerId: string;
  status: ConclusionStatus;
  /** 两名观察员提交同一视野同一结构时，双方均标冲突 */
  conflict: boolean;
  conflictNote?: string;
  /** 因清晰度更新被失效重算的次数 */
  recomputeCount: number;
  /** 旧记录迁入、没有任何焦面信息 */
  unlayered: boolean;
  createdAt: number;
  confirmedAt?: number;
  confirmedBy?: string;
}

export interface SlideRecord {
  id: string;
  sampleId: string;
  /** 玻片编号 */
  code: string;
  magnification: string;
  stain: string;
  /** legacy=true 表示旧记录迁入，缺少焦面信息时先标待核 */
  legacy: boolean;
  reviewStatus: ReviewStatus;
  reviewNote?: string;
  layers: FocalLayer[];
  conclusions: StructureConclusion[];
  createdAt: number;
}

export interface Sample {
  id: string;
  name: string;
  category: string;
}

export type LogKind = "info" | "ok" | "warn" | "danger";

export interface LogEntry {
  id: string;
  at: number;
  kind: LogKind;
  text: string;
}

export interface RecorderDB {
  samples: Sample[];
  slides: SlideRecord[];
  log: LogEntry[];
}
