const test = require("node:test");
const assert = require("node:assert/strict");
const { buildAudioGraph, buildPlannedTimeline, scriptText, voiceScriptText } = require("../electron/services/mix-engine.cjs");

test("纯音乐脚本不生成口播文本并关闭素材原声", () => {
  const script = {
    voiceMode: "music_only",
    blocks: [{ subtitleText: "垂感西裤", voiceText: "这条裤子很垂顺", voiceEnabled: true }]
  };
  assert.equal(scriptText(script), "垂感西裤");
  assert.equal(voiceScriptText(script), "");
  assert.match(buildAudioGraph({ hasVoice: false, hasMusic: true, musicOnly: true }), /volume=0,aresample=48000\[a0\]/);
});

test("全程口播和部分口播也会强制关闭素材原声", () => {
  const graph = buildAudioGraph({ hasVoice: true, hasMusic: true, musicOnly: false });
  assert.match(graph, /\[0:a:0\]volume=0,aresample=48000\[a0\]/);
  assert.doesNotMatch(graph, /volume=0\.16/);
});

test("部分口播只合成启用口播的段落", () => {
  const script = {
    voiceMode: "partial_voice",
    blocks: [
      { voiceText: "第一句", voiceEnabled: true },
      { voiceText: "这一段只放音乐", voiceEnabled: false },
      { voiceText: "第三句", voiceEnabled: true }
    ]
  };
  assert.equal(voiceScriptText(script), "第一句。第三句");
});

test("确认后的 AI 剪辑计划决定素材顺序和截取范围", () => {
  const materials = [
    { id: "m1", filePath: "D:\\素材\\正面.mp4", duration: 4 },
    { id: "m2", filePath: "D:\\素材\\转身.mp4", duration: 3.5 }
  ];
  const timeline = buildPlannedTimeline({
    status: "review",
    confirmed: true,
    decisions: [
      { blockId: "b1", timeline: [{ materialId: "m2", sourceStart: 0.5, duration: 2 }] },
      { blockId: "b2", timeline: [{ materialId: "m1", sourceStart: 1, duration: 3 }] }
    ]
  }, materials);
  assert.deepEqual(timeline.map((item) => item.materialId), ["m2", "m1"]);
  assert.equal(timeline[0].sourceStart, 0.5);
  assert.equal(timeline[1].duration, 3);
});

test("未确认、阻断或越界的剪辑计划不能进入执行器", () => {
  const materials = [{ id: "m1", filePath: "D:\\素材\\正面.mp4", duration: 4 }];
  assert.throws(
    () => buildPlannedTimeline({ status: "ready", confirmed: false, decisions: [] }, materials),
    (error) => error.code === "AI_EDITOR_PLAN_UNCONFIRMED"
  );
  assert.throws(
    () => buildPlannedTimeline({ status: "blocked", confirmed: true, decisions: [] }, materials),
    (error) => error.code === "AI_EDITOR_PLAN_BLOCKED"
  );
  assert.throws(
    () => buildPlannedTimeline({
      status: "ready",
      confirmed: true,
      decisions: [{ blockId: "b1", timeline: [{ materialId: "m1", sourceStart: 3, duration: 2 }] }]
    }, materials),
    (error) => error.code === "AI_EDITOR_TIMELINE_OUT_OF_RANGE"
  );
});

test("批量变体只在同一段落的 AI 候选素材内轮换", () => {
  const materials = [
    { id: "m1", filePath: "D:\\素材\\正面.mp4", duration: 4 },
    { id: "m2", filePath: "D:\\素材\\转身.mp4", duration: 4 }
  ];
  const plan = {
    status: "ready",
    confirmed: true,
    decisions: [{
      blockId: "b1",
      selectedMaterialIds: ["m1", "m2"],
      timeline: [{ materialId: "m1", sourceStart: 0, duration: 3 }]
    }]
  };
  assert.equal(buildPlannedTimeline(plan, materials, 0)[0].materialId, "m1");
  assert.equal(buildPlannedTimeline(plan, materials, 1)[0].materialId, "m2");
});
