const { normalizeNarrativeRole } = require("./editing-case-analysis-service.cjs");

const CATEGORY_TYPES = Object.freeze({
  "人物穿搭": "outfit",
  "整体展示": "overall",
  "细节讲解": "detail",
  "测评讲解": "review",
  "测评对比": "review",
  "动作展示": "action",
  "口播": "speech",
  "上衣相关": "upper_related",
  "其他": "other"
});

const ROLE_RANK = Object.freeze({
  question_hook: 0,
  pain_hook: 0,
  detail_evidence: 1,
  outfit_result: 2,
  overall_result: 2,
  use_case: 3,
  review_conclusion: 3,
  soft_cta: 4
});

function text(value, limit = 1000) {
  return String(value ?? "").trim().slice(0, limit);
}

function blockMaterialType(block = {}) {
  const explicit = text(block.materialType || block.type, 40).toLowerCase();
  if (explicit) return explicit;
  return CATEGORY_TYPES[text(block.category, 40)] || "other";
}

function inferSharedTopic(script = {}, blocks = []) {
  const explicitScriptTopic = text(script.topic || script.topicId, 100);
  if (explicitScriptTopic) return explicitScriptTopic;

  // A single explicit block topic establishes the default for the whole script.
  // Other blocks still keep their own explicit topic as an intentional override.
  const explicitBlockTopic = blocks
    .map((block) => text(block?.topic || block?.topicId, 100))
    .find(Boolean);
  if (explicitBlockTopic) return explicitBlockTopic;

  // Infer once from the complete script instead of independently per sentence.
  // This prevents supporting words such as "衬衫" and opaque script ids from
  // turning otherwise related sentences into different topics.
  const source = [
    script.productName,
    script.name,
    script.title,
    ...blocks.flatMap((block) => [block?.name, block?.voiceText, block?.subtitleText, block?.text])
  ].filter(Boolean).join("；");
  if (/西裤|裤装|裤子|长裤|阔腿裤/.test(source)) return "裤装穿搭";
  if (/衬衫|短袖|上衣|外套/.test(source)) return "服装穿搭";
  return "同一脚本主题";
}

function inferTopic(block = {}, sharedTopic = "") {
  const explicit = text(block.topic || block.topicId, 100);
  return explicit || text(sharedTopic, 100) || "同一脚本主题";
}

function buildSentenceIntents(script = {}) {
  const blocks = Array.isArray(script.blocks) ? script.blocks : [];
  const learnedBlocks = Array.isArray(script.editingRecipe?.blocks) ? script.editingRecipe.blocks : [];
  const sharedTopic = inferSharedTopic(script, blocks);
  return blocks.map((block, index) => {
    const learned = learnedBlocks[index] || {};
    const merged = { ...block, ...learned, name: block.name || learned.name };
    const sourceText = text(block.voiceText ?? block.subtitleText ?? block.text ?? "");
    const materialType = blockMaterialType({ ...block, materialType: learned.materialType });
    return {
      blockId: text(block.id || `block-${index + 1}`, 160),
      order: index,
      name: text(block.name || `段落 ${index + 1}`, 100),
      duration: Number(Math.max(0, Number(block.duration || 0)).toFixed(3)),
      text: sourceText,
      topic: inferTopic(block, sharedTopic),
      narrativeRole: normalizeNarrativeRole({ ...merged, type: materialType }, index, blocks.length),
      requiredMaterialTypes: materialType === "other" ? [] : [materialType],
      visualInstruction: text(block.visualInstruction || learned.editingIntent || block.name, 500)
    };
  });
}

function issue(code, blockId, message, details = {}) {
  return { code, blockId, message, ...details };
}

function validateNarrativeContinuity(input = {}) {
  const sentenceIntents = Array.isArray(input.sentenceIntents) ? input.sentenceIntents : [];
  const bindings = Array.isArray(input.bindings) ? input.bindings : [];
  const bindingMap = new Map(bindings.map((binding) => [String(binding.blockId), binding]));
  const issues = [];
  let previousRank = -1;
  const conclusionCounts = new Map();
  const primaryTopic = sentenceIntents.find((intent) => text(intent.topic))?.topic || "";

  for (const intent of sentenceIntents) {
    const rank = ROLE_RANK[intent.narrativeRole];
    if (Number.isFinite(rank)) {
      if (rank < previousRank) {
        issues.push(issue("NARRATIVE_ORDER_REGRESSION", intent.blockId, `${intent.name} 回到了前面的叙事阶段`, { previousRank, currentRank: rank }));
      }
      previousRank = Math.max(previousRank, rank);
    }
    if (["review_conclusion", "soft_cta"].includes(intent.narrativeRole)) {
      const count = (conclusionCounts.get(intent.narrativeRole) || 0) + 1;
      conclusionCounts.set(intent.narrativeRole, count);
      if (count > 1) issues.push(issue("REPEATED_CONCLUSION", intent.blockId, `${intent.name} 重复了已经表达过的结论`));
    }
    if (primaryTopic && intent.topic && intent.topic !== primaryTopic) {
      issues.push(issue("TOPIC_JUMP", intent.blockId, `${intent.name} 从“${primaryTopic}”跳到了“${intent.topic}”`, { expectedTopic: primaryTopic, actualTopic: intent.topic }));
    }
    const binding = bindingMap.get(String(intent.blockId));
    if (!binding || !(binding.selectedMaterials || []).length) {
      issues.push(issue("MATERIAL_BINDING_MISSING", intent.blockId, `${intent.name} 没有绑定素材分类片段`));
      continue;
    }
    if (intent.requiredMaterialTypes?.length) {
      const actualTypes = [...new Set((binding.selectedMaterials || []).map((material) => blockMaterialType(material)))];
      if (!actualTypes.some((type) => intent.requiredMaterialTypes.includes(type))) {
        issues.push(issue("MATERIAL_ROLE_MISMATCH", intent.blockId, `${intent.name} 需要 ${intent.requiredMaterialTypes.join("/")} 分类，但当前使用 ${actualTypes.join("/") || "未知"}`, { expectedTypes: intent.requiredMaterialTypes, actualTypes }));
      }
    }
  }

  return {
    version: "narrative-continuity-2026.08.1",
    status: issues.length ? "blocked" : "pass",
    issues,
    narrativeOrder: sentenceIntents.map((intent) => intent.narrativeRole),
    audit: {
      sentenceCount: sentenceIntents.length,
      bindingCount: bindings.length,
      secondaryFilteringApplied: false,
      catalogMutationApplied: false
    }
  };
}

module.exports = {
  CATEGORY_TYPES,
  ROLE_RANK,
  blockMaterialType,
  buildSentenceIntents,
  validateNarrativeContinuity
};
