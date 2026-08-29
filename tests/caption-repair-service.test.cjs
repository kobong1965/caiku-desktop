const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { bundledPythonCandidates, complementTimedRanges, inspectCaptionRepairRuntime, manualZonesFromAudit, manualZonesFromRegions, modelCandidates, parseLastJsonLine, planHighDifficultyCaptionRepair, pythonCandidates, rangeString, repairCaptionRanges } = require("../electron/services/caption-repair-service.cjs");

test("字幕修复时间段按毫秒精度传给逐帧引擎", () => {
  assert.equal(rangeString([{ start: 1.2345, end: 4.5678 }, { start: 8, duration: 2 }]), "1.234-4.568,8.000-10.000");
});

test("4fps 字幕框扩展成连续时间亮字蒙版以覆盖打字动画首尾", () => {
  const zones = manualZonesFromAudit({
    sampleFps: 4,
    samples: [{ time: 0.76, boxes: [[163, 204, 126, 49]] }]
  }, [{ start: 0, end: 4.88 }], { width: 1080, height: 1920 });
  assert.equal(zones.length, 1);
  assert.ok(zones[0].start < 0.5);
  assert.ok(zones[0].end > 1);
  assert.equal(zones[0].mode, "bright");
  assert.ok(zones[0].x0 < 163 / 540);
  assert.ok(zones[0].y0 < 204 / 960);
});

test("千问复检发现漏字幕时生成覆盖整段的二次亮字蒙版", () => {
  const zones = manualZonesFromRegions([
    { x: 0.25, y: 0.85, width: 0.5, height: 0.08, confidence: 0.98 }
  ], 4.267);
  assert.equal(zones.length, 1);
  assert.equal(zones[0].start, 0);
  assert.equal(zones[0].end, 4.267);
  assert.equal(zones[0].mode, "outlined");
  assert.ok(zones[0].y0 <= 0.73);
  assert.equal(zones[0].y1, 1);
});

test("优先使用用户设置或裁库专用 Python", () => {
  const candidates = pythonCandidates({ pythonPath: "D:/caption/python.exe" });
  assert.equal(candidates[0].command, "D:/caption/python.exe");
  assert.ok(candidates.some((item) => item.command === "python"));
});

test("打包后优先使用安装包内置字幕修复运行时", () => {
  const resourcesPath = "C:/Users/demo/AppData/Local/Programs/caiku-desktop/resources";
  const bundled = bundledPythonCandidates({ resourcesPath });
  assert.equal(bundled[0].replaceAll("\\", "/"), "C:/Users/demo/AppData/Local/Programs/caiku-desktop/resources/caption-runtime/python.exe");
  const candidates = pythonCandidates({}, { resourcesPath });
  assert.equal(candidates[0].command.replaceAll("\\", "/"), bundled[0].replaceAll("\\", "/"));
  assert.equal(candidates[1].command.replaceAll("\\", "/"), "C:/Users/demo/AppData/Local/Programs/caiku-desktop/resources/caption-runtime/Scripts/python.exe");
});

test("坏 Python 不会阻止后续内置字幕修复运行时被选中", async () => {
  const resourcesPath = "C:/Programs/caiku/resources";
  const calls = [];
  const result = await inspectCaptionRepairRuntime({}, {
    resourcesPath,
    runProcessImpl: async (command) => {
      calls.push(command);
      if (command.replaceAll("\\", "/").endsWith("/caption-runtime/python.exe")) {
        return { stdout: "{\"python\":true,\"opencv\":false,\"lama\":false,\"torch\":false,\"opencvError\":\"No module named cv2\"}\n" };
      }
      return { stdout: "{\"python\":true,\"opencv\":true,\"lama\":true,\"torch\":true,\"cuda\":false}\n" };
    }
  });
  assert.equal(result.repairAvailable, true);
  assert.equal(result.command.replaceAll("\\", "/"), "C:/Programs/caiku/resources/caption-runtime/Scripts/python.exe");
  assert.equal(calls.length, 2);
});

test("字幕补画优先使用安装包内置 LaMa 模型", async (t) => {
  const resourcesPath = await fs.mkdtemp(path.join(os.tmpdir(), "caiku-caption-model-"));
  t.after(() => fs.rm(resourcesPath, { recursive: true, force: true }));
  await fs.mkdir(path.join(resourcesPath, "caption-models"), { recursive: true });
  await fs.writeFile(path.join(resourcesPath, "caption-models", "big-lama.pt"), "fixture");
  const expectedModel = modelCandidates("big-lama.pt", { resourcesPath })[0];
  const calls = [];
  await repairCaptionRanges("input.mp4", "output.mp4", [{ start: 0, end: 2 }], {
    repairAvailable: true,
    command: "python",
    argsPrefix: []
  }, {
    resourcesPath,
    runProcessImpl: async (command, args, options) => {
      calls.push({ command, args, env: options.env });
      return { stdout: "" };
    }
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].env.LAMA_MODEL, expectedModel);
});

test("能力探测能忽略日志并读取最后一行 JSON", () => {
  assert.deepEqual(parseLastJsonLine("loading\n{\"opencv\":true,\"lama\":true}\n"), { opencv: true, lama: true });
});

test("高难动态字幕自动升级到全尺寸字形补画并避开内部复杂转场", () => {
  const samples = [];
  for (let time = 0; time <= 5; time += 0.25) samples.push({ time, boxes: [[85, 802, 370, 56]] });
  for (let time = 5.25; time <= 6.75; time += 0.25) samples.push({ time, boxes: [[30, 400, 375, 58], [70, 515, 440, 65]] });
  for (let time = 7; time <= 16; time += 0.25) samples.push({ time, boxes: [[84, 802, 360, 56]] });
  for (let time = 16; time <= 17.75; time += 0.25) samples.push({ time, boxes: [[17, 576, 380, 56]] });
  const plan = planHighDifficultyCaptionRepair({
    sampleFps: 4,
    checkedFrames: samples.length,
    positiveFrames: samples.length,
    positiveRatio: 1,
    samples
  }, { width: 2160, height: 3840, duration: 17.817 });
  assert.equal(plan.level, "high");
  assert.equal(plan.analysisWidth, 1080);
  assert.equal(plan.manualOnly, true);
  assert.deepEqual(plan.excludedRanges, [{ start: 5.05, end: 7 }]);
  assert.deepEqual(plan.keepRanges, [
    { start: 0, end: 5.05, duration: 5.05 },
    { start: 7, end: 17.817, duration: 10.817 }
  ]);
  assert.ok(plan.manualZones.length >= 3);
});

test("被剔除区间的前后保留素材不会低于 2 秒", () => {
  assert.deepEqual(complementTimedRanges(10, [{ start: 1, end: 3 }, { start: 7, end: 8.5 }], 2), [
    { start: 3, end: 7, duration: 4 }
  ]);
});
