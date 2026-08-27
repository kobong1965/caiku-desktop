const QUALITY_RULESET_VERSION = "CN-DOUYIN-QUALITY-2026.08.3";

const QUALITY_DIMENSIONS = Object.freeze({
  technical: { label: "技术与导出", weight: 8, hardGate: true },
  visualFidelity: { label: "原画清晰度与完整构图", weight: 7, hardGate: true },
  productIdentity: { label: "商品身份一致", weight: 13, hardGate: true },
  scriptEvidence: { label: "脚本与直接证据", weight: 13, hardGate: true },
  hook: { label: "前 3 秒钩子", weight: 9, hardGate: false },
  pacing: { label: "节奏与镜头语法", weight: 9, hardGate: false },
  productProof: { label: "商品证明完整度", weight: 10, hardGate: true },
  captionCleanliness: { label: "字幕与画面洁净度", weight: 8, hardGate: true },
  audio: { label: "音频技术质量", weight: 5, hardGate: true },
  voiceNaturalness: { label: "口播自然度与种草感", weight: 5, hardGate: true },
  compliance: { label: "合规与真实性", weight: 8, hardGate: true },
  diversity: { label: "成片差异化", weight: 5, hardGate: true }
});

const QUALITY_STATUSES = Object.freeze(["ready_100", "repair_required", "blocked", "manual_review"]);
const SIGNAL_STATUSES = new Set(["pass", "review", "blocked", "missing"]);

function clampScore(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(100, number));
}

function reasonList(value, fallback = []) {
  const source = Array.isArray(value) ? value : value ? [value] : fallback;
  return source.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 12);
}

function normalizeSignal(value, fallback = {}) {
  const raw = value && typeof value === "object" ? value : {};
  const fallbackStatus = SIGNAL_STATUSES.has(fallback.status) ? fallback.status : "missing";
  const status = SIGNAL_STATUSES.has(raw.status) ? raw.status : fallbackStatus;
  const defaultScores = { pass: 100, review: 60, blocked: 0, missing: 0 };
  return {
    status,
    score: clampScore(raw.score, clampScore(fallback.score, defaultScores[status])),
    reasons: reasonList(raw.reasons || raw.reason, reasonList(fallback.reasons || fallback.reason)),
    source: String(raw.source || fallback.source || "quality_contract")
  };
}

function issueText(issue = {}) {
  return [issue.name, issue.detail, issue.message].filter(Boolean).join("：");
}

function explicitSignal(report, key) {
  return report?.qualitySignals?.[key] || null;
}

function inferTechnical(report) {
  const section = report?.technical;
  if (!section) return normalizeSignal(null, { status: "missing", reasons: ["缺少成片技术检测结果"] });
  if (section.status === "blocked") return normalizeSignal(null, { status: "blocked", reasons: ["成片技术规格未通过"] });
  const exact = Number(section.width) === 1080
    && Number(section.height) === 1920
    && String(section.videoCodec || "").toLowerCase() === "h264"
    && String(section.audioCodec || "").toLowerCase() === "aac"
    && Number(section.sampleRate) === 48000;
  if (section.status === "pass" && exact) return normalizeSignal(null, { status: "pass", score: 100, reasons: [] });
  return normalizeSignal(null, { status: "review", score: exact ? 85 : 40, reasons: ["技术规格信息不完整或需要复核"] });
}

function inferProductIdentity(report) {
  const section = report?.productIdentity || report?.productIdentityCoverage;
  if (!section) return normalizeSignal(null, { status: "missing", reasons: ["尚未检查目标款号与画面商品是否一致"] });
  if (section.status === "mismatch" || section.status === "blocked") {
    return normalizeSignal(null, { status: "blocked", reasons: reasonList(section.reasons || section.reason, ["画面出现非目标商品"]), score: 0 });
  }
  if (section.status === "match" || section.status === "matched" || section.status === "pass") {
    const coverage = section.coverage == null ? 1 : Number(section.coverage);
    const score = section.score == null ? coverage * 100 : section.score;
    return normalizeSignal(null, { status: coverage >= 1 && Number(score) >= 100 ? "pass" : "review", score, reasons: reasonList(section.reasons) });
  }
  return normalizeSignal(null, { status: "review", score: section.score || 0, reasons: reasonList(section.reasons || section.reason, ["商品身份置信度不足，需要人工复核"]) });
}

function inferVisualFidelity(report) {
  const section = report?.visualFidelity || report?.technical?.visualFidelity;
  if (!section) return normalizeSignal(null, { status: "missing", reasons: ["缺少原画清晰度、裁切与放大检测结果"] });
  const zoomFactor = Number(section.zoomFactor ?? 1);
  const cropFactor = Number(section.cropFactor ?? 1);
  const fullFrame = section.framingPolicy === "preserve_full_frame";
  const upscaled = section.sourceWasUpscaled === true || zoomFactor > 1.001;
  if (section.status === "blocked" || upscaled || cropFactor < 0.999 || !fullFrame) {
    return normalizeSignal(null, {
      status: "blocked",
      score: 0,
      reasons: reasonList(section.reasons || section.reason, [upscaled ? "检测到画面放大，会降低清晰度" : "没有保留完整原始构图"])
    });
  }
  if (section.status === "pass" && fullFrame && cropFactor >= 0.999) return normalizeSignal(null, { status: "pass", score: 100, reasons: [] });
  return normalizeSignal(null, { status: "review", score: 60, reasons: ["原画清晰度或完整构图需要复核"] });
}

function inferScriptEvidence(report) {
  const section = report?.scriptEvidence;
  if (section) return normalizeSignal(section);
  const decisions = Array.isArray(report?.editingPlan?.decisions) ? report.editingPlan.decisions : [];
  if (!decisions.length) return normalizeSignal(null, { status: "missing", reasons: ["缺少逐段直接证据检查"] });
  const missing = decisions.filter((decision) => decision.evidenceStatus === "missing"
    || decision.rewriteRequired === true
    || (Array.isArray(decision.unsupportedClaims) && decision.unsupportedClaims.length));
  if (missing.length) {
    return normalizeSignal(null, { status: "blocked", score: 0, reasons: [`${missing.length} 个脚本段落存在证据缺失或不支持主张`] });
  }
  const indirect = decisions.filter((decision) => decision.evidenceStatus !== "direct");
  if (indirect.length) return normalizeSignal(null, { status: "review", score: 0, reasons: [`${indirect.length} 个脚本段落只有间接证据`] });
  return normalizeSignal(null, { status: "pass", score: 100, reasons: [] });
}

function inferHook(report) {
  const section = report?.hook;
  if (section) return normalizeSignal(section);
  const score = report?.visualSemantic?.hookScore ?? report?.visualSemantic?.alignmentScore;
  if (score != null) return normalizeSignal(null, { status: Number(score) >= 100 ? "pass" : "review", score, reasons: ["使用视觉质检分数作为钩子基础分，仍需独立钩子检测"] });
  return normalizeSignal(null, { status: "missing", reasons: ["尚未检查前 3 秒钩子"] });
}

function inferPacing(report) {
  if (report?.pacing) return normalizeSignal(report.pacing);
  return normalizeSignal(null, { status: "missing", reasons: ["尚未检查镜头时长、重复与节奏"] });
}

function inferProductProof(report) {
  if (report?.productProof) return normalizeSignal(report.productProof);
  const coverage = report?.materialCoverage;
  if (!coverage) return normalizeSignal(null, { status: "missing", reasons: ["缺少商品证明镜头覆盖检查"] });
  if (coverage.status === "blocked") return normalizeSignal(null, { status: "blocked", score: 0, reasons: reasonList(coverage.message, ["商品证明镜头不足"]) });
  if (coverage.status === "pass") return normalizeSignal(null, { status: "pass", score: 100, reasons: [] });
  return normalizeSignal(null, { status: "review", score: 50, reasons: reasonList(coverage.message, ["商品证明镜头不完整"]) });
}

function inferCaptionCleanliness(report) {
  const section = report?.captionCleanliness || report?.captionVerification?.final || report?.captionVerification;
  if (section) return normalizeSignal(section);
  const issues = Array.isArray(report?.visualSemantic?.issues) ? report.visualSemantic.issues : [];
  const captionIssues = issues.filter((issue) => /字幕|水印|OCR|评论|可见文字/i.test(issueText(issue)));
  if (captionIssues.some((issue) => issue.level === "block" && /字幕|水印|OCR/i.test(issueText(issue)))) {
    return normalizeSignal(null, { status: "blocked", score: 0, reasons: captionIssues.map(issueText) });
  }
  if (captionIssues.length) return normalizeSignal(null, { status: "review", score: 0, reasons: captionIssues.map(issueText) });
  return normalizeSignal(null, { status: "missing", reasons: ["尚未执行成片后字幕与水印残留复核"] });
}

function inferAudio(report) {
  if (report?.audio) return normalizeSignal(report.audio);
  if (!report?.voice) return normalizeSignal(null, { status: "missing", reasons: ["缺少音频质量检测结果"] });
  if (report.voice.sourceAudioMuted !== true) return normalizeSignal(null, { status: "blocked", score: 0, reasons: ["素材原声没有被强制关闭"] });
  if (report?.technical?.status === "pass" && report.voice.status !== "not_selected") {
    return normalizeSignal(null, { status: "review", score: 75, reasons: ["素材原声已关闭，但仍缺少响度、峰值和断音检测"] });
  }
  return normalizeSignal(null, { status: "review", score: 40, reasons: ["音轨存在性或音频质量需要复核"] });
}

function inferVoiceNaturalness(report) {
  if (report?.voice?.source === "music_only" || report?.voice?.status === "not_required") {
    return normalizeSignal(null, { status: "pass", score: 100, reasons: [] });
  }
  if (report?.voice?.source === "windows_offline_tts") {
    return normalizeSignal(null, { status: "blocked", score: 0, reasons: ["机械系统配音禁止进入质量成片"] });
  }
  const section = report?.voiceNaturalness || report?.voice?.naturalness;
  if (section) return normalizeSignal(section);
  return normalizeSignal(null, { status: "missing", reasons: ["口播尚未试听确认，不能标记为自然种草口播"] });
}

function inferCompliance(report) {
  if (report?.compliance) return normalizeSignal(report.compliance);
  const scriptStatus = report?.script?.status;
  const visualStatus = report?.visualSemantic?.status;
  const visualIssues = Array.isArray(report?.visualSemantic?.issues) ? report.visualSemantic.issues : [];
  const blockers = visualIssues.filter((issue) => issue.level === "block");
  if (scriptStatus === "blocked" || visualStatus === "blocked" || blockers.length) {
    return normalizeSignal(null, { status: "blocked", score: 0, reasons: blockers.length ? blockers.map(issueText) : ["脚本或可见画面存在阻断级风险"] });
  }
  if (scriptStatus === "review" || visualStatus === "review") return normalizeSignal(null, { status: "review", score: 50, reasons: ["脚本或画面存在待复核风险"] });
  if (scriptStatus === "pass" && visualStatus === "pass") return normalizeSignal(null, { status: "pass", score: 100, reasons: [] });
  return normalizeSignal(null, { status: "missing", reasons: ["合规检查尚未覆盖脚本和可见画面两条通道"] });
}

function inferDiversity(report) {
  const section = report?.diversity || report?.variantSimilarity;
  if (section) return normalizeSignal(section);
  return normalizeSignal(null, { status: "missing", reasons: ["尚未检查同批成片的视觉、音频和切点相似度"] });
}

const INFERERS = {
  technical: inferTechnical,
  visualFidelity: inferVisualFidelity,
  productIdentity: inferProductIdentity,
  scriptEvidence: inferScriptEvidence,
  hook: inferHook,
  pacing: inferPacing,
  productProof: inferProductProof,
  captionCleanliness: inferCaptionCleanliness,
  audio: inferAudio,
  voiceNaturalness: inferVoiceNaturalness,
  compliance: inferCompliance,
  diversity: inferDiversity
};

function decidePublishStatus(quality = {}) {
  if (Array.isArray(quality.hardBlockers) && quality.hardBlockers.length) return "blocked";
  const breakdown = quality.scoreBreakdown || {};
  const hardNeedsReview = Object.entries(QUALITY_DIMENSIONS).some(([key, config]) => config.hardGate
    && (breakdown[key]?.status !== "pass" || Number(breakdown[key]?.score) !== 100));
  if (hardNeedsReview) return "manual_review";
  const allPerfect = Object.keys(QUALITY_DIMENSIONS).every((key) => breakdown[key]?.status === "pass" && Number(breakdown[key]?.score) === 100);
  return allPerfect && Number(quality.totalScore) === 100 ? "ready_100" : "repair_required";
}

function scoreQualityReport(report = {}) {
  const scoreBreakdown = {};
  const hardBlockers = [];
  const reviewItems = [];
  let weightedTotal = 0;

  for (const [key, config] of Object.entries(QUALITY_DIMENSIONS)) {
    const signal = normalizeSignal(explicitSignal(report, key) || INFERERS[key](report));
    const weightedScore = signal.score * config.weight / 100;
    scoreBreakdown[key] = {
      label: config.label,
      weight: config.weight,
      hardGate: config.hardGate,
      status: signal.status,
      score: signal.score,
      weightedScore: Number(weightedScore.toFixed(2)),
      reasons: signal.reasons,
      source: signal.source
    };
    weightedTotal += weightedScore;
    if (config.hardGate && signal.status === "blocked") {
      hardBlockers.push({ code: `${key.toUpperCase()}_BLOCKED`, dimension: key, label: config.label, message: signal.reasons[0] || `${config.label}未通过` });
    } else if (signal.status !== "pass" || signal.score !== 100) {
      reviewItems.push({ dimension: key, label: config.label, hardGate: config.hardGate, status: signal.status, score: signal.score, message: signal.reasons[0] || `${config.label}需要修复` });
    }
  }

  const quality = {
    rulesetVersion: QUALITY_RULESET_VERSION,
    totalScore: Math.round(weightedTotal),
    scoreBreakdown,
    hardBlockers,
    reviewItems
  };
  quality.status = decidePublishStatus(quality);
  quality.publishReady = quality.status === "ready_100";
  return quality;
}

function applyQualityContract(report = {}) {
  const quality = scoreQualityReport(report);
  return {
    ...report,
    schemaVersion: Math.max(2, Number(report.schemaVersion || 0)),
    status: quality.status,
    totalScore: quality.totalScore,
    publishReady: quality.publishReady,
    scoreBreakdown: quality.scoreBreakdown,
    hardBlockers: quality.hardBlockers,
    reviewItems: quality.reviewItems,
    quality
  };
}

module.exports = {
  QUALITY_DIMENSIONS,
  QUALITY_RULESET_VERSION,
  QUALITY_STATUSES,
  applyQualityContract,
  decidePublishStatus,
  normalizeSignal,
  scoreQualityReport
};
