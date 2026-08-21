const fs = require("node:fs/promises");
const path = require("node:path");
const { PNG } = require("pngjs");
const { runFfmpeg } = require("./process-runner.cjs");

function normalizeZones(zones) {
  const source = Array.isArray(zones) && zones.length ? zones : [
    { x: 0, y: 0, width: 1, height: 0.28 },
    { x: 0, y: 0.66, width: 1, height: 0.34 }
  ];
  return source.map((zone) => ({
    x: Math.max(0, Math.min(1, Number(zone.x || 0))),
    y: Math.max(0, Math.min(1, Number(zone.y || 0))),
    width: Math.max(0, Math.min(1, Number(zone.width ?? zone.w ?? 1))),
    height: Math.max(0, Math.min(1, Number(zone.height ?? zone.h ?? 1))),
    fill: zone.fill === true
  }));
}

function pixelInZones(x, y, width, height, zones) {
  const normalizedX = x / width;
  const normalizedY = y / height;
  return zones.some((zone) => normalizedX >= zone.x && normalizedX <= zone.x + zone.width && normalizedY >= zone.y && normalizedY <= zone.y + zone.height);
}

function candidateMask(png, zones) {
  const { width, height, data } = png;
  const mask = new Uint8Array(width * height);
  const luminanceAt = (sampleX, sampleY) => {
    const safeX = Math.max(0, Math.min(width - 1, sampleX));
    const safeY = Math.max(0, Math.min(height - 1, sampleY));
    const offset = (safeY * width + safeX) * 4;
    return data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114;
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!pixelInZones(x, y, width, height, zones)) continue;
      const pixel = y * width + x;
      const offset = pixel * 4;
      const red = data[offset];
      const green = data[offset + 1];
      const blue = data[offset + 2];
      const whiteBase = red > 228 && green > 228 && blue > 228 && Math.max(red, green, blue) - Math.min(red, green, blue) < 30;
      const yellow = red > 185 && green > 145 && blue < 175 && red - blue > 42;
      const luminance = red * 0.299 + green * 0.587 + blue * 0.114;
      const neighbors = [
        luminanceAt(x - 4, y), luminanceAt(x + 4, y), luminanceAt(x, y - 4), luminanceAt(x, y + 4),
        luminanceAt(x - 3, y - 3), luminanceAt(x + 3, y + 3)
      ];
      const localContrast = whiteBase && [
        ...neighbors
      ].some((neighbor) => luminance - neighbor > 72);
      const darkOnBright = luminance < 58 && neighbors.some((neighbor) => neighbor - luminance > 145);
      if (localContrast || darkOnBright || yellow) mask[pixel] = 1;
    }
  }
  return mask;
}

function filterComponents(input, width, height, minimumArea = 5, maximumArea = 70000) {
  const output = new Uint8Array(input.length);
  const visited = new Uint8Array(input.length);
  const queue = new Int32Array(input.length);
  const component = [];
  for (let start = 0; start < input.length; start += 1) {
    if (!input[start] || visited[start]) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    visited[start] = 1;
    component.length = 0;
    while (head < tail) {
      const pixel = queue[head++];
      component.push(pixel);
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      for (let deltaY = -1; deltaY <= 1; deltaY += 1) {
        for (let deltaX = -1; deltaX <= 1; deltaX += 1) {
          if (!deltaX && !deltaY) continue;
          const nextX = x + deltaX;
          const nextY = y + deltaY;
          if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;
          const next = nextY * width + nextX;
          if (input[next] && !visited[next]) {
            visited[next] = 1;
            queue[tail++] = next;
          }
        }
      }
    }
    if (component.length >= minimumArea && component.length <= maximumArea) {
      for (const pixel of component) output[pixel] = 1;
    }
  }
  return output;
}

function dilate(input, width, height, radius = 7) {
  const horizontal = new Uint8Array(input.length);
  const output = new Uint8Array(input.length);
  for (let y = 0; y < height; y += 1) {
    let sum = 0;
    for (let x = 0; x < width; x += 1) {
      const addX = Math.min(width - 1, x + radius);
      const removeX = x - radius - 1;
      sum += input[y * width + addX];
      if (removeX >= 0) sum -= input[y * width + removeX];
      horizontal[y * width + x] = sum > 0 ? 1 : 0;
    }
  }
  for (let x = 0; x < width; x += 1) {
    let sum = 0;
    for (let y = 0; y < height; y += 1) {
      const addY = Math.min(height - 1, y + radius);
      const removeY = y - radius - 1;
      sum += horizontal[addY * width + x];
      if (removeY >= 0) sum -= horizontal[removeY * width + x];
      output[y * width + x] = sum > 0 ? 255 : 0;
    }
  }
  return output;
}

async function extractNormalizedFrame(inputPath, outputPath, seconds, width, height) {
  await runFfmpeg([
    "-y", "-ss", seconds.toFixed(3), "-i", inputPath,
    "-frames:v", "1",
    "-vf", `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},format=rgba`,
    outputPath
  ]);
}

async function generateCaptionMask(inputPath, sourceInfo, outputMaskPath, options = {}) {
  const zones = normalizeZones(options.zones);
  const samples = options.samples || [0.25, 0.5, 0.75];
  const targetWidth = Number(options.width || 540);
  const targetHeight = Number(options.height || 960);
  const workingDir = path.dirname(outputMaskPath);
  await fs.mkdir(workingDir, { recursive: true });
  const union = new Uint8Array(targetWidth * targetHeight);
  const temporaryFrames = [];
  for (let index = 0; index < samples.length; index += 1) {
    const framePath = path.join(workingDir, `.mask-frame-${Date.now()}-${index}.png`);
    temporaryFrames.push(framePath);
    const seconds = Math.max(0.1, Math.min(sourceInfo.duration - 0.1, sourceInfo.duration * samples[index]));
    await extractNormalizedFrame(inputPath, framePath, seconds, targetWidth, targetHeight);
    const png = PNG.sync.read(await fs.readFile(framePath));
    const filtered = filterComponents(candidateMask(png, zones), png.width, png.height);
    for (let pixel = 0; pixel < union.length; pixel += 1) if (filtered[pixel]) union[pixel] = 1;
  }
  for (const zone of zones.filter((item) => item.fill)) {
    const startX = Math.floor(zone.x * targetWidth);
    const endX = Math.ceil(Math.min(1, zone.x + zone.width) * targetWidth);
    const startY = Math.floor(zone.y * targetHeight);
    const endY = Math.ceil(Math.min(1, zone.y + zone.height) * targetHeight);
    for (let y = startY; y < endY; y += 1) {
      for (let x = startX; x < endX; x += 1) union[y * targetWidth + x] = 1;
    }
  }
  const expanded = dilate(union, targetWidth, targetHeight, Number(options.dilationRadius || 3));
  const border = Math.max(6, Math.round(targetWidth / 90));
  for (let y = 0; y < targetHeight; y += 1) {
    for (let x = 0; x < targetWidth; x += 1) {
      if (x < border || x >= targetWidth - border || y < border || y >= targetHeight - border) expanded[y * targetWidth + x] = 0;
    }
  }
  const header = Buffer.from(`P5\n${targetWidth} ${targetHeight}\n255\n`, "ascii");
  await fs.writeFile(outputMaskPath, Buffer.concat([header, Buffer.from(expanded)]));
  await Promise.all(temporaryFrames.map((framePath) => fs.unlink(framePath).catch(() => {})));
  return { maskPath: outputMaskPath, zones, width: targetWidth, height: targetHeight, maskedPixels: expanded.reduce((sum, value) => sum + (value ? 1 : 0), 0) };
}

module.exports = { candidateMask, dilate, filterComponents, generateCaptionMask, normalizeZones };
