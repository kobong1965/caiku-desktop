const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

function executableCandidates(name) {
  const fileName = process.platform === "win32" ? `${name}.exe` : name;
  const candidates = [];
  if (process.resourcesPath) candidates.push(path.join(process.resourcesPath, "bin", fileName));
  candidates.push(path.resolve(__dirname, "..", "..", "vendor", "ffmpeg", fileName));
  candidates.push(fileName);
  return candidates;
}

function resolveExecutable(name) {
  const candidates = executableCandidates(name);
  return candidates.find((candidate) => path.isAbsolute(candidate) && fs.existsSync(candidate)) || candidates.at(-1);
}

function runProcess(command, args, options = {}) {
  const { cwd, signal, onStderr, onStdout, env, maxBuffer = 20 * 1024 * 1024 } = options;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const abort = () => {
      if (!child.killed) child.kill("SIGTERM");
    };
    signal?.addEventListener("abort", abort, { once: true });

    child.stdout.on("data", (chunk) => {
      const value = chunk.toString();
      stdout = (stdout + value).slice(-maxBuffer);
      onStdout?.(value);
    });
    child.stderr.on("data", (chunk) => {
      const value = chunk.toString();
      stderr = (stderr + value).slice(-maxBuffer);
      onStderr?.(value);
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      reject(Object.assign(error, { command, args, stderr }));
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      if (signal?.aborted) {
        reject(Object.assign(new Error("任务已取消"), { code: "TASK_CANCELLED" }));
      } else if (code === 0) {
        resolve({ stdout, stderr, code });
      } else {
        reject(Object.assign(new Error(`${path.basename(command)} 执行失败，退出码 ${code}`), { code, command, args, stdout, stderr }));
      }
    });
  });
}

function runFfmpeg(args, options) {
  return runProcess(resolveExecutable("ffmpeg"), ["-hide_banner", "-nostdin", ...args], options);
}

function runFfprobe(args, options) {
  return runProcess(resolveExecutable("ffprobe"), ["-v", "error", ...args], options);
}

async function inspectCapabilities() {
  const result = { ffmpeg: false, ffprobe: false, ffmpegPath: resolveExecutable("ffmpeg"), ffprobePath: resolveExecutable("ffprobe") };
  try {
    const version = await runFfmpeg(["-version"]);
    result.ffmpeg = true;
    result.ffmpegVersion = version.stdout.split(/\r?\n/)[0] || version.stderr.split(/\r?\n/)[0];
  } catch (error) {
    result.ffmpegError = error.message;
  }
  try {
    await runFfprobe(["-version"]);
    result.ffprobe = true;
  } catch (error) {
    result.ffprobeError = error.message;
  }
  return result;
}

module.exports = { inspectCapabilities, resolveExecutable, runFfmpeg, runFfprobe, runProcess };
