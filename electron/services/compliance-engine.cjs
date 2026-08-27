const RULE_VERSION = "CN-DOUYIN-OFFLINE-2026.08.2";

const RULES = [
  {
    id: "extreme",
    level: "block",
    terms: [
      "最好", "最佳", "最优", "最强", "最高级", "最先进", "最便宜", "最划算", "最舒服", "最显瘦", "最百搭", "最值得",
      "销量第一", "行业第一", "排名第一", "第一品牌", "顶级", "绝对", "唯一", "全网", "天花板", "史上", "国家级"
    ],
    message: "疑似极限或唯一性表达",
    replacement: "更适合、较为、这款"
  },
  { id: "guarantee", level: "block", terms: ["保证", "百分百", "永久", "无效退款", "零风险", "一定", "必然"], message: "疑似无法证明的保证性承诺", replacement: "可改为个人体验或条件性描述" },
  { id: "medical", level: "block", terms: ["治疗", "治愈", "根治", "药效", "降血压", "抗癌", "无副作用"], message: "疑似医疗功效表达", replacement: "删除功效承诺并核对商品资质" },
  { id: "body", level: "review", terms: ["显瘦", "瘦十斤", "秒瘦", "增高", "长高"], message: "体型或效果描述需要画面及证据支持", replacement: "改为版型观感或实际穿着体验" },
  { id: "price", level: "review", terms: ["最低价", "全网最低", "跳楼价", "亏本", "仅此一天"], message: "价格或稀缺性表述需与实时活动一致", replacement: "以投放时商品页价格和活动为准" },
  { id: "scarcity", level: "review", terms: ["最后一批", "马上抢光", "错过不再", "限量绝版"], message: "稀缺性表述需要真实库存依据", replacement: "删除虚构紧迫感" }
];

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function blockComplianceSource(script, block = {}) {
  const voiceMode = ["full_voice", "partial_voice", "music_only"].includes(script.voiceMode) ? script.voiceMode : "full_voice";
  const musicOnly = voiceMode === "music_only";
  const voiceEnabled = !musicOnly && (voiceMode === "full_voice" || block.voiceEnabled !== false);
  const candidates = voiceEnabled
    ? [["voiceText", block.voiceText], ["text", block.text], ["subtitleText", block.subtitleText], ["name", block.name]]
    : [["subtitleText", block.subtitleText], ["text", block.text], ["name", block.name]];
  const selected = candidates.find(([, value]) => value !== null && value !== undefined) || ["name", ""];
  return { field: selected[0], text: normalizeText(selected[1]) };
}

function scriptComplianceSegments(script = {}) {
  return (Array.isArray(script.blocks) ? script.blocks : []).map((block, index) => {
    const source = blockComplianceSource(script, block);
    return {
      blockId: String(block?.id || `block-${index + 1}`),
      blockName: String(block?.name || `段落 ${index + 1}`),
      field: source.field,
      text: source.text
    };
  }).filter((segment) => segment.text);
}

function scriptComplianceText(script = {}) {
  const text = scriptComplianceSegments(script).map((segment) => segment.text).join("。").trim();
  return text || normalizeText(script.name);
}

function isNegatedOccurrence(text, index) {
  const prefix = text.slice(Math.max(0, index - 4), index);
  return /(?:不|并不|并非|不是|没有|没|未|无法|不能|无需)$/.test(prefix);
}

function checkText(text) {
  const normalized = normalizeText(text);
  const issues = [];
  for (const rule of RULES) {
    for (const term of rule.terms) {
      let index = normalized.indexOf(term);
      while (index !== -1) {
        if (!isNegatedOccurrence(normalized, index)) {
          issues.push({
            ruleId: rule.id,
            level: rule.level,
            term,
            index,
            excerpt: normalized.slice(Math.max(0, index - 12), Math.min(normalized.length, index + term.length + 12)),
            message: rule.message,
            suggestion: rule.replacement
          });
        }
        index = normalized.indexOf(term, index + term.length);
      }
    }
  }
  const blockers = issues.filter((issue) => issue.level === "block");
  return {
    mode: "offline_baseline",
    ruleVersion: RULE_VERSION,
    checkedAt: new Date().toISOString(),
    text: normalized,
    status: blockers.length ? "blocked" : issues.length ? "review" : "pass",
    score: Math.max(0, 100 - blockers.length * 25 - (issues.length - blockers.length) * 8),
    issues,
    disclaimer: "本地规则检查用于发布前筛查，不替代平台最新规则、商品资质审核或人工复核。"
  };
}

function checkScript(script) {
  const segments = scriptComplianceSegments(script);
  const report = checkText(segments.map((segment) => segment.text).join("。").trim() || normalizeText(script?.name));
  let cursor = 0;
  const ranges = segments.map((segment) => {
    const range = { ...segment, start: cursor, end: cursor + segment.text.length };
    cursor = range.end + 1;
    return range;
  });
  return {
    ...report,
    issues: report.issues.map((issue) => {
      const segment = ranges.find((range) => issue.index >= range.start && issue.index < range.end);
      return segment ? {
        ...issue,
        blockId: segment.blockId,
        blockName: segment.blockName,
        field: segment.field,
        blockIndex: issue.index - segment.start
      } : issue;
    })
  };
}

function checkCoverage(script, materials) {
  const requested = new Set((script?.blocks || []).map((block) => block.category).filter(Boolean));
  const available = new Set((materials || []).map((material) => material.typeLabel || material.categoryLabel).filter(Boolean));
  const missing = [...requested].filter((category) => !available.has(category));
  return {
    status: missing.length ? "review" : "pass",
    requested: [...requested],
    available: [...available],
    missing,
    message: missing.length ? `缺少脚本需要的素材类型：${missing.join("、")}` : "脚本段落与素材分类覆盖一致"
  };
}

module.exports = {
  RULES,
  RULE_VERSION,
  checkCoverage,
  checkScript,
  checkText,
  isNegatedOccurrence,
  normalizeText,
  scriptComplianceSegments,
  scriptComplianceText
};
