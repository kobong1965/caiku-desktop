const STANDARD_VERSION = "fashion-video-standard-2026.08.22";

const DECISIONS = Object.freeze({
  CLEAN: "clean",
  REPAIR: "repair_standard_caption",
  LOW_REUSE: "route_low_reuse"
});

const COMPLEX_TEXT_KINDS = new Set(["sticker", "price", "product", "screenshot", "ui", "graphic", "magnifier", "collage"]);
const STANDARD_TEXT_KINDS = new Set(["subtitle", "watermark"]);
const COMPLEX_FEATURES = new Set(["sticker", "price_card", "product_card", "screenshot", "ui_panel", "magnifier", "cutout", "collage", "comparison_layer", "large_sales_text"]);

function clamp(value, minimum = 0, maximum = 1) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : minimum;
}

function cleanStrings(values, limit = 12) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || "").trim()).filter(Boolean))].slice(0, limit);
}

function normalizeOverlayAssessment(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const allowed = new Set(["none", "standard_caption", "complex_graphic", "unknown"]);
  return {
    complexity: allowed.has(source.complexity) ? source.complexity : "unknown",
    features: cleanStrings(source.features, 12),
    safeToInpaint: source.safeToInpaint === true,
    subjectOverlap: ["none", "low", "high", "unknown"].includes(source.subjectOverlap) ? source.subjectOverlap : "unknown",
    reason: String(source.reason || "").trim().slice(0, 240)
  };
}

function auditSlice(sourceAudit = {}, segment = {}) {
  const start = Number(segment.start || 0);
  const end = Number(segment.end ?? (start + Number(segment.duration || 0)));
  const samples = (Array.isArray(sourceAudit.samples) ? sourceAudit.samples : []).filter((sample) => {
    const time = Number(sample?.time);
    return Number.isFinite(time) && time >= start && time < end;
  });
  const sampleFps = Math.max(0.1, Number(sourceAudit.sampleFps || 4));
  const checkedFrames = Math.max(0, Math.round(Math.max(0, end - start) * sampleFps));
  return {
    available: sourceAudit.available !== false,
    sampleFps,
    checkedFrames,
    positiveFrames: samples.length,
    positiveRatio: Number((samples.length / Math.max(1, checkedFrames)).toFixed(4)),
    samples
  };
}

function regionRisk(regions = []) {
  const normalized = (Array.isArray(regions) ? regions : []).map((region) => ({
    area: clamp(region?.width) * clamp(region?.height),
    confidence: clamp(region?.confidence)
  })).filter((region) => region.area > 0 && region.confidence >= 0.45);
  return {
    count: normalized.length,
    maximumArea: normalized.reduce((maximum, region) => Math.max(maximum, region.area), 0),
    totalArea: normalized.reduce((sum, region) => sum + region.area, 0)
  };
}

function decideCaptionTreatment({ analysis = {}, captionMode = "smart_mask", audit = {} } = {}) {
  const visibleTexts = Array.isArray(analysis.visibleTexts) ? analysis.visibleTexts : [];
  const overlay = normalizeOverlayAssessment(analysis.overlayAssessment);
  const risk = regionRisk(analysis.captionRegions);
  const kinds = new Set(visibleTexts.map((item) => String(item?.kind || "other").toLowerCase()));
  const hasStandardText = [...kinds].some((kind) => STANDARD_TEXT_KINDS.has(kind)) || overlay.complexity === "standard_caption";
  const hasComplexText = [...kinds].some((kind) => COMPLEX_TEXT_KINDS.has(kind));
  const sustainedAuditHit = Number(audit.positiveFrames || 0) >= 2 && Number(audit.positiveRatio || 0) >= 0.05;
  const areaTooLarge = risk.maximumArea > 0.12 || risk.totalArea > 0.18 || risk.count > 4;
  const reportedComplexFeatures = overlay.features.filter((feature) => COMPLEX_FEATURES.has(feature));
  const nonStickerComplexFeatures = reportedComplexFeatures.filter((feature) => feature !== "sticker");
  const multiLayerAuditFrames = (Array.isArray(audit.samples) ? audit.samples : []).filter((sample) => {
    const boxes = Array.isArray(sample?.boxes) ? sample.boxes : [];
    if (boxes.length < 3) return false;
    const centers = boxes.map((box) => Number(box?.[1]) + Number(box?.[3]) / 2).filter(Number.isFinite);
    return centers.length >= 3 && Math.max(...centers) - Math.min(...centers) >= 200;
  }).length;
  const denseWideAuditFrames = (Array.isArray(audit.samples) ? audit.samples : []).filter((sample) => (
    (Array.isArray(sample?.boxes) ? sample.boxes : []).some((box) => Number(box?.[2]) >= 400)
  )).length;
  const unexplainedDenseOverlay = overlay.complexity === "unknown"
    && visibleTexts.length === 0
    && Number(audit.positiveRatio || 0) >= 0.8
    && denseWideAuditFrames >= 2;
  const sceneEmbeddedBrandText = overlay.complexity === "none"
    && hasComplexText
    && risk.count === 0
    && !sustainedAuditHit;
  const ignoredStickerConflict = overlay.complexity === "standard_caption"
    && reportedComplexFeatures.includes("sticker")
    && nonStickerComplexFeatures.length === 0
    && !hasComplexText
    && !areaTooLarge
    && (hasStandardText || sustainedAuditHit);
  const complexFeatures = ignoredStickerConflict ? [] : reportedComplexFeatures;
  const complexReasons = [];
  if (overlay.complexity === "complex_graphic") complexReasons.push("视觉模型识别到复杂覆盖图层");
  if (complexFeatures.length) complexReasons.push(`包含${complexFeatures.join("、")}`);
  if (hasComplexText && !sceneEmbeddedBrandText) complexReasons.push("包含贴纸、商品卡、截图或营销图文");
  if (multiLayerAuditFrames >= 2) complexReasons.push("本机连续检测到多层截图或拼贴图文");
  if (unexplainedDenseOverlay) complexReasons.push("视觉模型未能解释本机连续检出的宽幅覆盖层");
  if (overlay.subjectOverlap === "high" && (overlay.complexity === "complex_graphic" || complexFeatures.length || hasComplexText)) {
    complexReasons.push("复杂覆盖区域与人物或商品主体重叠");
  }
  if (areaTooLarge) complexReasons.push("覆盖面积过大，不适合自动补画");

  const hasModelText = visibleTexts.length > 0 || risk.count > 0;
  const anyDetectedText = hasModelText || sustainedAuditHit;

  if (complexReasons.length) {
    return {
      version: STANDARD_VERSION,
      decision: DECISIONS.LOW_REUSE,
      reason: complexReasons.join("；"),
      detectedText: anyDetectedText,
      needsReview: true,
      overlay,
      risk,
      multiLayerAuditFrames,
      denseWideAuditFrames
    };
  }
  if (captionMode === "keep" && anyDetectedText) {
    return {
      version: STANDARD_VERSION,
      decision: DECISIONS.LOW_REUSE,
      reason: "当前设置保留原画，检测到的硬字幕不能进入可复用素材",
      detectedText: true,
      needsReview: true,
      overlay,
      risk
    };
  }
  if (hasStandardText || sustainedAuditHit) {
    return {
      version: STANDARD_VERSION,
      decision: DECISIONS.REPAIR,
      reason: ignoredStickerConflict
        ? "普通字幕证据一致，已忽略视觉模型的贴纸误标签并进入安全修复"
        : hasStandardText ? "检测到可安全修复的常规硬字幕或小面积水印" : "4fps 连续检测到常规描边文字",
      detectedText: true,
      needsReview: false,
      ignoredStickerConflict,
      multiLayerAuditFrames,
      overlay,
      risk
    };
  }
  return {
    version: STANDARD_VERSION,
    decision: DECISIONS.CLEAN,
    reason: sceneEmbeddedBrandText
      ? "视觉模型确认文字属于服装或配饰本体标识，不按后期字幕处理"
      : Number(audit.positiveFrames || 0) === 1 && !hasModelText
      ? "仅有单帧弱检测且视觉模型未见文字，按服装高光或纹理误报处理"
      : "视觉模型与本机检测均未发现需要清除的硬字幕",
    detectedText: false,
    needsReview: false,
    isolatedDetectorHit: Number(audit.positiveFrames || 0) === 1 && !hasModelText,
    overlay,
    risk
  };
}

function finalMaterialDestination({ treatment, captionVerification, repairAvailable = true } = {}) {
  const reasons = [];
  if (treatment?.decision === DECISIONS.LOW_REUSE) reasons.push(treatment.reason || "复杂图文覆盖");
  if (treatment?.decision === DECISIONS.REPAIR && !repairAvailable) reasons.push("本机字幕修复引擎不可用");
  if (captionVerification?.status && captionVerification.status !== "pass") reasons.push(...(captionVerification.reasons || ["字幕终检未通过"]));
  return {
    lowReuse: reasons.length > 0,
    folder: reasons.length ? "98_低复用待复核" : null,
    reasons: cleanStrings(reasons, 12)
  };
}

function shouldAttemptCaptionSecondPass({ treatment, captionVerification, captionRegions, repairAvailable = false } = {}) {
  return repairAvailable === true
    && treatment?.decision === DECISIONS.REPAIR
    && captionVerification?.status === "blocked"
    && Array.isArray(captionRegions)
    && captionRegions.length > 0;
}

function gateFinalCaptionAudit(captionVerification = {}, finalAudit = {}, options = {}) {
  const result = { ...captionVerification, reasons: [...(captionVerification.reasons || [])] };
  if (options.required === false) return result;
  if (!finalAudit.available) {
    result.status = "review";
    result.reasons = [...new Set([...result.reasons, "修复后 4fps 本机终检未完成，不能证明字幕已经清除"])]
    return result;
  }
  if (Number(finalAudit.positiveFrames || 0) >= 2 && Number(finalAudit.positiveRatio || 0) >= 0.05) {
    result.status = "blocked";
    result.residualCount = Math.max(Number(result.residualCount || 0), Number(finalAudit.positiveFrames || 0));
    result.reasons = [...new Set([...result.reasons, `修复后 4fps 仍连续检出 ${finalAudit.positiveFrames} 个字幕候选帧`])];
    return result;
  }
  if (Number(finalAudit.positiveFrames || 0) === 1 && result.status === "pass") {
    result.isolatedDetectorHit = true;
    result.reasons = [...new Set([...result.reasons, "4fps 终检出现 1 个孤立候选，模型未识别文字，按服装高光或纹理误报记录"])]
  }
  return result;
}

module.exports = {
  COMPLEX_FEATURES,
  DECISIONS,
  STANDARD_VERSION,
  auditSlice,
  decideCaptionTreatment,
  finalMaterialDestination,
  gateFinalCaptionAudit,
  normalizeOverlayAssessment,
  regionRisk,
  shouldAttemptCaptionSecondPass
};
