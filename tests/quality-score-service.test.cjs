const test = require("node:test");
const assert = require("node:assert/strict");
const {
  QUALITY_DIMENSIONS,
  applyQualityContract,
  decidePublishStatus,
  scoreQualityReport
} = require("../electron/services/quality-score-service.cjs");
const { finalizeQualityReport } = require("../electron/services/quality-audit-service.cjs");

function allPassSignals() {
  return Object.fromEntries(Object.keys(QUALITY_DIMENSIONS).map((key) => [key, {
    status: "pass",
    score: 100,
    reasons: []
  }]));
}

test("包含清晰度和口播自然度的质量权重总和固定为 100", () => {
  const total = Object.values(QUALITY_DIMENSIONS).reduce((sum, dimension) => sum + dimension.weight, 0);
  assert.equal(total, 100);
});

test("所有维度满分且没有阻断时才进入 ready_100", () => {
  const result = scoreQualityReport({ qualitySignals: allPassSignals() });
  assert.equal(result.totalScore, 100);
  assert.equal(result.status, "ready_100");
  assert.equal(result.publishReady, true);
  assert.deepEqual(result.hardBlockers, []);
  assert.deepEqual(result.reviewItems, []);
});

test("软维度未满分进入 repair_required 而不是冒充可投放", () => {
  const qualitySignals = allPassSignals();
  qualitySignals.hook = { status: "review", score: 75, reasons: ["前 3 秒缺少商品直接证据"] };
  const result = scoreQualityReport({ qualitySignals });
  assert.equal(result.totalScore, 98);
  assert.equal(result.status, "repair_required");
  assert.equal(result.publishReady, false);
  assert.equal(result.scoreBreakdown.hook.score, 75);
});

test("硬维度明确阻断时整体状态必须 blocked", () => {
  const qualitySignals = allPassSignals();
  qualitySignals.compliance = { status: "blocked", score: 0, reasons: ["可见文字包含未核实履约承诺"] };
  const result = scoreQualityReport({ qualitySignals });
  assert.equal(result.status, "blocked");
  assert.equal(result.publishReady, false);
  assert.equal(result.hardBlockers[0].dimension, "compliance");
});

test("画面放大或机械配音任一项都会阻断 100 分", () => {
  const zoomed = allPassSignals();
  zoomed.visualFidelity = { status: "blocked", score: 0, reasons: ["检测到 2.5 倍放大"] };
  assert.equal(scoreQualityReport({ qualitySignals: zoomed }).status, "blocked");
  const robotic = allPassSignals();
  robotic.voiceNaturalness = { status: "blocked", score: 0, reasons: ["机械系统配音"] };
  assert.equal(scoreQualityReport({ qualitySignals: robotic }).status, "blocked");
});

test("硬维度信息不足进入 manual_review", () => {
  const qualitySignals = allPassSignals();
  delete qualitySignals.productIdentity;
  const result = scoreQualityReport({ qualitySignals });
  assert.equal(result.status, "manual_review");
  assert.equal(result.publishReady, false);
  assert.ok(result.reviewItems.some((item) => item.dimension === "productIdentity"));
});

test("历史低分报告会被回放为低于 60 分并阻断", () => {
  const legacy = {
    technical: { status: "pass", width: 1080, height: 1920, videoCodec: "h264", audioCodec: "aac", sampleRate: 48000 },
    script: { status: "pass", score: 100 },
    materialCoverage: { status: "review", missing: ["测评讲解"] },
    editingPlan: {
      decisions: [
        { blockId: "b1", evidenceStatus: "indirect", unsupportedClaims: [], rewriteRequired: false }
      ]
    },
    voice: { status: "generated_or_selected", sourceAudioMuted: true },
    visualSemantic: {
      status: "blocked",
      alignmentScore: 45,
      issues: [
        { level: "block", name: "可见极限词与虚假功效承诺" },
        { level: "review", name: "字幕与画面不匹配" }
      ]
    }
  };
  const result = scoreQualityReport(legacy);
  assert.equal(result.status, "blocked");
  assert.ok(result.totalScore < 60);
  assert.equal(result.scoreBreakdown.scriptEvidence.status, "review");
  assert.equal(result.scoreBreakdown.captionCleanliness.status, "review");
});

test("质量合同写回统一状态且保留原报告内容", () => {
  const report = finalizeQualityReport({ outputPath: "D:\\成片\\候选.mp4", qualitySignals: allPassSignals() });
  assert.equal(report.outputPath, "D:\\成片\\候选.mp4");
  assert.equal(report.schemaVersion, 2);
  assert.equal(report.status, "ready_100");
  assert.equal(report.totalScore, 100);
  assert.equal(report.publishReady, true);
  assert.equal(decidePublishStatus(report.quality), "ready_100");
});

test("直接应用合同与质检服务收口得到相同发布状态", () => {
  const raw = { qualitySignals: allPassSignals() };
  assert.equal(applyQualityContract(raw).status, finalizeQualityReport(raw).status);
});

test("重复质检会按最新信号重算而不是沿用旧分数", () => {
  const report = {
    technical: { status: "pass", width: 1080, height: 1920, videoCodec: "h264", audioCodec: "aac", sampleRate: 48000 },
    visualFidelity: { status: "pass", framingPolicy: "preserve_full_frame", cropFactor: 1, zoomFactor: 1, sourceWasUpscaled: false },
    productIdentity: { status: "match", score: 100, coverage: 1, reasons: [] },
    editingPlan: { decisions: [{ blockId: "b1", evidenceStatus: "direct", unsupportedClaims: [], rewriteRequired: false }] },
    hook: { status: "pass", score: 100, reasons: [] },
    pacing: { status: "pass", score: 100, reasons: [] },
    materialCoverage: { status: "pass", missing: [] },
    captionVerification: { final: { status: "pass", score: 100, reasons: [] } },
    audio: { status: "pass", score: 100, reasons: [] },
    voice: { status: "generated_or_selected", source: "qwen_tts_instruct", naturalness: { status: "pass", score: 100, reasons: [] } },
    script: { status: "pass", score: 100 },
    visualSemantic: { status: "pass", issues: [] },
    variantSimilarity: { status: "pass", score: 100, reasons: [] },
    scoreBreakdown: { compliance: { status: "review", score: 50, reasons: ["旧结果"] } }
  };
  const result = finalizeQualityReport(report);
  assert.equal(result.scoreBreakdown.compliance.status, "pass");
  assert.equal(result.totalScore, 100);
  assert.equal(result.status, "ready_100");
});
