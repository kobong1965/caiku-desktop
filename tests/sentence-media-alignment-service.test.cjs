const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildAlignedSentenceTimeline,
  buildAlignedSrt,
  validateSentenceAlignment
} = require("../electron/services/sentence-media-alignment-service.cjs");

const script = {
  id: "aligned-script",
  voiceMode: "full_voice",
  blocks: [
    { id: "b1", name: "开场", duration: 3, category: "人物穿搭", voiceText: "还有人不懂西裤怎么搭？", subtitleText: "旧字幕开场" },
    { id: "b2", name: "细节", duration: 4, category: "细节讲解", voiceText: "先看腰头和褶皱。", subtitleText: "旧字幕细节" }
  ]
};

const editingPlan = {
  decisions: [
    { blockId: "b1", timeline: [{ materialId: "outfit-1", duration: 3 }] },
    { blockId: "b2", timeline: [{ materialId: "detail-1", duration: 2 }, { materialId: "detail-2", duration: 2 }] }
  ]
};

test("配音、字幕和镜头使用同一份逐句文本与时间线", () => {
  const aligned = buildAlignedSentenceTimeline({ script, editingPlan });
  assert.equal(aligned.sentences[0].text, "还有人不懂西裤怎么搭？");
  assert.equal(aligned.sentences[0].voiceText, aligned.sentences[0].subtitleText);
  assert.equal(aligned.sentences[1].start, 3);
  assert.equal(aligned.sentences[1].end, 7);
  assert.deepEqual(aligned.sentences[1].materialIds, ["detail-1", "detail-2"]);
  assert.equal(aligned.voiceText, "还有人不懂西裤怎么搭？先看腰头和褶皱。");
  assert.equal(validateSentenceAlignment(aligned).status, "pass");
  const srt = buildAlignedSrt(aligned);
  assert.match(srt, /00:00:00,000 --> 00:00:03,000/);
  assert.match(srt, /还有人不懂西裤怎么搭？/);
  assert.match(srt, /00:00:03,000 --> 00:00:07,000/);
});

test("部分口播只对启用段落强制配音字幕同源", () => {
  const partial = structuredClone(script);
  partial.voiceMode = "partial_voice";
  partial.blocks[1].voiceEnabled = false;
  partial.blocks[1].subtitleText = "这一段只显示字幕";
  const aligned = buildAlignedSentenceTimeline({ script: partial, editingPlan });
  assert.equal(aligned.sentences[0].voiceEnabled, true);
  assert.equal(aligned.sentences[0].voiceText, aligned.sentences[0].subtitleText);
  assert.equal(aligned.sentences[1].voiceText, "");
  assert.equal(aligned.sentences[1].subtitleText, "这一段只显示字幕");
  assert.equal(validateSentenceAlignment(aligned).status, "pass");
});

test("纯音乐模式不生成口播，字幕可为空", () => {
  const musicOnly = { id: "music", voiceMode: "music_only", blocks: [{ id: "m1", name: "纯画面", duration: 4, category: "人物穿搭", voiceText: "不得合成", subtitleText: "" }] };
  const aligned = buildAlignedSentenceTimeline({ script: musicOnly, editingPlan: { decisions: [{ blockId: "m1", timeline: [{ materialId: "outfit-1", duration: 4 }] }] } });
  assert.equal(aligned.voiceText, "");
  assert.equal(aligned.sentences[0].voiceText, "");
  assert.equal(buildAlignedSrt(aligned), "");
  assert.equal(validateSentenceAlignment(aligned).status, "pass");
});

test("重叠时间段或配音字幕不一致会阻断", () => {
  const aligned = buildAlignedSentenceTimeline({ script, editingPlan });
  aligned.sentences[1].start = 2;
  aligned.sentences[1].subtitleText = "不一致字幕";
  const result = validateSentenceAlignment(aligned);
  assert.equal(result.status, "blocked");
  assert.deepEqual(new Set(result.issues.map((item) => item.code)), new Set(["VOICE_SUBTITLE_TEXT_MISMATCH", "SENTENCE_TIMELINE_OVERLAP"]));
});
