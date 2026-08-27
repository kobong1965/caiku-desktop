const test = require("node:test");
const assert = require("node:assert/strict");
const { buildAudioGraph, buildPlannedTimeline, buildScriptSrt, escapeSubtitleFilterPath, scriptText, voiceScriptText } = require("../electron/services/mix-engine.cjs");

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
  assert.equal(voiceScriptText(script), "第一句。第三句。");
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

test("未确认或时间越界的剪辑计划不能进入执行器", () => {
  const materials = [{ id: "m1", filePath: "D:\\素材\\正面.mp4", duration: 4 }];
  assert.throws(
    () => buildPlannedTimeline({ status: "ready", confirmed: false, decisions: [] }, materials),
    (error) => error.code === "AI_EDITOR_PLAN_UNCONFIRMED"
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

test("质量低分计划先生成候选片，不再被 100 分时间线门禁拦截", () => {
  const material = { id: "m1", filePath: "D:\\素材\\正面.mp4", duration: 5 };
  const timeline = buildPlannedTimeline({
    status: "blocked",
    confirmed: true,
    decisions: [{
      blockId: "b1",
      evidenceStatus: "missing",
      rewriteRequired: true,
      unsupportedClaims: ["尚无直接证据"],
      timeline: [{ materialId: "m1", sourceStart: 0, duration: 5 }]
    }]
  }, [material], 0, { qualityMode: true });
  assert.equal(timeline.length, 1);
  assert.equal(timeline[0].materialId, "m1");
  assert.equal(timeline.qualityValidation.status, "blocked");
  assert.ok(timeline.qualityValidation.errors.some((issue) => issue.code === "SHOT_TOO_LONG"));
});

test("无论是否生成草稿，时间线单镜低于 2 秒仍然硬拦截", () => {
  const material = { id: "m1", filePath: "D:\\素材\\正面.mp4", duration: 4 };
  assert.throws(
    () => buildPlannedTimeline({
      status: "blocked",
      confirmed: true,
      decisions: [{ blockId: "b1", timeline: [{ materialId: "m1", sourceStart: 0, duration: 1.5 }] }]
    }, [material], 0, { qualityMode: true }),
    (error) => error.code === "TIMELINE_SHOT_TOO_SHORT"
      && error.details.errors[0].code === "SHOT_TOO_SHORT"
  );
});

test("变体时间线出现重复素材时允许先渲染并记录待修复问题", () => {
  const material = { id: "m1", filePath: "D:\\素材\\正面.mp4", duration: 4 };
  const timeline = buildPlannedTimeline({
    status: "blocked",
    confirmed: true,
    decisions: [
      { blockId: "b1", timeline: [{ materialId: "m1", sourceStart: 0, duration: 2 }] },
      { blockId: "b2", timeline: [{ materialId: "m1", sourceStart: 2, duration: 2 }] }
    ]
  }, [material], 0, { qualityMode: true });
  assert.equal(timeline.length, 2);
  assert.ok(timeline.qualityValidation.errors.some((issue) => issue.code === "MATERIAL_REPEATED"));
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

test("变体对段内双镜头做交换而不是把第二镜重复两次", () => {
  const materials = ["m1", "m2"].map((id) => ({ id, filePath: `D:\\素材\\${id}.mp4`, duration: 4 }));
  const plan = {
    status: "ready",
    confirmed: true,
    decisions: [{
      blockId: "b1",
      selectedMaterialIds: ["m1", "m2"],
      candidateMaterialIds: ["m1", "m2"],
      timeline: [
        { materialId: "m1", sourceStart: 0, duration: 2 },
        { materialId: "m2", sourceStart: 0, duration: 2 }
      ]
    }]
  };
  assert.deepEqual(buildPlannedTimeline(plan, materials, 1).map((item) => item.materialId), ["m2", "m1"]);
});

test("多段变体按整条时间线轮换且不会重复素材", () => {
  const materials = ["m1", "m2", "m3", "m4"].map((id) => ({ id, filePath: `D:\\素材\\${id}.mp4`, duration: 4 }));
  const candidateIds = materials.map((item) => item.id);
  const plan = {
    status: "ready",
    confirmed: true,
    decisions: candidateIds.map((materialId, index) => ({
      blockId: `b${index + 1}`,
      selectedMaterialIds: candidateIds,
      timeline: [{ materialId, sourceStart: 0, duration: 3 }]
    }))
  };
  const variant = buildPlannedTimeline(plan, materials, 1);
  assert.deepEqual(variant.map((item) => item.materialId), ["m2", "m3", "m4", "m1"]);
  assert.equal(new Set(variant.map((item) => item.materialId)).size, 4);
});

test("屏幕字幕按脚本时间段生成 SRT，空字幕不被错误烧录", () => {
  const srt = buildScriptSrt({ blocks: [
    { start: 0, duration: 2.5, subtitleText: "先看正面版型" },
    { start: 2.5, duration: 3, subtitleText: "" },
    { start: 5.5, duration: 2, subtitleText: "近看腰头细节" }
  ] }, 7.5);
  assert.match(srt, /00:00:00,000 --> 00:00:02,500/);
  assert.match(srt, /先看正面版型/);
  assert.match(srt, /00:00:05,500 --> 00:00:07,500/);
  assert.doesNotMatch(srt, /\n2\n00:00:02,500/);
});

test("有口播时字幕使用同一份口播文本，旧字幕不会继续烧录", () => {
  const script = { voiceMode: "full_voice", blocks: [
    { id: "b1", duration: 3, voiceText: "还有人不懂西裤怎么搭？", subtitleText: "旧字幕" }
  ] };
  const srt = buildScriptSrt(script, 3, { decisions: [{ blockId: "b1", timeline: [{ materialId: "m1", duration: 3 }] }] });
  assert.match(srt, /还有人不懂西裤怎么搭？/);
  assert.doesNotMatch(srt, /旧字幕/);
  assert.equal(scriptText(script), "还有人不懂西裤怎么搭？");
});

test("质量时间线信任人工分类，不按旧可混剪字段阻止", () => {
  const material = { id: "m1", filePath: "D:\\素材\\人工确认.mp4", duration: 4, eligibleForMix: false, productIdentity: { status: "unknown" }, captionVerification: { status: "review" } };
  const result = buildPlannedTimeline({
    status: "ready",
    confirmed: true,
    decisions: [{ blockId: "b1", evidenceStatus: "direct", rewriteRequired: false, unsupportedClaims: [], timeline: [{ materialId: "m1", duration: 4 }] }]
  }, [material], 0, { qualityMode: true });
  assert.equal(result[0].materialId, "m1");
});

test("Windows 字幕滤镜路径会转为 FFmpeg 安全格式", () => {
  const escaped = escapeSubtitleFilterPath("D:\\抖音素材库\\成片字幕.srt");
  assert.match(escaped, /^D\\:\//);
  assert.doesNotMatch(escaped, /\\抖音/);
});
