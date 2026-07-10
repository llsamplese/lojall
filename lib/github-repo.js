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
    const error = new Error(data?.message || "Falha ao consultar dados no GitHub.");
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

async function readGithubJson(response) {
  const text = await response.text();
  if (!text.trim()) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    const preview = text.replace(/\s+/g, " ").trim().slice(0, 140);
    const parseError = new Error(`GitHub retornou uma resposta inesperada: ${preview || "vazia"}`);
    parseError.status = response.status;
    parseError.cause = error;
    throw parseError;
  }
}

async function githubGetJson(url, fallbackMessage) {
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, { headers: getHeaders() });
      if (response.status === 404) {
        return { response, data: null };
      }
      const data = await readGithubJson(response);
      if (!response.ok) {
        const error = new Error(data?.message || fallbackMessage || "Falha ao consultar dados no GitHub.");
        error.status = response.status;
        error.data = data;
        throw error;
      }
      return { response, data };
    } catch (error) {
      lastError = error;
      const retryable = Number(error?.status) >= 500 || /resposta inesperada|fetch failed|terminated|timeout/i.test(String(error?.message || ""));
      if (!retryable || attempt === 2) {
        throw error;
      }
    }
  }
  throw lastError || new Error(fallbackMessage || "Falha ao consultar dados no GitHub.");
}

async function getExistingFile(repo, path, branch) {
  const url = `${GITHUB_API}/repos/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`;
  const { data } = await githubGetJson(url, "Falha ao consultar arquivo no GitHub.");
  if (!data) {
    return { content: "", sha: null };
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
  const { data } = await githubGetJson(url, "Falha ao listar diretório no GitHub.");
  if (!data) {
    return [];
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
