const STYLE_PROFILES = Object.freeze({
  "real-review-short": Object.freeze({
    id: "real-review-short",
    label: "真人短种草",
    minimumDuration: 20,
    maximumDuration: 59.999,
    targetCharsPerSecond: Object.freeze([3.8, 4.3]),
    requiredRoles: Object.freeze(["pain_hook", "visible_evidence", "use_case", "soft_cta"]),
    instructions: "像真实中文服装博主面对朋友分享，不是广告旁白，要有来自真实试穿过程的种草感。平均语速控制在3.8到4.3个汉字每秒，但句内要有快慢：痛点钩子略快，版型和细节证据稍慢。每8到14个汉字留一次200到450毫秒的自然呼吸，段落转折可停500到900毫秒。先观察再下结论，轻带过‘你看、那、呢、我觉得’这类口语连接词；关键词自然加重，其余内容不要字字用力。语气真实、有一点思考感，结尾克制推荐。不要模仿任何具体人物或创作者音色，不要统一句尾，不要播音腔、客服腔、喊麦、机械匀速或全程高亢。"
  }),
  "real-review-deep": Object.freeze({
    id: "real-review-deep",
    label: "真人深测评",
    minimumDuration: 60,
    maximumDuration: 180,
    targetCharsPerSecond: Object.freeze([3.8, 4.2]),
    requiredRoles: Object.freeze(["review_hook", "visible_evidence", "neutral_observation", "soft_cta"]),
    instructions: "像真实中文服装测评博主边看实物边说，不是背稿。平均语速控制在3.8到4.2个汉字每秒，开箱和转场略快，面料、做工、尺寸和动作实测放慢。每8到14个汉字留一次200到450毫秒的自然呼吸，项目切换时停500到900毫秒。使用少量‘OK、你看、那、呢、我觉得’，允许轻微思考感和一处中性观察，再根据证据下结论。重点词有轻重变化，句尾不要整齐一致；结尾使用‘可以参考一下’一类克制推荐。不要模仿任何具体人物或创作者音色，不要新闻播报、客服话术、夸张叫卖、机械匀速或全程只说好话。"
  })
});

function selectVoiceStyle(duration) {
  return Number(duration || 0) >= 60 ? STYLE_PROFILES["real-review-deep"] : STYLE_PROFILES["real-review-short"];
}

function voiceStyle(styleId) {
  return STYLE_PROFILES[styleId] || STYLE_PROFILES["real-review-short"];
}

function buildVoiceInstructions(styleId) {
  return voiceStyle(styleId).instructions;
}

function evaluateVoiceScript(script, styleId) {
  const profile = voiceStyle(styleId);
  const blocks = Array.isArray(script?.blocks) ? script.blocks : [];
  const present = new Set(blocks.map((block) => String(block?.styleRole || "").trim()).filter(Boolean));
  const missingRoles = profile.requiredRoles.filter((role) => !present.has(role));
  const text = blocks.map((block) => String(block?.voiceText || block?.text || "")).join("");
  const hanCharacterCount = (text.match(/[\u3400-\u9fff]/g) || []).length;
  const duration = Math.max(0, Number(script?.duration || blocks.reduce((sum, block) => sum + Number(block?.duration || 0), 0)));
  const charsPerSecond = duration > 0 ? Number((hanCharacterCount / duration).toFixed(2)) : 0;
  return {
    styleId: profile.id,
    styleLabel: profile.label,
    status: missingRoles.length ? "blocked" : "pass",
    missingRoles,
    hanCharacterCount,
    duration,
    charsPerSecond,
    targetCharsPerSecond: [...profile.targetCharsPerSecond]
  };
}

module.exports = {
  STYLE_PROFILES,
  buildVoiceInstructions,
  evaluateVoiceScript,
  selectVoiceStyle,
  voiceStyle
};
