const fs = require("node:fs/promises");
const path = require("node:path");
const { QWEN_ENDPOINTS, extractAssistantContent, requestJson } = require("./ai-classifier.cjs");
const { evaluateBlockEvidence, extractClaims, materialDirectlyProves } = require("./claim-evidence-service.cjs");
const { shouldEscalateToReviewer } = require("./ai-model-router.cjs");
const { buildSentenceIntents, validateNarrativeContinuity } = require("./narrative-continuity-service.cjs");
const { buildSentenceMediaBindings } = require("./sentence-media-alignment-service.cjs");
const { optimizeTimeline } = require("./timeline-optimizer-service.cjs");

const DEFAULT_LOCAL_EDITOR_SETTINGS = Object.freeze({
  enabled: true,
  endpoint: "http://127.0.0.1:11434",
  model: "qwen3.5:latest",
  timeoutMs: 180000,
  temperature: 0.1,
  think: false,
  contextLength: 8192,
  maxOutputTokens: 2048
});

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

const EVIDENCE_RULES = Object.freeze([
  {
    code: "elasticity",
    label: "弹力/拉伸",
    claimPattern: /弹力|高弹|拉伸|回弹|弹性/i,
    evidencePattern: /弹力|高弹|拉伸|回弹|弹性|stretch|elastic/i
  },
  {
    code: "squat",
    label: "下蹲舒适",
    claimPattern: /下蹲|蹲下|深蹲|蹲着|蹲起/i,
    evidencePattern: /下蹲|蹲下|深蹲|蹲起|squat/i
  },
  {
    code: "waterproof",
    label: "防水/拒水",
    claimPattern: /防水|拒水|不沾水|泼水/i,
    evidencePattern: /防水|拒水|不沾水|泼水|waterproof/i
  }
]);

function createEditorError(message, code, details = null) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  return error;
}

function normalizeLocalEditorSettings(value = {}) {
  let endpoint;
  try {
    endpoint = new URL(String(value.endpoint || DEFAULT_LOCAL_EDITOR_SETTINGS.endpoint).trim());
  } catch {
    throw createEditorError("本地 AI 剪辑师地址无效", "AI_EDITOR_ENDPOINT_INVALID");
  }
  const hostname = endpoint.hostname.toLowerCase();
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname) || !['http:', 'https:'].includes(endpoint.protocol)) {
    throw createEditorError("AI 剪辑师第一版只允许连接本机 Ollama", "AI_EDITOR_ENDPOINT_NOT_LOCAL");
  }
  const timeoutMs = Math.max(15000, Math.min(300000, Math.round(Number(value.timeoutMs || DEFAULT_LOCAL_EDITOR_SETTINGS.timeoutMs))));
  const contextLength = Math.max(4096, Math.min(32768, Math.round(Number(value.contextLength || DEFAULT_LOCAL_EDITOR_SETTINGS.contextLength))));
  const maxOutputTokens = Math.max(512, Math.min(4096, Math.round(Number(value.maxOutputTokens || DEFAULT_LOCAL_EDITOR_SETTINGS.maxOutputTokens))));
  endpoint.pathname = endpoint.pathname.replace(/\/+$/, "");
  endpoint.search = "";
  endpoint.hash = "";
  return {
    enabled: value.enabled !== false,
    endpoint: endpoint.toString().replace(/\/$/, ""),
    model: String(value.model || DEFAULT_LOCAL_EDITOR_SETTINGS.model).trim().slice(0, 100) || DEFAULT_LOCAL_EDITOR_SETTINGS.model,
    timeoutMs,
    temperature: Math.max(0, Math.min(0.4, Number(value.temperature ?? DEFAULT_LOCAL_EDITOR_SETTINGS.temperature))),
    think: value.think === true,
    contextLength,
    maxOutputTokens
  };
}

function textValue(value, fallback = "") {
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (value && typeof value === "object") {
    for (const key of ["text", "message", "summary", "reason", "detail", "name"]) {
      if (typeof value[key] === "string" && value[key].trim()) return value[key].trim();
    }
    try { return JSON.stringify(value).slice(0, 1000); } catch { return fallback; }
  }
  return fallback;
}

function stringArray(value, limit = 12) {
  return Array.isArray(value)
    ? value.map((item) => textValue(item)).filter(Boolean).slice(0, limit)
    : [];
}

function compactDetected(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).slice(0, 12).map(([key, item]) => {
    if (Array.isArray(item)) return [key, stringArray(item)];
    if (item && typeof item === "object") {
      const serialized = JSON.stringify(item);
      return [key, serialized.length <= 1500 ? JSON.parse(serialized) : serialized.slice(0, 1500)];
    }
    return [key, typeof item === "boolean" ? item : String(item ?? "").slice(0, 200)];
  }));
}

function flattenEvidence(value, output = []) {
  if (value == null) return output;
  if (Array.isArray(value)) {
    value.forEach((item) => flattenEvidence(item, output));
    return output;
  }
  if (typeof value === "object") {
    Object.values(value).forEach((item) => flattenEvidence(item, output));
    return output;
  }
  output.push(String(value));
  return output;
}

function buildMaterialCapabilityCard(material = {}) {
  const tags = stringArray(material.classificationTags || material.tags);
  const detected = compactDetected(material.classificationDetected || material.detected);
  const productIdentity = material.productIdentity && typeof material.productIdentity === "object" ? material.productIdentity : {};
  const shot = material.shot && typeof material.shot === "object" ? material.shot : {};
  const actions = stringArray(material.actions, 20);
  const visibleTexts = (Array.isArray(material.visibleTexts) ? material.visibleTexts : []).map((item) => typeof item === "string" ? item : item?.text).filter(Boolean).slice(0, 30);
  const evidence = (Array.isArray(material.evidence) ? material.evidence : []).slice(0, 30).map((item) => ({
    claimCode: textValue(item?.claimCode).slice(0, 80),
    label: textValue(item?.label).slice(0, 120),
    status: ["direct", "indirect", "absent", "unknown"].includes(item?.status) ? item.status : "unknown",
    observations: stringArray(item?.observations, 8)
  }));
  const title = String(material.classificationTitle || material.title || material.name || "未命名素材").trim().slice(0, 100);
  const reason = String(material.classificationReason || material.reason || "").trim().slice(0, 500);
  const card = {
    id: String(material.id || "").trim(),
    name: String(material.name || title).trim().slice(0, 100),
    duration: Number(Math.max(0, Number(material.duration || 0)).toFixed(3)),
    type: String(material.type || "other").trim().toLowerCase(),
    typeLabel: String(material.typeLabel || "其他").trim().slice(0, 40),
    title,
    tags,
    reason,
    detected,
    productIdentity,
    shot,
    actions,
    visibleTexts,
    evidence,
    eligibleForMix: material.eligibleForMix === true,
    captionVerification: material.captionVerification && typeof material.captionVerification === "object"
      ? material.captionVerification
      : {}
  };
  card.evidenceText = [card.name, card.typeLabel, card.title, ...tags, reason, ...flattenEvidence(detected), ...flattenEvidence(productIdentity), ...flattenEvidence(shot), ...actions, ...visibleTexts, ...flattenEvidence(evidence)].filter(Boolean).join("；").slice(0, 4000);
  return card;
}

function scriptBlockText(block = {}) {
  return [block.name, block.visualInstruction, block.subtitleText, block.voiceText, block.text]
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .join("；");
}

function detectEvidenceGaps(block, materialCards) {
  const claimText = scriptBlockText(block);
  const evidenceText = (materialCards || []).map((card) => card.evidenceText || buildMaterialCapabilityCard(card).evidenceText).join("；");
  return EVIDENCE_RULES
    .filter((rule) => rule.claimPattern.test(claimText) && !rule.evidencePattern.test(evidenceText))
    .map(({ code, label }) => ({ code, label }));
}

function parseJsonContent(content) {
  const text = String(content || "").trim();
  const candidates = [text, text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]];
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) candidates.push(text.slice(start, end + 1));
  for (const candidate of candidates.filter(Boolean)) {
    try { return JSON.parse(candidate.trim()); } catch { /* try the next candidate */ }
  }
  throw createEditorError("本地 AI 剪辑师返回的不是有效 JSON", "AI_EDITOR_INVALID_JSON");
}

function blockType(block = {}) {
  const explicit = String(block.type || "").toLowerCase();
  if (["outfit", "overall", "detail", "review", "action", "speech", "upper_related", "other"].includes(explicit)) return explicit;
  return CATEGORY_TYPES[String(block.category || "").trim()] || "other";
}

function normalizeScriptBlocks(script = {}) {
  return (script.blocks || []).map((block, index) => ({
    id: String(block.id || `block-${index + 1}`),
    name: String(block.name || `段落 ${index + 1}`).slice(0, 100),
    duration: Number(Math.max(0.5, Number(block.duration || 2)).toFixed(3)),
    type: blockType(block),
    visualInstruction: String(block.visualInstruction || block.name || "匹配画面内容").slice(0, 500),
    subtitleText: String(block.subtitleText ?? block.text ?? "").slice(0, 1000),
    voiceText: String(block.voiceText ?? block.text ?? "").slice(0, 1000),
    voiceEnabled: script.voiceMode === "music_only" ? false : block.voiceEnabled !== false,
    transitionNote: String(block.transitionNote || "按节奏自然切换").slice(0, 300)
  }));
}

function normalizeTimeline(rawTimeline, selectedCards, targetDuration) {
  const selectedMap = new Map(selectedCards.map((card) => [card.id, card]));
  const timeline = [];
  let used = 0;
  for (const item of Array.isArray(rawTimeline) ? rawTimeline : []) {
    const card = selectedMap.get(String(item?.materialId || ""));
    if (!card || used >= targetDuration - 0.001) continue;
    const sourceStart = Math.max(0, Math.min(Number(item.sourceStart || 0), Math.max(0, card.duration - 0.05)));
    const available = Math.max(0, card.duration - sourceStart);
    const duration = Math.min(Math.max(0, Number(item.duration || available)), available, targetDuration - used);
    if (duration < 0.05) continue;
    timeline.push({ materialId: card.id, sourceStart: Number(sourceStart.toFixed(3)), duration: Number(duration.toFixed(3)) });
    used += duration;
  }
  let index = 0;
  while (selectedCards.length && used < targetDuration - 0.001 && index < 200) {
    const card = selectedCards[index % selectedCards.length];
    const duration = Math.min(card.duration, targetDuration - used);
    if (duration >= 0.05) {
      timeline.push({ materialId: card.id, sourceStart: 0, duration: Number(duration.toFixed(3)) });
      used += duration;
    }
    index += 1;
  }
  return timeline;
}

function validateEditingPlan(value, context = {}) {
  const script = context.script || {};
  const blocks = normalizeScriptBlocks(script);
  const materialCards = (context.materials || []).map(buildMaterialCapabilityCard).filter((card) => card.id);
  const materialMap = new Map(materialCards.map((card) => [card.id, card]));
  if (!blocks.length) throw createEditorError("脚本没有可规划的段落", "AI_EDITOR_SCRIPT_EMPTY");
  if (!materialCards.length) throw createEditorError("没有可用于规划的素材", "AI_EDITOR_MATERIALS_EMPTY");

  const rawDecisions = Array.isArray(value?.decisions) ? value.decisions : [];
  const warnings = stringArray(value?.warnings, 30);
  const decisions = blocks.map((block, index) => {
    const raw = rawDecisions.find((item) => String(item?.blockId || "") === block.id) || rawDecisions[index] || {};
    const rawIds = [
      ...(Array.isArray(raw.selectedMaterialIds) ? raw.selectedMaterialIds : []),
      ...(Array.isArray(raw.timeline) ? raw.timeline.map((item) => item?.materialId) : [])
    ].map((item) => String(item || "")).filter(Boolean);
    const invalidIds = [...new Set(rawIds.filter((id) => !materialMap.has(id)))];
    if (invalidIds.length) warnings.push(`${block.name} 忽略了未勾选素材：${invalidIds.join("、")}`);
    let selectedMaterialIds = [...new Set(rawIds.filter((id) => materialMap.has(id)))];
    if (!selectedMaterialIds.length) {
      const categoryMatches = materialCards.filter((card) => card.type === block.type);
      const safeFallback = (categoryMatches.length ? categoryMatches : materialCards).slice(0, 2);
      selectedMaterialIds = safeFallback.map((card) => card.id);
      warnings.push(`${block.name}：模型未选择可执行镜头，已按素材分类补充安全替代，仍需人工确认`);
    }
    const selectedCards = selectedMaterialIds.map((id) => materialMap.get(id));
    const evidenceGaps = detectEvidenceGaps(block, selectedCards.length ? selectedCards : materialCards);
    const evidenceContract = evaluateBlockEvidence(block, selectedCards, { trustHumanConfirmedCatalog: true });
    const rawUnsupported = stringArray(raw.unsupportedClaims, 20);
    const unsupportedClaims = [...new Set([...rawUnsupported, ...evidenceGaps.map((gap) => gap.label), ...evidenceContract.unsupportedClaims])];
    const contractHasMissing = evidenceContract.claims.some((claim) => claim.status === "missing");
    const contractHasIndirect = evidenceContract.claims.some((claim) => claim.status === "indirect");
    const evidenceStatus = evidenceContract.allDirect && !evidenceGaps.length
      ? "direct"
      : contractHasMissing || evidenceGaps.length ? "missing" : contractHasIndirect ? "indirect" : "missing";
    let suggestedVoiceText = String(raw.suggestedVoiceText || "").trim().slice(0, 1000);
    if (suggestedVoiceText && detectEvidenceGaps({ voiceText: suggestedVoiceText }, selectedCards.length ? selectedCards : materialCards).length) {
      warnings.push(`${block.name} 的建议改词仍包含无画面证据的表达，已清空等待人工修改`);
      suggestedVoiceText = "";
    }
    const rewriteRequired = raw.rewriteRequired === true || evidenceGaps.length > 0 || !evidenceContract.allDirect;
    const timeline = normalizeTimeline(raw.timeline, selectedCards, block.duration);
    if (!timeline.length) warnings.push(`${block.name} 没有可执行的素材时间线`);
    return {
      blockId: block.id,
      blockName: block.name,
      duration: block.duration,
      intent: String(raw.intent || block.visualInstruction).trim().slice(0, 500),
      evidenceStatus,
      selectedMaterialIds,
      unsupportedClaims,
      evidenceContract,
      rewriteRequired,
      suggestedVoiceText,
      reason: String(raw.reason || "模型未提供选镜理由").trim().slice(0, 1000),
      timeline
    };
  });
  const sentenceIntents = buildSentenceIntents(script);
  const sentenceBindings = buildSentenceMediaBindings({ script, decisions, materials: context.materials || [] });
  const narrativeContinuity = validateNarrativeContinuity({ sentenceIntents, bindings: sentenceBindings });
  const blocked = decisions.some((decision) => !decision.timeline.length) || narrativeContinuity.status === "blocked";
  const review = decisions.some((decision) => decision.evidenceStatus !== "direct" || decision.rewriteRequired || decision.unsupportedClaims.length);
  const requiredEvidenceCount = decisions.reduce((sum, decision) => sum + Number(decision.evidenceContract?.requiredCount || 0), 0);
  const directEvidenceCount = decisions.reduce((sum, decision) => sum + Number(decision.evidenceContract?.directCount || 0), 0);
  return {
    schemaVersion: 1,
    id: `edit-plan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    status: blocked ? "blocked" : review ? "review" : "ready",
    summary: textValue(value?.summary, "AI 剪辑师已根据所选素材安排镜头").slice(0, 1000),
    scriptId: String(script.id || ""),
    scriptSnapshot: blocks,
    inputMaterialIds: materialCards.map((card) => card.id).sort(),
    decisions,
    sentenceIntents,
    sentenceBindings,
    narrativeContinuity,
    directEvidenceCoverage: requiredEvidenceCount ? Number((directEvidenceCount / requiredEvidenceCount).toFixed(3)) : 1,
    warnings: [...new Set(warnings)].slice(0, 50),
    model: String(context.model || DEFAULT_LOCAL_EDITOR_SETTINGS.model),
    provider: String(context.provider || "ollama"),
    routeMode: String(context.routeMode || "local_private"),
    fallbackUsed: context.fallbackUsed === true,
    fallbackReason: String(context.fallbackReason || "").slice(0, 500),
    reviewerUsed: context.reviewerUsed === true,
    primaryModel: String(context.primaryModel || context.model || DEFAULT_LOCAL_EDITOR_SETTINGS.model),
    confidence: Number.isFinite(Number(value?.confidence)) ? Number(Math.max(0, Math.min(1, Number(value.confidence))).toFixed(3)) : null,
    conflicts: stringArray(value?.conflicts, 20),
    generatedAt: new Date().toISOString(),
    confirmed: false
  };
}

function candidateScore(block, decision, material) {
  const originallySelected = (decision.selectedMaterialIds || []).map(String).includes(String(material.id));
  const directClaimCount = extractClaims(block).filter((claim) => materialDirectlyProves(material, claim.code, { trustHumanConfirmedCatalog: true })).length;
  return directClaimCount * 100 + (material.type === block.type ? 20 : 0) + (originallySelected ? 10 : 0) + Math.min(9, Number(material.duration || 0));
}

function applyStrictTimeline(plan, script, materials) {
  const blocks = normalizeScriptBlocks(script);
  const materialCards = (materials || []).map(buildMaterialCapabilityCard).filter((card) => card.id);
  const trustedCatalogCards = materialCards;
  const blockMap = new Map(blocks.map((block) => [block.id, block]));
  const optimizationDecisions = (plan.decisions || []).map((decision) => {
    const block = blockMap.get(String(decision.blockId)) || { id: decision.blockId, type: "other" };
    const candidateMaterialIds = [...trustedCatalogCards]
      .sort((a, b) => candidateScore(block, decision, b) - candidateScore(block, decision, a) || a.id.localeCompare(b.id))
      .map((card) => card.id);
    return { ...decision, candidateMaterialIds, selectedMaterialIds: candidateMaterialIds };
  });
  const optimized = optimizeTimeline(
    { decisions: optimizationDecisions, materials: materialCards },
    { requireEligibility: false, trustClassificationCatalog: true }
  );
  const optimizedMap = new Map(optimized.blockPlans.map((item) => [String(item.blockId), item.timeline]));
  const materialMap = new Map(materialCards.map((card) => [card.id, card]));
  const warnings = [...(plan.warnings || []), ...optimized.errors.map((item) => item.message)];
  const decisions = optimizationDecisions.map((decision) => {
    const timeline = optimizedMap.get(String(decision.blockId)) || [];
    const timelineMaterialIds = timeline.map((item) => String(item.materialId || "")).filter(Boolean);
    const selectedMaterialIds = [...new Set(timelineMaterialIds)];
    const selectedCards = timelineMaterialIds.map((id) => materialMap.get(id)).filter(Boolean);
    const block = blockMap.get(String(decision.blockId)) || {};
    const evidenceGaps = detectEvidenceGaps(block, selectedCards);
    const evidenceContract = evaluateBlockEvidence(block, selectedCards, { trustHumanConfirmedCatalog: true });
    const unsupportedClaims = [...new Set([...evidenceGaps.map((item) => item.label), ...evidenceContract.unsupportedClaims])];
    return {
      ...decision,
      candidateMaterialIds: [...(decision.candidateMaterialIds || [])],
      selectedMaterialIds,
      timeline,
      evidenceContract,
      evidenceStatus: evidenceContract.allDirect && !evidenceGaps.length ? "direct" : evidenceContract.claims.some((claim) => claim.status === "indirect") ? "indirect" : "missing",
      unsupportedClaims,
      rewriteRequired: unsupportedClaims.length > 0
    };
  });
  const requiredEvidenceCount = decisions.reduce((sum, decision) => sum + Number(decision.evidenceContract?.requiredCount || 0), 0);
  const directEvidenceCount = decisions.reduce((sum, decision) => sum + Number(decision.evidenceContract?.directCount || 0), 0);
  const sentenceIntents = buildSentenceIntents(script);
  const sentenceBindings = buildSentenceMediaBindings({ script, decisions, materials });
  const narrativeContinuity = validateNarrativeContinuity({ sentenceIntents, bindings: sentenceBindings });
  const evidenceBlocked = decisions.some((decision) => decision.evidenceStatus !== "direct" || decision.rewriteRequired || decision.unsupportedClaims.length);
  const timelineBlocked = optimized.status !== "ready" || decisions.some((decision) => !decision.timeline.length);
  const narrativeBlocked = narrativeContinuity.status === "blocked";
  return {
    ...plan,
    status: !timelineBlocked && !evidenceBlocked && !narrativeBlocked ? "ready" : "blocked",
    decisions,
    sentenceIntents,
    sentenceBindings,
    narrativeContinuity,
    actualUsedMaterialIds: [...new Set(decisions.flatMap((decision) => decision.selectedMaterialIds))],
    directEvidenceCoverage: requiredEvidenceCount ? Number((directEvidenceCount / requiredEvidenceCount).toFixed(3)) : 1,
    timelineOptimization: {
      version: optimized.version,
      status: optimized.status,
      errors: optimized.errors,
      stats: optimized.stats,
      catalogPolicy: optimized.catalogPolicy,
      revalidatedAfterOptimization: true
    },
    warnings: [...new Set(warnings)].slice(0, 50)
  };
}

function buildPlanningPrompt({ script, materialCards, projectName, retrievedCases = [] }) {
  const blocks = normalizeScriptBlocks(script);
  const recipe = script?.editingRecipe && typeof script.editingRecipe === "object" ? {
    summary: textValue(script.editingRecipe.summary).slice(0, 1000),
    patternId: textValue(script.editingRecipe.patternId).slice(0, 120),
    patterns: stringArray(script.editingRecipe.patterns || script.editingRecipe.editingPattern, 20),
    narrativeOrder: stringArray(script.editingRecipe.narrativeOrder, 30),
    requiredMaterialRoles: stringArray(script.editingRecipe.requiredMaterialRoles, 20),
    blocks: (Array.isArray(script.editingRecipe.blocks) ? script.editingRecipe.blocks : []).slice(0, 30).map((block) => ({
      narrativeRole: textValue(block.narrativeRole).slice(0, 80),
      materialType: textValue(block.materialType || block.type).slice(0, 80),
      duration: Number(block.duration || 0),
      cutTechnique: textValue(block.cutTechnique).slice(0, 80)
    }))
  } : null;
  const sentenceIntents = buildSentenceIntents(script);
  const deterministicGaps = blocks.map((block) => ({
    blockId: block.id,
    gaps: detectEvidenceGaps(block, materialCards).map((item) => item.label)
  })).filter((item) => item.gaps.length);
  const learnedCases = (Array.isArray(retrievedCases) ? retrievedCases : []).slice(0, 5).map((item) => ({
    caseId: textValue(item.caseId).slice(0, 160),
    reasons: stringArray(item.reasons, 12),
    structuralRecipe: item.structuralRecipe || null,
    factReuseAllowed: false
  }));
  const promptCards = materialCards.map(({ evidenceText, eligibleForMix, captionVerification, productIdentity, ...card }) => card);
  return `你是服饰带货短视频的剪辑决策师。请理解脚本每句话，再从对应素材分类选择画面，生成逐段可执行且前后连贯的剪辑计划。\n\n硬性规则：\n1. 人工确认的素材分类清单是唯一素材真相源。只能使用清单中的 id，不得依据旧版可混剪标记、字幕、画质、款号或复核字段再次筛选、删除、降级或改类。\n2. 每个脚本句先遵守 sentenceIntent 的 narrativeRole 和 requiredMaterialTypes，再选择该分类下的片段；reason 必须说明“为什么这个分类和片段对应这句话”。\n3. 叙事顺序必须连续：问题/痛点钩子 → 细节证据 → 上身或整体结果 → 使用场景/结论 → 轻 CTA。禁止跳题、重复结论、倒序和无关镜头补时长。\n4. 只能使用候选素材中的 id，禁止虚构素材和动作；timeline 的 sourceStart 与 duration 必须在素材时长内。\n5. 没有拉伸、下蹲、泼水等画面信息时，不得让相应文案硬套在无关分类上；应报告文案与分类不对应。\n6. 用户投喂案例的剪辑思路只能影响节奏和镜头角色，并可学习结构和切法；禁止复用参考商品事实、口播原句和卖点结论。\n7. 同一条成片内每个素材 id 只能使用一次；每个镜头 2–4 秒，timeline 总时长等于段落 duration。\n8. 每个脚本段落都返回一个 decision；summary 必须是字符串，warnings 必须是字符串数组。\n9. 本版本不读取、不使用千川反馈。\n\n只返回 JSON 对象：summary、decisions、warnings。每个 decision 返回 blockId、narrativeRole、intent、evidenceStatus(direct/indirect/missing)、selectedMaterialIds、unsupportedClaims、rewriteRequired、suggestedVoiceText、reason、timeline。timeline 每项返回 materialId、sourceStart、duration。\n\n工程：${String(projectName || script?.name || "未命名工程").slice(0, 100)}\n脚本：${JSON.stringify({ id: script?.id, name: script?.name, voiceMode: script?.voiceMode, blocks })}\n逐句意图：${JSON.stringify(sentenceIntents)}\n用户投喂视频保存的可复用剪辑思路：${JSON.stringify(recipe)}\n检索到的用户投喂案例结构：${JSON.stringify(learnedCases)}\n程序预检发现的画文信息缺口：${JSON.stringify(deterministicGaps)}\n人工确认的素材分类清单：${JSON.stringify(promptCards)}`;
}

let fashionEditorSkillCache;

async function loadFashionEditorSkill() {
  if (fashionEditorSkillCache) return fashionEditorSkillCache;
  const skillRoot = path.resolve(__dirname, "..", "..", "skills", "caiku-fashion-editor");
  const files = [
    path.join(skillRoot, "SKILL.md"),
    path.join(skillRoot, "references", "taxonomy.md"),
    path.join(skillRoot, "references", "output-contract.md")
  ];
  try {
    const [skill, taxonomy, contract] = await Promise.all(files.map((file) => fs.readFile(file, "utf8")));
    fashionEditorSkillCache = `${skill}\n\n${taxonomy}\n\n${contract}`;
    return fashionEditorSkillCache;
  } catch (error) {
    throw createEditorError(`无法加载 caiku-fashion-editor Skill：${error.message}`, "AI_EDITOR_SKILL_MISSING");
  }
}

function combineSignal(signal, timeoutMs) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}

async function requestOllamaJson(prompt, settings, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") throw createEditorError("当前运行环境不支持本地模型请求", "AI_EDITOR_FETCH_UNAVAILABLE");
  let response;
  try {
    response = await fetchImpl(`${settings.endpoint}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: settings.model,
        messages: [
          { role: "system", content: "严格依据素材证据做剪辑决策，禁止臆造镜头、动作和商品卖点。只输出有效 JSON。" },
          { role: "user", content: prompt }
        ],
        stream: false,
        think: settings.think,
        format: "json",
        keep_alive: "10m",
        options: {
          temperature: settings.temperature,
          num_ctx: settings.contextLength,
          num_predict: settings.maxOutputTokens
        }
      }),
      signal: combineSignal(options.signal, settings.timeoutMs)
    });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      if (options.signal?.aborted) throw createEditorError("AI 剪辑规划已取消", "AI_EDITOR_ABORTED");
      throw createEditorError("本地 Qwen 剪辑规划超时，请稍后重试", "AI_EDITOR_TIMEOUT");
    }
    throw createEditorError(`无法连接本机 Ollama：${error.message}`, "AI_EDITOR_UNAVAILABLE");
  }
  const responseText = await response.text();
  let data;
  try { data = responseText ? JSON.parse(responseText) : {}; } catch { data = { raw: responseText }; }
  if (!response.ok) {
    const message = data?.error || data?.message || `HTTP ${response.status}`;
    throw createEditorError(`本地 Ollama 请求失败：${message}`, "AI_EDITOR_REMOTE_ERROR", { status: response.status });
  }
  const content = data?.message?.content;
  if (!content) throw createEditorError("本地 Qwen 没有返回剪辑计划", "AI_EDITOR_EMPTY_RESPONSE");
  return parseJsonContent(content);
}

async function requestQwenPlanJson(prompt, step, options = {}) {
  if (!options.apiKey) throw createEditorError("云端 AI 剪辑师需要先配置千问 API Key", "AI_KEY_REQUIRED");
  const region = options.region === "international" ? "international" : "china";
  const response = await requestJson({
    endpoint: QWEN_ENDPOINTS[region],
    apiKey: options.apiKey,
    signal: options.signal,
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs || 120000,
    retries: 1,
    body: {
      model: step.model,
      messages: [
        { role: "system", content: "严格依据素材证据做服装短视频剪辑决策，禁止臆造镜头、动作和商品卖点。只输出有效 JSON。" },
        { role: "user", content: prompt }
      ],
      enable_thinking: false,
      response_format: { type: "json_object" },
      temperature: 0.1,
      max_tokens: 3000,
      stream: false
    }
  });
  return parseJsonContent(extractAssistantContent(response));
}

function localSettingsForStep(settings, route, step) {
  return normalizeLocalEditorSettings({
    ...settings,
    endpoint: route?.settings?.localEndpoint || settings.endpoint,
    model: step.model || route?.settings?.localModel || settings.model
  });
}

async function requestPlanForStep(prompt, step, route, settings, options) {
  if (step.provider === "qwen") return requestQwenPlanJson(prompt, step, options);
  if (step.provider === "ollama") return requestOllamaJson(prompt, localSettingsForStep(settings, route, step), options);
  throw createEditorError(`不支持的剪辑师 provider：${step.provider}`, "AI_EDITOR_PROVIDER_INVALID");
}

async function createEditingPlan(payload = {}, options = {}) {
  const settings = normalizeLocalEditorSettings(options.settings || {});
  if (!settings.enabled) throw createEditorError("本地 AI 剪辑师未启用", "AI_EDITOR_DISABLED");
  const materialCards = (payload.materials || []).map(buildMaterialCapabilityCard).filter((card) => card.id);
  if (!materialCards.length) throw createEditorError("请至少勾选一个已确认分类素材", "AI_EDITOR_MATERIALS_EMPTY");
  if (!payload.script?.blocks?.length) throw createEditorError("请先选择包含段落的脚本", "AI_EDITOR_SCRIPT_EMPTY");
  const skillText = await loadFashionEditorSkill();
  const prompt = `${skillText}\n\n${buildPlanningPrompt({ script: payload.script, materialCards, projectName: payload.projectName, retrievedCases: payload.retrievedCases })}\n\n额外输出 confidence(0到1) 与 conflicts(字符串数组)，用于决定是否进入疑难复核。`;
  const route = options.route || {
    mode: "local_private",
    primary: { provider: "ollama", model: settings.model },
    fallback: null,
    reviewer: null,
    settings: { localEndpoint: settings.endpoint, localModel: settings.model, reviewerThreshold: 0.72, allowPremiumEscalation: true }
  };
  const contextFor = (step, extra = {}) => ({
    script: payload.script,
    materials: payload.materials,
    model: step.model,
    provider: step.provider,
    routeMode: route.mode,
    primaryModel: route.primary.model,
    ...extra
  });
  try {
    const rawPlan = await requestPlanForStep(prompt, route.primary, route, settings, options);
    let plan = validateEditingPlan(rawPlan, contextFor(route.primary));
    if (route.reviewer && route.primary.provider === "qwen" && shouldEscalateToReviewer({
      confidence: rawPlan?.confidence,
      conflicts: rawPlan?.conflicts,
      executable: plan.status !== "blocked"
    }, route.settings)) {
      const reviewed = await requestPlanForStep(prompt, route.reviewer, route, settings, options);
      plan = validateEditingPlan(reviewed, contextFor(route.reviewer, { reviewerUsed: true }));
    }
    return payload.qualityMode === true ? applyStrictTimeline(plan, payload.script, payload.materials) : plan;
  } catch (primaryError) {
    if (!route.fallback) throw primaryError;
    const rawFallback = await requestPlanForStep(prompt, route.fallback, route, settings, options);
    const fallbackPlan = validateEditingPlan(rawFallback, contextFor(route.fallback, {
      fallbackUsed: true,
      fallbackReason: primaryError.message
    }));
    return payload.qualityMode === true ? applyStrictTimeline(fallbackPlan, payload.script, payload.materials) : fallbackPlan;
  }
}

module.exports = {
  DEFAULT_LOCAL_EDITOR_SETTINGS,
  buildMaterialCapabilityCard,
  buildPlanningPrompt,
  createEditingPlan,
  applyStrictTimeline,
  detectEvidenceGaps,
  loadFashionEditorSkill,
  normalizeLocalEditorSettings,
  parseJsonContent,
  requestOllamaJson,
  requestQwenPlanJson,
  validateEditingPlan
};
