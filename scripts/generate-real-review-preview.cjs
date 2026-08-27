const { app, safeStorage } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { synthesizeQwenVoice } = require("../electron/services/qwen-tts-service.cjs");

const USER_DATA_PATH = path.join(process.env.APPDATA || app.getPath("appData"), "caiku-desktop");
app.setPath("userData", USER_DATA_PATH);

const PREVIEW_TEXT = [
  "买西裤最怕什么？太窄挑腿，太宽又容易没精神。",
  "这条918我先不急着夸，直接看上身。你看腰头这个双褶，正面还是挺利落的。",
  "裤腿做的是宽松直筒，站着、转身都能看清轮廓。",
  "黑色平时搭针织或者短袖都顺眼，通勤日常穿也不费劲。",
  "喜欢这种干净利落的，可以再看看尺码。"
].join(" ");

async function main() {
  const statePath = path.join(USER_DATA_PATH, "caiku-state.json");
  const state = JSON.parse(await fs.readFile(statePath, "utf8"));
  const encrypted = state?.providerSecrets?.qwen;
  if (!encrypted || !safeStorage.isEncryptionAvailable()) throw new Error("未找到可用的千问安全密钥");
  const apiKey = safeStorage.decryptString(Buffer.from(encrypted, "base64"));
  const outputPath = path.resolve(process.argv[2] || path.join(process.cwd(), "analysis", "918-real-review-short-preview.wav"));
  const result = await synthesizeQwenVoice(PREVIEW_TEXT, outputPath, {
    apiKey,
    presetName: "真人短种草",
    duration: 29
  });
  process.stdout.write(`${JSON.stringify({ ...result, instructions: undefined })}\n`);
}

app.whenReady().then(main).then(() => app.quit()).catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  app.exit(1);
});
