const test = require("node:test");
const assert = require("node:assert/strict");
const {
  compareVariantFingerprints,
  createCreativeStrategies,
  validateVariantBatch
} = require("../electron/services/variant-similarity-service.cjs");

test("批量成片先生成互不相同的创意策略", () => {
  const strategies = createCreativeStrategies(3, 1);
  assert.equal(new Set(strategies.map((item) => item.id)).size, 3);
  assert.equal(new Set(strategies.map((item) => item.hookStyle)).size, 3);
  assert.equal(new Set(strategies.map((item) => item.voiceTempo)).size, 3);
});

test("同音频同开头同顺序会得到最高相似度", () => {
  const left = { audioHash: "same", hookMaterialId: "m1", materialIds: ["m1", "m2"], cutDurations: [3, 3], strategyId: "s1" };
  const result = compareVariantFingerprints(left, { ...left });
  assert.equal(result.similarity, 1);
  assert.equal(result.audioSame, true);
  assert.equal(result.hookSame, true);
});

test("音频、开头和素材顺序不同的成片可通过差异化门禁", () => {
  const result = validateVariantBatch([
    { id: "v1", audioHash: "a", hookMaterialId: "m1", materialIds: ["m1", "m2", "m3"], cutDurations: [2, 3, 4], strategyId: "s1" },
    { id: "v2", audioHash: "b", hookMaterialId: "m4", materialIds: ["m4", "m5", "m2"], cutDurations: [4, 2, 3], strategyId: "s2" }
  ]);
  assert.equal(result.status, "pass");
});

test("相同音频或相同开头任一出现就阻断", () => {
  const result = validateVariantBatch([
    { id: "v1", audioHash: "same", hookMaterialId: "m1", materialIds: ["m1", "m2"], cutDurations: [3, 3], strategyId: "s1" },
    { id: "v2", audioHash: "same", hookMaterialId: "m3", materialIds: ["m3", "m4"], cutDurations: [2, 4], strategyId: "s2" }
  ]);
  assert.equal(result.status, "blocked");
  assert.equal(result.blockers[0].audioSame, true);
});
