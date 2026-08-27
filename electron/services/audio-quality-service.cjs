const { runFfmpeg } = require("./process-runner.cjs");

function parseAudioMetrics(stderr, duration = 0) {
  const text = String(stderr || "");
  const integratedMatches = [...text.matchAll(/\bI:\s*(-?\d+(?:\.\d+)?)\s*LUFS/g)];
  const peakMatches = [...text.matchAll(/\bPeak:\s*(-?\d+(?:\.\d+)?)\s*dBFS/g)];
  const silenceDurations = [...text.matchAll(/silence_duration:\s*(\d+(?:\.\d+)?)/g)].map((match) => Number(match[1]));
  const integratedLufs = Number(integratedMatches.at(-1)?.[1]);
  const peakDb = Number(peakMatches.at(-1)?.[1]);
  const silenceSeconds = silenceDurations.reduce((sum, value) => sum + value, 0);
  return {
    integratedLufs: Number.isFinite(integratedLufs) ? integratedLufs : null,
    peakDb: Number.isFinite(peakDb) ? peakDb : null,
    silenceSeconds: Number(silenceSeconds.toFixed(3)),
    silenceRatio: duration > 0 ? Number(Math.min(1, silenceSeconds / duration).toFixed(3)) : null
  };
}

function evaluateAudioMetrics(metrics = {}) {
  const reasons = [];
  if (!Number.isFinite(metrics.integratedLufs)) reasons.push("无法读取综合响度");
  else if (metrics.integratedLufs < -16 || metrics.integratedLufs > -12) reasons.push(`综合响度 ${metrics.integratedLufs} LUFS 不在 -16 到 -12 范围`);
  if (!Number.isFinite(metrics.peakDb)) reasons.push("无法读取峰值电平");
  else if (metrics.peakDb > -1 || metrics.peakDb < -6) reasons.push(`峰值 ${metrics.peakDb} dBFS 不在 -6 到 -1 范围`);
  if (Number.isFinite(metrics.silenceRatio) && metrics.silenceRatio > 0.35) reasons.push(`长静音占比 ${Math.round(metrics.silenceRatio * 100)}% 超过 35%`);
  return { status: reasons.length ? "blocked" : "pass", score: reasons.length ? 0 : 100, reasons, source: "ffmpeg_ebur128" };
}

async function analyzeAudioQuality(filePath, duration, options = {}) {
  const analysis = await runFfmpeg([
    "-i", filePath,
    "-map", "0:a:0",
    "-af", "silencedetect=noise=-45dB:d=1,ebur128=peak=true",
    "-f", "null",
    process.platform === "win32" ? "NUL" : "/dev/null"
  ], { signal: options.signal });
  const hashResult = await runFfmpeg(["-i", filePath, "-map", "0:a:0", "-f", "md5", "-"], { signal: options.signal });
  const metrics = parseAudioMetrics(analysis.stderr, duration);
  const audioHash = hashResult.stdout.match(/MD5=([a-f0-9]+)/i)?.[1] || "";
  return { ...evaluateAudioMetrics(metrics), ...metrics, audioHash };
}

module.exports = { analyzeAudioQuality, evaluateAudioMetrics, parseAudioMetrics };
