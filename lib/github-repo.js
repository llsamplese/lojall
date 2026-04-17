const GITHUB_API = "https://api.github.com";

function isGithubConfigured() {
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

function getRepo() {
  return process.env.GITHUB_LOG_REPO;
}

function getBranch() {
  return process.env.GITHUB_LOG_BRANCH || "main";
}

async function githubRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...getHeaders(),
      ...(options.headers || {})
    }
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.message || "Falha ao consultar dados no GitHub.");
  }

  return data;
}

async function getExistingFile(repo, path, branch) {
  const url = `${GITHUB_API}/repos/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`;
  const response = await fetch(url, { headers: getHeaders() });

  if (response.status === 404) {
    return { content: "", sha: null };
  }

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.message || "Falha ao consultar arquivo no GitHub.");
  }

  const content = data.content
    ? Buffer.from(String(data.content).replace(/\n/g, ""), "base64").toString("utf8")
    : "";

  return { content, sha: data.sha || null };
}

async function writeFile(repo, path, branch, content, sha, message = `Update ${path}`) {
  const url = `${GITHUB_API}/repos/${repo}/contents/${encodeURIComponent(path)}`;
  const payload = {
    message,
    branch,
    content: Buffer.from(content, "utf8").toString("base64")
  };

  if (sha) {
    payload.sha = sha;
  }

  return githubRequest(url, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

async function listDirectory(repo, path, branch) {
  const url = `${GITHUB_API}/repos/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`;
  const response = await fetch(url, { headers: getHeaders() });

  if (response.status === 404) {
    return [];
  }

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.message || "Falha ao listar diretório no GitHub.");
  }

  return Array.isArray(data) ? data : [];
}

module.exports = {
  isGithubConfigured,
  getHeaders,
  getRepo,
  getBranch,
  githubRequest,
  getExistingFile,
  writeFile,
  listDirectory
};
