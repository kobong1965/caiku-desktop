const test = require("node:test");
const assert = require("node:assert/strict");

const {
  applyStrictTimeline,
  validateEditingPlan
} = require("../electron/services/ai-editor-service.cjs");

function material(id, type, typeLabel, duration = 4) {
  const outfitEvidence = ["outfit", "overall"].includes(type)
    ? [{ claimCode: "visual_full_outfit", status: "direct", observations: ["全身正面和侧面展示裤型轮廓，转身时可以看清宽松直筒线条。"] }]
    : [];
  return {
    id,
    name: `${typeLabel} ${id.split("-").at(-1)}`,
    type,
    typeLabel,
    duration,
    actions: ["站立", "转身"],
    evidence: outfitEvidence,
    eligibleForMix: false,
    classificationNeedsReview: true
  };
}

const materials = [
  ...Array.from({ length: 7 }, (_, index) => material(`outfit-${index + 1}`, "outfit", "人物穿搭", 4.2)),
  ...Array.from({ length: 7 }, (_, index) => material(`detail-${index + 1}`, "detail", "细节讲解", 4)),
  material("action-1", "action", "动作展示", 4),
  ...Array.from({ length: 4 }, (_, index) => material(`overall-${index + 1}`, "overall", "整体展示", 4.2))
];

const script = {
  id: "s6-918-real-review-short-29s",
  name: "918 真人短种草 29秒",
  voiceMode: "full_voice",
  blocks: [
    { id: "s6-b1", name: "购买痛点", styleRole: "pain_hook", duration: 5, category: "人物穿搭", type: "outfit", visualInstruction: "目标商品正面全身上身画面", voiceText: "买西裤最怕什么？太窄挑腿，太宽又容易没精神。" },
    { id: "s6-b2", name: "双褶证据", styleRole: "visible_evidence", duration: 8, category: "细节讲解", type: "detail", visualInstruction: "目标商品腰头双褶近景后回到正面上身", voiceText: "先看腰头这个双褶。" },
    { id: "s6-b3", name: "版型证据", styleRole: "visible_evidence", duration: 6, category: "人物穿搭", type: "outfit", visualInstruction: "目标商品站立与转身轮廓", voiceText: "裤腿是宽松直筒，站着、转身都能看清轮廓。" },
    { id: "s6-b4", name: "真实场景", styleRole: "use_case", duration: 6, category: "人物穿搭", type: "outfit", visualInstruction: "目标商品搭配针织或短袖画面", voiceText: "通勤日常穿也不费劲。" },
    { id: "s6-b5", name: "克制收口", styleRole: "soft_cta", duration: 4, category: "整体展示", type: "overall", visualInstruction: "目标商品完整上身收尾", voiceText: "喜欢这种干净利落的，可以再看看尺码。" }
  ]
};

test("当前19素材结构经最终优化后消除7项旧误报并生成29秒可执行计划", () => {
  const rawPlan = {
    summary: "模拟优化前选镜",
    decisions: [
      { blockId: "s6-b1", selectedMaterialIds: ["overall-1"], timeline: [{ materialId: "overall-1", duration: 4 }] },
      { blockId: "s6-b2", selectedMaterialIds: ["detail-1"], timeline: [{ materialId: "detail-1", duration: 4 }] },
      { blockId: "s6-b3", selectedMaterialIds: ["overall-2"], timeline: [{ materialId: "overall-2", duration: 4 }] },
      { blockId: "s6-b4", selectedMaterialIds: ["outfit-1"], timeline: [{ materialId: "outfit-1", duration: 4 }] },
      { blockId: "s6-b5", selectedMaterialIds: ["overall-3"], timeline: [{ materialId: "overall-3", duration: 4 }] }
    ]
  };

  const before = validateEditingPlan(rawPlan, { script, materials });
  assert.equal(before.status, "blocked");
  assert.ok(before.narrativeContinuity.issues.some((issue) => issue.code === "MATERIAL_ROLE_MISMATCH"));

  const result = applyStrictTimeline(before, script, materials);
  assert.equal(result.status, "ready");
  assert.equal(result.narrativeContinuity.status, "pass");
  assert.deepEqual(result.narrativeContinuity.issues, []);
  assert.deepEqual(result.narrativeContinuity.narrativeOrder, ["pain_hook", "detail_evidence", "outfit_result", "use_case", "soft_cta"]);
  assert.equal(result.timelineOptimization.status, "ready");
  assert.equal(result.timelineOptimization.revalidatedAfterOptimization, true);
  assert.equal(result.timelineOptimization.stats.totalDuration, 29);
  assert.equal(result.timelineOptimization.stats.uniqueMaterialCount, 9);
  assert.equal(result.actualUsedMaterialIds.length, 9);
  assert.ok(result.decisions.every((decision) => decision.evidenceStatus === "direct" && decision.unsupportedClaims.length === 0));
  assert.ok(result.decisions.every((decision) => decision.candidateMaterialIds.length === 19));
  assert.ok(result.decisions.every((decision) => decision.selectedMaterialIds.length < decision.candidateMaterialIds.length));
});
