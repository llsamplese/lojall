const DOWNLOAD_LINKS = require("../data/download-links");
const { getAllOrderRecords, getRecordEmail, isGithubLoggingConfigured } = require("../lib/github-order-log");

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

function getDeliveredItems(items) {
  return (Array.isArray(items) ? items : []).map((item) => {
    const title = String(item?.title || "").trim();
    const link = normalizedDownloads[normalizeName(title)] || "";
    return {
      title,
      unit_price: Number(item?.unit_price || 0),
      link,
      delivered: Boolean(link)
    };
  });
}

function sortByDateDesc(list, getDate) {
  return list.sort((a, b) => new Date(getDate(b) || 0) - new Date(getDate(a) || 0));
}

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Método não permitido." });
  }

  if (!isGithubLoggingConfigured()) {
    return res.status(500).json({ error: "Log no GitHub não está configurado na Vercel." });
  }

  try {
    const records = await getAllOrderRecords();
    const customers = new Map();

    records.forEach((record) => {
      const email = getRecordEmail(record);
      if (!email) {
        return;
      }

      const customer = customers.get(email) || {
        email,
        name: "",
        phone: "",
        access_code: "",
        last_order_at: "",
        total_orders: 0,
        approved_orders: 0,
        purchases: [],
        all_payment_ids: new Set()
      };

      customer.name = String(record?.customer_name || "").trim() || customer.name;
      customer.phone = String(record?.customer_phone || "").trim() || customer.phone;
      customer.access_code = String(record?.customer_access_code || "").trim() || customer.access_code;

      const createdAt = String(record?.created_at || "").trim();
      if (!customer.last_order_at || new Date(createdAt) > new Date(customer.last_order_at)) {
        customer.last_order_at = createdAt;
      }

      const paymentId = String(record?.payment_id || "").trim();
      if (paymentId) {
        customer.all_payment_ids.add(paymentId);
      }

      if (String(record?.status || "").trim() === "approved") {
        customer.approved_orders += 1;
        customer.purchases.push({
          payment_id: paymentId,
          created_at: createdAt,
          payment_type_id: String(record?.payment_type_id || "").trim(),
          transaction_amount: Number(record?.transaction_amount || 0),
          items: getDeliveredItems(record?.items)
        });
      }

      customers.set(email, customer);
    });

    const payload = sortByDateDesc(
      Array.from(customers.values()).map((customer) => ({
        email: customer.email,
        name: customer.name,
        phone: customer.phone,
        access_code: customer.access_code,
        last_order_at: customer.last_order_at,
        total_orders: customer.all_payment_ids.size || customer.purchases.length,
        approved_orders: customer.approved_orders,
        purchases: sortByDateDesc(customer.purchases, (purchase) => purchase.created_at)
      })),
      (customer) => customer.last_order_at
    );

    return res.status(200).json({
      ok: true,
      total_customers: payload.length,
      customers: payload
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Erro ao carregar painel de clientes." });
  }
};
