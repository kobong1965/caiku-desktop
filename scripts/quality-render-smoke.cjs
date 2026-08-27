const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { mixBatch } = require("../electron/services/mix-engine.cjs");
const { runFfmpeg } = require("../electron/services/process-runner.cjs");
const { probeVideo } = require("../electron/services/video-engine.cjs");

async function makeVideo(filePath, color, frequency) {
  await runFfmpeg([
    "-y",
    "-f", "lavfi", "-i", `color=c=${color}:s=1080x1920:r=30:d=3`,
    "-f", "lavfi", "-i", `sine=frequency=${frequency}:sample_rate=48000:duration=3`,
    "-shortest", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-ar", "48000", filePath
  ]);
}

async function main() {
  const smokeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "caiku-quality-smoke-"));
  try {
    const batchDir = path.join(smokeRoot, "918", "2026-08-22_smoke");
    const firstPath = path.join(smokeRoot, "first.mp4");
    const secondPath = path.join(smokeRoot, "second.mp4");
    const musicPath = path.join(smokeRoot, "music.wav");
    await Promise.all([
      makeVideo(firstPath, "0x202020", 440),
      makeVideo(secondPath, "0x5b5b5b", 660),
      runFfmpeg(["-y", "-f", "lavfi", "-i", "sine=frequency=330:sample_rate=48000:duration=8", "-c:a", "pcm_s16le", musicPath])
    ]);
    const eligible = {
      duration: 3,
      eligibleForMix: true,
      productIdentity: { status: "matched" },
      captionVerification: { status: "pass" },
      evidence: [{ claim: "目标商品", status: "direct" }]
    };
    const materials = [
      { ...eligible, id: "m1", name: "正面上身", filePath: firstPath, type: "outfit", typeLabel: "人物穿搭" },
      { ...eligible, id: "m2", name: "面料细节", filePath: secondPath, type: "detail", typeLabel: "细节讲解" }
    ];
    const script = {
      id: "smoke-script",
      name: "918 质量链路小样",
      duration: 6,
      voiceMode: "music_only",
      blocks: [
        { id: "b1", name: "版型", start: 0, duration: 3, subtitleText: "先看正面版型", category: "人物穿搭" },
        { id: "b2", name: "细节", start: 3, duration: 3, subtitleText: "再看面料细节", category: "细节讲解" }
      ]
    };
    const editingPlan = {
      id: "smoke-plan",
      status: "ready",
      confirmed: true,
      scriptId: script.id,
      inputMaterialIds: ["m1", "m2"],
      decisions: [
        { blockId: "b1", blockName: "版型", duration: 3, evidenceStatus: "direct", selectedMaterialIds: ["m1"], unsupportedClaims: [], rewriteRequired: false, timeline: [{ materialId: "m1", sourceStart: 0, duration: 3 }] },
        { blockId: "b2", blockName: "细节", duration: 3, evidenceStatus: "direct", selectedMaterialIds: ["m2"], unsupportedClaims: [], rewriteRequired: false, timeline: [{ materialId: "m2", sourceStart: 0, duration: 3 }] }
      ]
    };
    const result = await mixBatch({
      batchDir,
      projectName: "918_质量小样",
      outputCount: 1,
      qualityMode: true,
      materials,
      script,
      editingPlan,
      musicPath
    });
    const output = result.outputs[0];
    const info = await probeVideo(output.filePath);
    assert.equal(info.width, 1080);
    assert.equal(info.height, 1920);
    assert.equal(info.videoCodec, "h264");
    assert.equal(info.audioCodec, "aac");
    assert.equal(info.sampleRate, 48000);
    assert.equal(output.report.voice.sourceAudioMuted, true);
    assert.equal(output.report.subtitles.status, "burned");
    assert.equal(output.report.variantSimilarity.status, "pass");
    process.stdout.write(`${JSON.stringify({ ok: true, technical: output.report.technical, subtitles: output.report.subtitles, diversity: output.report.variantSimilarity.status }, null, 2)}\n`);
  } finally {
    const resolved = path.resolve(smokeRoot);
    if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith("caiku-quality-smoke-")) {
      await fs.rm(resolved, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  console.error(error.stderr || error);
  process.exitCode = 1;
});

