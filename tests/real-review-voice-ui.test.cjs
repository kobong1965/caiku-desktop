const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("混剪页提供真人短种草和真人深测评试听", () => {
  const html = read("prototype/v1/index.html");
  const app = read("prototype/v1/app.js");
  assert.match(html, /data-ai-voice="真人短种草"/);
  assert.match(html, /data-ai-voice="真人深测评"/);
  assert.match(html, /20–35秒 · 痛点、证据、场景、克制收口/);
  assert.match(app, /selectedAiVoice: "真人短种草"/);
});

test("混剪页提供三个中性和辨识度音色但不冒充真人", () => {
  const html = read("prototype/v1/index.html");
  assert.match(html, /data-ai-voice="中性测评·四月"/);
  assert.match(html, /data-ai-voice="率性变音·月白"/);
  assert.match(html, /data-ai-voice="设计师变音·不吃鱼"/);
  assert.match(html, /官方系统音色/);
});

test("桌面试听先绑定所选预设并把脚本时长交给自动路由", () => {
  const bridge = read("prototype/v1/desktop-bridge.js");
  const main = read("electron/main.cjs");
  const mixer = read("electron/services/mix-engine.cjs");
  assert.match(bridge, /appState\.selectedAiVoice = button\.dataset\.aiVoice/);
  assert.match(bridge, /voicePreviewApproved = false/);
  assert.match(bridge, /previewVoice\(\{ presetName: button\.dataset\.aiVoice, text, duration:/);
  assert.match(main, /payload\?\.duration/);
  assert.match(mixer, /duration: Number\(payload\.script\?\.duration/);
});

test("918 真人短种草脚本具有完整风格角色且未试听只转为生成后复核", () => {
  const main = read("electron/main.cjs");
  const bridge = read("prototype/v1/desktop-bridge.js");
  for (const role of ["pain_hook", "visible_evidence", "use_case", "soft_cta"]) {
    assert.match(main, new RegExp(`styleRole: "${role}"`));
  }
  assert.match(main, /selectedAiVoice: applyRealReviewDefaults \? "真人短种草"/);
  assert.match(main, /voicePreviewApproved: applyRealReviewDefaults \? false/);
  assert.match(main, /realReviewVoiceV1Applied !== true/);
  assert.match(main, /realReviewVoiceV1Applied: true/);
  assert.match(main, /s6-b5[^\n]+styleRole: "soft_cta"[^\n]+category: "整体展示"[^\n]+type: "overall"/);
  assert.match(main, /editingAgentNarrativeFixV1Applied !== true/);
  assert.match(main, /migrateSoftCtaClosingBlocks\(migratedScripts\)/);
  assert.match(main, /editingAgentNarrativeFixV1Applied: true/);
  const voiceBranch = bridge.match(/if \(!musicOnly && !appState\.voices\.length && appState\.voicePreviewApproved !== true\) \{[\s\S]*?\n    \}/)?.[0] || "";
  assert.match(voiceBranch, /将先生成候选并在结果中标为待听感复核/);
  assert.doesNotMatch(voiceBranch, /return/);
});

test("纯音乐脚本缺音乐时继续生成静音候选", () => {
  const bridge = read("prototype/v1/desktop-bridge.js");
  const app = read("prototype/v1/app.js");
  const musicBranch = bridge.match(/if \(musicOnly && !musicFile\) \{[\s\S]*?\n    \}/)?.[0] || "";
  assert.match(musicBranch, /生成静音候选/);
  assert.match(musicBranch, /待补音乐/);
  assert.doesNotMatch(musicBranch, /return/);
  assert.match(app, /if \(musicOnly && !hasMusicFile\) showToast\("尚未添加音乐，将先生成静音候选，结果标为待补音乐"\)/);
});
