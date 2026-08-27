const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildSentenceIntents,
  validateNarrativeContinuity
} = require("../electron/services/narrative-continuity-service.cjs");
const { buildSentenceMediaBindings } = require("../electron/services/sentence-media-alignment-service.cjs");

const script = {
  id: "trousers-script",
  voiceMode: "full_voice",
  editingRecipe: {
    blocks: [
      { narrativeRole: "question_hook", materialType: "outfit" },
      { narrativeRole: "detail_evidence", materialType: "detail" },
      { narrativeRole: "outfit_result", materialType: "outfit" },
      { narrativeRole: "use_case", materialType: "overall" },
      { narrativeRole: "soft_cta", materialType: "outfit" }
    ]
  },
  blocks: [
    { id: "b1", name: "问题开场", duration: 3, category: "人物穿搭", voiceText: "还有人不懂西裤要怎么穿搭？", topic: "西裤穿搭" },
    { id: "b2", name: "细节", duration: 4, category: "细节讲解", voiceText: "先看腰头和褶皱的处理。", topic: "西裤穿搭" },
    { id: "b3", name: "上身", duration: 4, category: "人物穿搭", voiceText: "上身之后整体线条会更利落。", topic: "西裤穿搭" },
    { id: "b4", name: "场景", duration: 4, category: "整体展示", voiceText: "日常通勤搭衬衫就可以。", topic: "西裤穿搭" },
    { id: "b5", name: "结尾", duration: 3, category: "人物穿搭", voiceText: "照这个顺序搭就行。", topic: "西裤穿搭" }
  ]
};

const materials = [
  { id: "outfit-1", type: "outfit", typeLabel: "人物穿搭", duration: 4, eligibleForMix: false },
  { id: "detail-1", type: "detail", typeLabel: "细节讲解", duration: 4, classificationNeedsReview: true },
  { id: "outfit-2", type: "outfit", typeLabel: "人物穿搭", duration: 4 },
  { id: "overall-1", type: "overall", typeLabel: "整体展示", duration: 4, lowReuse: true },
  { id: "outfit-3", type: "outfit", typeLabel: "人物穿搭", duration: 4 }
];

function validDecisions() {
  return script.blocks.map((block, index) => ({
    blockId: block.id,
    selectedMaterialIds: [materials[index].id],
    timeline: [{ materialId: materials[index].id, sourceStart: 0, duration: block.duration }]
  }));
}

test("问题钩子到轻 CTA 的逐句选镜通过叙事门禁", () => {
  const intents = buildSentenceIntents(script);
  const bindings = buildSentenceMediaBindings({ script, decisions: validDecisions(), materials });
  const result = validateNarrativeContinuity({ sentenceIntents: intents, bindings });
  assert.equal(result.status, "pass");
  assert.deepEqual(intents.map((item) => item.narrativeRole), ["question_hook", "detail_evidence", "outfit_result", "use_case", "soft_cta"]);
  assert.equal(bindings[1].selectedMaterials[0].id, "detail-1");
  assert.equal(result.audit.secondaryFilteringApplied, false);
});

test("细节之前先下结论会被顺序门禁阻断", () => {
  const reversed = structuredClone(script);
  reversed.editingRecipe.blocks[1].narrativeRole = "outfit_result";
  reversed.editingRecipe.blocks[2].narrativeRole = "detail_evidence";
  const result = validateNarrativeContinuity({
    sentenceIntents: buildSentenceIntents(reversed),
    bindings: buildSentenceMediaBindings({ script: reversed, decisions: validDecisions(), materials })
  });
  assert.equal(result.status, "blocked");
  assert.ok(result.issues.some((issue) => issue.code === "NARRATIVE_ORDER_REGRESSION"));
});

test("文案要求细节但使用穿搭分类会被画文对应门禁阻断", () => {
  const decisions = validDecisions();
  decisions[1].selectedMaterialIds = ["outfit-1"];
  decisions[1].timeline = [{ materialId: "outfit-1", duration: 4 }];
  const result = validateNarrativeContinuity({
    sentenceIntents: buildSentenceIntents(script),
    bindings: buildSentenceMediaBindings({ script, decisions, materials })
  });
  assert.equal(result.status, "blocked");
  assert.ok(result.issues.some((issue) => issue.code === "MATERIAL_ROLE_MISMATCH" && issue.blockId === "b2"));
});

test("中途跳到无关主题和重复结论都会被阻断", () => {
  const broken = structuredClone(script);
  broken.blocks[3].topic = "快递物流";
  broken.blocks[3].voiceText = "今天说一下快递物流。";
  broken.editingRecipe.blocks[3].narrativeRole = "review_conclusion";
  broken.editingRecipe.blocks[4].narrativeRole = "review_conclusion";
  const result = validateNarrativeContinuity({
    sentenceIntents: buildSentenceIntents(broken),
    bindings: buildSentenceMediaBindings({ script: broken, decisions: validDecisions(), materials })
  });
  assert.equal(result.status, "blocked");
  assert.ok(result.issues.some((issue) => issue.code === "TOPIC_JUMP"));
  assert.ok(result.issues.some((issue) => issue.code === "REPEATED_CONCLUSION"));
});

test("未标注主题的同一脚本共享一次推断结果，不因单句关键词或脚本 ID 跳题", () => {
  const unlabelled = structuredClone(script);
  unlabelled.id = "s6-918-real-review-short-29s";
  delete unlabelled.name;
  unlabelled.blocks.forEach((block) => {
    delete block.topic;
  });
  unlabelled.blocks[3].voiceText = "日常通勤搭衬衫就可以。";

  const intents = buildSentenceIntents(unlabelled);
  const result = validateNarrativeContinuity({
    sentenceIntents: intents,
    bindings: buildSentenceMediaBindings({ script: unlabelled, decisions: validDecisions(), materials })
  });

  assert.deepEqual([...new Set(intents.map((intent) => intent.topic))], ["裤装穿搭"]);
  assert.equal(result.issues.some((issue) => issue.code === "TOPIC_JUMP"), false);
});

test("无法识别商品主题时使用稳定共享主题而不是脚本 ID", () => {
  const neutral = structuredClone(script);
  neutral.id = "opaque-script-id";
  neutral.blocks.forEach((block) => {
    delete block.topic;
    block.voiceText = "继续看下一处画面。";
  });

  const intents = buildSentenceIntents(neutral);
  assert.deepEqual([...new Set(intents.map((intent) => intent.topic))], ["同一脚本主题"]);
  assert.ok(intents.every((intent) => intent.topic !== neutral.id));
});

test("脚本级主题作为共享默认值，显式 block.topic 仍可覆盖并触发真实跳题", () => {
  const explicit = structuredClone(script);
  explicit.topic = "918 西裤穿搭";
  explicit.blocks.forEach((block) => delete block.topic);
  explicit.blocks[3].topic = "快递物流";

  const intents = buildSentenceIntents(explicit);
  const result = validateNarrativeContinuity({
    sentenceIntents: intents,
    bindings: buildSentenceMediaBindings({ script: explicit, decisions: validDecisions(), materials })
  });

  assert.equal(intents[0].topic, "918 西裤穿搭");
  assert.equal(intents[3].topic, "快递物流");
  assert.ok(result.issues.some((entry) => entry.code === "TOPIC_JUMP" && entry.blockId === "b4"));
});

test("逻辑检查不修改或删除人工确认分类清单", () => {
  const original = structuredClone(materials);
  buildSentenceMediaBindings({ script, decisions: validDecisions(), materials });
  assert.deepEqual(materials, original);
  assert.equal(materials.length, 5);
});
