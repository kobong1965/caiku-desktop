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
    detected
  };
  card.evidenceText = [card.name, card.typeLabel, card.title, ...tags, reason, ...flattenEvidence(detected)].filter(Boolean).join("；").slice(0, 2000);
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
  if (["outfit", "overall", "detail", "review", "action", "speech", "other"].includes(explicit)) return explicit;
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
  const materialCards = (context.materials || []).map(buildMaterialCapabilityCard).filter((card) => card.id && card.duration > 0);
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
    const rawUnsupported = stringArray(raw.unsupportedClaims, 20);
    const unsupportedClaims = [...new Set([...rawUnsupported, ...evidenceGaps.map((gap) => gap.label)])];
    const rawEvidenceStatus = ["direct", "indirect", "missing"].includes(raw.evidenceStatus) ? raw.evidenceStatus : "indirect";
    const evidenceStatus = evidenceGaps.length ? "missing" : rawEvidenceStatus;
    let suggestedVoiceText = String(raw.suggestedVoiceText || "").trim().slice(0, 1000);
    if (suggestedVoiceText && detectEvidenceGaps({ voiceText: suggestedVoiceText }, selectedCards.length ? selectedCards : materialCards).length) {
      warnings.push(`${block.name} 的建议改词仍包含无画面证据的表达，已清空等待人工修改`);
      suggestedVoiceText = "";
    }
    const rewriteRequired = raw.rewriteRequired === true || evidenceGaps.length > 0;
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
      rewriteRequired,
      suggestedVoiceText,
      reason: String(raw.reason || "模型未提供选镜理由").trim().slice(0, 1000),
      timeline
    };
  });
  const blocked = decisions.some((decision) => !decision.timeline.length);
  const review = decisions.some((decision) => decision.evidenceStatus !== "direct" || decision.rewriteRequired || decision.unsupportedClaims.length);
  return {
    schemaVersion: 1,
    id: `edit-plan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    status: blocked ? "blocked" : review ? "review" : "ready",
    summary: textValue(value?.summary, "AI 剪辑师已根据所选素材安排镜头").slice(0, 1000),
    scriptId: String(script.id || ""),
    scriptSnapshot: blocks,
    inputMaterialIds: materialCards.map((card) => card.id).sort(),
    decisions,
    warnings: [...new Set(warnings)].slice(0, 50),
    model: String(context.model || DEFAULT_LOCAL_EDITOR_SETTINGS.model),
    provider: "ollama",
    generatedAt: new Date().toISOString(),
    confirmed: false
  };
}

function buildPlanningPrompt({ script, materialCards, projectName }) {
  const blocks = normalizeScriptBlocks(script);
  const recipe = script?.editingRecipe && typeof script.editingRecipe === "object" ? {
    summary: textValue(script.editingRecipe.summary).slice(0, 1000),
    patterns: stringArray(script.editingRecipe.patterns || script.editingRecipe.editingPattern, 20),
    visibleTexts: stringArray(script.editingRecipe.visibleTexts, 30),
    sourceFileName: textValue(script.editingRecipe.sourceFileName).slice(0, 200)
  } : null;
  const deterministicGaps = blocks.map((block) => ({
    blockId: block.id,
    gaps: detectEvidenceGaps(block, materialCards).map((item) => item.label)
  })).filter((item) => item.gaps.length);
  return `你是服饰带货短视频的剪辑决策师。请基于脚本和本次已勾选的素材能力卡，生成逐段可执行的剪辑计划。\n\n硬性规则：\n1. 只能使用候选素材中的 id，禁止虚构素材和动作。\n2. timeline 的 sourceStart 与 duration 必须在素材时长内。\n3. 没有拉伸、下蹲、泼水等直接画面证据时，evidenceStatus 必须为 missing，unsupportedClaims 必须列出缺失卖点，rewriteRequired 必须为 true。\n4. suggestedVoiceText 必须完全删除素材不能证明的卖点，不能换个说法继续声称。\n5. 即使直接证据缺失，也必须从候选素材中选择诚实的替代镜头并填满 timeline，例如用走动、转身或整体版型画面承接改写后的文案；只有候选素材为空时才能不给 timeline。\n6. 优先匹配脚本 type、动作和景别；素材不够时可以重复使用，但不要连续重复同一个片段。\n7. 每个脚本段落都要返回一个 decision，timeline 总时长应等于段落 duration。\n8. summary 必须是字符串，warnings 必须是字符串数组。\n9. 对标视频保存的剪辑思路只能影响节奏和镜头角色，不能覆盖候选素材的真实证据，也不能要求不存在的动作。\n\n只返回 JSON 对象：summary、decisions、warnings。每个 decision 返回 blockId、intent、evidenceStatus(direct/indirect/missing)、selectedMaterialIds、unsupportedClaims、rewriteRequired、suggestedVoiceText、reason、timeline。timeline 每项返回 materialId、sourceStart、duration。\n\n工程：${String(projectName || script?.name || "未命名工程").slice(0, 100)}\n脚本：${JSON.stringify({ id: script?.id, name: script?.name, voiceMode: script?.voiceMode, blocks })}\n对标视频保存的可复用剪辑思路：${JSON.stringify(recipe)}\n程序预检发现的证据缺口：${JSON.stringify(deterministicGaps)}\n候选素材能力卡：${JSON.stringify(materialCards.map(({ evidenceText, ...card }) => card))}`;
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

async function createEditingPlan(payload = {}, options = {}) {
  const settings = normalizeLocalEditorSettings(options.settings || {});
  if (!settings.enabled) throw createEditorError("本地 AI 剪辑师未启用", "AI_EDITOR_DISABLED");
  const materialCards = (payload.materials || []).map(buildMaterialCapabilityCard).filter((card) => card.id && card.duration > 0);
  if (!materialCards.length) throw createEditorError("请至少勾选一个可用素材", "AI_EDITOR_MATERIALS_EMPTY");
  if (!payload.script?.blocks?.length) throw createEditorError("请先选择包含段落的脚本", "AI_EDITOR_SCRIPT_EMPTY");
  const prompt = buildPlanningPrompt({ script: payload.script, materialCards, projectName: payload.projectName });
  const rawPlan = await requestOllamaJson(prompt, settings, options);
  return validateEditingPlan(rawPlan, { script: payload.script, materials: payload.materials, model: settings.model });
}

module.exports = {
  DEFAULT_LOCAL_EDITOR_SETTINGS,
  buildMaterialCapabilityCard,
  buildPlanningPrompt,
  createEditingPlan,
  detectEvidenceGaps,
  normalizeLocalEditorSettings,
  parseJsonContent,
  requestOllamaJson,
  validateEditingPlan
};
