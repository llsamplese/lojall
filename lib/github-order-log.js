const {
  isGithubConfigured,
  getRepo,
  getBranch,
  getExistingFile,
  writeFile,
  listDirectory
} = require("./github-repo");

function isGithubLoggingConfigured() {
  return isGithubConfigured();
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function getRecordEmail(record) {
  return normalizeEmail(record?.customer_email || record?.payer_email || "");
}

function getLogFilePath(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `orders/${year}-${month}-${day}.jsonl`;
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

async function listOrderLogPaths() {
  if (!isGithubLoggingConfigured()) {
    return [];
  }

  const repo = getRepo();
  const branch = getBranch();
  const data = await listDirectory(repo, "orders", branch);

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
  const files = await getFilesInBatches(repo, paths, branch);
  return files.flatMap((file) => parseJsonl(file.content));
}

function getExistingAccessCodeForEmail(records, email) {
  const targetEmail = normalizeEmail(email);
  if (!targetEmail) {
    return "";
  }

  const match = records.find((record) => getRecordEmail(record) === targetEmail && String(record?.customer_access_code || "").trim());
  return match ? String(match.customer_access_code).trim() : "";
}

const DEFAULT_NEW_ACCESS_CODE = "llsamples2027";

async function assignCustomerAccessCode(email) {
  if (!isGithubLoggingConfigured()) {
    return {
      code: DEFAULT_NEW_ACCESS_CODE,
      source: "fallback"
    };
  }

  const records = await getAllOrderRecords();
  const existing = getExistingAccessCodeForEmail(records, email);
  if (existing) {
    return { code: existing, source: "existing" };
  }

  return {
    code: DEFAULT_NEW_ACCESS_CODE,
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
  const nextLine = `${JSON.stringify(record)}\n`;
  let lastError = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const existing = await getExistingFile(repo, path, branch);
      const nextContent = `${existing.content || ""}${nextLine}`;
      await writeFile(repo, path, branch, nextContent, existing.sha, `Log order contact ${path}`);
      return { saved: true, path, branch };
    } catch (error) {
      lastError = error;
      if (!isGithubConflict(error) || attempt === 2) {
        throw error;
      }
    }
  }

  throw lastError || new Error("Erro ao registrar pedido.");
}

async function hasSuccessfulEmailLog(paymentId) {
  const target = String(paymentId || "").trim();
  if (!target || !isGithubLoggingConfigured()) {
    return false;
  }

  const records = await getAllOrderRecords();
  return records.some((record) =>
    String(record?.payment_id || "").trim() === target
    && String(record?.event || "").trim() === "email_sent"
  );
}

async function hasSuccessfulWhatsAppLog(paymentId) {
  const target = String(paymentId || "").trim();
  if (!target || !isGithubLoggingConfigured()) {
    return false;
  }

  const records = await getAllOrderRecords();
  return records.some((record) =>
    String(record?.payment_id || "").trim() === target
    && String(record?.event || "").trim() === "whatsapp_sent"
  );
}

async function hasApprovedPaymentLog(paymentId) {
  const target = String(paymentId || "").trim();
  if (!target || !isGithubLoggingConfigured()) {
    return false;
  }

  const records = await getAllOrderRecords();
  return records.some((record) =>
    String(record?.payment_id || "").trim() === target
    && String(record?.status || "").trim() === "approved"
  );
}

module.exports = {
  DEFAULT_NEW_ACCESS_CODE,
  appendOrderLead,
  assignCustomerAccessCode,
  getAllOrderRecords,
  hasApprovedPaymentLog,
  hasSuccessfulEmailLog,
  hasSuccessfulWhatsAppLog,
  getLogFilePath,
  getExistingFile,
  isGithubLoggingConfigured,
  listOrderLogPaths,
  normalizeEmail,
  parseJsonl,
  getBranch,
  getRecordEmail
};
