const {
  getAllOrderRecords,
  getLogFilePath,
  getRecordEmail,
  isGithubLoggingConfigured,
  listOrderLogPaths,
  getExistingFile,
  parseJsonl,
  getBranch,
  appendOrderLead,
  assignCustomerAccessCode
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

async function updateCustomer(body) {
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
      const content = nextRecords.length
        ? `${nextRecords.map((record) => JSON.stringify(record)).join("\n")}\n`
        : "";
      await writeFile(repo, path, branch, content, existing.sha, `Update customer ${nextEmail}`);
    }
  }

  if (!updatedCount) {
    throw new Error("Nenhum registro desse cliente foi encontrado para atualizar.");
  }

  const records = await getAllOrderRecords();
  const updatedCustomer = records.filter((record) => getRecordEmail(record) === nextEmail);

  return {
    updated_records: updatedCount,
    customer: {
      email: nextEmail,
      access_code: nextAccessCode,
      name: updatedCustomer.find((record) => record.customer_name)?.customer_name || nextName,
      phone: updatedCustomer.find((record) => record.customer_phone)?.customer_phone || nextPhone,
      last_file_hint: getLogFilePath()
    }
  };
}

async function createCustomer(body) {
  const email = normalizeEmail(body.email);
  const name = String(body.name || "").trim();
  const phone = String(body.phone || "").trim();
  const requestedCode = String(body.access_code || "").trim();

  if (!email) {
    throw new Error("Informe o e-mail do cliente.");
  }

  const records = await getAllOrderRecords();
  if (records.some((record) => getRecordEmail(record) === email)) {
    throw new Error("Já existe cliente com esse e-mail. Edite o cadastro existente.");
  }

  const accessCode = requestedCode || (await assignCustomerAccessCode(email)).code;
  await appendOrderLead({
    created_at: new Date().toISOString(),
    status: "manual_profile",
    customer_name: name,
    customer_email: email,
    customer_phone: phone,
    customer_access_code: accessCode,
    payer_email: email,
    payment_id: "",
    payment_method_id: "",
    transaction_amount: 0,
    items: []
  });

  return {
    created: true,
    customer: {
      email,
      access_code: accessCode,
      name,
      phone,
      last_file_hint: getLogFilePath()
    }
  };
}

async function deleteCustomer(body) {
  const targetEmail = normalizeEmail(body.email || body.originalEmail);
  if (!targetEmail) {
    throw new Error("Informe o e-mail do cliente que será excluído.");
  }

  const repo = getRepo();
  const branch = getBranch();
  const paths = await listOrderLogPaths();
  let deletedCount = 0;

  for (const path of paths) {
    const existing = await getExistingFile(repo, path, branch);
    const records = parseJsonl(existing.content);
    const remaining = records.filter((record) => {
      const match = getRecordEmail(record) === targetEmail;
      if (match) {
        deletedCount += 1;
      }
      return !match;
    });

    if (remaining.length !== records.length) {
      const content = remaining.length
        ? `${remaining.map((record) => JSON.stringify(record)).join("\n")}\n`
        : "";
      await writeFile(repo, path, branch, content, existing.sha, `Delete customer ${targetEmail}`);
    }
  }

  if (!deletedCount) {
    throw new Error("Nenhum registro desse cliente foi encontrado para excluir.");
  }

  return {
    deleted: true,
    deleted_records: deletedCount,
    customer: {
      email: targetEmail
    }
  };
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
    const action = String(body.action || "update").trim().toLowerCase();

    let result;
    if (action === "create") {
      result = await createCustomer(body);
    } else if (action === "delete") {
      result = await deleteCustomer(body);
    } else {
      result = await updateCustomer(body);
    }

    return res.status(200).json({
      ok: true,
      ...result
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Erro ao atualizar cliente." });
  }
};
