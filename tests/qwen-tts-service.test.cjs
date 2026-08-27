const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs/promises");
const { QWEN_TTS_MODEL, resolveVoicePresetName, synthesizeQwenVoice, voicePreset } = require("../electron/services/qwen-tts-service.cjs");

test("种草配音使用 Qwen 指令模型并明确排除播音腔", async () => {
  let body;
  const fetchImpl = async (url, options = {}) => {
    if (String(url).startsWith("https://audio.example/")) {
      return { ok: true, arrayBuffer: async () => new Uint8Array(2048).buffer };
    }
    body = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({ status_code: 200, request_id: "req-1", output: { audio: { url: "https://audio.example/voice.wav" } } })
    };
  };
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "caiku-tts-"));
  const outputPath = path.join(directory, "voice.wav");
  const result = await synthesizeQwenVoice("这条西裤先看上身。", outputPath, { apiKey: "test-key", fetchImpl, duration: 29 });
  assert.equal(body.model, QWEN_TTS_MODEL);
  assert.equal(body.input.language_type, "Chinese");
  assert.equal(body.input.optimize_instructions, true);
  assert.match(body.input.instructions, /种草感/);
  assert.match(body.input.instructions, /不要播音腔/);
  assert.match(body.input.instructions, /目标时长约29秒/);
  assert.equal(result.provider, "qwen");
  assert.equal((await fs.stat(outputPath)).size, 2048);
});

test("未配置千问密钥时不会退回机械系统配音", async () => {
  await assert.rejects(
    synthesizeQwenVoice("测试", "D:\\voice.wav", {}),
    (error) => error.code === "QWEN_TTS_KEY_REQUIRED"
  );
  assert.match(voicePreset("自然女声").instructions, /机械匀速/);
});

test("真人短种草在60秒以上自动切换真人深测评", () => {
  assert.equal(resolveVoicePresetName("真人短种草", 35), "真人短种草");
  assert.equal(resolveVoicePresetName("真人短种草", 60), "真人深测评");
  assert.match(voicePreset("真人短种草").instructions, /先观察再下结论/);
  assert.match(voicePreset("真人深测评").instructions, /中性观察/);
});

test("提供中性知性率性和设计师三种辨识度音色", () => {
  assert.equal(voicePreset("中性测评·四月").voice, "Maia");
  assert.equal(voicePreset("率性变音·月白").voice, "Moon");
  assert.equal(voicePreset("设计师变音·不吃鱼").voice, "Nofish");
  assert.match(voicePreset("中性测评·四月").instructions, /中性/);
  assert.match(voicePreset("率性变音·月白").instructions, /辨识度/);
  assert.match(voicePreset("设计师变音·不吃鱼").instructions, /短视频/);
});
