const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeOcrText,
  textMatches,
  verifyCaptionRepair,
  verifyFinalCaptions
} = require("../electron/services/caption-verification-service.cjs");

test("OCR 文本比较忽略空格和标点但不把无关文案当同一句", () => {
  assert.equal(normalizeOcrText(" 高腰，直筒！ "), "高腰直筒");
  assert.equal(textMatches("高腰直筒显腿长", "高腰 直筒"), true);
  assert.equal(textMatches("黑色通勤裤", "夏季白衬衫"), false);
});

test("修复后仍有原字幕或水印时阻断素材", () => {
  const result = verifyCaptionRepair({
    treatmentMode: "smart_mask",
    beforeTexts: [{ text: "全网最显瘦", kind: "subtitle" }, { text: "账号水印", kind: "watermark" }],
    afterTexts: [{ text: "全网 最显瘦", kind: "subtitle" }]
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.residualCount, 1);
  assert.deepEqual(result.residualTexts, ["全网 最显瘦"]);
});

test("修复后 OCR 没有完成时不能假装字幕已清理", () => {
  const result = verifyCaptionRepair({ beforeTexts: ["原字幕"], afterAvailable: false });
  assert.equal(result.status, "review");
  assert.match(result.reasons[0], /不能证明/);
});

test("成片后缺脚本字幕或残留素材文字时阻断", () => {
  const result = verifyFinalCaptions({
    expectedTexts: ["高腰直筒", "通勤好搭"],
    observedTexts: ["高腰直筒", "旧视频水印"],
    sourceTexts: ["旧视频水印"]
  });
  assert.equal(result.status, "blocked");
  assert.deepEqual(result.missingTexts, ["通勤好搭"]);
  assert.deepEqual(result.sourceResidualTexts, ["旧视频水印"]);
});

test("脚本字幕完整且无素材残留时通过第三次检查", () => {
  const result = verifyFinalCaptions({
    expectedTexts: ["高腰直筒", "通勤好搭"],
    observedTexts: ["高腰直筒", "通勤好搭"],
    sourceTexts: ["原视频字幕"]
  });
  assert.equal(result.status, "pass");
  assert.equal(result.matchedCount, 2);
});
