const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildVoiceInstructions,
  evaluateVoiceScript,
  selectVoiceStyle
} = require("../electron/services/voice-style-service.cjs");

test("20到35秒默认使用真人短种草，60秒以上切换真人深测评", () => {
  assert.equal(selectVoiceStyle(30).id, "real-review-short");
  assert.equal(selectVoiceStyle(59.9).id, "real-review-short");
  assert.equal(selectVoiceStyle(60).id, "real-review-deep");
  assert.equal(selectVoiceStyle(90).label, "真人深测评");
});

test("真人口播指令包含变速呼吸和先观察再下结论", () => {
  const instructions = buildVoiceInstructions("real-review-short");
  assert.match(instructions, /3\.8到4\.3个汉字每秒/);
  assert.match(instructions, /200到450毫秒/);
  assert.match(instructions, /先观察再下结论/);
  assert.match(instructions, /不要模仿任何具体人物/);
  assert.match(instructions, /不要统一句尾/);
});

test("短种草脚本必须有痛点钩子画面证据场景和克制引导", () => {
  const valid = evaluateVoiceScript({
    duration: 28,
    blocks: [
      { styleRole: "pain_hook", voiceText: "买西裤最怕什么？太窄挑腿，太宽又没精神。" },
      { styleRole: "visible_evidence", voiceText: "你看腰头这个双褶，正面还是挺利落的。" },
      { styleRole: "visible_evidence", voiceText: "裤腿是宽松直筒，站着转身都能看清轮廓。" },
      { styleRole: "use_case", voiceText: "黑色搭针织或者短袖都顺眼。" },
      { styleRole: "soft_cta", voiceText: "喜欢这种感觉，可以再看看尺码。" }
    ]
  }, "real-review-short");
  assert.equal(valid.status, "pass");
  assert.deepEqual(valid.missingRoles, []);

  const invalid = evaluateVoiceScript({ duration: 20, blocks: [{ styleRole: "visible_evidence", voiceText: "这条裤子很好。" }] }, "real-review-short");
  assert.equal(invalid.status, "blocked");
  assert.deepEqual(invalid.missingRoles, ["pain_hook", "use_case", "soft_cta"]);
});

