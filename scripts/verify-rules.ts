import {
  registerLayer, uploadLayer, updateClarity,
  submitConclusion, submitConcurrent, confirmConclusion,
  importLegacySlide, reviewSlide, computeStats,
} from "../src/store";
import { seedDB } from "../src/seed";
import type { RecorderDB } from "../src/types";

let passed = 0;
function assert(name: string, cond: boolean, extra = ""): void {
  if (!cond) {
    console.error(`FAIL: ${name} ${extra}`);
    process.exit(1);
  }
  passed += 1;
  console.log(`PASS: ${name}`);
}

function fresh(): RecorderDB {
  return seedDB();
}

/* 1. 清晰度更新 → 未确认结论失效重算；已确认结论保留原层 */
{
  const db = fresh();
  const slide = db.slides[0];
  const [lZ12, lZ18] = slide.layers;
  const locked = slide.conclusions[0];   // 细胞核，已确认，层 z18
  const loose = slide.conclusions[1];    // 细胞壁，未确认，层 z12

  // 学生挑错层：把 z18 从清晰改模糊，z12 从模糊改清晰 → 未确认应跳到 z12
  updateClarity(db, { layerId: lZ12.id, clarity: "清晰" });
  updateClarity(db, { layerId: lZ18.id, clarity: "模糊" });

  assert("未确认结论重算到新最清晰层", loose.layerId === lZ12.id, loose.layerId);
  assert("未确认结论重算计数累加", loose.recomputeCount === 2);
  assert("已确认结论保留原层", locked.layerId === lZ18.id && locked.sourceLayerId === lZ18.id);
  assert("已确认结论不参与重算", locked.recomputeCount === 0);
}

/* 2. 两人同时提交同一视野：两边都留、都标冲突 */
{
  const db = fresh();
  const slide = db.slides[0];
  const before = slide.conclusions.length;
  const res = submitConcurrent(db, {
    slideId: slide.id, viewLabel: "视野A",
    structure: "液泡", text: "可见大液泡占据细胞大部分体积",
  }, ["学生甲", "学生丙"]);
  assert("同时提交返回两条", res.conclusionIds?.length === 2);
  assert("同时提交两边都新增", slide.conclusions.length === before + 2);
  const pair = slide.conclusions.slice(-2);
  assert("两边都标冲突", pair.every((c) => c.conflict));
}

/* 3. 后到者不能覆盖已确认结论 */
{
  const db = fresh();
  const slide = db.slides[0]; // 已有“细胞核”已确认（学生甲，z18）
  const res = submitConclusion(db, {
    slideId: slide.id, viewLabel: "视野A", structure: "细胞核",
    text: "我认为核看不清", observer: "学生丙",
  });
  const confirmed = slide.conclusions.find((c) => c.structure === "细胞核" && c.status === "confirmed")!;
  const incoming = slide.conclusions.find((c) => c.structure === "细胞核" && c.observer === "学生丙")!;
  assert("已确认结论文本未被覆盖", confirmed.text.includes("核膜边界"));
  assert("已确认结论仍在原层", confirmed.layerId === confirmed.sourceLayerId);
  assert("后到者被标冲突", incoming.conflict === true);
  assert("操作返回保留提示", res.message.includes("保留"));
}

/* 4. 补传失败保留已登记层、可重试 */
{
  const db = fresh();
  const slide = db.slides[0];
  const registered = slide.layers[2]; // z24 registered
  const layerCount = slide.layers.length;
  const fail = uploadLayer(db, registered.id, "x.jpg", true);
  assert("补传失败返回失败", fail.ok === false);
  assert("失败后层仍保留", slide.layers.some((l) => l.id === registered.id));
  assert("失败状态标记", registered.uploadStatus === "failed" && !!registered.uploadError);
  assert("失败不新增层", slide.layers.length === layerCount);
  const retry = uploadLayer(db, registered.id, "retry.jpg", false);
  assert("重试可成功", retry.ok && registered.uploadStatus === "uploaded" && registered.imageName === "retry.jpg");
}

/* 5. 重传同一层不生成副本 */
{
  const db = fresh();
  const slide = db.slides[0];
  const before = slide.layers.length;
  const res = registerLayer(db, { slideId: slide.id, viewLabel: "视野A", z: 18, clarity: "可用" });
  assert("同 z 重登不新增层", slide.layers.length === before);
  assert("返回既有层 id", res.layerId === slide.layers.find((l) => l.z === 18)?.id);
  assert("同 z 重登更新清晰度", slide.layers.find((l) => l.z === 18)?.clarity === "可用");
  const layer = slide.layers.find((l) => l.z === 18)!;
  uploadLayer(db, layer.id, "again.jpg");
  assert("重传图像仍无副本", slide.layers.length === before);
  assert("重传更新图像名", layer.imageName === "again.jpg");
}

/* 6. 旧记录无焦面信息先标待核；统计反映状态；无层不能通过复核 */
{
  const db = fresh();
  const res = importLegacySlide(db, {
    sampleId: "sample-paramecium", code: "OLD-X", magnification: "200x", stain: "活体",
    legacyConclusions: [{ structure: "纤毛", observer: "往届学生", text: "摆动" }],
  });
  const legacy = db.slides.find((s) => s.code === "OLD-X")!;
  assert("旧记录标待核", res.ok && legacy.reviewStatus === "pending" && legacy.legacy);
  assert("旧结论标 unlayered", legacy.conclusions[0].unlayered && legacy.conclusions[0].layerId === "");
  const blocked = reviewSlide(db, legacy.id, "王老师");
  assert("无焦面层不能通过复核", blocked.ok === false && legacy.reviewStatus === "pending");

  registerLayer(db, { slideId: legacy.id, viewLabel: "唯一视野", z: 10, clarity: "清晰" });
  const reviewed = reviewSlide(db, legacy.id, "王老师");
  assert("补登焦面后复核通过", reviewed.ok && legacy.reviewStatus === "reviewed");
}

/* 7. 旧结论不参与重算；统计口径 */
{
  const db = fresh();
  const stats = computeStats(db);
  assert("统计：3 张玻片", stats.slides === 3);
  assert("统计：1 张待核", stats.pending === 1);
  assert("统计：1 条 unlayered", stats.unlayered === 1);
  assert("统计：2 条冲突（血涂片）", stats.conflicts === 2);
  const legacy = db.slides.find((s) => s.reviewStatus === "pending")!;
  const layer = legacy.layers; // 空
  void layer;
  // 给旧玻片补层并更新清晰度，旧结论仍不重算
  registerLayer(db, { slideId: legacy.id, viewLabel: "视野Z", z: 10, clarity: "模糊" });
  updateClarity(db, { layerId: legacy.layers[0].id, clarity: "清晰" });
  const old = legacy.conclusions[0];
  assert("旧结论不参与重算", old.unlayered && old.recomputeCount === 0 && old.layerId === "");
}

/* 8. 同一观察员重复提交 → 修订本人那条，不新增、不冲突 */
{
  const db = fresh();
  const slide = db.slides[1]; // 血涂片：学生甲 已有“白细胞”
  const before = slide.conclusions.length;
  const res = submitConclusion(db, {
    slideId: slide.id, viewLabel: "中央视野", structure: "白细胞",
    text: "修订：确认是中性粒细胞", observer: "学生甲",
  });
  const mine = slide.conclusions.filter((c) => c.structure === "白细胞" && c.observer === "学生甲");
  assert("本人重交不新增", res.ok && slide.conclusions.length === before && mine.length === 1);
  assert("本人重交为修订", mine[0].text.includes("修订"));
}

/* 9. 教师确认后再遇同结构提交：确认层锁定，冲突挂新来者 */
{
  const db = fresh();
  const slide = db.slides[1];
  const jia = slide.conclusions.find((c) => c.observer === "学生甲")!;
  confirmConclusion(db, jia.id, "王老师");
  const layerAtConfirm = jia.layerId;
  // 改变清晰度，确认结论不动
  const otherLayer = slide.layers.find((l) => l.id !== layerAtConfirm)!;
  updateClarity(db, { layerId: otherLayer.id, clarity: "清晰" });
  assert("确认后清晰度变化不漂移", jia.layerId === layerAtConfirm);
  const res = submitConclusion(db, {
    slideId: slide.id, viewLabel: "中央视野", structure: "白细胞",
    text: "我也看到了", observer: "学生乙",
  });
  const yi = slide.conclusions.find((c) => c.observer === "学生乙")!;
  assert("后来者冲突且未覆盖", res.ok && yi.conflict && jia.status === "confirmed" && jia.text.includes("分叶"));
}

console.log(`\n全部 ${passed} 项断言通过`);
