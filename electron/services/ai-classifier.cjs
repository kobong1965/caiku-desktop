const fs = require("node:fs/promises");
const path = require("node:path");

const QWEN_ENDPOINTS = Object.freeze({
  china: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
  international: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions"
});

const DEFAULT_AI_SETTINGS = Object.freeze({
  enabled: true,
  provider: "qwen",
  region: "china",
  model: "qwen3.5-flash",
  framesPerClip: 4,
  confidenceThreshold: 0.85,
  allowOfflineFallback: false
});

const ALLOWED_TYPES = new Set(["outfit", "overall", "detail", "review", "action", "speech", "other"]);

function normalizeAiSettings(value = {}) {
  const frames = Math.max(3, Math.min(8, Math.round(Number(value.framesPerClip || DEFAULT_AI_SETTINGS.framesPerClip))));
  const threshold = Math.max(0.5, Math.min(0.99, Number(value.confidenceThreshold || DEFAULT_AI_SETTINGS.confidenceThreshold)));
  return {
    enabled: value.enabled !== false,
    provider: value.provider === "qwen" ? "qwen" : "qwen",
    region: value.region === "international" ? "international" : "china",
    model: String(value.model || DEFAULT_AI_SETTINGS.model).trim().slice(0, 80) || DEFAULT_AI_SETTINGS.model,
    framesPerClip: frames,
    confidenceThreshold: Number(threshold.toFixed(2)),
    allowOfflineFallback: value.allowOfflineFallback === true
  };
}

function createAiError(message, code, details = null) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  return error;
}

function combineSignals(externalSignal, timeoutMs) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return externalSignal ? AbortSignal.any([externalSignal, timeoutSignal]) : timeoutSignal;
}

async function requestJson({ endpoint, apiKey, body, signal, fetchImpl = globalThis.fetch, timeoutMs = 90000, retries = 2 }) {
  if (typeof fetchImpl !== "function") throw createAiError("当前运行环境不支持模型网络请求", "AI_FETCH_UNAVAILABLE");
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(body),
        signal: combineSignals(signal, timeoutMs)
      });
      const responseText = await response.text();
      let data;
      try {
        data = responseText ? JSON.parse(responseText) : {};
      } catch {
        data = { raw: responseText.slice(0, 1000) };
      }
      if (!response.ok) {
        const remoteMessage = data?.error?.message || data?.message || `HTTP ${response.status}`;
        const error = createAiError(`千问请求失败：${remoteMessage}`, response.status === 401 ? "AI_KEY_INVALID" : "AI_REMOTE_ERROR", { status: response.status });
        if ((response.status === 429 || response.status >= 500) && attempt < retries) {
          lastError = error;
          await new Promise((resolve) => setTimeout(resolve, 650 * (attempt + 1)));
          continue;
        }
        throw error;
      }
      return data;
    } catch (error) {
      if (error?.name === "AbortError" || error?.name === "TimeoutError") {
        if (signal?.aborted) throw createAiError("模型分类任务已取消", "AI_ABORTED");
        lastError = createAiError("千问连接超时，请检查网络或稍后重试", "AI_TIMEOUT");
      } else {
        lastError = error;
      }
      const retryable = ["AI_TIMEOUT", "ECONNRESET", "ENOTFOUND", "ECONNREFUSED"].includes(lastError?.code);
      if (!retryable || attempt >= retries) throw lastError;
      await new Promise((resolve) => setTimeout(resolve, 650 * (attempt + 1)));
    }
  }
  throw lastError || createAiError("千问请求失败", "AI_REMOTE_ERROR");
}

function extractAssistantContent(response) {
  const content = response?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((item) => item?.text || "").join("");
  throw createAiError("模型没有返回可读取的分类结果", "AI_EMPTY_RESPONSE");
}

function parseJsonContent(content) {
  const trimmed = String(content || "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
    if (fenced) {
      try { return JSON.parse(fenced.trim()); } catch { /* continue */ }
    }
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try { return JSON.parse(trimmed.slice(start, end + 1)); } catch { /* continue */ }
    }
  }
  throw createAiError("模型返回的分类结果不是有效 JSON", "AI_INVALID_JSON");
}

function validateClassification(value, settings = DEFAULT_AI_SETTINGS) {
  const type = String(value?.type || "").toLowerCase();
  if (!ALLOWED_TYPES.has(type)) throw createAiError(`模型返回了未知分类：${type || "空"}`, "AI_INVALID_CATEGORY");
  const rawConfidence = Number(value?.confidence);
  const confidence = Number.isFinite(rawConfidence) ? Math.max(0, Math.min(1, rawConfidence)) : 0;
  const normalized = normalizeAiSettings(settings);
  return {
    type,
    confidence: Number(confidence.toFixed(3)),
    title: String(value?.title || "").trim().slice(0, 32),
    tags: Array.isArray(value?.tags) ? value.tags.map((item) => String(item).trim()).filter(Boolean).slice(0, 6) : [],
    reason: String(value?.reason || "模型未提供分类理由").trim().slice(0, 240),
    detected: value?.detected && typeof value.detected === "object" ? value.detected : {},
    needsReview: value?.needsReview === true || confidence < normalized.confidenceThreshold
  };
}

function classificationPrompt(context = {}) {
  return `你是抖音服饰带货视频的素材分类器。请根据按时间顺序提供的视频帧，判断这个 ${Number(context.duration || 0).toFixed(2)} 秒片段最主要、最适合剪辑复用的用途。\n\n只能从以下 type 选择一个：\n- outfit：人物穿搭，重点是人物完整造型、上身效果或搭配关系\n- overall：整体展示，重点是商品全貌、正侧背面或全身远景\n- detail：细节讲解，重点是面料、褶皱、腰头、口袋、走线、弹力等局部\n- review：测评对比，包含前后/好坏/不同款式/显瘦等对比或结论性测评\n- action：动作展示，走动、转身、下蹲、拉伸、甩动等动态表现\n- speech：以人物对镜口播为主，画面缺少更明确的商品动作或局部信息\n- other：无法稳定归入以上类别\n\n判定原则：以画面表达意图为主，不要根据片段在原视频中的先后位置猜测；如果证据不足，选择 other 并把 needsReview 设为 true。\n\n只返回 JSON 对象，字段必须是：type、confidence(0到1)、title(不超过16个中文字符)、tags(最多6个)、reason、detected、needsReview。detected 可包含 person、garment、shotType、actions。`;
}

async function frameToDataUrl(framePath) {
  const bytes = await fs.readFile(framePath);
  const extension = path.extname(framePath).toLowerCase();
  const mime = extension === ".png" ? "image/png" : "image/jpeg";
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

async function classifyFrames({ framePaths, duration, sourceName, settings, apiKey, signal, fetchImpl }) {
  const normalized = normalizeAiSettings(settings);
  if (!normalized.enabled) throw createAiError("视觉大模型分类未启用", "AI_DISABLED");
  if (!apiKey) throw createAiError("尚未配置千问 API Key，请先到“设置 > 大模型”完成配置", "AI_KEY_REQUIRED");
  if (!Array.isArray(framePaths) || framePaths.length < 2) throw createAiError("用于模型识别的视频帧不足", "AI_FRAMES_MISSING");
  const video = await Promise.all(framePaths.map(frameToDataUrl));
  const body = {
    model: normalized.model,
    messages: [
      {
        role: "system",
        content: "你负责服饰带货素材的视觉理解与结构化分类。必须基于画面证据，不允许按时间位置猜测。"
      },
      {
        role: "user",
        content: [
          { type: "video", video, fps: Math.max(0.1, Math.min(10, framePaths.length / Math.max(1, Number(duration || 1)))) },
          { type: "text", text: `${classificationPrompt({ duration })}\n源文件：${String(sourceName || "未命名视频").slice(0, 100)}` }
        ]
      }
    ],
    response_format: { type: "json_object" },
    temperature: 0.1,
    max_tokens: 700,
    stream: false
  };
  const response = await requestJson({
    endpoint: QWEN_ENDPOINTS[normalized.region],
    apiKey,
    body,
    signal,
    fetchImpl
  });
  const result = validateClassification(parseJsonContent(extractAssistantContent(response)), normalized);
  return {
    ...result,
    provider: "qwen",
    model: normalized.model,
    mode: "qwen_vision",
    frameCount: framePaths.length
  };
}

function validateCompetitorAnalysis(value, duration) {
  const totalDuration = Math.max(2, Number(duration || value?.duration || 30));
  const voiceMode = ["full_voice", "partial_voice", "music_only"].includes(value?.voiceMode) ? value.voiceMode : "partial_voice";
  const sourceBlocks = Array.isArray(value?.blocks) ? value.blocks.slice(0, 16) : [];
  if (!sourceBlocks.length) throw createAiError("模型没有返回可用的竞品镜头结构", "AI_COMPETITOR_BLOCKS_MISSING");
  let cursor = 0;
  const blocks = sourceBlocks.map((block, index) => {
    const remaining = Math.max(2, totalDuration - cursor);
    const durationValue = Math.max(2, Math.min(remaining, Number(block?.duration || totalDuration / sourceBlocks.length)));
    const type = ALLOWED_TYPES.has(String(block?.type || "").toLowerCase()) ? String(block.type).toLowerCase() : "other";
    const categoryLabels = { outfit: "人物穿搭", overall: "整体展示", detail: "细节讲解", review: "测评对比", action: "动作展示", speech: "口播", other: "其他" };
    const result = {
      id: `competitor-block-${Date.now()}-${index}`,
      name: String(block?.name || `镜头段落 ${index + 1}`).trim().slice(0, 32),
      start: Number(cursor.toFixed(2)),
      duration: Number(durationValue.toFixed(2)),
      category: categoryLabels[type],
      visualInstruction: String(block?.visualInstruction || "按竞品结构匹配相同功能的画面").trim().slice(0, 300),
      subtitleText: String(block?.visibleText || block?.subtitleText || "").trim().slice(0, 500),
      voiceText: String(block?.voiceText || "").trim().slice(0, 500),
      voiceEnabled: voiceMode !== "music_only" && block?.voiceEnabled !== false,
      transitionNote: String(block?.transitionNote || "按竞品节奏自然切换").trim().slice(0, 160),
      text: String(block?.voiceText || "").trim().slice(0, 500)
    };
    cursor += durationValue;
    return result;
  });
  return {
    title: String(value?.title || "竞品结构脚本").trim().slice(0, 60),
    duration: Number(totalDuration.toFixed(2)),
    voiceMode,
    summary: String(value?.summary || "").trim().slice(0, 600),
    editingPattern: Array.isArray(value?.editingPattern) ? value.editingPattern.map(String).slice(0, 10) : [],
    visibleTexts: Array.isArray(value?.visibleTexts) ? value.visibleTexts.map(String).slice(0, 30) : [],
    blocks
  };
}

async function analyzeCompetitorFrames({ framePaths, duration, sourceName, settings, apiKey, signal, fetchImpl }) {
  const normalized = normalizeAiSettings(settings);
  if (!apiKey) throw createAiError("尚未配置千问 API Key，不能分析竞品视频", "AI_KEY_REQUIRED");
  if (!Array.isArray(framePaths) || framePaths.length < 3) throw createAiError("竞品视频抽帧不足", "AI_FRAMES_MISSING");
  const video = await Promise.all(framePaths.map(frameToDataUrl));
  const prompt = `你是服饰带货短视频的剪辑结构分析师。根据按时间顺序抽取的竞品视频帧，生成一个可以重新编辑和复用的结构化脚本草稿。视频总长约 ${Number(duration || 0).toFixed(2)} 秒。\n\n请分析：镜头段落顺序、主要画面功能、可见字幕/OCR文字、节奏和转场。不要声称识别了没有视觉证据的完整口播；看不清的文字留空。\n\n返回 JSON：title、duration、voiceMode(full_voice/partial_voice/music_only)、summary、editingPattern(数组)、visibleTexts(数组)、blocks(数组)。每个 block 必须包含 name、duration(至少2秒)、type(outfit/overall/detail/review/action/speech/other)、visualInstruction、visibleText、voiceText、voiceEnabled、transitionNote。所有段落时长之和应接近视频总长。`;
  const response = await requestJson({
    endpoint: QWEN_ENDPOINTS[normalized.region],
    apiKey,
    signal,
    fetchImpl,
    body: {
      model: normalized.model,
      messages: [
        { role: "system", content: "你只根据视频画面证据分析剪辑结构和可见文字，并输出有效 JSON。" },
        { role: "user", content: [{ type: "video", video }, { type: "text", text: `${prompt}\n源文件：${String(sourceName || "竞品视频").slice(0, 100)}` }] }
      ],
      response_format: { type: "json_object" },
      temperature: 0.15,
      max_tokens: 2200,
      stream: false
    }
  });
  return validateCompetitorAnalysis(parseJsonContent(extractAssistantContent(response)), duration);
}

function validateOutputAudit(value) {
  const allowedStatuses = new Set(["pass", "review", "blocked"]);
  const status = allowedStatuses.has(value?.status) ? value.status : "review";
  const rawScore = Number(value?.alignmentScore);
  return {
    status,
    alignmentScore: Number.isFinite(rawScore) ? Math.max(0, Math.min(100, Math.round(rawScore))) : 0,
    summary: String(value?.summary || "模型未提供完整结论").trim().slice(0, 500),
    issues: Array.isArray(value?.issues) ? value.issues.slice(0, 20).map((issue) => ({
      level: ["block", "review", "info"].includes(issue?.level) ? issue.level : "review",
      name: String(issue?.name || "需要复核").trim().slice(0, 80),
      detail: String(issue?.detail || "").trim().slice(0, 300),
      timeHint: String(issue?.timeHint || "").trim().slice(0, 40)
    })) : [],
    observedScenes: Array.isArray(value?.observedScenes) ? value.observedScenes.map(String).slice(0, 20) : [],
    visibleTexts: Array.isArray(value?.visibleTexts) ? value.visibleTexts.map(String).slice(0, 30) : []
  };
}

async function auditOutputFrames({ framePaths, duration, sourceName, script, materialSummary, settings, apiKey, signal, fetchImpl }) {
  const normalized = normalizeAiSettings(settings);
  if (!apiKey) throw createAiError("尚未配置千问 API Key，不能完成逐条成片质检", "AI_KEY_REQUIRED");
  if (!Array.isArray(framePaths) || framePaths.length < 3) throw createAiError("成片质检抽帧不足", "AI_FRAMES_MISSING");
  const video = await Promise.all(framePaths.map(frameToDataUrl));
  const scriptEvidence = (script?.blocks || []).map((block) => ({
    start: block.start,
    duration: block.duration,
    category: block.category,
    visualInstruction: block.visualInstruction,
    subtitleText: block.subtitleText,
    voiceText: block.voiceEnabled === false ? "" : block.voiceText
  }));
  const prompt = `你是抖音服饰带货成片的发布前多模态质检员。请根据按时间顺序抽取的成片画面，核对画面内容是否与脚本镜头要求、字幕文案和素材分类相符，并识别画面中可见的极限词、虚假承诺、价格或功效风险。只能依据可见画面证据；本任务没有音频转写，所以不要声称逐字核对了口播音频。\n\n脚本：${JSON.stringify(scriptEvidence).slice(0, 9000)}\n素材分类摘要：${JSON.stringify(materialSummary || []).slice(0, 3000)}\n\n只返回 JSON：status(pass/review/blocked)、alignmentScore(0-100)、summary、issues、observedScenes、visibleTexts。issues 中每项包含 level(block/review/info)、name、detail、timeHint。画文明确冲突或可见阻断词用 blocked，证据不足或轻微不一致用 review。`;
  const response = await requestJson({
    endpoint: QWEN_ENDPOINTS[normalized.region],
    apiKey,
    signal,
    fetchImpl,
    body: {
      model: normalized.model,
      messages: [
        { role: "system", content: "你负责短视频成片的视觉语义与可见文案质检，必须标明证据边界并输出有效 JSON。" },
        { role: "user", content: [{ type: "video", video }, { type: "text", text: `${prompt}\n成片：${String(sourceName || "未命名成片").slice(0, 100)}；时长 ${Number(duration || 0).toFixed(2)} 秒。` }] }
      ],
      response_format: { type: "json_object" },
      temperature: 0.05,
      max_tokens: 1600,
      stream: false
    }
  });
  return {
    ...validateOutputAudit(parseJsonContent(extractAssistantContent(response))),
    provider: "qwen",
    model: normalized.model,
    mode: "qwen_visual_quality_audit",
    frameCount: framePaths.length
  };
}

async function testQwenConnection({ settings, apiKey, signal, fetchImpl }) {
  const normalized = normalizeAiSettings(settings);
  if (!apiKey) throw createAiError("请输入或先保存千问 API Key", "AI_KEY_REQUIRED");
  const startedAt = Date.now();
  const response = await requestJson({
    endpoint: QWEN_ENDPOINTS[normalized.region],
    apiKey,
    signal,
    fetchImpl,
    timeoutMs: 30000,
    retries: 0,
    body: {
      model: normalized.model,
      messages: [{ role: "user", content: "只返回 JSON：{\"status\":\"ok\"}" }],
      response_format: { type: "json_object" },
      temperature: 0,
      max_tokens: 40,
      stream: false
    }
  });
  const content = parseJsonContent(extractAssistantContent(response));
  return {
    connected: true,
    provider: "qwen",
    model: normalized.model,
    region: normalized.region,
    latencyMs: Date.now() - startedAt,
    responseStatus: content.status || "ok"
  };
}

module.exports = {
  ALLOWED_TYPES,
  DEFAULT_AI_SETTINGS,
  QWEN_ENDPOINTS,
  analyzeCompetitorFrames,
  auditOutputFrames,
  classifyFrames,
  classificationPrompt,
  extractAssistantContent,
  normalizeAiSettings,
  parseJsonContent,
  requestJson,
  testQwenConnection,
  validateCompetitorAnalysis,
  validateOutputAudit,
  validateClassification
};
