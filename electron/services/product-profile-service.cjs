const PROFILE_SCHEMA_VERSION = 1;
const PRODUCT_PROFILE_STORE_KEY = "productProfiles";

function cleanText(value, maximumLength = 160) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maximumLength);
}

function cleanSku(value) {
  return cleanText(value, 80);
}

function cleanTextList(values, maximumLength = 160) {
  const seen = new Set();
  return (Array.isArray(values) ? values : [])
    .map((value) => cleanText(value, maximumLength))
    .filter((value) => {
      const key = value.toLocaleLowerCase("zh-CN");
      if (!value || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function normalizeReferenceImage(image, index = 0) {
  const source = typeof image === "string" ? { filePath: image } : (image || {});
  const filePath = cleanText(source.filePath, 2048);
  if (!filePath) return null;
  return {
    id: cleanText(source.id, 120) || `reference-${index + 1}`,
    filePath,
    label: cleanText(source.label, 80)
  };
}

function normalizeReferenceImages(images) {
  const seen = new Set();
  return (Array.isArray(images) ? images : [])
    .map(normalizeReferenceImage)
    .filter((image) => {
      if (!image) return false;
      const key = image.filePath.toLocaleLowerCase("zh-CN");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((image, index) => ({ ...image, id: image.id || `reference-${index + 1}` }));
}

function normalizeProductProfile(profile, options = {}) {
  const source = profile || {};
  const sku = cleanSku(source.sku);
  if (!sku) {
    const error = new Error("请先填写款号，再保存目标商品资料卡");
    error.code = "PRODUCT_PROFILE_SKU_REQUIRED";
    throw error;
  }
  const now = options.now || new Date().toISOString();
  return {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    sku,
    name: cleanText(source.name, 120),
    category: cleanText(source.category, 80),
    color: cleanText(source.color, 120),
    silhouette: cleanText(source.silhouette, 120),
    fabric: cleanText(source.fabric, 160),
    audience: cleanText(source.audience, 160),
    referenceImages: normalizeReferenceImages(source.referenceImages),
    allowedClaims: cleanTextList(source.allowedClaims, 240),
    verificationRequired: cleanTextList(source.verificationRequired, 240),
    createdAt: cleanText(source.createdAt, 40) || now,
    updatedAt: now
  };
}

function normalizeStoredProfiles(profiles) {
  const values = Array.isArray(profiles) ? profiles : [];
  const normalized = [];
  const seen = new Set();
  for (const profile of values) {
    try {
      const item = normalizeProductProfile(profile, { now: cleanText(profile?.updatedAt, 40) || new Date().toISOString() });
      const key = item.sku.toLocaleLowerCase("zh-CN");
      if (seen.has(key)) continue;
      seen.add(key);
      normalized.push(item);
    } catch {
      // Ignore invalid legacy records so one broken entry cannot block the library.
    }
  }
  return normalized;
}

function createProductProfileRepository(store, options = {}) {
  if (!store || typeof store.get !== "function" || typeof store.set !== "function") {
    throw new TypeError("product profile repository requires a store with get/set methods");
  }
  const now = typeof options.now === "function" ? options.now : () => new Date().toISOString();

  async function readAll() {
    return normalizeStoredProfiles(await store.get(PRODUCT_PROFILE_STORE_KEY));
  }

  return Object.freeze({
    async list() {
      const profiles = await readAll();
      return profiles.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.sku.localeCompare(right.sku, "zh-CN"));
    },

    async get(sku) {
      const key = cleanSku(sku).toLocaleLowerCase("zh-CN");
      if (!key) return null;
      return (await readAll()).find((profile) => profile.sku.toLocaleLowerCase("zh-CN") === key) || null;
    },

    async save(profile) {
      const profiles = await readAll();
      const key = cleanSku(profile?.sku).toLocaleLowerCase("zh-CN");
      const previous = profiles.find((item) => item.sku.toLocaleLowerCase("zh-CN") === key);
      const normalized = normalizeProductProfile({ ...previous, ...profile }, { now: now() });
      const nextProfiles = profiles.filter((item) => item.sku.toLocaleLowerCase("zh-CN") !== key);
      nextProfiles.push(normalized);
      await store.set(PRODUCT_PROFILE_STORE_KEY, nextProfiles);
      return normalized;
    },

    async remove(sku) {
      const key = cleanSku(sku).toLocaleLowerCase("zh-CN");
      if (!key) return false;
      const profiles = await readAll();
      const nextProfiles = profiles.filter((profile) => profile.sku.toLocaleLowerCase("zh-CN") !== key);
      if (nextProfiles.length === profiles.length) return false;
      await store.set(PRODUCT_PROFILE_STORE_KEY, nextProfiles);
      return true;
    }
  });
}

module.exports = {
  PROFILE_SCHEMA_VERSION,
  PRODUCT_PROFILE_STORE_KEY,
  cleanTextList,
  createProductProfileRepository,
  normalizeProductProfile,
  normalizeReferenceImages
};
