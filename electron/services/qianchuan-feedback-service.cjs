const crypto = require("node:crypto");

const PERFORMANCE_STORE_KEY = "qianchuanFeedback";
const FEEDBACK_SCHEMA_VERSION = 1;

function parseCsvLine(line) {
  const values = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && quoted && line[index + 1] === '"') { value += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { values.push(value.trim()); value = ""; }
    else value += char;
  }
  values.push(value.trim());
  return values;
}

function numberValue(value) {
  const cleaned = String(value ?? "").replace(/[,%￥¥\s]/g, "");
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : 0;
}

function findHeader(headers, names) {
  return headers.findIndex((header) => names.some((name) => String(header).toLowerCase().includes(name.toLowerCase())));
}

function normalizeCreativeName(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/\.(mp4|mov|mkv|m4v)$/i, "")
    .replace(/_1080x1920$/i, "")
    .trim()
    .toLocaleLowerCase("zh-CN");
}

function stableCreativeId(value) {
  return `creative-${crypto.createHash("sha256").update(normalizeCreativeName(value), "utf8").digest("hex").slice(0, 16)}`;
}

function weightedRate(rows, key, weightKey = "impressions") {
  const valid = rows.filter((row) => Number(row[key]) > 0);
  const totalWeight = valid.reduce((sum, row) => sum + Math.max(1, Number(row[weightKey] || 0)), 0);
  return totalWeight ? Number((valid.reduce((sum, row) => sum + Number(row[key]) * Math.max(1, Number(row[weightKey] || 0)), 0) / totalWeight).toFixed(4)) : 0;
}

function parseQianchuanCsv(text) {
  const lines = String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) {
    const error = new Error("千川 CSV 没有可读取的数据行");
    error.code = "QIANCHUAN_CSV_EMPTY";
    throw error;
  }
  const headers = parseCsvLine(lines[0]);
  const columns = {
    name: findHeader(headers, ["视频名称", "素材名称", "文件名", "创意名称"]),
    creativeId: findHeader(headers, ["创意id", "素材id", "视频id", "creative id"]),
    impressions: findHeader(headers, ["展现量", "展示量", "曝光"]),
    play3Rate: findHeader(headers, ["3秒播放率", "3s播放率", "3秒留存率"]),
    play5Rate: findHeader(headers, ["5秒播放率", "5s播放率", "5秒留存率"]),
    completionRate: findHeader(headers, ["完播率", "播放完成率"]),
    clicks: findHeader(headers, ["点击量", "点击数"]),
    ctr: findHeader(headers, ["点击率", "ctr"]),
    spend: findHeader(headers, ["消耗", "花费"]),
    orders: findHeader(headers, ["成交订单", "成交单量", "订单数"]),
    revenue: findHeader(headers, ["成交金额", "支付金额", "gmv"]),
    roi: findHeader(headers, ["支付roi", "roi"]),
    cvr: findHeader(headers, ["点击成交率", "转化率", "cvr"]),
    cpa: findHeader(headers, ["成交成本", "转化成本", "cpa"])
  };
  if (columns.name < 0) {
    const error = new Error("CSV 中找不到视频名称、素材名称或创意名称列");
    error.code = "QIANCHUAN_NAME_COLUMN_MISSING";
    throw error;
  }
  const rows = lines.slice(1).map(parseCsvLine).map((values) => {
    const read = (key) => columns[key] >= 0 ? values[columns[key]] : "";
    const impressions = numberValue(read("impressions"));
    const clicks = numberValue(read("clicks"));
    const spend = numberValue(read("spend"));
    const revenue = numberValue(read("revenue"));
    const ctrRaw = numberValue(read("ctr"));
    const roiRaw = numberValue(read("roi"));
    const orders = numberValue(read("orders"));
    return {
      creativeId: String(read("creativeId") || "").trim() || stableCreativeId(read("name")),
      outputName: String(read("name") || "").trim().slice(0, 240),
      impressions,
      play3Rate: Number(numberValue(read("play3Rate")).toFixed(4)),
      play5Rate: Number(numberValue(read("play5Rate")).toFixed(4)),
      completionRate: Number(numberValue(read("completionRate")).toFixed(4)),
      clicks,
      ctr: Number((ctrRaw || (impressions ? clicks / impressions * 100 : 0)).toFixed(4)),
      spend: Number(spend.toFixed(2)),
      orders,
      revenue: Number(revenue.toFixed(2)),
      roi: Number((roiRaw || (spend ? revenue / spend : 0)).toFixed(4)),
      cvr: Number((numberValue(read("cvr")) || (clicks ? orders / clicks * 100 : 0)).toFixed(4)),
      cpa: Number((numberValue(read("cpa")) || (orders ? spend / orders : 0)).toFixed(2))
    };
  }).filter((row) => row.outputName);
  if (!rows.length) throw Object.assign(new Error("千川 CSV 没有有效的视频数据"), { code: "QIANCHUAN_ROWS_EMPTY" });
  const totals = rows.reduce((total, row) => ({
    impressions: total.impressions + row.impressions,
    clicks: total.clicks + row.clicks,
    spend: total.spend + row.spend,
    orders: total.orders + row.orders,
    revenue: total.revenue + row.revenue
  }), { impressions: 0, clicks: 0, spend: 0, orders: 0, revenue: 0 });
  return {
    rows,
    summary: {
      videoCount: rows.length,
      ...totals,
      ctr: Number((totals.impressions ? totals.clicks / totals.impressions * 100 : 0).toFixed(4)),
      roi: Number((totals.spend ? totals.revenue / totals.spend : 0).toFixed(4)),
      cvr: Number((totals.clicks ? totals.orders / totals.clicks * 100 : 0).toFixed(4)),
      cpa: Number((totals.orders ? totals.spend / totals.orders : 0).toFixed(2)),
      play3Rate: weightedRate(rows, "play3Rate"),
      play5Rate: weightedRate(rows, "play5Rate"),
      completionRate: weightedRate(rows, "completionRate")
    }
  };
}

function buildPerformanceInsights(records = [], outputHistory = []) {
  const historyById = new Map((outputHistory || []).map((output) => [String(output.creativeId || stableCreativeId(output.outputName || output.name)), output]));
  const creatives = (records || []).flatMap((record) => record.rows || []).map((row) => {
    const creativeId = String(row.creativeId || stableCreativeId(row.outputName));
    const output = historyById.get(creativeId) || null;
    return {
      ...row,
      creativeId,
      sku: output?.sku || "",
      hookStyle: output?.creativeStrategy?.hookStyle || "unknown",
      pacingStyle: output?.creativeStrategy?.pacingStyle || "unknown",
      ctaStyle: output?.creativeStrategy?.ctaStyle || "unknown",
      voiceTempo: output?.creativeStrategy?.voiceTempo ?? null,
      duration: output?.duration ?? null,
      sampleMatched: Boolean(output)
    };
  });
  const ranked = [...creatives].sort((left, right) => (right.roi - left.roi) || (right.ctr - left.ctr) || (right.completionRate - left.completionRate));
  const tagMap = new Map();
  for (const creative of creatives.filter((item) => item.sampleMatched)) {
    for (const [kind, label] of [["hook", creative.hookStyle], ["pacing", creative.pacingStyle], ["cta", creative.ctaStyle]]) {
      if (!label || label === "unknown") continue;
      const key = `${kind}:${label}`;
      const entry = tagMap.get(key) || { kind, label, samples: 0, impressions: 0, clicks: 0, spend: 0, revenue: 0, orders: 0 };
      entry.samples += 1;
      entry.impressions += creative.impressions;
      entry.clicks += creative.clicks;
      entry.spend += creative.spend;
      entry.revenue += creative.revenue;
      entry.orders += creative.orders;
      tagMap.set(key, entry);
    }
  }
  const tagPerformance = [...tagMap.values()].map((entry) => ({
    ...entry,
    ctr: Number((entry.impressions ? entry.clicks / entry.impressions * 100 : 0).toFixed(4)),
    roi: Number((entry.spend ? entry.revenue / entry.spend : 0).toFixed(4)),
    confidence: entry.samples >= 3 ? "usable" : "exploratory"
  })).sort((left, right) => (right.roi - left.roi) || (right.ctr - left.ctr));
  return {
    generatedAt: new Date().toISOString(),
    sampleCount: creatives.length,
    matchedSampleCount: creatives.filter((item) => item.sampleMatched).length,
    topCreatives: ranked.slice(0, 10),
    tagPerformance: tagPerformance.slice(0, 20),
    rule: "反馈只用于调整钩子、节奏、CTA、时长和音频策略；不得覆盖商品身份、素材证据、字幕和合规硬门槛。少于 3 个样本只作探索提示。"
  };
}

function createQianchuanFeedbackRepository(store, options = {}) {
  const now = typeof options.now === "function" ? options.now : () => new Date().toISOString();
  return Object.freeze({
    async list() { return await store.get(PERFORMANCE_STORE_KEY) || []; },
    async importCsv(text, sourcePath = "") {
      const parsed = parseQianchuanCsv(text);
      const record = { id: `feedback-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, schemaVersion: FEEDBACK_SCHEMA_VERSION, importedAt: now(), sourcePath, ...parsed };
      const records = await store.get(PERFORMANCE_STORE_KEY) || [];
      await store.set(PERFORMANCE_STORE_KEY, [record, ...records].slice(0, 50));
      return record;
    },
    async remove(id) {
      const records = await store.get(PERFORMANCE_STORE_KEY) || [];
      const next = records.filter((record) => record.id !== id);
      if (next.length === records.length) return false;
      await store.set(PERFORMANCE_STORE_KEY, next);
      return true;
    }
  });
}

module.exports = { FEEDBACK_SCHEMA_VERSION, PERFORMANCE_STORE_KEY, buildPerformanceInsights, createQianchuanFeedbackRepository, normalizeCreativeName, numberValue, parseCsvLine, parseQianchuanCsv, stableCreativeId, weightedRate };
