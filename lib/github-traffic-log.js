const {
  isGithubConfigured,
  getRepo,
  getBranch,
  getExistingFile,
  writeFile,
  listDirectory
} = require("./github-repo");

function isGithubTrafficConfigured() {
  return isGithubConfigured();
}

function getTrafficLogPath(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `traffic/${year}-${month}-${day}.jsonl`;
}

function parseJsonl(content) {
  return String(content || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function isGithubConflict(error) {
  return Number(error?.status) === 409 || /sha|conflict/i.test(String(error?.message || ""));
}

async function getFilesInBatches(repo, paths, branch, batchSize = 8) {
  const files = [];
  for (let index = 0; index < paths.length; index += batchSize) {
    const batch = paths.slice(index, index + batchSize);
    const results = await Promise.allSettled(batch.map((path) => getExistingFile(repo, path, branch)));
    files.push(...results.filter((result) => result.status === "fulfilled").map((result) => result.value));
  }
  return files;
}

async function appendTrafficRecord(record) {
  if (!isGithubTrafficConfigured()) {
    return { saved: false, reason: "github_log_not_configured" };
  }

  const repo = getRepo();
  const branch = getBranch();
  const path = getTrafficLogPath();
  const nextLine = `${JSON.stringify(record)}\n`;
  let lastError = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const existing = await getExistingFile(repo, path, branch);
      const nextContent = `${existing.content || ""}${nextLine}`;
      await writeFile(repo, path, branch, nextContent, existing.sha, `Log traffic ${path}`);
      return { saved: true, path, branch };
    } catch (error) {
      lastError = error;
      if (!isGithubConflict(error) || attempt === 2) {
        throw error;
      }
    }
  }

  throw lastError || new Error("Erro ao registrar tráfego.");
}

async function appendSiteVisit(record) {
  return appendTrafficRecord(record);
}

async function listTrafficLogPaths() {
  if (!isGithubTrafficConfigured()) {
    return [];
  }

  const repo = getRepo();
  const branch = getBranch();
  const data = await listDirectory(repo, "traffic", branch);
  return Array.isArray(data)
    ? data.filter((item) => item.type === "file" && String(item.name || "").endsWith(".jsonl")).map((item) => item.path)
    : [];
}

async function getAllTrafficRecords() {
  if (!isGithubTrafficConfigured()) {
    return [];
  }

  const repo = getRepo();
  const branch = getBranch();
  const paths = await listTrafficLogPaths();
  const files = await getFilesInBatches(repo, paths, branch);
  return files.flatMap((file) => parseJsonl(file.content));
}

async function getTrafficStats() {
  const records = await getAllTrafficRecords();
  const stats = {
    total: 0,
    home: 0,
    product_direct: 0,
    package_direct: 0,
    checkout_events: {},
    checkout_total: 0
  };

  records.forEach((record) => {
    const source = String(record?.source || "").trim();
    if (source === "storefront_visit") {
      const pageType = String(record?.page_type || "").trim();
      stats.total += 1;
      if (pageType === "home") stats.home += 1;
      if (pageType === "product_direct") stats.product_direct += 1;
      if (pageType === "package_direct") stats.package_direct += 1;
      return;
    }

    if (source === "checkout_event") {
      const eventName = String(record?.event_name || "unknown").trim() || "unknown";
      stats.checkout_events[eventName] = (stats.checkout_events[eventName] || 0) + 1;
      stats.checkout_total += 1;
    }
  });

  return stats;
}

module.exports = {
  appendTrafficRecord,
  appendSiteVisit,
  getAllTrafficRecords,
  getTrafficLogPath,
  getTrafficStats,
  isGithubTrafficConfigured,
  listTrafficLogPaths,
  parseJsonl
};
