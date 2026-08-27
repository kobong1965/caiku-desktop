const test = require("node:test");
const assert = require("node:assert/strict");
const { buildCaptionRegionFilters, buildSegmentExportArgs, chooseCaptionSafeCrop, mergeShortSegments, splitLongSegments, MAXIMUM_CLIP_SECONDS, MINIMUM_CLIP_SECONDS } = require("../electron/services/video-engine.cjs");

test("服装素材默认按 2 到 6 秒形成可复用镜头", () => {
  assert.equal(MINIMUM_CLIP_SECONDS, 2);
  assert.equal(MAXIMUM_CLIP_SECONDS, 6);
  assert.ok(splitLongSegments([{ start: 0, end: 19.2 }]).every((segment) => segment.end - segment.start <= 6));
});

test("低于 2 秒的相邻镜头会被合并", () => {
  const result = mergeShortSegments([
    { start: 0, end: 0.8 },
    { start: 0.8, end: 2.4 },
    { start: 2.4, end: 6.2 },
    { start: 6.2, end: 7.1 },
    { start: 7.1, end: 10 }
  ]);
  assert.ok(result.length < 5);
  assert.ok(result.every((segment) => segment.duration >= MINIMUM_CLIP_SECONDS));
  assert.equal(result[0].start, 0);
  assert.equal(result.at(-1).end, 10);
});

test("长镜头拆分后仍能通过 2 秒门槛", () => {
  const split = splitLongSegments([{ start: 0, end: 25 }], 9);
  const result = mergeShortSegments(split, 2);
  assert.equal(result.length, 3);
  assert.ok(result.every((segment) => segment.duration >= 2 && segment.duration <= 9));
});

test("分类片段输出静音轨而不是原视频声音", () => {
  const args = buildSegmentExportArgs("input.mp4", "output.mp4", { start: 1, duration: 3 }, { captionMode: "keep" });
  assert.ok(args.includes("anullsrc=r=48000:cl=stereo"));
  assert.ok(args.includes("1:a:0"));
  assert.ok(!args.includes("0:a:0?"));
});

test("硬字幕严格模式保留完整构图且禁止裁切放大和拉丝滤镜", () => {
  const filters = buildCaptionRegionFilters([
    { x: 0.1, y: 0.08, width: 0.7, height: 0.06, confidence: 0.95 },
    { x: 0.05, y: 0.3, width: 0.9, height: 0.4, confidence: 0.99 }
  ]);
  assert.equal(filters.length, 1);
  assert.match(filters[0], /^delogo=x=\d+:y=\d+:w=\d+:h=\d+:show=0$/);
  const args = buildSegmentExportArgs("input.mp4", "output.mp4", { start: 0, duration: 4 }, {
    captionMode: "smart_mask",
    captionMaskPath: "D:/mask.pgm",
    captionRegions: [{ x: 0.1, y: 0.08, width: 0.7, height: 0.06, confidence: 0.95 }]
  });
  const filter = args[args.indexOf("-vf") + 1];
  assert.match(filter, /force_original_aspect_ratio=decrease/);
  assert.match(filter, /pad=1080:1920/);
  assert.doesNotMatch(filter, /delogo=|removelogo/);
  assert.doesNotMatch(filter, /force_original_aspect_ratio=increase|crop=/);
  const crop = chooseCaptionSafeCrop([{ x: 0.1, y: 0.08, width: 0.7, height: 0.06, confidence: 0.95 }]);
  assert.equal(crop.width / crop.height, 1080 / 1920);
});
