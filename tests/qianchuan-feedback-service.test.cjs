const test = require("node:test");
const assert = require("node:assert/strict");
const { buildPerformanceInsights, createQianchuanFeedbackRepository, parseQianchuanCsv, stableCreativeId } = require("../electron/services/qianchuan-feedback-service.cjs");

test("解析千川常用中文列并计算加权 CTR 与 ROI", () => {
  const result = parseQianchuanCsv("视频名称,展现量,点击量,消耗,成交订单,成交金额\n成片01,1000,50,100,3,260\n成片02,500,10,50,1,75");
  assert.equal(result.rows.length, 2);
  assert.equal(result.summary.ctr, 4);
  assert.equal(result.summary.roi, 2.2333);
  assert.equal(result.summary.orders, 4);
});

test("百分号和货币符号可以安全转换", () => {
  const result = parseQianchuanCsv("素材名称,点击率,消耗,支付ROI\n\"神裤,第一版\",5.2%,￥100,2.6");
  assert.equal(result.rows[0].outputName, "神裤,第一版");
  assert.equal(result.rows[0].ctr, 5.2);
  assert.equal(result.rows[0].spend, 100);
});

test("导入记录可以保存和删除且不覆盖历史", async () => {
  const state = {};
  const store = { async get(key) { return structuredClone(state[key]); }, async set(key, value) { state[key] = structuredClone(value); return value; } };
  const repository = createQianchuanFeedbackRepository(store, { now: () => "2026-08-22T12:00:00.000Z" });
  const csv = "视频名称,展现量,点击量\n成片01,100,5";
  const first = await repository.importCsv(csv, "first.csv");
  await repository.importCsv(csv, "second.csv");
  assert.equal((await repository.list()).length, 2);
  assert.equal(await repository.remove(first.id), true);
  assert.equal((await repository.list()).length, 1);
});

test("读取 3 秒 5 秒完播 CVR CPA 并生成稳定创意 ID", () => {
  const csv = "视频名称,曝光,3秒播放率,5秒播放率,完播率,点击量,消耗,订单数,成交金额\n成片01_1080x1920.mp4,1000,42%,31%,12%,50,100,5,260";
  const result = parseQianchuanCsv(csv);
  assert.equal(result.rows[0].creativeId, stableCreativeId("成片01"));
  assert.equal(result.rows[0].play3Rate, 42);
  assert.equal(result.rows[0].play5Rate, 31);
  assert.equal(result.rows[0].completionRate, 12);
  assert.equal(result.rows[0].cvr, 10);
  assert.equal(result.rows[0].cpa, 20);
});

test("投放反馈只在匹配创意后回写策略标签且小样本标为探索", () => {
  const creativeId = stableCreativeId("成片01.mp4");
  const records = [{ rows: [{ creativeId, outputName: "成片01.mp4", impressions: 1000, clicks: 50, spend: 100, orders: 5, revenue: 260, ctr: 5, roi: 2.6, completionRate: 12 }] }];
  const insights = buildPerformanceInsights(records, [{ creativeId, sku: "918", creativeStrategy: { hookStyle: "细节证据", pacingStyle: "快切证据", ctaStyle: "查看商品卡" } }]);
  assert.equal(insights.matchedSampleCount, 1);
  assert.equal(insights.tagPerformance[0].confidence, "exploratory");
  assert.match(insights.rule, /不得覆盖商品身份/);
});
