const fs = require("node:fs");
const path = require("node:path");
const { PNG } = require("pngjs");
const { runFfmpeg } = require("../electron/services/process-runner.cjs");

const size = 512;
const png = new PNG({ width: size, height: size });

function color(hex) {
  const value = Number.parseInt(hex.replace("#", ""), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255, 255];
}

function setPixel(x, y, fill) {
  if (x < 0 || x >= size || y < 0 || y >= size) return;
  const offset = (y * size + x) * 4;
  png.data.set(fill, offset);
}

function roundedRect(x, y, width, height, radius, fill) {
  for (let pixelY = y; pixelY < y + height; pixelY += 1) {
    for (let pixelX = x; pixelX < x + width; pixelX += 1) {
      const nearX = Math.max(x + radius - pixelX, 0, pixelX - (x + width - radius - 1));
      const nearY = Math.max(y + radius - pixelY, 0, pixelY - (y + height - radius - 1));
      if (nearX * nearX + nearY * nearY <= radius * radius) setPixel(pixelX, pixelY, fill);
    }
  }
}

function circle(centerX, centerY, radius, fill) {
  for (let y = centerY - radius; y <= centerY + radius; y += 1) {
    for (let x = centerX - radius; x <= centerX + radius; x += 1) {
      if ((x - centerX) ** 2 + (y - centerY) ** 2 <= radius ** 2) setPixel(x, y, fill);
    }
  }
}

roundedRect(0, 0, 512, 512, 112, color("#111311"));
roundedRect(70, 70, 372, 372, 88, color("#bff3df"));
roundedRect(152, 154, 208, 48, 4, color("#111311"));
roundedRect(176, 232, 160, 42, 4, color("#111311"));
roundedRect(158, 304, 196, 46, 4, color("#111311"));
roundedRect(234, 136, 44, 242, 4, color("#111311"));
circle(380, 380, 40, color("#ffca5c"));

async function main() {
  const pngPath = path.resolve(__dirname, "..", "build", "icon.png");
  const icoPath = path.resolve(__dirname, "..", "build", "icon.ico");
  fs.writeFileSync(pngPath, PNG.sync.write(png));
  await runFfmpeg(["-y", "-i", pngPath, "-vf", "scale=256:256", icoPath]);
  process.stdout.write(`${icoPath}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
