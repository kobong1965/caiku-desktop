const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { scoreQualityReport } = require("../electron/services/quality-score-service.cjs");

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "quality", "god-pants-2026-08-21.json"), "utf8"));

test("三条历史低分成片都被固定为 blocked 且低于 60 分", () => {
  assert.equal(fixture.variants.length, 3);
  for (const variant of fixture.variants) {
    const quality = scoreQualityReport(variant.report);
    assert.equal(quality.status, variant.expected.status, variant.fileName);
    assert.ok(quality.totalScore <= variant.expected.maximumScore, `${variant.fileName}: ${quality.totalScore}`);
  }
});

test("失败金标覆盖错误商品字幕风险重复与高度相似", () => {
  const expected = [
    "wrong_product",
    "caption_residual",
    "visible_risk_text",
    "missing_direct_evidence",
    "repeated_shot",
    "identical_audio",
    "high_variant_similarity"
  ];
  assert.deepEqual(fixture.goldIssues, expected);
  assert.equal(new Set(fixture.variants.map(() => fixture.sharedMetrics.audioDecodedMd5)).size, 1);
  assert.ok(Object.values(fixture.sharedMetrics.pairVisualSimilarity).every((value) => value >= 0.8));
});

test("三条成片的切点签名高度重合", () => {
  const [first, second, third] = fixture.variants.map((variant) => variant.cutSignature.map(String));
  assert.deepEqual(first, second);
  const overlap = first.filter((value) => third.includes(value)).length / Math.max(first.length, third.length);
  assert.ok(overlap >= 0.9, `切点重合率仅 ${overlap}`);
});
