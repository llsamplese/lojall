const GITHUB_API = "https://api.github.com";

function isGithubLoggingConfigured() {
  return Boolean(process.env.GITHUB_LOG_TOKEN && process.env.GITHUB_LOG_REPO);
}

function getHeaders() {
  return {
    Authorization: `Bearer ${process.env.GITHUB_LOG_TOKEN}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28"
  };
}

function getLogFilePath(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `orders/${year}-${month}-${day}.jsonl`;
}

async function getExistingFile(repo, path, branch) {
  const url = `${GITHUB_API}/repos/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`;
  const response = await fetch(url, { headers: getHeaders() });

  if (response.status === 404) {
    return { content: "", sha: null };
  }

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.message || "Falha ao consultar arquivo de log no GitHub.");
  }

  const content = data.content
    ? Buffer.from(String(data.content).replace(/\n/g, ""), "base64").toString("utf8")
    : "";

  return { content, sha: data.sha || null };
}

async function writeFile(repo, path, branch, content, sha) {
  const url = `${GITHUB_API}/repos/${repo}/contents/${encodeURIComponent(path)}`;
  const payload = {
    message: `Log order contact ${path}`,
    branch,
    content: Buffer.from(content, "utf8").toString("base64")
  };

  if (sha) {
    payload.sha = sha;
  }

  const response = await fetch(url, {
    method: "PUT",
    headers: getHeaders(),
    body: JSON.stringify(payload)
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.message || "Falha ao salvar log no GitHub.");
  }

  return data;
}

async function appendOrderLead(record) {
  if (!isGithubLoggingConfigured()) {
    return { saved: false, reason: "github_log_not_configured" };
  }

  const repo = process.env.GITHUB_LOG_REPO;
  const branch = process.env.GITHUB_LOG_BRANCH || "main";
  const path = getLogFilePath();
  const existing = await getExistingFile(repo, path, branch);
  const nextLine = `${JSON.stringify(record)}\n`;
  const nextContent = `${existing.content || ""}${nextLine}`;
  await writeFile(repo, path, branch, nextContent, existing.sha);

  return { saved: true, path, branch };
}

module.exports = {
  appendOrderLead,
  isGithubLoggingConfigured
};
