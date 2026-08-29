const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { resolveExecutable, runProcess } = require("./process-runner.cjs");

function scriptCandidates(name, options = {}) {
  const candidates = [];
  if (options.resourcesPath) candidates.push(path.join(options.resourcesPath, "pipeline", name));
  if (process.resourcesPath) candidates.push(path.join(process.resourcesPath, "pipeline", name));
  candidates.push(path.resolve(__dirname, "..", "..", "scripts", name));
  return [...new Set(candidates)];
}

function resolveScript(name, options = {}) {
  const script = scriptCandidates(name, options).find((candidate) => fsSync.existsSync(candidate));
  if (!script) throw Object.assign(new Error(`找不到字幕处理脚本：${name}`), { code: "CAPTION_SCRIPT_MISSING" });
  return script;
}

function modelCandidates(name, options = {}) {
  const candidates = [];
  if (options.resourcesPath) candidates.push(path.join(options.resourcesPath, "caption-models", name));
  if (process.resourcesPath) candidates.push(path.join(process.resourcesPath, "caption-models", name));
  candidates.push(path.resolve(__dirname, "..", "..", "vendor", "caption-models", name));
  return [...new Set(candidates)];
}

function resolveModel(name, options = {}) {
  return modelCandidates(name, options).find((candidate) => fsSync.existsSync(candidate)) || null;
}

function bundledPythonCandidates(options = {}) {
  const candidates = [];
  if (options.resourcesPath) {
    candidates.push(path.join(options.resourcesPath, "caption-runtime", "python.exe"));
    candidates.push(path.join(options.resourcesPath, "caption-runtime", "Scripts", "python.exe"));
  }
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, "caption-runtime", "python.exe"));
    candidates.push(path.join(process.resourcesPath, "caption-runtime", "Scripts", "python.exe"));
  }
  candidates.push(path.resolve(__dirname, "..", "..", "vendor", "caption-runtime-full", "python.exe"));
  candidates.push(path.resolve(__dirname, "..", "..", "vendor", "caption-runtime-full", "Scripts", "python.exe"));
  candidates.push(path.resolve(__dirname, "..", "..", "vendor", "caption-runtime", "Scripts", "python.exe"));
  candidates.push(path.resolve(__dirname, "..", "..", "vendor", "caption-runtime", "python.exe"));
  return candidates;
}

function pythonCandidates(settings = {}, options = {}) {
  const candidates = [
    settings.pythonPath,
    ...bundledPythonCandidates(options),
    process.env.CAIKU_CAPTION_PYTHON,
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Caiku", "caption-runtime", "Scripts", "python.exe"),
    path.join(os.tmpdir(), "caiku-video-cu130-env", "Scripts", "python.exe"),
    "python",
    "py"
  ].filter(Boolean);
  return [...new Set(candidates)].map((command) => ({ command, argsPrefix: command === "py" ? ["-3"] : [] }));
}

function parseLastJsonLine(value) {
  const lines = String(value || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try { return JSON.parse(lines[index]); } catch { /* continue */ }
  }
  return null;
}

async function inspectCaptionRepairRuntime(settings = {}, options = {}) {
  const run = options.runProcessImpl || runProcess;
  const code = [
    "import json",
    "result={'python':True,'opencv':False,'lama':False,'torch':False,'cuda':False}",
    "try:\n import cv2\n result['opencv']=True\n result['opencvVersion']=cv2.__version__\nexcept Exception as e: result['opencvError']=str(e)",
    "try:\n import torch\n result['torch']=True\n result['torchVersion']=torch.__version__\n result['cuda']=bool(torch.cuda.is_available())\nexcept Exception as e: result['torchError']=str(e)",
    "try:\n from simple_lama_inpainting import SimpleLama\n result['lama']=True\nexcept Exception as e: result['lamaError']=str(e)",
    "print(json.dumps(result,ensure_ascii=False))"
  ].join("\n");
  const failures = [];
  let bestCapability = null;
  for (const candidate of pythonCandidates(settings, options)) {
    try {
      const result = await run(candidate.command, [...candidate.argsPrefix, "-c", code], { signal: options.signal, maxBuffer: 1024 * 1024 });
      const capability = parseLastJsonLine(result.stdout);
      if (!capability?.python) throw new Error("Python 未返回能力信息");
      const normalized = {
        ...capability,
        command: candidate.command,
        argsPrefix: candidate.argsPrefix,
        auditAvailable: capability.opencv === true,
        repairAvailable: capability.opencv === true && capability.lama === true,
        acceleration: capability.cuda ? "cuda" : "cpu"
      };
      if (normalized.repairAvailable) return normalized;
      if (!bestCapability || (normalized.auditAvailable && !bestCapability.auditAvailable)) bestCapability = normalized;
      failures.push(`${candidate.command}: ${[normalized.opencvError, normalized.torchError, normalized.lamaError].filter(Boolean).join("；") || "字幕修复依赖不完整"}`);
    } catch (error) {
      failures.push(`${candidate.command}: ${error.message}`);
    }
  }
  if (bestCapability) {
    return {
      ...bestCapability,
      error: failures.join("；").slice(0, 2000)
    };
  }
  return {
    command: null,
    argsPrefix: [],
    auditAvailable: false,
    repairAvailable: false,
    acceleration: "unavailable",
    error: failures.join("；").slice(0, 2000)
  };
}

async function auditVideoCaptions(inputPath, runtime, options = {}) {
  if (!runtime?.auditAvailable) return { available: false, sampleFps: 4, samples: [], positiveFrames: 0, reason: runtime?.error || "OpenCV 不可用" };
  const run = options.runProcessImpl || runProcess;
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "caiku-caption-audit-"));
  const configPath = path.join(temporaryDirectory, "config.json");
  const outputPath = path.join(temporaryDirectory, "audit.json");
  const previewDirectory = path.join(temporaryDirectory, "preview");
  const sampleFps = Math.max(1, Math.min(8, Number(options.sampleFps || 4)));
  try {
    await fs.writeFile(configPath, JSON.stringify({ items: [{ id: "source", source: inputPath }] }), "utf8");
    const script = resolveScript("batch-subtitle-audit.py", options);
    const remover = resolveScript("remove-dynamic-captions.py", options);
    await run(runtime.command, [
      ...(runtime.argsPrefix || []), script,
      "--config", configPath,
      "--remover", remover,
      "--output", outputPath,
      "--preview-dir", previewDirectory,
      "--sample-fps", String(sampleFps)
    ], { signal: options.signal, onStdout: options.onLog, onStderr: options.onLog });
    const report = JSON.parse(await fs.readFile(outputPath, "utf8"));
    return { available: true, ...(report.videos?.[0] || {}), sampleFps };
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true }).catch(() => {});
  }
}

function rangeString(ranges = []) {
  return (Array.isArray(ranges) ? ranges : []).map((range) => {
    const start = Math.max(0, Number(range.start || 0));
    const end = Math.max(start, Number(range.end ?? (start + Number(range.duration || 0))));
    return `${start.toFixed(3)}-${end.toFixed(3)}`;
  }).join(",");
}

function manualZonesFromAudit(audit = {}, ranges = [], video = {}) {
  const sampleFps = Math.max(1, Number(audit.sampleFps || 4));
  const analysisWidth = 540;
  const sourceWidth = Math.max(1, Number(video.width || 1080));
  const sourceHeight = Math.max(1, Number(video.height || 1920));
  const analysisHeight = Math.max(1, Math.round(sourceHeight * analysisWidth / sourceWidth));
  const activeRanges = (Array.isArray(ranges) ? ranges : []).map((range) => ({
    start: Math.max(0, Number(range.start || 0)),
    end: Math.max(0, Number(range.end ?? (Number(range.start || 0) + Number(range.duration || 0))))
  })).filter((range) => range.end > range.start);
  const timePad = Math.max(0.35, 0.75 / sampleFps);
  const padX = Math.round(analysisWidth * 0.025);
  const padY = Math.round(analysisHeight * 0.015);
  const zones = [];
  for (const sample of Array.isArray(audit.samples) ? audit.samples : []) {
    const time = Number(sample?.time);
    if (!Number.isFinite(time)) continue;
    const range = activeRanges.find((item) => item.start <= time && time < item.end);
    if (!range) continue;
    for (const box of Array.isArray(sample.boxes) ? sample.boxes : []) {
      if (!Array.isArray(box) || box.length < 4) continue;
      const [x, y, width, height] = box.map(Number);
      if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) continue;
      zones.push({
        start: Number(Math.max(range.start, time - timePad).toFixed(3)),
        end: Number(Math.min(range.end, time + timePad).toFixed(3)),
        x0: Number((Math.max(0, x - padX) / analysisWidth).toFixed(6)),
        y0: Number((Math.max(0, y - padY) / analysisHeight).toFixed(6)),
        x1: Number((Math.min(analysisWidth, x + width + padX) / analysisWidth).toFixed(6)),
        y1: Number((Math.min(analysisHeight, y + height + padY) / analysisHeight).toFixed(6)),
        mode: "bright"
      });
    }
  }
  return zones;
}

function manualZonesFromRegions(regions = [], duration = 0) {
  const end = Math.max(0, Number(duration || 0));
  if (!end) return [];
  return (Array.isArray(regions) ? regions : []).map((region) => {
    const x = Math.max(0, Math.min(1, Number(region?.x || 0)));
    const y = Math.max(0, Math.min(1, Number(region?.y || 0)));
    const width = Math.max(0, Math.min(1 - x, Number(region?.width || 0)));
    const height = Math.max(0, Math.min(1 - y, Number(region?.height || 0)));
    if (!width || !height || Number(region?.confidence || 0) < 0.45) return null;
    return {
      start: 0,
      end: Number(end.toFixed(3)),
      x0: Number(Math.max(0, x - 0.06).toFixed(6)),
      y0: Number(Math.max(0, y - 0.12).toFixed(6)),
      x1: Number(Math.min(1, x + width + 0.06).toFixed(6)),
      y1: Number(Math.min(1, y + height + 0.12).toFixed(6)),
      mode: "outlined"
    };
  }).filter(Boolean);
}

const HIGH_DIFFICULTY_PLAN_VERSION = "caption-high-fidelity-2026.08.1";

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value || 0)));
}

function normalizedAuditSamples(audit = {}, video = {}) {
  const analysisWidth = 540;
  const sourceWidth = Math.max(1, Number(video.width || 1080));
  const sourceHeight = Math.max(1, Number(video.height || 1920));
  const analysisHeight = Math.max(1, Math.round(sourceHeight * analysisWidth / sourceWidth));
  return (Array.isArray(audit.samples) ? audit.samples : []).map((sample) => {
    const rawBoxes = Array.isArray(sample?.boxes?.[0]) ? sample.boxes : (Array.isArray(sample?.boxes) && sample.boxes.length >= 4 ? [sample.boxes] : []);
    const boxes = rawBoxes.map((box) => {
      const [x, y, width, height] = box.map(Number);
      if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
      return {
        x0: clamp01(x / analysisWidth),
        y0: clamp01(y / analysisHeight),
        x1: clamp01((x + width) / analysisWidth),
        y1: clamp01((y + height) / analysisHeight)
      };
    }).filter(Boolean);
    return { time: Number(sample?.time), boxes };
  }).filter((sample) => Number.isFinite(sample.time)).sort((left, right) => left.time - right.time);
}

function horizontalOverlap(left, right) {
  const overlap = Math.max(0, Math.min(left.x1, right.x1) - Math.max(left.x0, right.x0));
  return overlap / Math.max(0.001, Math.min(left.x1 - left.x0, right.x1 - right.x0));
}

function mergeTimedRanges(ranges = [], duration = Infinity) {
  const sorted = ranges.map((range) => ({
    start: Math.max(0, Number(range.start || 0)),
    end: Math.min(duration, Math.max(0, Number(range.end || 0)))
  })).filter((range) => range.end > range.start).sort((left, right) => left.start - right.start);
  const merged = [];
  for (const range of sorted) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end + 0.08) previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
  }
  return merged.map((range) => ({ start: Number(range.start.toFixed(3)), end: Number(range.end.toFixed(3)) }));
}

function complementTimedRanges(duration, excludedRanges = [], minimumSeconds = 2) {
  const end = Math.max(0, Number(duration || 0));
  if (!end) return [];
  const excluded = mergeTimedRanges(excludedRanges, end);
  const keep = [];
  let cursor = 0;
  for (const range of excluded) {
    if (range.start - cursor >= minimumSeconds) keep.push({ start: cursor, end: range.start });
    cursor = Math.max(cursor, range.end);
  }
  if (end - cursor >= minimumSeconds) keep.push({ start: cursor, end });
  return keep.map((range) => ({
    start: Number(range.start.toFixed(3)),
    end: Number(range.end.toFixed(3)),
    duration: Number((range.end - range.start).toFixed(3))
  }));
}

function groupBottomCaptionRuns(samples, sampleFps) {
  const maximumGap = Math.max(0.35, 1.6 / Math.max(1, sampleFps));
  const runs = [];
  for (const sample of samples) {
    const boxes = sample.boxes.filter((box) => box.y0 >= 0.72 && box.y1 - box.y0 <= 0.14 && box.x1 - box.x0 >= 0.12);
    if (!boxes.length) continue;
    const previous = runs.at(-1);
    if (!previous || sample.time - previous.last > maximumGap) {
      runs.push({ first: sample.time, last: sample.time, boxes: [...boxes] });
    } else {
      previous.last = sample.time;
      previous.boxes.push(...boxes);
    }
  }
  return runs.filter((run) => run.last - run.first >= 0.5);
}

function clusterPersistentMiddleBoxes(samples, sampleFps) {
  const maximumGap = Math.max(0.35, 1.6 / Math.max(1, sampleFps));
  const clusters = [];
  for (const sample of samples) {
    for (const box of sample.boxes.filter((item) => item.y0 >= 0.32 && item.y0 < 0.72 && item.y1 - item.y0 <= 0.14 && item.x1 - item.x0 >= 0.2)) {
      const centerY = (box.y0 + box.y1) / 2;
      const cluster = clusters.findLast((item) => sample.time - item.last <= maximumGap
        && Math.abs(centerY - item.centerY) <= 0.055
        && horizontalOverlap(box, item.lastBox) >= 0.35);
      if (cluster) {
        cluster.last = sample.time;
        cluster.lastBox = box;
        cluster.centerY = (cluster.centerY * cluster.boxes.length + centerY) / (cluster.boxes.length + 1);
        cluster.boxes.push(box);
        cluster.times.add(sample.time);
      } else {
        clusters.push({ first: sample.time, last: sample.time, lastBox: box, centerY, boxes: [box], times: new Set([sample.time]) });
      }
    }
  }
  return clusters.filter((cluster) => cluster.times.size >= 4 && cluster.last - cluster.first >= 0.7);
}

function zoneFromBoxes(boxes, start, end, padding = {}) {
  return {
    start: Number(Math.max(0, start).toFixed(3)),
    end: Number(Math.max(start, end).toFixed(3)),
    x0: Number(clamp01(Math.min(...boxes.map((box) => box.x0)) - Number(padding.x || 0.06)).toFixed(6)),
    y0: Number(clamp01(Math.min(...boxes.map((box) => box.y0)) - Number(padding.y || 0.05)).toFixed(6)),
    x1: Number(clamp01(Math.max(...boxes.map((box) => box.x1)) + Number(padding.x || 0.06)).toFixed(6)),
    y1: Number(clamp01(Math.max(...boxes.map((box) => box.y1)) + Number(padding.y || 0.04)).toFixed(6)),
    mode: "outlined"
  };
}

function planHighDifficultyCaptionRepair(audit = {}, video = {}, options = {}) {
  const duration = Math.max(0, Number(video.duration || video.durationSeconds || 0));
  const sampleFps = Math.max(1, Number(audit.sampleFps || 4));
  const samples = normalizedAuditSamples(audit, video);
  const bottomRuns = groupBottomCaptionRuns(samples, sampleFps);
  const middleClusters = clusterPersistentMiddleBoxes(samples, sampleFps);
  const maximumBoxes = samples.reduce((maximum, sample) => Math.max(maximum, sample.boxes.length), 0);
  const internalClusters = middleClusters.filter((cluster) => cluster.first >= 2
    && duration - cluster.last >= 2
    && cluster.last - cluster.first <= 2.2);
  const excludedRanges = mergeTimedRanges(internalClusters.map((cluster) => ({
    start: cluster.first - 0.2,
    end: cluster.last + 0.25
  })), duration).filter((range) => range.start >= 2 && duration - range.end >= 2);
  const bottomZones = bottomRuns.map((run) => zoneFromBoxes(run.boxes, run.first - 0.05, Math.min(duration, run.last + 0.1), { x: 0.06, y: 0.045 }));
  const tailZones = middleClusters.filter((cluster) => duration - cluster.last < 0.65)
    .map((cluster) => zoneFromBoxes(cluster.boxes, cluster.first - 0.18, duration, { x: 0.1, y: 0.055 }));
  const positiveRatio = Number(audit.positiveRatio || (Number(audit.checkedFrames || 0) ? Number(audit.positiveFrames || 0) / Number(audit.checkedFrames) : 0));
  let score = 0;
  if (positiveRatio >= 0.3) score += 20;
  if (bottomRuns.some((run) => run.last - run.first >= 2)) score += 25;
  if (middleClusters.length) score += 25;
  if (maximumBoxes >= 4) score += 15;
  if (excludedRanges.length) score += 15;
  const level = score >= Number(options.highThreshold || 70) ? "high" : score >= 40 ? "medium" : "standard";
  const manualZones = level === "high"
    ? [...bottomZones, ...tailZones]
    : manualZonesFromAudit(audit, options.ranges || [{ start: 0, end: duration }], video);
  return {
    version: HIGH_DIFFICULTY_PLAN_VERSION,
    score,
    level,
    strategy: level === "high" ? "full_frame_glyph_lama" : "standard_lama",
    analysisWidth: level === "high" ? 1080 : 540,
    manualOnly: level === "high",
    manualZones,
    excludedRanges,
    keepRanges: complementTimedRanges(duration, excludedRanges, Number(options.minimumSeconds || 2)),
    evidence: {
      positiveRatio: Number(positiveRatio.toFixed(4)),
      maximumBoxes,
      bottomRunCount: bottomRuns.length,
      persistentMiddleCount: middleClusters.length
    }
  };
}

function timedRangeOverlapSeconds(range, candidate) {
  return Math.max(0, Math.min(Number(range.end || 0), Number(candidate.end || 0)) - Math.max(Number(range.start || 0), Number(candidate.start || 0)));
}

async function repairCaptionRanges(inputPath, outputPath, ranges, runtime, options = {}) {
  if (!runtime?.repairAvailable) throw Object.assign(new Error("本机缺少 OpenCV + LaMa 字幕修复运行环境"), { code: "CAPTION_REPAIR_UNAVAILABLE" });
  const run = options.runProcessImpl || runProcess;
  const script = resolveScript("remove-dynamic-captions.py", options);
  const lamaModelPath = resolveModel("big-lama.pt", options);
  const args = [
    ...(runtime.argsPrefix || []), script,
    "--input", inputPath,
    "--output", outputPath,
    "--ffmpeg", resolveExecutable("ffmpeg"),
    "--engine", "lama",
    "--width", String(Math.max(2, Number(options.width || 1080))),
    "--fps", String(Math.max(1, Number(options.fps || 30))),
    "--analysis-width", String(Math.max(270, Number(options.analysisWidth || 540))),
    "--scan-full-frame",
    "--process-ranges", rangeString(ranges)
  ];
  let manualZonesDirectory = null;
  if (Array.isArray(options.manualZones) && options.manualZones.length) {
    manualZonesDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "caiku-caption-zones-"));
    const manualZonesPath = path.join(manualZonesDirectory, "zones.json");
    await fs.writeFile(manualZonesPath, JSON.stringify(options.manualZones), "utf8");
    args.push("--manual-zones-json", manualZonesPath);
  }
  if (Array.isArray(options.keepRanges) && options.keepRanges.length) args.push("--keep-ranges", rangeString(options.keepRanges));
  if (options.manualOnly === true) args.push("--manual-only");
  let progressBuffer = "";
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  try {
    await run(runtime.command, args, {
      signal: options.signal,
      env: lamaModelPath ? { LAMA_MODEL: lamaModelPath, PYTHONUTF8: "1" } : { PYTHONUTF8: "1" },
      onStdout: (chunk) => {
        progressBuffer = (progressBuffer + chunk).slice(-4000);
        const matches = [...progressBuffer.matchAll(/progress_frames=(\d+)\s+time=([\d.]+)s/g)];
        const last = matches.at(-1);
        if (last) options.onProgress?.({ frames: Number(last[1]), sourceSecond: Number(last[2]) });
        options.onLog?.(chunk);
      },
      onStderr: options.onLog
    });
  } finally {
    if (manualZonesDirectory) await fs.rm(manualZonesDirectory, { recursive: true, force: true }).catch(() => {});
  }
  return outputPath;
}

module.exports = {
  HIGH_DIFFICULTY_PLAN_VERSION,
  auditVideoCaptions,
  complementTimedRanges,
  inspectCaptionRepairRuntime,
  bundledPythonCandidates,
  modelCandidates,
  resolveModel,
  manualZonesFromAudit,
  manualZonesFromRegions,
  mergeTimedRanges,
  parseLastJsonLine,
  planHighDifficultyCaptionRepair,
  pythonCandidates,
  rangeString,
  repairCaptionRanges,
  resolveScript,
  scriptCandidates,
  timedRangeOverlapSeconds
};
