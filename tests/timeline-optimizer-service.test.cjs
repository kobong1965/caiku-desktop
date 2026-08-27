const test = require("node:test");
const assert = require("node:assert/strict");
const {
  optimizeTimeline,
  partitionDuration,
  validateTimelineItems
} = require("../electron/services/timeline-optimizer-service.cjs");

function eligible(id, duration = 4) {
  return { id, duration, eligibleForMix: true, productIdentity: { status: "matched" }, captionVerification: { status: "pass" } };
}

test("脚本时长被拆成每镜 2 到 4 秒", () => {
  assert.deepEqual(partitionDuration(9), [3, 3, 3]);
  assert.deepEqual(partitionDuration(5), [2.5, 2.5]);
  assert.equal(partitionDuration(1.9), null);
});

test("优化器使用独立素材填满段落且不重复", () => {
  const result = optimizeTimeline({
    decisions: [{ blockId: "b1", blockName: "开场", duration: 8, selectedMaterialIds: ["m1", "m2"] }],
    materials: [eligible("m1"), eligible("m2")]
  }, { requireEligibility: true });
  assert.equal(result.status, "ready");
  assert.equal(result.stats.totalDuration, 8);
  assert.equal(result.stats.shotCount, 2);
  assert.equal(result.stats.uniqueMaterialCount, 2);
});

test("独立素材不足时阻断而不是重复同片填时长", () => {
  const result = optimizeTimeline({
    decisions: [{ blockId: "b1", blockName: "证明", duration: 8, selectedMaterialIds: ["m1"] }],
    materials: [eligible("m1")]
  }, { requireEligibility: true });
  assert.equal(result.status, "blocked");
  assert.equal(result.errors[0].code, "UNIQUE_MATERIALS_INSUFFICIENT");
});

test("错款或字幕未通过的素材不能进入严格时间线", () => {
  const wrong = { ...eligible("wrong"), productIdentity: { status: "mismatch" } };
  const dirty = { ...eligible("dirty"), captionVerification: { status: "blocked" } };
  const result = optimizeTimeline({
    decisions: [{ blockId: "b1", duration: 4, selectedMaterialIds: ["wrong", "dirty"] }],
    materials: [wrong, dirty]
  }, { requireEligibility: true });
  assert.equal(result.status, "blocked");
});

test("最终时间线拒绝短镜头、长镜头、重复和间接证据", () => {
  const material = eligible("m1", 10);
  const result = validateTimelineItems([
    { materialId: "m1", material, duration: 1.5 },
    { materialId: "m1", material, duration: 5 }
  ], {
    requireEligibility: true,
    requireDirectEvidence: true,
    decisions: [{ blockId: "b1", evidenceStatus: "indirect", unsupportedClaims: ["弹力"] }]
  });
  assert.equal(result.status, "blocked");
  assert.deepEqual(new Set(result.errors.map((error) => error.code)), new Set(["SHOT_TOO_SHORT", "SHOT_TOO_LONG", "MATERIAL_REPEATED", "DIRECT_EVIDENCE_REQUIRED"]));
});
