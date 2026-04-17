const {
  getAllOrderRecords,
  getLogFilePath,
  getRecordEmail,
  isGithubLoggingConfigured,
  listOrderLogPaths,
  getExistingFile,
  parseJsonl,
  getBranch
} = require("../lib/github-order-log");
const { getRepo, writeFile } = require("../lib/github-repo");

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body;
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Método não permitido." });
  }

  if (!isGithubLoggingConfigured()) {
    return res.status(500).json({ error: "Log no GitHub não está configurado na Vercel." });
  }

  try {
    const body = parseBody(req);
    const originalEmail = normalizeEmail(body.originalEmail);
    const nextEmail = normalizeEmail(body.email);
    const nextAccessCode = String(body.access_code || "").trim();
    const nextName = String(body.name || "").trim();
    const nextPhone = String(body.phone || "").trim();

    if (!originalEmail) {
      throw new Error("Informe o e-mail original do cliente.");
    }

    if (!nextEmail) {
      throw new Error("Informe o novo e-mail do cliente.");
    }

    if (!nextAccessCode) {
      throw new Error("Informe o código de acesso do cliente.");
    }

    const repo = getRepo();
    const branch = getBranch();
    const paths = await listOrderLogPaths();
    let updatedCount = 0;

    for (const path of paths) {
      const existing = await getExistingFile(repo, path, branch);
      const records = parseJsonl(existing.content);
      let changed = false;

      const nextRecords = records.map((record) => {
        if (getRecordEmail(record) !== originalEmail) {
          return record;
        }

        changed = true;
        updatedCount += 1;
        return {
          ...record,
          customer_email: nextEmail,
          customer_access_code: nextAccessCode,
          customer_name: nextName || record.customer_name || "",
          customer_phone: nextPhone || record.customer_phone || ""
        };
      });

      if (changed) {
        const content = `${nextRecords.map((record) => JSON.stringify(record)).join("\n")}\n`;
        await writeFile(repo, path, branch, content, existing.sha, `Update customer ${nextEmail}`);
      }
    }

    if (!updatedCount) {
      throw new Error("Nenhum registro desse cliente foi encontrado para atualizar.");
    }

    const records = await getAllOrderRecords();
    const updatedCustomer = records.filter((record) => getRecordEmail(record) === nextEmail);

    return res.status(200).json({
      ok: true,
      updated_records: updatedCount,
      customer: {
        email: nextEmail,
        access_code: nextAccessCode,
        name: updatedCustomer.find((record) => record.customer_name)?.customer_name || nextName,
        phone: updatedCustomer.find((record) => record.customer_phone)?.customer_phone || nextPhone,
        last_file_hint: getLogFilePath()
      }
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Erro ao atualizar cliente." });
  }
};
