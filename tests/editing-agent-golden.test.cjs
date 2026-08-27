const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createClassifiedMaterialCatalog } = require("../electron/services/classified-material-catalog-service.cjs");
const { applyStrictTimeline, validateEditingPlan } = require("../electron/services/ai-editor-service.cjs");
const { buildAlignedSentenceTimeline, validateSentenceAlignment } = require("../electron/services/sentence-media-alignment-service.cjs");

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "editing-agent-trousers-golden.json"), "utf8"));

function runGolden() {
  const catalog = createClassifiedMaterialCatalog({ sku: fixture.sku, humanConfirmed: fixture.humanConfirmed, manifests: fixture.manifests });
  const before = JSON.stringify(catalog.materials);
  const validated = validateEditingPlan(fixture.modelPlan, { script: fixture.script, materials: catalog.materials, model: "golden", provider: "fixture" });
  const plan = applyStrictTimeline(validated, fixture.script, catalog.materials);
  const aligned = buildAlignedSentenceTimeline({ script: fixture.script, editingPlan: plan });
  return { catalog, before, plan, aligned, alignment: validateSentenceAlignment(aligned) };
}

test("固定西裤脚本按问题钩子到轻引导生成完整逻辑时间线", () => {
  const { plan, aligned, alignment } = runGolden();
  assert.equal(plan.status, "ready");
  assert.equal(plan.narrativeContinuity.status, "pass");
  assert.deepEqual(plan.narrativeContinuity.narrativeOrder, fixture.expected.narrativeOrder);
  assert.equal(plan.decisions.length, fixture.script.blocks.length);
  assert.equal(aligned.totalDuration, fixture.expected.totalDuration);
  assert.equal(alignment.status, "pass");
});

test("黄金回归完整保留人工清单且不按旧风险字段二次筛选", () => {
  const { catalog, before, plan } = runGolden();
  assert.equal(catalog.materialCount, fixture.expected.materialCount);
  assert.deepEqual(catalog.materials.map((item) => item.id).sort(), fixture.expected.materialIds);
  assert.equal(catalog.audit.excludedBySecondaryQualityFilter, 0);
  assert.equal(JSON.stringify(catalog.materials), before);
  assert.equal(plan.timelineOptimization.catalogPolicy, "trust_human_confirmed_classification");
  assert.deepEqual([...new Set(plan.decisions.flatMap((decision) => decision.timeline.map((item) => item.materialId)))].sort(), fixture.expected.materialIds);
});

test("有口播模式逐句配音字幕和镜头时间完全同源", () => {
  const { aligned } = runGolden();
  assert.ok(aligned.sentences.every((sentence) => sentence.voiceText === sentence.subtitleText));
  assert.ok(aligned.sentences.every((sentence) => sentence.timeline.length === 1));
  assert.equal(aligned.voiceText, fixture.script.blocks.map((block) => block.voiceText).join(""));
});
