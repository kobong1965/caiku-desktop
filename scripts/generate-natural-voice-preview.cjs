const { app, safeStorage } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { synthesizeQwenVoice } = require("../electron/services/qwen-tts-service.cjs");

const USER_DATA_PATH = path.join(process.env.APPDATA || app.getPath("appData"), "caiku-desktop");
app.setPath("userData", USER_DATA_PATH);

const PREVIEW_TEXT = "这条西裤我最近是真挺爱穿的，先给你们看上身。腰头的双褶做得很利落，正面看不会显得拖沓。裤腿是宽松直筒的，站着和转身都能看清轮廓。黑色搭针织或者短袖都顺眼，通勤日常穿也不费劲。喜欢这种干净利落的感觉，可以点商品卡再看看尺码。";

async function main() {
  const statePath = path.join(USER_DATA_PATH, "caiku-state.json");
  const state = JSON.parse(await fs.readFile(statePath, "utf8"));
  const encrypted = state?.providerSecrets?.qwen;
  if (!encrypted || !safeStorage.isEncryptionAvailable()) throw new Error("未找到可用的千问安全密钥");
  const apiKey = safeStorage.decryptString(Buffer.from(encrypted, "base64"));
  const outputPath = path.resolve(process.argv[2] || path.join(process.cwd(), "analysis", "918-v3-natural-seeding-preview.wav"));
  const result = await synthesizeQwenVoice(PREVIEW_TEXT, outputPath, { apiKey, presetName: "自然女声" });
  process.stdout.write(`${JSON.stringify({ ...result, instructions: undefined })}\n`);
}

app.whenReady().then(main).then(() => app.quit()).catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  app.exit(1);
});
