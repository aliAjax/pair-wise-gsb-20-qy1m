import type { AppState } from "./types";

/** 示例数据：含多层焦面、已确认/未确认结论、补传失败层与无焦面旧记录 */
export function seedState(): AppState {
  const now = Date.now();
  return {
    samples: [
      { id: "sp1", name: "洋葱表皮", kind: "植物组织", stain: "碘液" },
      { id: "sp2", name: "人血涂片", kind: "血液涂片", stain: "瑞氏染色" },
      { id: "sp3", name: "草履虫", kind: "微生物", stain: "活体观察" },
    ],
    slides: [
      { id: "sl1", sampleId: "sp1", code: "BL-2026-01" },
      { id: "sl2", sampleId: "sp2", code: "BL-2026-02" },
      { id: "sl3", sampleId: "sp3", code: "BL-2026-03" },
    ],
    fields: [
      { id: "fv1", slideId: "sl1", label: "视野 A", magnification: "400x" },
      { id: "fv2", slideId: "sl2", label: "视野 A", magnification: "1000x" },
      { id: "fv3", slideId: "sl3", label: "视野 A", magnification: "200x" },
    ],
    layers: [
      { id: "ly1", fieldId: "fv1", zIndex: 1, focalPosition: 12.4, sharpness: 88, observer: "学生小李", upload: "uploaded", conflict: false, updatedAt: now - 3600_000 },
      { id: "ly2", fieldId: "fv1", zIndex: 2, focalPosition: 13.1, sharpness: 92, observer: "学生小李", upload: "uploaded", conflict: false, updatedAt: now - 3500_000 },
      { id: "ly3", fieldId: "fv1", zIndex: 3, focalPosition: 13.8, sharpness: 61, observer: "学生小李", upload: "failed", conflict: false, updatedAt: now - 3400_000 },
      { id: "ly4", fieldId: "fv2", zIndex: 1, focalPosition: 8.2, sharpness: 90, observer: "学生小王", upload: "uploaded", conflict: false, updatedAt: now - 3300_000 },
      { id: "ly5", fieldId: "fv2", zIndex: 2, focalPosition: 8.6, sharpness: 85, observer: "学生小王", upload: "registered", conflict: false, updatedAt: now - 3200_000 },
    ],
    conclusions: [
      { id: "cc1", fieldId: "fv1", layerId: "ly2", structure: "细胞壁 / 细胞核", note: "细胞壁清晰，细胞核可见", observer: "学生小李", state: "confirmed", conflict: false, supersededBy: null, recalculatedFrom: null, createdAt: now - 3500_000, confirmedBy: "实验课教师" },
      { id: "cc2", fieldId: "fv1", layerId: "ly3", structure: "中央液泡", note: "中央液泡明显，边界清楚", observer: "学生小李", state: "unconfirmed", conflict: false, supersededBy: null, recalculatedFrom: null, createdAt: now - 3400_000, confirmedBy: null },
      { id: "cc3", fieldId: "fv2", layerId: "ly4", structure: "红细胞", note: "红细胞分布均匀", observer: "学生小王", state: "unconfirmed", conflict: false, supersededBy: null, recalculatedFrom: null, createdAt: now - 3300_000, confirmedBy: null },
      { id: "cc4", fieldId: "fv3", layerId: null, structure: "纤毛", note: "纤毛运动明显（旧记录，无焦面信息）", observer: "学生小李", state: "unconfirmed", conflict: false, supersededBy: null, recalculatedFrom: null, createdAt: now - 86_400_000, confirmedBy: null },
    ],
    audit: [
      { id: "ev_seed", at: now - 86_400_000, actor: "系统", action: "导入旧记录", detail: "草履虫视野旧记录缺少焦面信息，已标记待核" },
    ],
  };
}
