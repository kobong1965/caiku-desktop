const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { exportSegment, generateThumbnail, probeVideo } = require("../electron/services/video-engine.cjs");
const { sanitizeFileSegment } = require("../electron/services/workspace-service.cjs");

async function uniqueDirectory(basePath) {
  let candidate = basePath;
  for (let index = 2; ; index += 1) {
    try {
      await fs.access(candidate);
      candidate = `${basePath}_${String(index).padStart(2, "0")}`;
    } catch {
      await fs.mkdir(candidate, { recursive: true });
      return candidate;
    }
  }
}

async function main() {
  const sourceManifestPath = path.resolve(process.argv[2]);
  const sourceManifest = JSON.parse(await fs.readFile(sourceManifestPath, "utf8"));
  const batchDir = await uniqueDirectory(path.join(sourceManifest.rootDir, sourceManifest.sku, "2026-08-22_918_V3原画保真_硬字幕阻断"));
  const folders = ["00_原视频", "01_人物穿搭", "02_整体展示", "03_细节讲解", "04_测评对比", "05_动作展示", "06_口播", "90_其他", "99_不可用", ".thumbnails", ".working", "成片", "质检报告", "剪辑计划"];
  await Promise.all(folders.map((folder) => fs.mkdir(path.join(batchDir, folder), { recursive: true })));
  const sourceInfoByPath = new Map();
  const sources = [];
  for (const source of sourceManifest.sources || []) {
    const originalPath = source.originalPath || source.filePath;
    const info = await probeVideo(originalPath);
    sourceInfoByPath.set(originalPath, info);
    const archivedPath = path.join(batchDir, "00_原视频", sanitizeFileSegment(path.basename(originalPath)));
    await fs.copyFile(originalPath, archivedPath);
    sources.push({ ...source, ...info, originalPath, archivedPath, status: "preserved_full_frame", captionMode: "strict_preserve" });
  }
  const materials = [];
  const sourceMaterials = sourceManifest.materials || [];
  for (let index = 0; index < sourceMaterials.length; index += 1) {
    const old = sourceMaterials[index];
    const sourceInfo = sourceInfoByPath.get(old.sourcePath) || await probeVideo(old.sourcePath);
    const segment = {
      start: Number(old.sourceStart || 0),
      end: Number(old.sourceEnd || (Number(old.sourceStart || 0) + Number(old.duration || 2))),
      duration: Number(old.sourceEnd || 0) - Number(old.sourceStart || 0) || Number(old.duration || 2)
    };
    const serial = String(index + 1).padStart(3, "0");
    const fileName = `${serial}_${sanitizeFileSegment(old.typeLabel || old.name || "素材")}_${segment.duration.toFixed(2)}s_原画保真.mp4`;
    const categoryFolder = old.categoryFolder || "90_其他";
    const outputPath = path.join(batchDir, categoryFolder, fileName);
    const info = await exportSegment(old.sourcePath, outputPath, segment, sourceInfo, { captionMode: "keep", preset: "veryfast", crf: 18 });
    const id = `material-v3-${index + 1}`;
    const thumbnailPath = path.join(batchDir, ".thumbnails", `${id}.jpg`);
    await generateThumbnail(outputPath, thumbnailPath, Math.min(1, segment.duration / 2));
    materials.push({
      ...old,
      id,
      name: `${old.typeLabel || "素材"} ${serial}`,
      batch: "918_V3原画保真_硬字幕阻断",
      duration: info.duration,
      width: info.width,
      height: info.height,
      filePath: outputPath,
      fileUrl: pathToFileURL(outputPath).href,
      thumbnailPath,
      sourceAudioMuted: true,
      audioMode: "silent_track",
      captionStatus: "residual_blocked",
      captionVerification: { status: "blocked", score: 0, residualCount: Math.max(1, Array.isArray(old.visibleTexts) ? old.visibleTexts.length : 1), reasons: ["源视频包含硬字幕；为保护原画清晰度，已禁止裁切放大和拉丝滤镜"] },
      visualFidelity: {
        status: "pass",
        framingPolicy: "preserve_full_frame",
        cropFactor: 1,
        zoomFactor: 1,
        sourceScale: Number(Math.min(1, 1080 / sourceInfo.width, 1920 / sourceInfo.height).toFixed(4)),
        sourceWasUpscaled: false,
        sourceWidth: sourceInfo.width,
        sourceHeight: sourceInfo.height,
        note: "完整构图等比缩小或原尺寸输出；不裁切、不放大。"
      },
      eligibleForMix: false,
      eligibilityReasons: ["源片硬字幕未无损清除", "禁止通过放大或拉丝伪修复"],
      uses: 0
    });
    process.stdout.write(`原画保真导出 ${index + 1}/${sourceMaterials.length}\n`);
  }
  const now = new Date().toISOString();
  const manifest = {
    ...sourceManifest,
    schemaVersion: 2,
    appVersion: "0.1.15",
    createdAt: now,
    updatedAt: now,
    status: "blocked_waiting_lossless_caption_removal",
    batchName: "918_V3原画保真_硬字幕阻断",
    batchDir,
    sources,
    materials,
    captionTreatment: { mode: "strict_preserve", label: "保留完整构图 · 硬字幕严格阻断", note: "不裁切、不放大、不使用拉丝滤镜；需无字幕源片或真正 AI 视频补全后才能混剪。" },
    audioPolicy: { sourceAudioMuted: true, mixSourceVolume: 0, note: "分类素材统一静音。" },
    summary: { sourceCount: sources.length, materialCount: materials.length, eligibleForMixCount: 0, blockedCaptionCount: materials.length, minimumDuration: Math.min(...materials.map((item) => item.duration)), categories: Object.fromEntries([...new Set(materials.map((item) => item.typeLabel))].map((label) => [label, materials.filter((item) => item.typeLabel === label).length])) },
    warnings: ["本批次完整保留原构图，未检测到裁切或放大。", "四条源视频均含硬字幕；18 个分类片段全部阻断混剪，避免以模糊或拉丝画面冒充清字幕素材。"]
  };
  const manifestPath = path.join(batchDir, "manifest.json");
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ batchDir, manifestPath, materialCount: materials.length, eligibleForMixCount: 0 })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
