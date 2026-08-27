const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

function outputDirectories(batchDir) {
  return {
    candidate: path.join(batchDir, ".working", "candidates"),
    ready: path.join(batchDir, "成片", "可投放"),
    repair: path.join(batchDir, "成片", "待修复"),
    blocked: path.join(batchDir, "成片", "已阻断")
  };
}

function destinationKey(status) {
  if (status === "ready_100") return "ready";
  // 进入本服务的视频已成功渲染；低分、风险词或证据不足都作为待修复候选片保留。
  // 缺文件、时间越界、FFmpeg 失败等无法渲染的技术错误会在上游抛错，不会产生伪成片。
  return "repair";
}

async function uniqueTarget(filePath) {
  const extension = path.extname(filePath);
  const base = filePath.slice(0, -extension.length);
  let candidate = filePath;
  for (let index = 2; ; index += 1) {
    try {
      await fs.access(candidate);
      candidate = `${base}_${index}${extension}`;
    } catch {
      return candidate;
    }
  }
}

async function writeJsonAtomic(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(temporary, filePath);
}

async function finalizeCandidateOutput(output, report, batchDir) {
  const directories = outputDirectories(batchDir);
  await Promise.all(Object.values(directories).map((directory) => fs.mkdir(directory, { recursive: true })));
  const destination = destinationKey(report.status);
  const targetDirectory = directories[destination];
  const targetPath = await uniqueTarget(path.join(targetDirectory, path.basename(output.filePath)));
  const finalReport = {
    ...report,
    outputPath: targetPath,
    destination,
    publishReady: report.status === "ready_100",
    generatedAsDraft: report.status !== "ready_100",
    generationPolicy: "generate_then_repair"
  };
  await writeJsonAtomic(output.reportPath, finalReport);
  await fs.rename(output.filePath, targetPath);
  let thumbnailPath = output.thumbnailPath;
  if (thumbnailPath) {
    try {
      const targetThumbnail = await uniqueTarget(path.join(targetDirectory, path.basename(thumbnailPath)));
      await fs.rename(thumbnailPath, targetThumbnail);
      thumbnailPath = targetThumbnail;
    } catch { /* thumbnail is optional */ }
  }
  return {
    ...output,
    filePath: targetPath,
    fileUrl: pathToFileURL(targetPath).href,
    thumbnailPath,
    image: thumbnailPath ? pathToFileURL(thumbnailPath).href : output.image,
    report: finalReport,
    status: finalReport.status,
    score: finalReport.totalScore,
    publishReady: finalReport.publishReady,
    destination
  };
}

module.exports = { destinationKey, finalizeCandidateOutput, outputDirectories, writeJsonAtomic };
