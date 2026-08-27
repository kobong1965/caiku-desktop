const test = require("node:test");
const assert = require("node:assert/strict");
const { checkCoverage, checkScript, checkText, scriptComplianceText } = require("../electron/services/compliance-engine.cjs");

test("阻断疑似极限价与保证性表达", () => {
  const report = checkText("这是全网最好的一条，保证穿上一定显瘦");
  assert.equal(report.status, "blocked");
  assert.ok(report.issues.some((issue) => issue.term === "全网"));
  assert.ok(report.issues.some((issue) => issue.term === "最好"));
  assert.ok(report.issues.some((issue) => issue.term === "保证"));
});

test("痛点问句、时间顺序和否定说明不会被子串误阻断", () => {
  const report = checkText("买西裤最怕什么？最近先看上身，第一眼看版型，最后再看尺码；这条不一定适合每个人，也不保证人人喜欢。");
  assert.equal(report.status, "pass");
  assert.deepEqual(report.issues, []);
});

test("显瘦与库存表达只进入待复核", () => {
  const report = checkText("上身看起来显瘦，这是最后一批");
  assert.equal(report.status, "review");
  assert.ok(report.issues.every((issue) => issue.level === "review"));
});

test("脚本检查使用最终实际口播并返回段落位置", () => {
  const script = {
    voiceMode: "full_voice",
    blocks: [{
      id: "s6-b1",
      name: "购买痛点",
      voiceText: "买西裤最怕什么？太窄挑腿，太宽又容易没精神。",
      subtitleText: "太窄挑腿 · 太宽没精神"
    }]
  };
  const report = checkScript(script);
  assert.equal(report.status, "pass");
  assert.equal(scriptComplianceText(script), script.blocks[0].voiceText);

  script.blocks[0].voiceText = "这是全网最好的一条";
  const blocked = checkScript(script);
  assert.equal(blocked.status, "blocked");
  assert.ok(blocked.issues.every((issue) => issue.blockId === "s6-b1"));
  assert.ok(blocked.issues.every((issue) => issue.blockName === "购买痛点"));
  assert.ok(blocked.issues.every((issue) => issue.field === "voiceText"));
});

test("纯音乐脚本只检查实际显示的字幕", () => {
  const report = checkScript({
    voiceMode: "music_only",
    blocks: [{ id: "b1", name: "展示", voiceText: "全网最好", subtitleText: "宽松直筒" }]
  });
  assert.equal(report.status, "pass");
  assert.equal(report.text, "宽松直筒");
});

test("素材分类覆盖脚本段落", () => {
  const report = checkCoverage(
    { blocks: [{ category: "人物穿搭" }, { category: "细节讲解" }] },
    [{ typeLabel: "人物穿搭" }, { typeLabel: "细节讲解" }]
  );
  assert.equal(report.status, "pass");
  assert.deepEqual(report.missing, []);
});
