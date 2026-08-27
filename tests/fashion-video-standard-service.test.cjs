const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DECISIONS,
  auditSlice,
  decideCaptionTreatment,
  finalMaterialDestination,
  gateFinalCaptionAudit,
  normalizeOverlayAssessment,
  shouldAttemptCaptionSecondPass
} = require("../electron/services/fashion-video-standard-service.cjs");

test("无字幕素材直接进入保真分类", () => {
  const result = decideCaptionTreatment({ analysis: { visibleTexts: [], captionRegions: [] }, audit: { positiveFrames: 0 } });
  assert.equal(result.decision, DECISIONS.CLEAN);
  assert.equal(result.needsReview, false);
});

test("常规白黄描边硬字幕进入 LaMa 安全修复", () => {
  const result = decideCaptionTreatment({
    analysis: {
      visibleTexts: [{ text: "久坐也不勒", kind: "subtitle" }],
      captionRegions: [{ x: 0.2, y: 0.72, width: 0.6, height: 0.06, confidence: 0.96 }],
      overlayAssessment: { complexity: "standard_caption", safeToInpaint: true }
    },
    audit: { positiveFrames: 6, positiveRatio: 0.3 }
  });
  assert.equal(result.decision, DECISIONS.REPAIR);
});

test("普通字幕与贴纸标签冲突时以字幕证据为准并执行修复", () => {
  const result = decideCaptionTreatment({
    analysis: {
      visibleTexts: [{ text: "西裤分享", kind: "subtitle" }],
      captionRegions: [{ x: 0.35, y: 0.45, width: 0.3, height: 0.1, confidence: 0.95 }],
      overlayAssessment: {
        complexity: "standard_caption",
        features: ["sticker"],
        safeToInpaint: false,
        subjectOverlap: "high"
      }
    },
    audit: { positiveFrames: 18, positiveRatio: 0.9 }
  });
  assert.equal(result.decision, DECISIONS.REPAIR);
  assert.equal(result.ignoredStickerConflict, true);
  assert.match(result.reason, /忽略视觉模型的贴纸误标签/);
});

test("普通字幕覆盖人物主体时仍执行修复并交给终检把关", () => {
  const result = decideCaptionTreatment({
    analysis: {
      visibleTexts: [{ text: "显腿长", kind: "subtitle" }],
      captionRegions: [{ x: 0.28, y: 0.48, width: 0.44, height: 0.08, confidence: 0.96 }],
      overlayAssessment: { complexity: "standard_caption", features: ["subtitle"], subjectOverlap: "high" }
    },
    audit: { positiveFrames: 12, positiveRatio: 0.6 }
  });
  assert.equal(result.decision, DECISIONS.REPAIR);
});

test("截图贴纸和大面积营销图文进入低复用而不强行补画", () => {
  const result = decideCaptionTreatment({
    analysis: {
      visibleTexts: [{ text: "到手价", kind: "price" }],
      captionRegions: [{ x: 0.05, y: 0.1, width: 0.9, height: 0.45, confidence: 0.98 }],
      overlayAssessment: { complexity: "complex_graphic", features: ["screenshot", "price_card"], subjectOverlap: "high" }
    }
  });
  assert.equal(result.decision, DECISIONS.LOW_REUSE);
  assert.equal(finalMaterialDestination({ treatment: result }).folder, "98_低复用待复核");
});

test("本机连续检测到三层以上图文时按截图拼贴分流", () => {
  const result = decideCaptionTreatment({
    analysis: { visibleTexts: [], captionRegions: [], overlayAssessment: { complexity: "unknown" } },
    audit: {
      positiveFrames: 6,
      positiveRatio: 0.3,
      samples: [
        { time: 2.25, boxes: [[0, 20, 400, 60], [20, 210, 300, 50], [80, 760, 380, 50]] },
        { time: 2.5, boxes: [[0, 20, 400, 60], [0, 410, 500, 80], [80, 760, 380, 50]] }
      ]
    }
  });
  assert.equal(result.decision, DECISIONS.LOW_REUSE);
  assert.match(result.reason, /多层截图或拼贴图文/);
});

test("集中在底部字幕带的三行双语字幕仍进入修复", () => {
  const result = decideCaptionTreatment({
    analysis: {
      visibleTexts: [{ text: "冬天选对内搭很重要", kind: "subtitle" }],
      overlayAssessment: { complexity: "standard_caption", features: ["sticker"] }
    },
    audit: {
      positiveFrames: 8,
      positiveRatio: 0.5,
      samples: [
        { time: 0.52, boxes: [[151, 729, 234, 40], [62, 773, 396, 37], [125, 809, 285, 38]] },
        { time: 0.76, boxes: [[151, 729, 234, 40], [62, 773, 396, 37], [125, 809, 285, 38]] }
      ]
    }
  });
  assert.equal(result.decision, DECISIONS.REPAIR);
  assert.equal(result.ignoredStickerConflict, true);
});

test("模型未知但本机持续检出宽幅覆盖层时进入低复用", () => {
  const samples = Array.from({ length: 6 }, (_, index) => ({
    time: index * 0.25,
    boxes: [[50, 461, 440, 41]]
  }));
  const result = decideCaptionTreatment({
    analysis: { visibleTexts: [], captionRegions: [], overlayAssessment: { complexity: "unknown" } },
    audit: { positiveFrames: 15, checkedFrames: 15, positiveRatio: 1, samples }
  });
  assert.equal(result.decision, DECISIONS.LOW_REUSE);
  assert.match(result.reason, /宽幅覆盖层/);
});

test("单帧服装高光疑似文字且模型未识别时按误报保留", () => {
  const result = decideCaptionTreatment({ analysis: {}, audit: { positiveFrames: 1, positiveRatio: 0.02 } });
  assert.equal(result.decision, DECISIONS.CLEAN);
  assert.equal(result.isolatedDetectorHit, true);
});

test("服装或配饰本体 Logo 不会被当成后期贴纸分流", () => {
  const result = decideCaptionTreatment({
    analysis: {
      visibleTexts: [{ text: "adidas", kind: "sticker", confidence: 0.98 }],
      captionRegions: [],
      overlayAssessment: { complexity: "none", features: [], safeToInpaint: true, subjectOverlap: "none" }
    },
    audit: { positiveFrames: 0, positiveRatio: 0, samples: [] }
  });
  assert.equal(result.decision, DECISIONS.CLEAN);
  assert.match(result.reason, /本体标识/);
});

test("源视频 4fps 检测结果能按镜头时间切片", () => {
  const slice = auditSlice({ sampleFps: 4, samples: [{ time: 0.5 }, { time: 2.1 }, { time: 2.4 }] }, { start: 2, end: 3, duration: 1 });
  assert.equal(slice.checkedFrames, 4);
  assert.equal(slice.positiveFrames, 2);
});

test("覆盖图层结构会被规范化并限制字段", () => {
  assert.deepEqual(normalizeOverlayAssessment({ complexity: "complex_graphic", features: ["screenshot", "screenshot"], safeToInpaint: true, subjectOverlap: "high" }), {
    complexity: "complex_graphic", features: ["screenshot"], safeToInpaint: true, subjectOverlap: "high", reason: ""
  });
});

test("普通字幕需要修复但运行环境不可用时安全降级到低复用", () => {
  const treatment = decideCaptionTreatment({ analysis: { visibleTexts: [{ text: "显腿长", kind: "subtitle" }] } });
  const destination = finalMaterialDestination({ treatment, repairAvailable: false });
  assert.equal(treatment.decision, DECISIONS.REPAIR);
  assert.equal(destination.lowReuse, true);
  assert.match(destination.reasons.join("；"), /修复引擎不可用/);
});

test("二次补画只允许普通字幕修复片段触发", () => {
  const blocked = { status: "blocked" };
  const captionRegions = [{ x: 0.2, y: 0.8, width: 0.6, height: 0.1 }];
  assert.equal(shouldAttemptCaptionSecondPass({
    treatment: { decision: DECISIONS.REPAIR }, captionVerification: blocked, captionRegions, repairAvailable: true
  }), true);
  assert.equal(shouldAttemptCaptionSecondPass({
    treatment: { decision: DECISIONS.LOW_REUSE }, captionVerification: blocked, captionRegions, repairAvailable: true
  }), false);
});

test("修复后 4fps 连续命中会阻断，单帧弱命中只记录误报候选", () => {
  const blocked = gateFinalCaptionAudit({ status: "pass", residualCount: 0, reasons: [] }, { available: true, positiveFrames: 3, positiveRatio: 0.15 });
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.residualCount, 3);
  const isolated = gateFinalCaptionAudit({ status: "pass", reasons: [] }, { available: true, positiveFrames: 1, positiveRatio: 0.02 });
  assert.equal(isolated.status, "pass");
  assert.equal(isolated.isolatedDetectorHit, true);
  const unavailable = gateFinalCaptionAudit({ status: "pass", reasons: [] }, { available: false });
  assert.equal(unavailable.status, "review");
});
