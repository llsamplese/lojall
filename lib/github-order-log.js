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

function getRepo() {
  return process.env.GITHUB_LOG_REPO;
}

function getBranch() {
  return process.env.GITHUB_LOG_BRANCH || "main";
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function getLogFilePath(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `orders/${year}-${month}-${day}.jsonl`;
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

  return githubRequest(url, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
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

async function listOrderLogPaths() {
  if (!isGithubLoggingConfigured()) {
    return [];
  }

  const repo = getRepo();
  const branch = getBranch();
  const url = `${GITHUB_API}/repos/${repo}/contents/orders?ref=${encodeURIComponent(branch)}`;
  const response = await fetch(url, { headers: getHeaders() });

  if (response.status === 404) {
    return [];
  }

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.message || "Falha ao listar logs de pedidos no GitHub.");
  }

  return Array.isArray(data)
    ? data.filter((item) => item.type === "file" && String(item.name || "").endsWith(".jsonl")).map((item) => item.path)
    : [];
}

async function getAllOrderRecords() {
  if (!isGithubLoggingConfigured()) {
    return [];
  }

  const repo = getRepo();
  const branch = getBranch();
  const paths = await listOrderLogPaths();
  const records = [];

  for (const path of paths) {
    const file = await getExistingFile(repo, path, branch);
    records.push(...parseJsonl(file.content));
  }

  return records;
}

function getExistingAccessCodeForEmail(records, email) {
  const targetEmail = normalizeEmail(email);
  if (!targetEmail) {
    return "";
  }

  const match = records.find((record) => normalizeEmail(record?.payer_email) === targetEmail && String(record?.customer_access_code || "").trim());
  return match ? String(match.customer_access_code).trim() : "";
}

function getNextAccessCode(records) {
  const highest = records.reduce((max, record) => {
    const match = String(record?.customer_access_code || "").trim().match(/^llsamples(\d+)$/i);
    if (!match) {
      return max;
    }

    return Math.max(max, Number(match[1]));
  }, 0);

  return `llsamples${highest + 1}`;
}

async function assignCustomerAccessCode(email) {
  if (!isGithubLoggingConfigured()) {
    return {
      code: `llsamples${Date.now().toString().slice(-4)}`,
      source: "fallback"
    };
  }

  const records = await getAllOrderRecords();
  const existing = getExistingAccessCodeForEmail(records, email);
  if (existing) {
    return { code: existing, source: "existing" };
  }

  return {
    code: getNextAccessCode(records),
    source: "generated"
  };
}

async function appendOrderLead(record) {
  if (!isGithubLoggingConfigured()) {
    return { saved: false, reason: "github_log_not_configured" };
  }

  const repo = getRepo();
  const branch = getBranch();
  const path = getLogFilePath();
  const existing = await getExistingFile(repo, path, branch);
  const nextLine = `${JSON.stringify(record)}\n`;
  const nextContent = `${existing.content || ""}${nextLine}`;
  await writeFile(repo, path, branch, nextContent, existing.sha);

  return { saved: true, path, branch };
}

module.exports = {
  appendOrderLead,
  assignCustomerAccessCode,
  getAllOrderRecords,
  isGithubLoggingConfigured,
  normalizeEmail
};
