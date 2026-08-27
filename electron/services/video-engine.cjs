const fs = require("node:fs/promises");
const path = require("node:path");
const { runFfmpeg, runFfprobe } = require("./process-runner.cjs");

const MINIMUM_CLIP_SECONDS = 2;
const MAXIMUM_CLIP_SECONDS = 6;

async function probeVideo(filePath) {
  const { stdout } = await runFfprobe([
    "-show_entries", "format=duration,size,bit_rate:stream=index,codec_type,codec_name,width,height,r_frame_rate,sample_rate,channels",
    "-of", "json",
    filePath
  ]);
  const data = JSON.parse(stdout);
  const video = data.streams?.find((stream) => stream.codec_type === "video");
  const audio = data.streams?.find((stream) => stream.codec_type === "audio");
  if (!video) throw Object.assign(new Error("文件中没有可读取的视频轨道"), { code: "NO_VIDEO_STREAM" });
  return {
    filePath,
    fileName: path.basename(filePath),
    duration: Number(data.format?.duration || 0),
    size: Number(data.format?.size || 0),
    bitRate: Number(data.format?.bit_rate || 0),
    width: Number(video.width || 0),
    height: Number(video.height || 0),
    frameRate: video.r_frame_rate || "0/1",
    videoCodec: video.codec_name || "unknown",
    hasAudio: Boolean(audio),
    audioCodec: audio?.codec_name || null,
    sampleRate: Number(audio?.sample_rate || 0),
    channels: Number(audio?.channels || 0)
  };
}

function splitLongSegments(segments, maximumSeconds = MAXIMUM_CLIP_SECONDS) {
  const result = [];
  for (const segment of segments) {
    const duration = segment.end - segment.start;
    if (duration <= maximumSeconds) {
      result.push({ ...segment });
      continue;
    }
    const parts = Math.ceil(duration / maximumSeconds);
    const partDuration = duration / parts;
    for (let index = 0; index < parts; index += 1) {
      result.push({ start: segment.start + index * partDuration, end: index === parts - 1 ? segment.end : segment.start + (index + 1) * partDuration });
    }
  }
  return result;
}

function mergeShortSegments(inputSegments, minimumSeconds = MINIMUM_CLIP_SECONDS) {
  const segments = inputSegments
    .map((segment) => ({ start: Number(segment.start), end: Number(segment.end) }))
    .filter((segment) => Number.isFinite(segment.start) && Number.isFinite(segment.end) && segment.end > segment.start)
    .sort((a, b) => a.start - b.start);
  if (!segments.length) return [];

  let index = 0;
  while (index < segments.length) {
    const duration = segments[index].end - segments[index].start;
    if (duration + 0.001 >= minimumSeconds) {
      index += 1;
      continue;
    }
    if (segments.length === 1) break;
    if (index === 0) {
      segments[1].start = segments[0].start;
      segments.splice(0, 1);
    } else {
      segments[index - 1].end = segments[index].end;
      segments.splice(index, 1);
      index = Math.max(0, index - 1);
    }
  }
  return segments.map((segment) => ({
    start: Number(segment.start.toFixed(3)),
    end: Number(segment.end.toFixed(3)),
    duration: Number((segment.end - segment.start).toFixed(3))
  }));
}

async function detectScenes(filePath, duration, options = {}) {
  const threshold = Number(options.threshold || 0.32);
  let stderr = "";
  await runFfmpeg([
    "-i", filePath,
    "-filter:v", `select=gt(scene\\,${threshold}),showinfo`,
    "-an", "-f", "null", "-"
  ], { signal: options.signal, onStderr: (chunk) => { stderr += chunk; } });
  const boundaries = [0];
  const pattern = /pts_time:([0-9.]+)/g;
  for (const match of stderr.matchAll(pattern)) {
    const value = Number(match[1]);
    if (value > 0.15 && value < duration - 0.15) boundaries.push(value);
  }
  boundaries.push(duration);
  const unique = [...new Set(boundaries.map((value) => Number(value.toFixed(3))))].sort((a, b) => a - b);
  const raw = unique.slice(0, -1).map((start, index) => ({ start, end: unique[index + 1] }));
  return mergeShortSegments(splitLongSegments(raw, options.maximumSeconds || MAXIMUM_CLIP_SECONDS), options.minimumSeconds || MINIMUM_CLIP_SECONDS);
}

const CLASSIFICATIONS = [
  { type: "outfit", label: "人物穿搭", folder: "01_人物穿搭" },
  { type: "overall", label: "整体展示", folder: "02_整体展示" },
  { type: "detail", label: "细节讲解", folder: "03_细节讲解" },
  { type: "review", label: "测评对比", folder: "04_测评对比" },
  { type: "action", label: "动作展示", folder: "05_动作展示" },
  { type: "speech", label: "口播", folder: "06_口播" },
  { type: "upper_related", label: "上衣相关", folder: "91_上衣相关" },
  { type: "other", label: "其他", folder: "90_其他" }
];

function classifySegment(segment, index, total) {
  const position = total <= 1 ? 0.5 : index / (total - 1);
  let type;
  if (segment.duration <= 3.15) type = "detail";
  else if (position < 0.22) type = "overall";
  else if (position > 0.78) type = "review";
  else if (index % 5 === 0) type = "action";
  else if (index % 4 === 0) type = "speech";
  else type = "outfit";
  return CLASSIFICATIONS.find((item) => item.type === type);
}

function escapeFilterPath(filePath) {
  return String(filePath).replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

function buildCaptionRegionFilters(regions = [], width = 1080, height = 1920) {
  return (Array.isArray(regions) ? regions : []).slice(0, 12).map((region) => {
    const x = Number(region?.x);
    const y = Number(region?.y);
    const regionWidth = Number(region?.width);
    const regionHeight = Number(region?.height);
    const confidence = Number(region?.confidence);
    if (![x, y, regionWidth, regionHeight].every(Number.isFinite) || regionWidth <= 0 || regionHeight <= 0) return null;
    if (Number.isFinite(confidence) && confidence < 0.45) return null;
    if (regionWidth * regionHeight > 0.16) return null;
    const paddingX = 0.018;
    const paddingY = 0.012;
    const left = Math.max(0, Math.floor((x - paddingX) * width));
    const top = Math.max(0, Math.floor((y - paddingY) * height));
    const right = Math.min(width, Math.ceil((x + regionWidth + paddingX) * width));
    const bottom = Math.min(height, Math.ceil((y + regionHeight + paddingY) * height));
    const boxWidth = Math.max(16, right - left);
    const boxHeight = Math.max(16, bottom - top);
    if (left + boxWidth > width || top + boxHeight > height) return null;
    return `delogo=x=${left}:y=${top}:w=${boxWidth}:h=${boxHeight}:show=0`;
  }).filter(Boolean);
}

function chooseCaptionSafeCrop(regions = [], width = 1080, height = 1920) {
  const boxes = (Array.isArray(regions) ? regions : []).map((region) => ({
    x: Number(region?.x),
    y: Number(region?.y),
    width: Number(region?.width),
    height: Number(region?.height),
    confidence: Number(region?.confidence)
  })).filter((region) => [region.x, region.y, region.width, region.height].every(Number.isFinite)
    && region.width > 0 && region.height > 0
    && (!Number.isFinite(region.confidence) || region.confidence >= 0.45));
  const candidates = [
    { x: 0.1, y: 0.15, scale: 0.8 },
    { x: 1 / 6, y: 0.25, scale: 2 / 3 },
    { x: 2 / 9, y: 0.26, scale: 5 / 9 },
    { x: 0.239, y: 0.06, scale: 0.521 },
    { x: 0.239, y: 0.42, scale: 0.521 },
    { x: 0.3, y: 0.28, scale: 0.4 }
  ];
  const overlapArea = (crop, box) => {
    const overlapWidth = Math.max(0, Math.min(crop.x + crop.scale, box.x + box.width) - Math.max(crop.x, box.x));
    const overlapHeight = Math.max(0, Math.min(crop.y + crop.scale, box.y + box.height) - Math.max(crop.y, box.y));
    return overlapWidth * overlapHeight;
  };
  const ranked = candidates.map((candidate) => ({
    ...candidate,
    overlap: boxes.reduce((sum, box) => sum + overlapArea(candidate, box), 0)
  })).sort((left, right) => left.overlap - right.overlap || right.scale - left.scale);
  const selected = ranked[0];
  const cropWidth = Math.max(2, Math.floor((width * selected.scale) / 2) * 2);
  const cropHeight = Math.max(2, Math.floor((height * selected.scale) / 2) * 2);
  const cropX = Math.max(0, Math.min(width - cropWidth, Math.floor((width * selected.x) / 2) * 2));
  const cropY = Math.max(0, Math.min(height - cropHeight, Math.floor((height * selected.y) / 2) * 2));
  return { x: cropX, y: cropY, width: cropWidth, height: cropHeight, overlap: Number(selected.overlap.toFixed(4)) };
}

function createVideoFilter(captionMode = "blur_band", captionMaskPath = null, captionRegions = []) {
  const normalize = "scale='min(1080,iw)':'min(1920,ih)':force_original_aspect_ratio=decrease:flags=lanczos,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=30,format=yuv420p";
  if (captionMode === "keep") return { filter: normalize, map: "0:v:0" };
  if (captionMode === "smart_mask") {
    return { filter: normalize, map: "0:v:0" };
  }
  if (captionMode === "crop_reframe") return { filter: normalize, map: "0:v:0" };
  return { filter: normalize, map: "0:v:0" };
}

function buildSegmentExportArgs(inputPath, outputPath, segment, options = {}) {
  const videoFilter = createVideoFilter(options.captionMode || "blur_band", options.captionMaskPath, options.captionRegions);
  const args = ["-y", "-ss", segment.start.toFixed(3), "-i", inputPath, "-t", segment.duration.toFixed(3)];
  args.push("-f", "lavfi", "-t", segment.duration.toFixed(3), "-i", "anullsrc=r=48000:cl=stereo");
  if (videoFilter.complex) args.push("-filter_complex", videoFilter.complex);
  else args.push("-vf", videoFilter.filter);
  args.push("-map", videoFilter.map, "-map", "1:a:0");
  args.push(
    "-c:v", "libx264", "-preset", options.preset || "veryfast", "-crf", String(options.crf || 20),
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
    "-movflags", "+faststart", "-shortest", outputPath
  );
  return args;
}

async function exportSegment(inputPath, outputPath, segment, _sourceInfo, options = {}) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const args = buildSegmentExportArgs(inputPath, outputPath, segment, options);
  let stderr = "";
  await runFfmpeg(args, {
    signal: options.signal,
    onStderr: (chunk) => {
      stderr += chunk;
      const matches = [...stderr.matchAll(/time=(\d+):(\d+):([\d.]+)/g)];
      const last = matches.at(-1);
      if (last) {
        const seconds = Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3]);
        options.onProgress?.(Math.min(1, seconds / segment.duration));
      }
      if (stderr.length > 12000) stderr = stderr.slice(-6000);
    }
  });
  return probeVideo(outputPath);
}

async function generateThumbnail(videoPath, outputPath, atSeconds = 0.5) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await runFfmpeg(["-y", "-ss", String(Math.max(0, atSeconds)), "-i", videoPath, "-frames:v", "1", "-vf", "scale=360:-2", "-q:v", "3", outputPath]);
  return outputPath;
}

async function generateAnalysisFrames(videoPath, outputDirectory, segment, count = 4, options = {}) {
  const frameCount = Math.max(3, Math.min(8, Math.round(Number(count || 4))));
  await fs.mkdir(outputDirectory, { recursive: true });
  const duration = Math.max(0.1, Number(segment.duration || (segment.end - segment.start)));
  const outputPattern = path.join(outputDirectory, "frame-%02d.jpg");
  await runFfmpeg([
    "-y",
    "-ss", Number(segment.start || 0).toFixed(3),
    "-i", videoPath,
    "-t", duration.toFixed(3),
    "-vf", `fps=${(frameCount / duration).toFixed(6)},scale=640:-2:flags=lanczos`,
    "-frames:v", String(frameCount),
    "-q:v", "3",
    outputPattern
  ], { signal: options.signal });
  const files = (await fs.readdir(outputDirectory))
    .filter((name) => /^frame-\d+\.jpg$/i.test(name))
    .sort()
    .map((name) => path.join(outputDirectory, name));
  if (files.length < 2) {
    const error = new Error("无法为视觉模型提取足够的视频帧");
    error.code = "AI_FRAME_EXTRACTION_FAILED";
    throw error;
  }
  return files;
}

module.exports = {
  CLASSIFICATIONS,
  MAXIMUM_CLIP_SECONDS,
  MINIMUM_CLIP_SECONDS,
  classifySegment,
  buildSegmentExportArgs,
  buildCaptionRegionFilters,
  chooseCaptionSafeCrop,
  detectScenes,
  exportSegment,
  generateAnalysisFrames,
  generateThumbnail,
  mergeShortSegments,
  probeVideo,
  splitLongSegments
};
