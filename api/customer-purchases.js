const DOWNLOAD_LINKS = require("../data/download-links");
const { getAllOrderRecords, normalizeEmail, isGithubLoggingConfigured } = require("../lib/github-order-log");

function normalizeName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[–—]/g, "-")
    .replace(/[`"'_*]+/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const normalizedDownloads = Object.entries(DOWNLOAD_LINKS).reduce((acc, [name, link]) => {
  acc[normalizeName(name)] = link;
  return acc;
}, {});

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

function buildPurchaseId(record) {
  return String(record.payment_id || `${record.created_at || ""}-${JSON.stringify(record.items || [])}`);
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
    const email = normalizeEmail(body.email);
    const accessCode = String(body.access_code || "").trim();

    if (!email) {
      return res.status(400).json({ error: "Informe o e-mail da compra." });
    }

    if (!accessCode) {
      return res.status(400).json({ error: "Informe o código de acesso do cliente." });
    }

    const records = await getAllOrderRecords();
    const emailRecords = records.filter((record) => normalizeEmail(record?.payer_email) === email);

    if (!emailRecords.length) {
      return res.status(404).json({ error: "Nenhuma compra foi encontrada para esse e-mail." });
    }

    const matchingCode = emailRecords.find((record) => String(record?.customer_access_code || "").trim() === accessCode);
    if (!matchingCode) {
      return res.status(401).json({ error: "Código de acesso inválido para esse e-mail." });
    }

    const approvedMap = new Map();
    emailRecords
      .filter((record) => String(record?.status || "").trim() === "approved")
      .forEach((record) => {
        const items = Array.isArray(record.items) ? record.items : [];
        approvedMap.set(buildPurchaseId(record), {
          payment_id: record.payment_id || "",
          transaction_amount: Number(record.transaction_amount || 0),
          date_approved: record.created_at || "",
          payment_type_id: record.payment_type_id || "",
          items: items.map((item) => {
            const title = String(item.title || "").trim();
            const link = normalizedDownloads[normalizeName(title)] || "";
            return {
              title,
              unit_price: Number(item.unit_price || 0),
              link,
              delivered: Boolean(link)
            };
          })
        });
      });

    const purchases = Array.from(approvedMap.values()).sort((a, b) => new Date(b.date_approved || 0) - new Date(a.date_approved || 0));

    return res.status(200).json({
      ok: true,
      email,
      purchases
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Erro ao consultar compras desse e-mail." });
  }
};
