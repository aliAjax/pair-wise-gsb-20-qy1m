import type { RecorderDB } from "./types";

const t0 = Date.parse("2026-10-06T09:00:00+08:00");

let counter = 0;
function fixedId(prefix: string): string {
  counter += 1;
  return `${prefix}-seed-${counter}`;
}

export function seedDB(): RecorderDB {
  counter = 0;

  const samples = [
    { id: "sample-onion", name: "洋葱表皮", category: "植物组织" },
    { id: "sample-blood", name: "人血涂片", category: "血液涂片" },
    { id: "sample-paramecium", name: "草履虫", category: "微生物" },
  ];

  // 玻片一：多层焦面，含一条已确认（锁原层）和一条未确认（清晰度更新会重算）
  const slide1Id = "slide-onion-a";
  const l1 = fixedId("layer");
  const l2 = fixedId("layer");
  const l3 = fixedId("layer");
  const slide1 = {
    id: slide1Id,
    sampleId: "sample-onion",
    code: "YP-2026-101",
    magnification: "400x",
    stain: "碘液染色",
    legacy: false,
    reviewStatus: "reviewed" as const,
    reviewNote: "王老师 已核对 3 个焦面层与图像",
    createdAt: t0,
    layers: [
      {
        id: l1, slideId: slide1Id, viewLabel: "视野A", z: 12, clarity: "模糊" as const,
        uploadStatus: "uploaded" as const, imageName: "onion-a-z12.jpg",
        registeredAt: t0 + 1000, uploadedAt: t0 + 2000,
      },
      {
        id: l2, slideId: slide1Id, viewLabel: "视野A", z: 18, clarity: "清晰" as const,
        uploadStatus: "uploaded" as const, imageName: "onion-a-z18.jpg",
        registeredAt: t0 + 3000, uploadedAt: t0 + 4000,
      },
      {
        id: l3, slideId: slide1Id, viewLabel: "视野A", z: 24, clarity: "可用" as const,
        // 已登记、图像待补传（用于演示补传失败/重试/不产生副本）
        uploadStatus: "registered" as const,
        registeredAt: t0 + 5000,
      },
    ],
    conclusions: [
      {
        id: fixedId("conclusion"), slideId: slide1Id, viewLabel: "视野A",
        structure: "细胞核", observer: "学生甲", text: "核膜边界清楚，核内染色均匀，位于细胞中央",
        layerId: l2, sourceLayerId: l2, status: "confirmed" as const, conflict: false,
        recomputeCount: 0, unlayered: false, createdAt: t0 + 6000,
        confirmedAt: t0 + 7000, confirmedBy: "王老师",
      },
      {
        id: fixedId("conclusion"), slideId: slide1Id, viewLabel: "视野A",
        structure: "细胞壁", observer: "学生乙", text: "壁轮廓连续，可见与相邻细胞的接点",
        // 学生挑错层：当前挂在 z=12 模糊层，清晰度一旦更新会失效重算到 z=18
        layerId: l1, sourceLayerId: l1, status: "unconfirmed" as const, conflict: false,
        recomputeCount: 0, unlayered: false, createdAt: t0 + 8000,
      },
    ],
  };

  // 玻片二：两个观察员已各交一条同结构结论，并存待裁决
  const slide2Id = "slide-blood-b";
  const b1 = fixedId("layer");
  const b2 = fixedId("layer");
  const slide2 = {
    id: slide2Id,
    sampleId: "sample-blood",
    code: "RX-2026-058",
    magnification: "1000x",
    stain: "瑞氏染色",
    legacy: false,
    reviewStatus: "reviewed" as const,
    reviewNote: "王老师 已核对焦面层；结构结论存在冲突待裁决",
    createdAt: t0 + 10000,
    layers: [
      {
        id: b1, slideId: slide2Id, viewLabel: "中央视野", z: 5, clarity: "清晰" as const,
        uploadStatus: "uploaded" as const, imageName: "blood-z5.jpg",
        registeredAt: t0 + 11000, uploadedAt: t0 + 12000,
      },
      {
        id: b2, slideId: slide2Id, viewLabel: "中央视野", z: 9, clarity: "可用" as const,
        uploadStatus: "uploaded" as const, imageName: "blood-z9.jpg",
        registeredAt: t0 + 13000, uploadedAt: t0 + 14000,
      },
    ],
    conclusions: [
      {
        id: fixedId("conclusion"), slideId: slide2Id, viewLabel: "中央视野",
        structure: "白细胞", observer: "学生甲", text: "可见分叶核中性粒细胞 1 个，颗粒清晰",
        layerId: b1, sourceLayerId: b1, status: "unconfirmed" as const, conflict: true,
        conflictNote: "与 学生丙 的同视野提交并存，待教师裁决",
        recomputeCount: 0, unlayered: false, createdAt: t0 + 15000,
      },
      {
        id: fixedId("conclusion"), slideId: slide2Id, viewLabel: "中央视野",
        structure: "白细胞", observer: "学生丙", text: "疑为淋巴细胞，核质比高，未见明显分叶",
        layerId: b1, sourceLayerId: b1, status: "unconfirmed" as const, conflict: true,
        conflictNote: "与 学生甲 的同视野提交并存，待教师裁决",
        recomputeCount: 0, unlayered: false, createdAt: t0 + 16000,
      },
    ],
  };

  // 玻片三：旧记录迁入，没有任何焦面信息 → 待核
  const slide3 = {
    id: "slide-paramecium-legacy",
    sampleId: "sample-paramecium",
    code: "OLD-2025-017",
    magnification: "200x",
    stain: "活体观察",
    legacy: true,
    reviewStatus: "pending" as const,
    reviewNote: "旧记录缺少焦面位置与清晰度信息，需补登焦面后复核",
    createdAt: t0 + 20000,
    layers: [],
    conclusions: [
      {
        id: fixedId("conclusion"), slideId: "slide-paramecium-legacy", viewLabel: "",
        structure: "纤毛", observer: "往届学生", text: "纤毛摆动明显，虫体旋转前进（旧记录，未标焦面）",
        layerId: "", sourceLayerId: "", status: "unconfirmed" as const, conflict: false,
        recomputeCount: 0, unlayered: true, createdAt: t0 + 21000,
      },
    ],
  };

  return {
    samples,
    slides: [slide1, slide2, slide3],
    log: [
      { id: fixedId("log"), at: t0 + 21000, kind: "warn", text: "旧记录 OLD-2025-017 迁入：无焦面信息，已标记待核" },
      { id: fixedId("log"), at: t0 + 16000, kind: "warn", text: "RX-2026-058 中央视野：学生甲、学生丙 分别提交「白细胞」，两边都留并标冲突" },
      { id: fixedId("log"), at: t0 + 7000, kind: "ok", text: "王老师 确认 YP-2026-101「细胞核」（学生甲），结论保留原层" },
    ],
  };
}
