const DEFAULTS = require("../data/store-config-defaults");
const {
  isGithubConfigured,
  getRepo,
  getBranch,
  getExistingFile,
  writeFile
} = require("./github-repo");

const CONFIG_PATH = "data/store-config.json";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function mergeObjects(base, incoming) {
  const output = { ...base };
  Object.entries(incoming || {}).forEach(([key, value]) => {
    if (value && typeof value === "object" && !Array.isArray(value) && base[key] && typeof base[key] === "object" && !Array.isArray(base[key])) {
      output[key] = mergeObjects(base[key], value);
    } else {
      output[key] = value;
    }
  });
  return output;
}

function normalizeConfig(config) {
  const merged = mergeObjects(clone(DEFAULTS), config || {});
  merged.ui = mergeObjects(clone(DEFAULTS.ui), merged.ui || {});
  merged.globalPricing = mergeObjects(clone(DEFAULTS.globalPricing), merged.globalPricing || {});
  merged.deletedCoupons = Array.isArray(merged.deletedCoupons) ? merged.deletedCoupons.map((code) => String(code || "").trim().toUpperCase()).filter(Boolean) : [];
  merged.coupons = merged.coupons && typeof merged.coupons === "object" ? merged.coupons : {};
  merged.productOverrides = merged.productOverrides && typeof merged.productOverrides === "object" ? merged.productOverrides : {};
  merged.packages = merged.packages && typeof merged.packages === "object" ? merged.packages : {};
  return merged;
}

async function getStoreConfig() {
  if (!isGithubConfigured()) {
    return normalizeConfig();
  }

  const file = await getExistingFile(getRepo(), CONFIG_PATH, getBranch());
  if (!file.content) {
    return normalizeConfig();
  }

  try {
    return normalizeConfig(JSON.parse(file.content));
  } catch {
    return normalizeConfig();
  }
}

async function saveStoreConfig(nextConfig) {
  if (!isGithubConfigured()) {
    throw new Error("Log/configuração do GitHub não está ativo na Vercel.");
  }

  const repo = getRepo();
  const branch = getBranch();
  const existing = await getExistingFile(repo, CONFIG_PATH, branch);
  const normalized = normalizeConfig(nextConfig);
  await writeFile(
    repo,
    CONFIG_PATH,
    branch,
    `${JSON.stringify(normalized, null, 2)}\n`,
    existing.sha,
    "Update store config"
  );

  return normalized;
}

module.exports = {
  CONFIG_PATH,
  getStoreConfig,
  saveStoreConfig,
  normalizeConfig
};
