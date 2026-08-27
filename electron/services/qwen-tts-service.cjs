const fs = require("node:fs/promises");
const path = require("node:path");
const { buildVoiceInstructions, selectVoiceStyle } = require("./voice-style-service.cjs");

const QWEN_TTS_ENDPOINT = "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation";
const QWEN_TTS_MODEL = "qwen3-tts-instruct-flash-2026-01-26";

const VOICE_PRESETS = Object.freeze({
  "真人短种草": {
    voice: "Cherry",
    styleId: "real-review-short",
    instructions: buildVoiceInstructions("real-review-short")
  },
  "真人深测评": {
    voice: "Cherry",
    styleId: "real-review-deep",
    instructions: buildVoiceInstructions("real-review-deep")
  },
  "中性测评·四月": {
    voice: "Maia",
    instructions: "自然中性的中文女声，音域居中，不甜、不嗲、不过度温柔，像有审美但不端着的服装测评人。说话清楚但不要播音感，句内有轻重和自然呼吸；先看画面，再给判断。情绪克制可信，结尾轻收。不要客服腔、广告腔、统一句尾、机械匀速或模仿具体人物。"
  },
  "率性变音·月白": {
    voice: "Moon",
    instructions: "率性、中性、略带低频质感的中文声音，辨识度清楚但不过分抢画面，接近短视频里常见的轻变音旁白。语气松弛，句子有快慢，重点词短促加重，结尾不要刻意上扬。不要卡通化、装酷、喊麦、播音腔、机械匀速或模仿具体人物。"
  },
  "设计师变音·不吃鱼": {
    voice: "Nofish",
    instructions: "自然松弛的中文设计师口吻，带一点容易被记住的短视频变音感，但保持中性和真实。像边看版型边随口点评，允许轻微口语感和不完全字正腔圆；信息点说清楚，其余内容轻带过。不要故意搞怪、夸张口音、客服腔、广告喊麦、机械匀速或模仿具体人物。"
  },
  "自然女声": {
    voice: "Cherry",
    instructions: "年轻自然的中文女声，像真实服装博主面对朋友分享。语速偏快但不要赶，句间有自然呼吸和短停顿，语尾轻微上扬，重点词有轻重变化。真诚、有生活感、有种草感，不要播音腔、客服腔、广告喊麦或机械匀速。"
  },
  "轻熟女声": {
    voice: "Cherry",
    instructions: "二十八到三十五岁自然松弛的中文女声，像通勤穿搭博主真实试穿后分享。中速偏快，声音温暖，停顿自然，重点清晰但不过度强调。不要播音腔、客服腔、机械匀速或夸张促销感。"
  },
  "知性女声": {
    voice: "Cherry",
    instructions: "清晰知性的年轻中文女声，像懂面料和版型的服装主理人在镜头前讲解。语速适中，克制可信，句子有呼吸，关键信息自然加重。不要新闻播报、客服话术、机械匀速或夸张叫卖。"
  }
});

function createTtsError(message, code, details = null) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  return error;
}

function resolveVoicePresetName(name, duration = 0) {
  const requested = String(name || "").trim();
  if (!requested) return selectVoiceStyle(duration).label;
  if (requested === "真人短种草" && Number(duration || 0) >= 60) return "真人深测评";
  return VOICE_PRESETS[requested] ? requested : "真人短种草";
}

function voicePreset(name, duration = 0) {
  return VOICE_PRESETS[resolveVoicePresetName(name, duration)];
}

async function synthesizeQwenVoice(text, outputPath, options = {}) {
  const cleanText = String(text || "").replace(/\s+/g, " ").trim();
  if (!cleanText) return null;
  if (!String(options.apiKey || "").trim()) throw createTtsError("自然配音需要先在设置中配置千问 API Key", "QWEN_TTS_KEY_REQUIRED");
  const requestedPresetName = String(options.presetName || "");
  const presetName = resolveVoicePresetName(requestedPresetName, options.duration);
  const preset = voicePreset(presetName, options.duration);
  const targetDuration = Math.max(0, Number(options.duration || 0));
  const baseInstructions = options.instructions || preset.instructions;
  const resolvedInstructions = targetDuration > 0
    ? `${baseInstructions} 当前整段目标时长约${Math.round(targetDuration)}秒，请不要连续赶读；在问句、观察转结论和每个句号后留足呼吸，使实际时长尽量接近目标。`
    : baseInstructions;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") throw createTtsError("当前环境不支持千问语音请求", "QWEN_TTS_FETCH_UNAVAILABLE");
  const timeout = new AbortController();
  const timeoutId = setTimeout(() => timeout.abort(), Number(options.timeoutMs || 120000));
  const abort = () => timeout.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  try {
    const response = await fetchImpl(options.endpoint || QWEN_TTS_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${String(options.apiKey).trim()}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: options.model || QWEN_TTS_MODEL,
        input: {
          text: cleanText,
          voice: options.voice || preset.voice,
          language_type: "Chinese",
          instructions: resolvedInstructions,
          optimize_instructions: true
        }
      }),
      signal: timeout.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || Number(data.status_code || response.status) >= 400) {
      throw createTtsError(data.message || `千问自然配音请求失败（HTTP ${response.status}）`, data.code || "QWEN_TTS_REQUEST_FAILED", { status: response.status, requestId: data.request_id });
    }
    const audioUrl = data?.output?.audio?.url;
    if (!audioUrl) throw createTtsError("千问没有返回可下载的配音文件", "QWEN_TTS_EMPTY_AUDIO", { requestId: data.request_id });
    const audioResponse = await fetchImpl(audioUrl, { signal: timeout.signal });
    if (!audioResponse.ok) throw createTtsError(`配音文件下载失败（HTTP ${audioResponse.status}）`, "QWEN_TTS_DOWNLOAD_FAILED");
    const audio = Buffer.from(await audioResponse.arrayBuffer());
    if (audio.length < 1024) throw createTtsError("千问返回的配音文件异常", "QWEN_TTS_AUDIO_INVALID");
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, audio);
    return {
      filePath: outputPath,
      provider: "qwen",
      model: options.model || QWEN_TTS_MODEL,
      voice: options.voice || preset.voice,
      presetName,
      requestedPresetName: requestedPresetName || selectVoiceStyle(options.duration).label,
      instructions: resolvedInstructions,
      optimizeInstructions: true,
      requestId: data.request_id || "",
      bytes: audio.length,
      generatedAt: new Date().toISOString()
    };
  } catch (error) {
    if (error?.name === "AbortError" && options.signal?.aborted) throw createTtsError("自然配音已取消", "QWEN_TTS_ABORTED");
    if (error?.name === "AbortError") throw createTtsError("千问自然配音超时，请稍后重试", "QWEN_TTS_TIMEOUT");
    throw error;
  } finally {
    clearTimeout(timeoutId);
    options.signal?.removeEventListener("abort", abort);
  }
}

module.exports = { QWEN_TTS_ENDPOINT, QWEN_TTS_MODEL, VOICE_PRESETS, resolveVoicePresetName, synthesizeQwenVoice, voicePreset };
