const REPAIR_PLAN_VERSION = "repair-plan-2026.08.1";
const MAX_AUTOMATIC_REPAIR_ATTEMPTS = 3;

const ACTIONS = Object.freeze({
  productIdentity: { type: "replace_material", label: "替换错误商品镜头", automatic: true },
  scriptEvidence: { type: "rewrite_or_find_evidence", label: "补充直接证据或诚实改写文案", automatic: true },
  productProof: { type: "find_proof_material", label: "补齐商品证明镜头", automatic: true },
  captionCleanliness: { type: "rerender_caption", label: "更换字幕清理方式并重新 OCR", automatic: true },
  audio: { type: "remix_audio", label: "重新归一响度或更换音频", automatic: true },
  compliance: { type: "rewrite_compliance", label: "删除风险词和无依据承诺", automatic: true },
  diversity: { type: "regenerate_variant", label: "更换开头、素材顺序和音频策略", automatic: true },
  technical: { type: "rerender_technical", label: "按 1080×1920 标准重新导出", automatic: true },
  hook: { type: "replace_hook", label: "更换前三秒钩子", automatic: true },
  pacing: { type: "rebuild_timeline", label: "按 2–4 秒镜头语法重排时间线", automatic: true }
});

function createRepairPlan(report = {}, attempt = 0) {
  if (report.status === "ready_100") return { version: REPAIR_PLAN_VERSION, status: "not_required", attempt, maximumAttempts: MAX_AUTOMATIC_REPAIR_ATTEMPTS, actions: [] };
  const dimensions = [...new Set([
    ...(report.hardBlockers || []).map((item) => item.dimension),
    ...(report.reviewItems || []).map((item) => item.dimension)
  ].filter(Boolean))];
  const actions = dimensions.map((dimension, index) => ({
    id: `repair-${attempt + 1}-${index + 1}`,
    dimension,
    ...(ACTIONS[dimension] || { type: "manual_review", label: `人工复核 ${dimension}`, automatic: false }),
    reason: report.hardBlockers?.find((item) => item.dimension === dimension)?.message
      || report.reviewItems?.find((item) => item.dimension === dimension)?.message
      || "该维度未达到 100 分"
  }));
  const exhausted = attempt >= MAX_AUTOMATIC_REPAIR_ATTEMPTS;
  return {
    version: REPAIR_PLAN_VERSION,
    status: exhausted ? "manual_review" : actions.some((action) => action.automatic) ? "auto_repair_available" : "manual_review",
    attempt,
    nextAttempt: exhausted ? null : attempt + 1,
    maximumAttempts: MAX_AUTOMATIC_REPAIR_ATTEMPTS,
    actions: exhausted ? actions.map((action) => ({ ...action, automatic: false })) : actions
  };
}

module.exports = { ACTIONS, MAX_AUTOMATIC_REPAIR_ATTEMPTS, REPAIR_PLAN_VERSION, createRepairPlan };
