const fs = require("node:fs/promises");
const path = require("node:path");
const { normalizeLoopbackEndpoint } = require("./ai-model-router.cjs");
const { normalizeOverlayAssessment } = require("./fashion-video-standard-service.cjs");

const QWEN_ENDPOINTS = Object.freeze({
  china: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
  international: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions"
});

const DEFAULT_AI_SETTINGS = Object.freeze({
  enabled: true,
  provider: "qwen",
  region: "china",
  model: "qwen3.7-flash-2026-07-15",
  framesPerClip: 4,
  confidenceThreshold: 0.85,
  allowOfflineFallback: false
});

const ALLOWED_TYPES = new Set(["outfit", "overall", "detail", "review", "action", "speech", "upper_related", "other"]);
const PRODUCT_IDENTITY_STATUSES = new Set(["matched", "mismatch", "unknown"]);
const SHOT_SIZES = new Set(["extreme_closeup", "closeup", "medium", "full", "wide", "unknown"]);
const SHOT_ANGLES = new Set(["front", "side", "back", "top", "low", "mixed", "unknown"]);
const TEXT_REGIONS = new Set(["top", "center", "bottom", "full", "unknown"]);
const TEXT_KINDS = new Set(["subtitle", "sticker", "price", "product", "watermark", "screenshot", "ui", "graphic", "magnifier", "collage", "other"]);

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
  throw createAiError("模型返回的分类结果不是有效 JSON", "AI_INVALID_JSON", {
    responsePreview: trimmed.slice(0, 2000)
  });
}

function cleanStringArray(values, limit = 12, itemLimit = 100) {
  return [...new Set((Array.isArray(values) ? values : []).map((item) => String(item || "").trim().slice(0, itemLimit)).filter(Boolean))].slice(0, limit);
}

function normalizeVisibleTexts(values) {
  return (Array.isArray(values) ? values : []).slice(0, 30).map((item) => {
    const source = typeof item === "string" ? { text: item } : (item || {});
    const confidence = Number(source.confidence);
    return {
      text: String(source.text || "").trim().slice(0, 300),
      region: TEXT_REGIONS.has(source.region) ? source.region : "unknown",
      kind: TEXT_KINDS.has(source.kind) ? source.kind : "other",
      confidence: Number.isFinite(confidence) ? Number(Math.max(0, Math.min(1, confidence)).toFixed(3)) : null
    };
  }).filter((item) => item.text);
}

function normalizeCaptionRegions(values) {
  return (Array.isArray(values) ? values : []).slice(0, 12).map((item) => {
    const source = item || {};
    const clamp = (value) => Number(Math.max(0, Math.min(1, Number(value || 0))).toFixed(4));
    return {
      x: clamp(source.x),
      y: clamp(source.y),
      width: clamp(source.width),
      height: clamp(source.height),
      confidence: clamp(source.confidence)
    };
  }).filter((item) => item.width > 0 && item.height > 0);
}

function normalizeProductIdentity(value, productProfile = null) {
  const source = value && typeof value === "object" ? value : {};
  const hasTarget = Boolean(String(productProfile?.sku || "").trim());
  const status = hasTarget && PRODUCT_IDENTITY_STATUSES.has(source.status) ? source.status : "unknown";
  const confidence = Number(source.confidence);
  return {
    status,
    targetSku: String(productProfile?.sku || "").trim().slice(0, 80),
    confidence: Number.isFinite(confidence) ? Number(Math.max(0, Math.min(1, confidence)).toFixed(3)) : 0,
    observedCategory: String(source.observedCategory || "").trim().slice(0, 100),
    observedColor: String(source.observedColor || "").trim().slice(0, 100),
    observedSilhouette: String(source.observedSilhouette || "").trim().slice(0, 120),
    reasons: cleanStringArray(source.reasons, 8, 180)
  };
}

function normalizeEvidence(values) {
  const allowedStatuses = new Set(["direct", "indirect", "absent", "unknown"]);
  return (Array.isArray(values) ? values : []).slice(0, 30).map((item) => ({
    claimCode: String(item?.claimCode || "").trim().slice(0, 80),
    label: String(item?.label || "").trim().slice(0, 120),
    status: allowedStatuses.has(item?.status) ? item.status : "unknown",
    observations: cleanStringArray(item?.observations, 8, 180)
  })).filter((item) => item.claimCode || item.label);
}

function normalizeSceneAnalysis(value, productProfile = null) {
  const source = value && typeof value === "object" ? value : {};
  const detected = source.detected && typeof source.detected === "object" ? source.detected : {};
  const shot = source.shot && typeof source.shot === "object"
    ? source.shot
    : detected.shot && typeof detected.shot === "object" ? detected.shot : {};
  const visibleTexts = Array.isArray(source.visibleTexts) && source.visibleTexts.length
    ? source.visibleTexts
    : detected.visibleTexts;
  const captionRegions = Array.isArray(source.captionRegions) && source.captionRegions.length
    ? source.captionRegions
    : detected.captionRegions;
  const overlayAssessment = source.overlayAssessment && typeof source.overlayAssessment === "object"
    ? source.overlayAssessment
    : detected.overlayAssessment;
  const evidence = Array.isArray(source.evidence) && source.evidence.length
    ? source.evidence
    : detected.evidence;
  return {
    productIdentity: normalizeProductIdentity(source.productIdentity || detected.productIdentity, productProfile),
    shot: {
      size: SHOT_SIZES.has(shot.size) ? shot.size : "unknown",
      angle: SHOT_ANGLES.has(shot.angle) ? shot.angle : "unknown",
      camera: String(shot.camera || "unknown").trim().slice(0, 80) || "unknown"
    },
    actions: cleanStringArray(source.actions || source.detected?.actions, 16, 80),
    visibleTexts: normalizeVisibleTexts(visibleTexts),
    captionRegions: normalizeCaptionRegions(captionRegions),
    overlayAssessment: normalizeOverlayAssessment(overlayAssessment),
    evidence: normalizeEvidence(evidence)
  };
}

function validateClassification(value, settings = DEFAULT_AI_SETTINGS, context = {}) {
  const type = String(value?.type || "").toLowerCase();
  if (!ALLOWED_TYPES.has(type)) throw createAiError(`模型返回了未知分类：${type || "空"}`, "AI_INVALID_CATEGORY");
  const rawConfidence = Number(value?.confidence);
  const confidence = Number.isFinite(rawConfidence) ? Math.max(0, Math.min(1, rawConfidence)) : 0;
  const normalized = normalizeAiSettings(settings);
  const analysis = normalizeSceneAnalysis(value, context.productProfile);
  return {
    type,
    confidence: Number(confidence.toFixed(3)),
    title: String(value?.title || "").trim().slice(0, 32),
    tags: Array.isArray(value?.tags) ? value.tags.map((item) => String(item).trim()).filter(Boolean).slice(0, 6) : [],
    reason: String(value?.reason || "模型未提供分类理由").trim().slice(0, 240),
    detected: value?.detected && typeof value.detected === "object" ? value.detected : {},
    analysis,
    productIdentity: analysis.productIdentity,
    shot: analysis.shot,
    actions: analysis.actions,
    visibleTexts: analysis.visibleTexts,
    captionRegions: analysis.captionRegions,
    overlayAssessment: analysis.overlayAssessment,
    evidence: analysis.evidence,
    needsReview: value?.needsReview === true
      || confidence < normalized.confidenceThreshold
      || analysis.productIdentity.status !== "matched"
  };
}

function classificationPrompt(context = {}) {
  const productProfile = context.productProfile ? {
    sku: context.productProfile.sku,
    name: context.productProfile.name,
    category: context.productProfile.category,
    color: context.productProfile.color,
    silhouette: context.productProfile.silhouette,
    fabric: context.productProfile.fabric,
    allowedClaims: context.productProfile.allowedClaims,
    verificationRequired: context.productProfile.verificationRequired,
    referenceImageCount: Number(context.referenceImageCount || 0)
  } : null;
  return `你是抖音服饰带货视频的素材分类、字幕风险和直接证据识别器。请逐张检查按时间顺序提供的全部视频帧，判断这个 ${Number(context.duration || 0).toFixed(2)} 秒片段最主要、最适合剪辑复用的用途。\n\n只能从以下 type 选择一个：\n- outfit：人物穿搭，重点是人物完整造型、上身效果或搭配关系\n- overall：整体展示，重点是目标商品全貌、正侧背面或全身远景\n- detail：细节讲解，重点是面料、褶皱、腰头、口袋、走线、弹力等局部\n- review：测评对比，包含前后/好坏/不同款式/显瘦等对比或结论性测评\n- action：动作展示，走动、转身、下蹲、拉伸、甩动等动态表现\n- speech：以人物对镜口播为主，画面缺少更明确的商品动作或局部信息\n- upper_related：画面主体是上衣、上装换搭或上衣细节，目标裤装不是主要信息\n- other：无法稳定归入以上类别\n\n目标商品资料：${JSON.stringify(productProfile)}\n${productProfile ? "必须将片段商品与目标资料及参考图核对。明确不是同款时 productIdentity.status=mismatch；看不清或无法确认时为 unknown，禁止猜 matched。" : "没有目标商品资料卡，productIdentity.status 必须为 unknown。"}\n\n同时识别：\n1. shot：景别 size(extreme_closeup/closeup/medium/full/wide/unknown)、角度 angle(front/side/back/top/low/mixed/unknown)、camera。\n2. actions：只记录画面直接看到的动作。\n3. visibleTexts：逐项返回 text、region(top/center/bottom/full/unknown)、kind(subtitle/sticker/price/product/watermark/screenshot/ui/graphic/magnifier/collage/other)、confidence。只能记录待分类视频帧里的文字，严禁把目标商品参考图中的文字算入 visibleTexts。看不清就不要编造。\n4. captionRegions：标记待分类视频帧中的字幕或覆盖图文区域，返回归一化 x/y/width/height/confidence；严禁标记参考图文字。\n5. overlayAssessment：返回 complexity(none/standard_caption/complex_graphic/unknown)、features(可选 sticker/price_card/product_card/screenshot/ui_panel/magnifier/cutout/collage/comparison_layer/large_sales_text)、safeToInpaint、subjectOverlap(none/low/high/unknown)、reason。普通白色或黄色描边字幕属于 standard_caption；截图、贴纸、放大镜、抠图、拼贴、商品卡、大面积营销文字属于 complex_graphic。覆盖人物或商品主体时 safeToInpaint=false。\n6. evidence：必须为数组；每项包含 claimCode、label、status(direct/indirect/absent/unknown)、observations(字符串数组)，对 allowedClaims 逐项判断；不得用相似画面替代直接证据。\n\n判定原则：以画面表达意图为主，不要根据片段先后位置猜测；没有弹力拉伸动作就不能把“弹力”标成直接证据；证据不足选择 other 或 needsReview=true。为防止输出截断，title 不超过20字、tags 不超过6项、reason 不超过80字、每个 observations 不超过2项且每项不超过30字。\n\n只返回 JSON 对象，字段必须是：type、confidence、title、tags、reason、detected、productIdentity、shot、actions、visibleTexts、captionRegions、overlayAssessment、evidence、needsReview。`;
}

async function availableReferenceImagePaths(productProfile) {
  const candidates = (Array.isArray(productProfile?.referenceImages) ? productProfile.referenceImages : [])
    .map((item) => typeof item === "string" ? item : item?.filePath)
    .filter(Boolean)
    .slice(0, 4);
  const available = [];
  for (const filePath of candidates) {
    try {
      await fs.access(filePath);
      available.push(filePath);
    } catch { /* missing reference image is reported by referenceImageCount=0 */ }
  }
  return available;
}

async function frameToDataUrl(framePath) {
  const bytes = await fs.readFile(framePath);
  const extension = path.extname(framePath).toLowerCase();
  const mime = extension === ".png" ? "image/png" : "image/jpeg";
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

async function frameToBase64(framePath) {
  return (await fs.readFile(framePath)).toString("base64");
}

function normalizeLocalVisionSettings(value = {}) {
  return {
    endpoint: normalizeLoopbackEndpoint(value.endpoint),
    model: String(value.model || "qwen3.5:latest").trim().slice(0, 100) || "qwen3.5:latest",
    timeoutMs: Math.max(15000, Math.min(300000, Math.round(Number(value.timeoutMs || 180000)))),
    contextLength: Math.max(4096, Math.min(32768, Math.round(Number(value.contextLength || 8192)))),
    maxOutputTokens: Math.max(512, Math.min(4096, Math.round(Number(value.maxOutputTokens || 1600)))),
    temperature: Math.max(0, Math.min(0.4, Number(value.temperature ?? 0.1))),
    think: value.think === true
  };
}

async function requestOllamaVisionJson({ framePaths, prompt, systemPrompt, localSettings, signal, fetchImpl = globalThis.fetch }) {
  const settings = normalizeLocalVisionSettings(localSettings);
  if (typeof fetchImpl !== "function") throw createAiError("当前运行环境不支持本地模型请求", "AI_FETCH_UNAVAILABLE");
  const images = await Promise.all(framePaths.map(frameToBase64));
  let response;
  try {
    response = await fetchImpl(`${settings.endpoint}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: settings.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt, images }
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
      signal: combineSignals(signal, settings.timeoutMs)
    });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      if (signal?.aborted) throw createAiError("本地视觉任务已取消", "AI_ABORTED");
      throw createAiError("本地 Qwen 视觉分析超时，请稍后重试", "AI_LOCAL_TIMEOUT");
    }
    throw createAiError(`无法连接本机 Ollama：${error.message}`, "AI_LOCAL_UNAVAILABLE");
  }
  const responseText = await response.text();
  let data;
  try { data = responseText ? JSON.parse(responseText) : {}; } catch { data = { raw: responseText }; }
  if (!response.ok) {
    const message = data?.error || data?.message || `HTTP ${response.status}`;
    throw createAiError(`本地 Ollama 请求失败：${message}`, "AI_LOCAL_REMOTE_ERROR", { status: response.status });
  }
  if (!data?.message?.content) throw createAiError("本地 Qwen 没有返回视觉分析结果", "AI_EMPTY_RESPONSE");
  return { value: parseJsonContent(data.message.content), settings };
}

async function classifyFramesWithOllama({ framePaths, duration, sourceName, settings, localSettings, productProfile, signal, fetchImpl }) {
  if (!Array.isArray(framePaths) || framePaths.length < 2) throw createAiError("用于本地模型识别的视频帧不足", "AI_FRAMES_MISSING");
  const referencePaths = await availableReferenceImagePaths(productProfile);
  const response = await requestOllamaVisionJson({
    framePaths: [...framePaths, ...referencePaths],
    prompt: `${classificationPrompt({ duration, productProfile, referenceImageCount: referencePaths.length })}\n前 ${framePaths.length} 张是片段帧，后 ${referencePaths.length} 张是目标商品参考图。\n源文件：${String(sourceName || "未命名视频").slice(0, 100)}`,
    systemPrompt: "你负责服饰带货素材的本地视觉理解与结构化分类。逐张检查所有画面，只按画面证据输出有效 JSON。",
    localSettings,
    signal,
    fetchImpl
  });
  return {
    ...validateClassification(response.value, settings, { productProfile }),
    provider: "ollama",
    model: response.settings.model,
    mode: "ollama_vision",
    frameCount: framePaths.length
  };
}

async function classifyFrames({ framePaths, duration, sourceName, settings, apiKey, productProfile, signal, fetchImpl }) {
  const normalized = normalizeAiSettings(settings);
  if (!normalized.enabled) throw createAiError("视觉大模型分类未启用", "AI_DISABLED");
  if (!apiKey) throw createAiError("尚未配置千问 API Key，请先到“设置 > 大模型”完成配置", "AI_KEY_REQUIRED");
  if (!Array.isArray(framePaths) || framePaths.length < 2) throw createAiError("用于模型识别的视频帧不足", "AI_FRAMES_MISSING");
  const video = await Promise.all(framePaths.map(frameToDataUrl));
  const referencePaths = await availableReferenceImagePaths(productProfile);
  const referenceImages = await Promise.all(referencePaths.map(frameToDataUrl));
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
          ...referenceImages.map((url) => ({ type: "image_url", image_url: { url } })),
          { type: "text", text: `${classificationPrompt({ duration, productProfile, referenceImageCount: referenceImages.length })}\n视频内容是待分类片段；其后的 ${referenceImages.length} 张图片是目标商品参考图。\n源文件：${String(sourceName || "未命名视频").slice(0, 100)}` }
        ]
      }
    ],
    enable_thinking: false,
    response_format: { type: "json_object" },
    temperature: 0.1,
    max_tokens: 1600,
    stream: false
  };
  const response = await requestJson({
    endpoint: QWEN_ENDPOINTS[normalized.region],
    apiKey,
    body,
    signal,
    fetchImpl
  });
  const result = validateClassification(parseJsonContent(extractAssistantContent(response)), normalized, { productProfile });
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
    const categoryLabels = { outfit: "人物穿搭", overall: "整体展示", detail: "细节讲解", review: "测评对比", action: "动作展示", speech: "口播", upper_related: "上衣相关", other: "其他" };
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
  const prompt = `你是服饰带货短视频的剪辑结构分析师。根据按时间顺序抽取的竞品视频帧，生成一个可以重新编辑和复用的结构化脚本草稿。视频总长约 ${Number(duration || 0).toFixed(2)} 秒。\n\n请分析：镜头段落顺序、主要画面功能、可见字幕/OCR文字、节奏和转场。不要声称识别了没有视觉证据的完整口播；看不清的文字留空。\n\n返回 JSON：title、duration、voiceMode(full_voice/partial_voice/music_only)、summary、editingPattern(数组)、visibleTexts(数组)、blocks(数组)。每个 block 必须包含 name、duration(至少2秒)、type(outfit/overall/detail/review/action/speech/upper_related/other)、visualInstruction、visibleText、voiceText、voiceEnabled、transitionNote。所有段落时长之和应接近视频总长。`;
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
      enable_thinking: false,
      response_format: { type: "json_object" },
      temperature: 0.15,
      max_tokens: 2200,
      stream: false
    }
  });
  return {
    ...validateCompetitorAnalysis(parseJsonContent(extractAssistantContent(response)), duration),
    provider: "qwen",
    model: normalized.model,
    mode: "qwen_competitor_analysis",
    frameCount: framePaths.length
  };
}

async function analyzeCompetitorFramesWithOllama({ framePaths, duration, sourceName, localSettings, signal, fetchImpl }) {
  if (!Array.isArray(framePaths) || framePaths.length < 3) throw createAiError("竞品视频抽帧不足", "AI_FRAMES_MISSING");
  const prompt = `你是服饰带货短视频的剪辑结构分析师。根据按时间顺序提供的竞品视频帧，生成可编辑、可复用的结构化脚本草稿。总长约 ${Number(duration || 0).toFixed(2)} 秒。分析镜头顺序、画面功能、可见字幕、节奏和转场；不要虚构听不到的口播。只返回 JSON：title、duration、voiceMode、summary、editingPattern、visibleTexts、blocks。每个 block 包含 name、duration、type、visualInstruction、visibleText、voiceText、voiceEnabled、transitionNote。\n源文件：${String(sourceName || "竞品视频").slice(0, 100)}`;
  const response = await requestOllamaVisionJson({
    framePaths,
    prompt,
    systemPrompt: "你只根据全部可见视频帧证据分析服饰带货剪辑结构，并输出有效 JSON。",
    localSettings: { ...localSettings, maxOutputTokens: Math.max(2200, Number(localSettings?.maxOutputTokens || 0)) },
    signal,
    fetchImpl
  });
  return {
    ...validateCompetitorAnalysis(response.value, duration),
    provider: "ollama",
    model: response.settings.model,
    mode: "ollama_competitor_analysis",
    frameCount: framePaths.length
  };
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
      enable_thinking: false,
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

async function auditOutputFramesWithOllama({ framePaths, duration, sourceName, script, materialSummary, localSettings, signal, fetchImpl }) {
  if (!Array.isArray(framePaths) || framePaths.length < 3) throw createAiError("成片质检抽帧不足", "AI_FRAMES_MISSING");
  const scriptEvidence = (script?.blocks || []).map((block) => ({
    start: block.start,
    duration: block.duration,
    category: block.category,
    visualInstruction: block.visualInstruction,
    subtitleText: block.subtitleText,
    voiceText: block.voiceEnabled === false ? "" : block.voiceText
  }));
  const prompt = `你是服饰带货成片的本地视觉质检员。根据按时间顺序提供的画面，核对画面与脚本镜头要求、字幕文案和素材分类是否相符，并识别可见的极限词、虚假承诺或功效风险。只能依据画面证据，不要声称核对了音频。\n脚本：${JSON.stringify(scriptEvidence).slice(0, 9000)}\n素材摘要：${JSON.stringify(materialSummary || []).slice(0, 3000)}\n只返回 JSON：status(pass/review/blocked)、alignmentScore(0-100)、summary、issues、observedScenes、visibleTexts。成片：${String(sourceName || "未命名成片").slice(0, 100)}；时长 ${Number(duration || 0).toFixed(2)} 秒。`;
  const response = await requestOllamaVisionJson({
    framePaths,
    prompt,
    systemPrompt: "你负责短视频成片的本地视觉语义与可见文案质检，必须标明证据边界并输出有效 JSON。",
    localSettings: { ...localSettings, maxOutputTokens: Math.max(1800, Number(localSettings?.maxOutputTokens || 0)) },
    signal,
    fetchImpl
  });
  return {
    ...validateOutputAudit(response.value),
    provider: "ollama",
    model: response.settings.model,
    mode: "ollama_visual_quality_audit",
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
      enable_thinking: false,
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

async function testOllamaConnection({ settings, signal, fetchImpl = globalThis.fetch }) {
  const normalized = normalizeLocalVisionSettings(settings);
  if (typeof fetchImpl !== "function") throw createAiError("当前运行环境不支持本地模型请求", "AI_FETCH_UNAVAILABLE");
  const startedAt = Date.now();
  let response;
  try {
    response = await fetchImpl(`${normalized.endpoint}/api/tags`, {
      method: "GET",
      signal: combineSignals(signal, 15000)
    });
  } catch (error) {
    throw createAiError(`无法连接本机 Ollama：${error.message}`, "AI_LOCAL_UNAVAILABLE");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw createAiError(`本地 Ollama 请求失败：HTTP ${response.status}`, "AI_LOCAL_REMOTE_ERROR");
  const availableModels = Array.isArray(data.models) ? data.models.map((item) => item.name || item.model).filter(Boolean) : [];
  const expectedBase = normalized.model.split(":")[0];
  if (!availableModels.some((name) => name === normalized.model || name.split(":")[0] === expectedBase)) {
    throw createAiError(`本机 Ollama 未安装 ${normalized.model}`, "AI_LOCAL_MODEL_MISSING", { availableModels });
  }
  return {
    connected: true,
    provider: "ollama",
    model: normalized.model,
    region: "local",
    latencyMs: Date.now() - startedAt,
    responseStatus: "ok"
  };
}

module.exports = {
  ALLOWED_TYPES,
  DEFAULT_AI_SETTINGS,
  QWEN_ENDPOINTS,
  analyzeCompetitorFrames,
  analyzeCompetitorFramesWithOllama,
  auditOutputFrames,
  auditOutputFramesWithOllama,
  classifyFrames,
  classifyFramesWithOllama,
  classificationPrompt,
  extractAssistantContent,
  normalizeAiSettings,
  normalizeLocalVisionSettings,
  normalizeSceneAnalysis,
  parseJsonContent,
  requestJson,
  requestOllamaVisionJson,
  testOllamaConnection,
  testQwenConnection,
  validateCompetitorAnalysis,
  validateOutputAudit,
  validateClassification
};
