const CLAIM_EVIDENCE_VERSION = "claim-evidence-2026.08.1";

const CLAIM_RULES = Object.freeze([
  { code: "elasticity", label: "弹力/拉伸", pattern: /高弹|弹力|弹性|拉伸|回弹/ },
  { code: "squat", label: "下蹲活动", pattern: /下蹲|蹲下|蹲起|蹲着/ },
  { code: "fabric_content", label: "面料成分", pattern: /面料成分|含棉|羊毛|聚酯|氨纶|莱赛尔|醋酸|真丝|桑蚕丝/ },
  { code: "pocket", label: "口袋功能", pattern: /口袋|插袋|装手机/ },
  { code: "anti_wrinkle", label: "抗皱表现", pattern: /抗皱|不起皱|不易皱|免烫/ },
  { code: "water_resistance", label: "防水/防泼水", pattern: /防水|防泼水|泼水|不沾水/ },
  { code: "silhouette", label: "版型轮廓", pattern: /高腰|直筒|阔腿|锥形|微喇|宽松|垂感/ },
  { code: "body_effect", label: "穿着效果", pattern: /显瘦|显高|显腿长|遮胯|藏肉|修饰腿型/ },
  { code: "movement", label: "动态展示", pattern: /走动|转身|摆动|活动自如/ }
]);

function blockText(block = {}) {
  return [block.name, block.visualInstruction, block.subtitleText, block.voiceText, block.text]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join("；");
}

function extractClaims(block = {}) {
  const text = blockText(block);
  return [
    { code: "target_product", label: "目标商品一致", implicit: true },
    ...CLAIM_RULES.filter((rule) => rule.pattern.test(text)).map(({ code, label }) => ({ code, label, implicit: false }))
  ];
}

function stringList(value) {
  return (Array.isArray(value) ? value : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function observedActions(material = {}) {
  return [...new Set([
    ...stringList(material.actions),
    ...stringList(material.detected?.actions),
    ...stringList(material.classificationDetected?.actions)
  ])].join("；");
}

function directObservations(material = {}) {
  return (Array.isArray(material.evidence) ? material.evidence : [])
    .filter((item) => item?.status === "direct")
    .flatMap((item) => stringList(item?.observations))
    .join("；");
}

function materialDirectlyProves(material, claimCode, options = {}) {
  if (claimCode === "target_product") return options.trustHumanConfirmedCatalog === true || material?.productIdentity?.status === "matched";
  const entries = Array.isArray(material?.evidence) ? material.evidence : [];
  if (entries.some((item) => item?.status === "direct" && String(item.claimCode || "") === claimCode)) return true;
  const actions = observedActions(material);
  if (claimCode === "elasticity") return /拉伸|拉扯|扯动/.test(actions);
  if (claimCode === "squat") return /下蹲|蹲下|蹲起/.test(actions);
  if (claimCode === "movement" && /走动|行走|转身|转圈|摆动|甩动|下蹲|蹲起|抬腿/.test(actions)) return true;
  if (options.trustHumanConfirmedCatalog !== true) return false;

  // Only observations already marked as direct can establish a missing claim
  // code. Names, folders, tags and model reasons deliberately do not count.
  const observations = directObservations(material);
  if (claimCode === "movement") return /走动|行走|转身|转圈|摆动|甩动|下蹲|蹲起|抬腿/.test(observations);
  if (claimCode === "silhouette") {
    const hasSilhouetteObservation = /版型|轮廓|裤型|裤腿线条|高腰|直筒|阔腿|锥形|微喇|宽松|垂感/.test(observations);
    const observationIsVisible = /可见|看清|展示|全身|正面|侧面|背面|站立|转身/.test(observations);
    return hasSilhouetteObservation && observationIsVisible;
  }
  return false;
}

function materialIndirectlySupports(material, claimCode) {
  const entries = Array.isArray(material?.evidence) ? material.evidence : [];
  return entries.some((item) => item?.status === "indirect" && String(item.claimCode || "") === claimCode);
}

function evaluateBlockEvidence(block, materials = [], options = {}) {
  const claims = extractClaims(block).map((claim) => {
    const directMaterialIds = materials.filter((material) => materialDirectlyProves(material, claim.code, options)).map((material) => material.id).filter(Boolean);
    const indirectMaterialIds = materials.filter((material) => materialIndirectlySupports(material, claim.code)).map((material) => material.id).filter(Boolean);
    return {
      ...claim,
      status: directMaterialIds.length ? "direct" : indirectMaterialIds.length ? "indirect" : "missing",
      directMaterialIds,
      indirectMaterialIds
    };
  });
  const directCount = claims.filter((claim) => claim.status === "direct").length;
  const unsupportedClaims = claims.filter((claim) => claim.status !== "direct").map((claim) => claim.label);
  return {
    version: CLAIM_EVIDENCE_VERSION,
    status: unsupportedClaims.length ? "blocked" : "pass",
    coverage: claims.length ? Number((directCount / claims.length).toFixed(3)) : 1,
    directCount,
    requiredCount: claims.length,
    claims,
    unsupportedClaims,
    allDirect: unsupportedClaims.length === 0
  };
}

function evaluatePlanEvidence(script = {}, decisions = [], materials = [], options = {}) {
  const materialMap = new Map(materials.map((material) => [String(material.id), material]));
  const blocks = Array.isArray(script.blocks) ? script.blocks : [];
  const blockResults = blocks.map((block, index) => {
    const decision = decisions.find((item) => String(item.blockId || "") === String(block.id || "")) || decisions[index] || {};
    const selected = (decision.selectedMaterialIds || []).map((id) => materialMap.get(String(id))).filter(Boolean);
    return { blockId: String(block.id || `block-${index + 1}`), ...evaluateBlockEvidence(block, selected, options) };
  });
  const required = blockResults.reduce((sum, result) => sum + result.requiredCount, 0);
  const direct = blockResults.reduce((sum, result) => sum + result.directCount, 0);
  return {
    version: CLAIM_EVIDENCE_VERSION,
    status: blockResults.every((result) => result.status === "pass") ? "pass" : "blocked",
    directEvidenceCoverage: required ? Number((direct / required).toFixed(3)) : 1,
    blockResults,
    unsupportedClaims: [...new Set(blockResults.flatMap((result) => result.unsupportedClaims))]
  };
}

module.exports = {
  CLAIM_EVIDENCE_VERSION,
  CLAIM_RULES,
  evaluateBlockEvidence,
  evaluatePlanEvidence,
  extractClaims,
  materialDirectlyProves
};
