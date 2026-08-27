const DEFAULT_AI_ROUTING_SETTINGS = Object.freeze({
  mode: "smart",
  classificationModel: "qwen3.7-flash-2026-07-15",
  editorModel: "qwen3.7-plus-2026-05-26",
  reviewerModel: "qwen3.8-max",
  localEndpoint: "http://127.0.0.1:11434",
  localModel: "qwen3.5:latest",
  allowLocalFallback: true,
  allowPremiumEscalation: true,
  reviewerThreshold: 0.72
});

const ALLOWED_MODES = new Set(["smart", "cloud_accuracy", "local_private"]);
const COMPLEX_TASKS = new Set(["editor", "competitor"]);
const ALLOWED_TASKS = new Set(["classification", "editor", "competitor", "quality"]);

function createRoutingError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeLoopbackEndpoint(value) {
  let endpoint;
  try {
    endpoint = new URL(String(value || DEFAULT_AI_ROUTING_SETTINGS.localEndpoint).trim());
  } catch {
    throw createRoutingError("本地 Qwen 地址无效", "AI_LOCAL_ENDPOINT_INVALID");
  }
  const hostname = endpoint.hostname.toLowerCase();
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname) || !["http:", "https:"].includes(endpoint.protocol)) {
    throw createRoutingError("本地隐私模式只允许连接本机 Ollama", "AI_LOCAL_ENDPOINT_NOT_LOCAL");
  }
  endpoint.pathname = endpoint.pathname.replace(/\/+$/, "");
  endpoint.search = "";
  endpoint.hash = "";
  return endpoint.toString().replace(/\/$/, "");
}

function modelName(value, fallback) {
  return String(value || fallback).trim().slice(0, 100) || fallback;
}

function normalizeAiRoutingSettings(value = {}) {
  const threshold = Math.max(0.5, Math.min(0.95, Number(value.reviewerThreshold ?? DEFAULT_AI_ROUTING_SETTINGS.reviewerThreshold)));
  return {
    mode: ALLOWED_MODES.has(value.mode) ? value.mode : DEFAULT_AI_ROUTING_SETTINGS.mode,
    classificationModel: modelName(value.classificationModel, DEFAULT_AI_ROUTING_SETTINGS.classificationModel),
    editorModel: modelName(value.editorModel, DEFAULT_AI_ROUTING_SETTINGS.editorModel),
    reviewerModel: modelName(value.reviewerModel, DEFAULT_AI_ROUTING_SETTINGS.reviewerModel),
    localEndpoint: normalizeLoopbackEndpoint(value.localEndpoint),
    localModel: modelName(value.localModel, DEFAULT_AI_ROUTING_SETTINGS.localModel),
    allowLocalFallback: value.allowLocalFallback !== false,
    allowPremiumEscalation: value.allowPremiumEscalation !== false,
    reviewerThreshold: Number(threshold.toFixed(2))
  };
}

function qwenModelForTask(task, settings) {
  if (COMPLEX_TASKS.has(task)) return settings.editorModel;
  return settings.classificationModel;
}

function buildTaskRoute(task, options = {}) {
  if (!ALLOWED_TASKS.has(task)) throw createRoutingError(`未知 AI 任务：${task}`, "AI_ROUTE_TASK_INVALID");
  const settings = normalizeAiRoutingSettings(options.settings || {});
  const hasApiKey = options.hasApiKey === true;
  const local = { provider: "ollama", model: settings.localModel };
  const cloud = { provider: "qwen", model: qwenModelForTask(task, settings) };
  const reviewer = COMPLEX_TASKS.has(task) && settings.allowPremiumEscalation && hasApiKey
    ? { provider: "qwen", model: settings.reviewerModel }
    : null;

  if (settings.mode === "local_private") {
    return { task, mode: settings.mode, primary: local, fallback: null, reviewer: null, settings };
  }
  if (settings.mode === "cloud_accuracy") {
    if (!hasApiKey) throw createRoutingError("云端高精度模式需要先配置千问 API Key", "AI_KEY_REQUIRED");
    return { task, mode: settings.mode, primary: cloud, fallback: null, reviewer, settings };
  }
  if (!hasApiKey) {
    return { task, mode: settings.mode, primary: local, fallback: null, reviewer: null, settings };
  }
  return {
    task,
    mode: settings.mode,
    primary: cloud,
    fallback: settings.allowLocalFallback ? local : null,
    reviewer,
    settings
  };
}

function shouldEscalateToReviewer(result = {}, settings = {}) {
  const normalized = normalizeAiRoutingSettings(settings);
  if (!normalized.allowPremiumEscalation) return false;
  const confidence = Number(result.confidence);
  const conflicts = Array.isArray(result.conflicts) ? result.conflicts.filter(Boolean) : [];
  return result.executable === false
    || conflicts.length > 0
    || (Number.isFinite(confidence) && confidence < normalized.reviewerThreshold);
}

module.exports = {
  DEFAULT_AI_ROUTING_SETTINGS,
  buildTaskRoute,
  normalizeAiRoutingSettings,
  normalizeLoopbackEndpoint,
  shouldEscalateToReviewer
};
