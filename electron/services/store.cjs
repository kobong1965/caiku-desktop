const fs = require("node:fs/promises");
const path = require("node:path");

class JsonStore {
  constructor(filePath, defaults = {}) {
    this.filePath = filePath;
    this.defaults = structuredClone(defaults);
    this.state = structuredClone(defaults);
    this.ready = this.load();
  }

  async load() {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      this.state = { ...structuredClone(this.defaults), ...JSON.parse(raw) };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await this.flush();
    }
    return this.state;
  }

  async get(key) {
    await this.ready;
    return key ? structuredClone(this.state[key]) : structuredClone(this.state);
  }

  async set(key, value) {
    await this.ready;
    this.state[key] = structuredClone(value);
    await this.flush();
    return structuredClone(value);
  }

  async patch(values) {
    await this.ready;
    this.state = { ...this.state, ...structuredClone(values) };
    await this.flush();
    return structuredClone(this.state);
  }

  async flush() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    await fs.writeFile(temporaryPath, `${JSON.stringify(this.state, null, 2)}\n`, "utf8");
    await fs.rename(temporaryPath, this.filePath);
  }
}

module.exports = { JsonStore };
