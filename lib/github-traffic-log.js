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

async function appendSiteVisit(record) {
  if (!isGithubTrafficConfigured()) {
    return { saved: false, reason: "github_log_not_configured" };
  }

  const repo = getRepo();
  const branch = getBranch();
  const path = getTrafficLogPath();
  const existing = await getExistingFile(repo, path, branch);
  const nextLine = `${JSON.stringify(record)}\n`;
  const nextContent = `${existing.content || ""}${nextLine}`;
  await writeFile(repo, path, branch, nextContent, existing.sha, `Log traffic ${path}`);
  return { saved: true, path, branch };
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
  const records = [];

  for (const path of paths) {
    const file = await getExistingFile(repo, path, branch);
    records.push(...parseJsonl(file.content));
  }

  return records;
}

async function getTrafficStats() {
  const records = await getAllTrafficRecords();
  const stats = {
    total: 0,
    home: 0,
    product_direct: 0,
    package_direct: 0
  };

  records.forEach((record) => {
    if (String(record?.source || "").trim() !== "storefront_visit") return;
    const pageType = String(record?.page_type || "").trim();
    stats.total += 1;
    if (pageType === "home") stats.home += 1;
    if (pageType === "product_direct") stats.product_direct += 1;
    if (pageType === "package_direct") stats.package_direct += 1;
  });

  return stats;
}

module.exports = {
  appendSiteVisit,
  getAllTrafficRecords,
  getTrafficLogPath,
  getTrafficStats,
  isGithubTrafficConfigured,
  listTrafficLogPaths,
  parseJsonl
};
