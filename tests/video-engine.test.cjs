const test = require("node:test");
const assert = require("node:assert/strict");
const { buildSegmentExportArgs, mergeShortSegments, splitLongSegments, MINIMUM_CLIP_SECONDS } = require("../electron/services/video-engine.cjs");

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
