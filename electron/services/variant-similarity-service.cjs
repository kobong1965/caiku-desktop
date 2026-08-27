const VARIANT_RULE_VERSION = "variant-diversity-2026.08.1";
const DEFAULT_SIMILARITY_THRESHOLD = 0.75;

const HOOK_STYLES = ["痛点提问", "上身结果", "细节证据", "动态动作", "搭配反差"];
const PACING_STYLES = ["快切证据", "均衡讲解", "先整体后细节", "动作穿插"];
const CTA_STYLES = ["查看商品卡", "按场景选款", "先看版型细节", "收藏后对比"];

function createCreativeStrategies(count, seed = 0) {
  return Array.from({ length: Math.max(1, Number(count || 1)) }, (_, index) => ({
    id: `strategy-${seed}-${index + 1}`,
    hookStyle: HOOK_STYLES[(seed + index) % HOOK_STYLES.length],
    pacingStyle: PACING_STYLES[(seed * 3 + index) % PACING_STYLES.length],
    ctaStyle: CTA_STYLES[(seed * 5 + index) % CTA_STYLES.length],
    orderOffset: index,
    musicOffsetSeconds: Number(((seed + index) * 3.7 % 18).toFixed(2)),
    voiceTempo: [1, 1.018, 0.982, 1.028, 0.974][index % 5]
  }));
}

function positionalOverlap(left = [], right = []) {
  const length = Math.max(left.length, right.length);
  if (!length) return 1;
  let same = 0;
  for (let index = 0; index < length; index += 1) if (left[index] && left[index] === right[index]) same += 1;
  return same / length;
}

function setOverlap(left = [], right = []) {
  const a = new Set(left);
  const b = new Set(right);
  const union = new Set([...a, ...b]);
  if (!union.size) return 1;
  return [...a].filter((item) => b.has(item)).length / union.size;
}

function numericSignatureSimilarity(left = [], right = []) {
  const length = Math.max(left.length, right.length);
  if (!length) return 1;
  let score = 0;
  for (let index = 0; index < length; index += 1) {
    const a = Number(left[index]);
    const b = Number(right[index]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    score += Math.max(0, 1 - Math.abs(a - b) / 2);
  }
  return score / length;
}

function compareVariantFingerprints(left = {}, right = {}) {
  const audioSame = left.audioHash && right.audioHash ? left.audioHash === right.audioHash : left.audioSignature === right.audioSignature;
  const hookSame = left.hookMaterialId && left.hookMaterialId === right.hookMaterialId ? 1 : 0;
  const position = positionalOverlap(left.materialIds, right.materialIds);
  const materials = setOverlap(left.materialIds, right.materialIds);
  const cuts = numericSignatureSimilarity(left.cutDurations, right.cutDurations);
  const strategySame = left.strategyId && left.strategyId === right.strategyId ? 1 : 0;
  const similarity = audioSame * 0.2 + hookSame * 0.25 + position * 0.25 + materials * 0.15 + cuts * 0.1 + strategySame * 0.05;
  return {
    similarity: Number(similarity.toFixed(3)),
    audioSame: Boolean(audioSame),
    hookSame: Boolean(hookSame),
    positionalOverlap: Number(position.toFixed(3)),
    materialOverlap: Number(materials.toFixed(3)),
    cutSimilarity: Number(cuts.toFixed(3))
  };
}

function validateVariantBatch(fingerprints = [], options = {}) {
  const threshold = Number(options.threshold || DEFAULT_SIMILARITY_THRESHOLD);
  const comparisons = [];
  for (let left = 0; left < fingerprints.length; left += 1) {
    for (let right = left + 1; right < fingerprints.length; right += 1) {
      comparisons.push({ left: fingerprints[left].id || String(left), right: fingerprints[right].id || String(right), ...compareVariantFingerprints(fingerprints[left], fingerprints[right]) });
    }
  }
  const blockers = comparisons.filter((item) => item.audioSame || item.hookSame || item.positionalOverlap > 0.5 || item.similarity >= threshold);
  return {
    version: VARIANT_RULE_VERSION,
    status: blockers.length ? "blocked" : "pass",
    threshold,
    comparisons,
    blockers,
    score: blockers.length ? 0 : 100
  };
}

module.exports = {
  DEFAULT_SIMILARITY_THRESHOLD,
  VARIANT_RULE_VERSION,
  compareVariantFingerprints,
  createCreativeStrategies,
  numericSignatureSimilarity,
  positionalOverlap,
  setOverlap,
  validateVariantBatch
};
