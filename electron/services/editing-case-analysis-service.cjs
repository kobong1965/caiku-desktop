const path = require("node:path");

const USER_REFERENCE_SOURCE = "user_uploaded_reference";
const ALLOWED_ROLES = new Set(["question_hook", "pain_hook", "detail_evidence", "outfit_result", "overall_result", "use_case", "review_conclusion", "soft_cta", "support"]);
const MATERIAL_TYPES = new Set(["outfit", "overall", "detail", "review", "action", "speech", "upper_related", "other"]);

function analysisError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function stringValue(value, limit = 500) {
  return String(value ?? "").trim().slice(0, limit);
}

function stringArray(value, limit = 20) {
  return (Array.isArray(value) ? value : []).map((item) => stringValue(item, 300)).filter(Boolean).slice(0, limit);
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeMaterialType(block = {}) {
  const raw = stringValue(block.type, 40).toLowerCase();
  if (MATERIAL_TYPES.has(raw)) return raw;
  const text = `${block.name || ""} ${block.visualInstruction || ""}`;
  if (/细节|面料|腰头|褶皱|口袋|走线/.test(text)) return "detail";
  if (/上身|穿搭|搭配/.test(text)) return "outfit";
  if (/整体|全身|正面|侧面|背面/.test(text)) return "overall";
  if (/动作|走动|转身|拉伸|下蹲/.test(text)) return "action";
  if (/测评|对比/.test(text)) return "review";
  return "other";
}

function normalizeNarrativeRole(block = {}, index = 0, total = 1) {
  const explicit = stringValue(block.narrativeRole || block.styleRole, 60).toLowerCase();
  if (ALLOWED_ROLES.has(explicit)) return explicit;
  const sourceText = [block.name, block.visibleText, block.subtitleText, block.voiceText, block.visualInstruction].filter(Boolean).join("；");
  const type = normalizeMaterialType(block);
  if (index === 0 && /还有人|不知道|不懂|怎么|为什么|\?|？|避雷|别再/.test(sourceText)) return "question_hook";
  if (index === 0) return "pain_hook";
  if (index === total - 1 && /结尾|推荐|入手|照着|商品卡|可以试|就行/.test(sourceText)) return "soft_cta";
  if (type === "detail") return "detail_evidence";
  if (type === "outfit") return "outfit_result";
  if (type === "overall") return /通勤|日常|场景|上班|约会/.test(sourceText) ? "use_case" : "overall_result";
  if (type === "review") return "review_conclusion";
  return "support";
}

function defaultCutTechnique(role, index) {
  if (index === 0) return "hard_cut";
  if (["detail_evidence", "outfit_result", "overall_result"].includes(role)) return "match_cut";
  if (role === "use_case") return "action_cut";
  return "natural_cut";
}

function normalizeSource(source = {}) {
  const sourceType = stringValue(source.sourceType || USER_REFERENCE_SOURCE, 80);
  if (sourceType !== USER_REFERENCE_SOURCE) {
    throw analysisError("市场脚本学习只能分析用户主动投喂的视频", "MARKET_SCRIPT_SOURCE_NOT_USER_PROVIDED");
  }
  const filePath = stringValue(source.filePath, 4096);
  if (!filePath) throw analysisError("缺少用户投喂的视频路径", "MARKET_SCRIPT_SOURCE_PATH_REQUIRED");
  return {
    sourceType: USER_REFERENCE_SOURCE,
    filePath: path.resolve(filePath),
    fileName: stringValue(source.fileName || path.basename(filePath), 240)
  };
}

function inferHook(value, blocks) {
  const raw = objectValue(value.hook);
  const first = blocks[0] || {};
  const hookText = stringValue(raw.text || first.subtitleText || first.voiceText || first.name, 500);
  const inferredQuestion = /还有人|不知道|不懂|怎么|为什么|\?|？/.test(hookText);
  const type = ["question", "pain", "result", "action", "statement"].includes(raw.type)
    ? raw.type
    : inferredQuestion ? "question" : first.narrativeRole === "pain_hook" ? "pain" : "statement";
  const seconds = Array.isArray(raw.targetSeconds) ? raw.targetSeconds.slice(0, 2).map(Number) : [0, Math.min(3, Number(first.duration || 3))];
  return { type, text: hookText, targetSeconds: seconds };
}

function createMarketScriptRecipe(value = {}, source = {}) {
  const normalizedSource = normalizeSource(source);
  const rawBlocks = Array.isArray(value.blocks) ? value.blocks.slice(0, 30) : [];
  if (!rawBlocks.length) throw analysisError("投喂视频没有可学习的镜头段落", "MARKET_SCRIPT_BLOCKS_REQUIRED");
  let cursor = 0;
  const blocks = rawBlocks.map((block, index) => {
    const duration = Number(Math.max(0.1, Number(block.duration || 2)).toFixed(3));
    const narrativeRole = normalizeNarrativeRole(block, index, rawBlocks.length);
    const materialType = normalizeMaterialType(block);
    const result = {
      id: stringValue(block.id || `learned-block-${index + 1}`, 160),
      order: index,
      start: Number(cursor.toFixed(3)),
      duration,
      name: stringValue(block.name || `镜头段落 ${index + 1}`, 100),
      narrativeRole,
      materialType,
      editingIntent: stringValue(block.editingIntent || block.visualInstruction || block.name, 500),
      visualInstruction: stringValue(block.visualInstruction, 500),
      subtitleText: stringValue(block.visibleText || block.subtitleText, 1000),
      voiceText: stringValue(block.voiceText, 1000),
      voiceEnabled: value.voiceMode !== "music_only" && block.voiceEnabled !== false,
      cutTechnique: stringValue(block.cutTechnique || defaultCutTechnique(narrativeRole, index), 80),
      transitionNote: stringValue(block.transitionNote || "按原样片节奏自然切换", 300)
    };
    cursor += duration;
    return result;
  });
  const hook = inferHook(value, blocks);
  const narrativeOrder = blocks.map((block) => block.narrativeRole);
  const requiredMaterialRoles = [...new Set(blocks.map((block) => block.materialType).filter((type) => type !== "other" && type !== "speech"))];
  const editingTechniques = stringArray(value.editingTechniques || value.editingPattern, 30);
  const containsDetailAndOutfit = requiredMaterialRoles.includes("detail") && requiredMaterialRoles.includes("outfit");
  const patternId = hook.type === "question" && containsDetailAndOutfit
    ? "question-hook-detail-outfit"
    : `${hook.type}-hook-${narrativeOrder.slice(1, 3).join("-") || "support"}`;
  return {
    schemaVersion: 1,
    source: normalizedSource,
    discovery: {
      marketSearchAllowed: false,
      crawlerAllowed: false,
      autoDownloadAllowed: false,
      configuredModelAnalysisAllowed: true
    },
    title: stringValue(value.title || normalizedSource.fileName.replace(/\.[^.]+$/, ""), 120),
    duration: Number(Math.max(cursor, Number(value.duration || 0)).toFixed(3)),
    voiceMode: ["full_voice", "partial_voice", "music_only"].includes(value.voiceMode) ? value.voiceMode : "partial_voice",
    summary: stringValue(value.summary || "已提取用户投喂视频的剪辑结构", 1000),
    patternId,
    hook,
    narrativeOrder,
    requiredMaterialRoles,
    editingTechniques,
    pacing: objectValue(value.pacing),
    subtitleStyle: objectValue(value.subtitleStyle),
    voiceStyle: objectValue(value.voiceStyle),
    musicStyle: objectValue(value.musicStyle),
    factReuseAllowed: false,
    blocks
  };
}

module.exports = {
  USER_REFERENCE_SOURCE,
  createMarketScriptRecipe,
  normalizeMaterialType,
  normalizeNarrativeRole
};
