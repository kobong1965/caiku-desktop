const CAPTION_VERIFICATION_VERSION = "caption-ocr-2026.08.1";

function normalizeOcrText(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[\s\p{P}\p{S}]+/gu, "")
    .trim();
}

function normalizeOcrItems(values) {
  return (Array.isArray(values) ? values : []).slice(0, 100).map((item) => {
    const source = typeof item === "string" ? { text: item } : (item || {});
    const confidence = Number(source.confidence);
    return {
      text: String(source.text || "").trim().slice(0, 500),
      normalizedText: normalizeOcrText(source.text),
      kind: String(source.kind || "other").trim().slice(0, 40),
      region: String(source.region || "unknown").trim().slice(0, 40),
      confidence: Number.isFinite(confidence) ? Number(Math.max(0, Math.min(1, confidence)).toFixed(3)) : null
    };
  }).filter((item) => item.normalizedText);
}

function charSetSimilarity(left, right) {
  const a = new Set([...normalizeOcrText(left)]);
  const b = new Set([...normalizeOcrText(right)]);
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((char) => b.has(char)).length;
  return intersection / Math.max(a.size, b.size);
}

function textMatches(left, right) {
  const a = normalizeOcrText(left);
  const b = normalizeOcrText(right);
  if (!a || !b) return false;
  if (a.includes(b) || b.includes(a)) return true;
  return Math.min(a.length, b.length) >= 3 && charSetSimilarity(a, b) >= 0.72;
}

function verifyCaptionRepair({ beforeTexts, afterTexts, treatmentMode, afterAvailable = true } = {}) {
  const before = normalizeOcrItems(beforeTexts);
  const after = normalizeOcrItems(afterTexts);
  const residuals = after.filter((afterItem) => before.some((beforeItem) => textMatches(afterItem.text, beforeItem.text)));
  const hardVisible = after.filter((item) => ["subtitle", "watermark"].includes(item.kind));
  const combinedResiduals = [...new Map([...residuals, ...hardVisible].map((item) => [item.normalizedText, item])).values()];
  const residualScore = before.length ? combinedResiduals.length / before.length : combinedResiduals.length ? 1 : 0;
  let status = "pass";
  const reasons = [];
  if (!afterAvailable) {
    status = "review";
    reasons.push("修复后 OCR 未完成，不能证明原字幕已经清除");
  } else if (treatmentMode === "keep" && before.length) {
    status = "blocked";
    reasons.push("处理模式保留了原画面文字");
  } else if (combinedResiduals.length) {
    status = "blocked";
    reasons.push(`修复后仍识别到 ${combinedResiduals.length} 项原字幕或水印`);
  }
  return {
    version: CAPTION_VERIFICATION_VERSION,
    stage: "post_repair",
    status,
    treatmentMode: String(treatmentMode || "unknown"),
    beforeCount: before.length,
    afterCount: after.length,
    residualCount: combinedResiduals.length,
    residualScore: Number(Math.max(0, Math.min(1, residualScore)).toFixed(3)),
    residualTexts: combinedResiduals.map((item) => item.text),
    reasons,
    before,
    after
  };
}

function verifyFinalCaptions({ expectedTexts, observedTexts, sourceTexts, observationAvailable = true } = {}) {
  const expected = normalizeOcrItems(expectedTexts);
  const observed = normalizeOcrItems(observedTexts);
  const source = normalizeOcrItems(sourceTexts);
  const matchedExpected = expected.filter((expectedItem) => observed.some((observedItem) => textMatches(expectedItem.text, observedItem.text)));
  const missingExpected = expected.filter((expectedItem) => !matchedExpected.includes(expectedItem));
  const sourceResiduals = observed.filter((observedItem) => source.some((sourceItem) => textMatches(observedItem.text, sourceItem.text)));
  let status = "pass";
  const reasons = [];
  if (!observationAvailable) {
    status = "blocked";
    reasons.push("成片后 OCR 未完成");
  }
  if (missingExpected.length) {
    status = "blocked";
    reasons.push(`成片缺少 ${missingExpected.length} 条脚本字幕`);
  }
  if (sourceResiduals.length) {
    status = "blocked";
    reasons.push(`成片仍出现 ${sourceResiduals.length} 条素材原文字`);
  }
  return {
    version: CAPTION_VERIFICATION_VERSION,
    stage: "final_output",
    status,
    expectedCount: expected.length,
    observedCount: observed.length,
    matchedCount: matchedExpected.length,
    missingTexts: missingExpected.map((item) => item.text),
    sourceResidualTexts: [...new Set(sourceResiduals.map((item) => item.text))],
    reasons
  };
}

module.exports = {
  CAPTION_VERIFICATION_VERSION,
  charSetSimilarity,
  normalizeOcrItems,
  normalizeOcrText,
  textMatches,
  verifyCaptionRepair,
  verifyFinalCaptions
};
