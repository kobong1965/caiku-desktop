const TIMELINE_RULE_VERSION = "timeline-grammar-2026.08.1";
const DEFAULT_MIN_SHOT_SECONDS = 2;
const DEFAULT_MAX_SHOT_SECONDS = 4;

function partitionDuration(duration, minimum = DEFAULT_MIN_SHOT_SECONDS, maximum = DEFAULT_MAX_SHOT_SECONDS) {
  const total = Number(duration);
  if (!Number.isFinite(total) || total < minimum - 0.001) return null;
  const count = Math.max(1, Math.ceil(total / maximum));
  const base = total / count;
  if (base < minimum - 0.001) return null;
  const parts = Array.from({ length: count }, () => Number(base.toFixed(3)));
  parts[parts.length - 1] = Number((total - parts.slice(0, -1).reduce((sum, value) => sum + value, 0)).toFixed(3));
  return parts;
}

function materialIsEligible(material, requireEligibility, trustClassificationCatalog = false) {
  if (!material) return false;
  if (trustClassificationCatalog) return true;
  if (Number(material.duration || 0) < DEFAULT_MIN_SHOT_SECONDS) return false;
  if (material.productIdentity?.status === "mismatch") return false;
  if (!requireEligibility) return true;
  return material.eligibleForMix === true
    && material.productIdentity?.status === "matched"
    && material.captionVerification?.status === "pass";
}

function optimizeTimeline({ decisions = [], materials = [] } = {}, options = {}) {
  const minimum = Number(options.minimumShotSeconds || DEFAULT_MIN_SHOT_SECONDS);
  const maximum = Number(options.maximumShotSeconds || DEFAULT_MAX_SHOT_SECONDS);
  const requireEligibility = options.requireEligibility === true;
  const trustClassificationCatalog = options.trustClassificationCatalog === true;
  const materialMap = new Map(materials.map((material) => [String(material.id), material]));
  const usedMaterialIds = new Set();
  const errors = [];
  const blockPlans = [];

  for (const decision of decisions) {
    const blockId = String(decision.blockId || "");
    const durations = partitionDuration(decision.duration, minimum, maximum);
    if (!durations) {
      errors.push({ code: "BLOCK_DURATION_UNSATISFIABLE", blockId, message: `${decision.blockName || blockId} 无法按每镜 ${minimum}–${maximum} 秒拆分` });
      continue;
    }
    const candidateIds = [...new Set([...(decision.selectedMaterialIds || []), ...(decision.timeline || []).map((item) => item.materialId)].map(String))];
    const candidates = candidateIds.map((id) => materialMap.get(id)).filter((material) => materialIsEligible(material, requireEligibility, trustClassificationCatalog) && !usedMaterialIds.has(String(material.id)));
    const timeline = [];
    for (let index = 0; index < durations.length; index += 1) {
      const shotDuration = durations[index];
      const candidateIndex = candidates.findIndex((material) => Number(material.duration || 0) >= shotDuration - 0.001);
      if (candidateIndex < 0) {
        errors.push({ code: "UNIQUE_MATERIALS_INSUFFICIENT", blockId, message: `${decision.blockName || blockId} 缺少可用的独立镜头，禁止重复同一素材填时长` });
        break;
      }
      const [material] = candidates.splice(candidateIndex, 1);
      const raw = (decision.timeline || []).find((item) => String(item.materialId) === String(material.id));
      const sourceStart = Math.max(0, Math.min(Number(raw?.sourceStart || 0), Math.max(0, Number(material.duration) - shotDuration)));
      usedMaterialIds.add(String(material.id));
      timeline.push({ materialId: String(material.id), sourceStart: Number(sourceStart.toFixed(3)), duration: shotDuration });
    }
    if (timeline.length === durations.length) blockPlans.push({ blockId, timeline });
  }

  const timeline = blockPlans.flatMap((block) => block.timeline.map((item) => ({ ...item, blockId: block.blockId })));
  return {
    version: TIMELINE_RULE_VERSION,
    status: errors.length ? "blocked" : "ready",
    timeline,
    blockPlans,
    errors,
    stats: {
      shotCount: timeline.length,
      uniqueMaterialCount: new Set(timeline.map((item) => item.materialId)).size,
      totalDuration: Number(timeline.reduce((sum, item) => sum + item.duration, 0).toFixed(3)),
      minimumShotDuration: timeline.length ? Math.min(...timeline.map((item) => item.duration)) : 0,
      maximumShotDuration: timeline.length ? Math.max(...timeline.map((item) => item.duration)) : 0
    },
    catalogPolicy: trustClassificationCatalog ? "trust_human_confirmed_classification" : requireEligibility ? "strict_eligibility" : "basic_timeline_constraints"
  };
}

function validateTimelineItems(items = [], options = {}) {
  const minimum = Number(options.minimumShotSeconds || DEFAULT_MIN_SHOT_SECONDS);
  const maximum = Number(options.maximumShotSeconds || DEFAULT_MAX_SHOT_SECONDS);
  const requireEligibility = options.requireEligibility === true;
  const trustClassificationCatalog = options.trustClassificationCatalog === true;
  const requireDirectEvidence = options.requireDirectEvidence === true;
  const errors = [];
  const seen = new Set();
  for (const item of items) {
    const materialId = String(item.materialId || item.material?.id || "");
    const duration = Number(item.duration || 0);
    if (duration < minimum - 0.001) errors.push({ code: "SHOT_TOO_SHORT", materialId, message: `${materialId} 的时间线片段低于 ${minimum} 秒` });
    if (duration > maximum + 0.001) errors.push({ code: "SHOT_TOO_LONG", materialId, message: `${materialId} 的单镜超过 ${maximum} 秒` });
    if (seen.has(materialId)) errors.push({ code: "MATERIAL_REPEATED", materialId, message: `${materialId} 在同一成片中被重复使用` });
    seen.add(materialId);
    if (!materialIsEligible(item.material, requireEligibility, trustClassificationCatalog)) errors.push({ code: "MATERIAL_NOT_ELIGIBLE", materialId, message: `${materialId} 无法满足时间线时长约束` });
  }
  if (requireDirectEvidence) {
    for (const decision of options.decisions || []) {
      if (decision.evidenceStatus !== "direct" || decision.rewriteRequired === true || (decision.unsupportedClaims || []).length) {
        errors.push({ code: "DIRECT_EVIDENCE_REQUIRED", blockId: decision.blockId, message: `${decision.blockName || decision.blockId} 尚未取得全部直接证据` });
      }
    }
  }
  return {
    version: TIMELINE_RULE_VERSION,
    status: errors.length ? "blocked" : "ready",
    errors,
    shotCount: items.length,
    uniqueMaterialCount: seen.size
  };
}

module.exports = {
  DEFAULT_MAX_SHOT_SECONDS,
  DEFAULT_MIN_SHOT_SECONDS,
  TIMELINE_RULE_VERSION,
  materialIsEligible,
  optimizeTimeline,
  partitionDuration,
  validateTimelineItems
};
