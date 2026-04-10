const MERCADO_PAGO_API = "https://api.mercadopago.com/checkout/preferences";

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

function normalizeMode(mode) {
  return mode === "card" ? "card" : "pix";
}

function roundCurrency(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function buildPaymentMethods(mode) {
  if (mode === "card") {
    return {
      excluded_payment_types: [
        { id: "bank_transfer" },
        { id: "ticket" },
        { id: "atm" }
      ],
      installments: 12
    };
  }

  return {
    excluded_payment_types: [
      { id: "credit_card" },
      { id: "debit_card" },
      { id: "prepaid_card" },
      { id: "ticket" },
      { id: "atm" }
    ],
    installments: 1
  };
}

function sanitizeItems(items) {
  if (!Array.isArray(items)) return [];

  return items
    .map((item) => ({
      title: String(item?.title || "").trim(),
      unit_price: roundCurrency(item?.unit_price || 0),
      quantity: Number(item?.quantity || 1),
      download_url: String(item?.download_url || "").trim()
    }))
    .filter((item) => item.title && item.unit_price > 0 && item.quantity > 0);
}

function buildPreference(body) {
  const mode = normalizeMode(body.mode);
  const items = sanitizeItems(body.items);

  if (!items.length) {
    throw new Error("Nenhum item válido foi enviado para pagamento.");
  }

  const customer = body.customer || {};
  const totals = body.totals || {};
  const amount = mode === "card" ? totals.card : totals.pix;
  const finalAmount = roundCurrency(amount || 0);

  if (finalAmount <= 0) {
    throw new Error("O valor final do checkout precisa ser maior que zero.");
  }

  const title = items.length === 1
    ? items[0].title
    : `Pedido LL Samples (${items.length} itens)`;

  const description = items
    .map((item) => `${item.title} - R$ ${item.unit_price.toFixed(2)}`)
    .join(" | ")
    .slice(0, 500);

  const preference = {
    items: [
      {
        id: `llsamples-${mode}`,
        title,
        description,
        quantity: 1,
        currency_id: "BRL",
        unit_price: finalAmount
      }
    ],
    payment_methods: buildPaymentMethods(mode),
    metadata: {
      store: "LL Samples",
      mode,
      customer_name: String(customer.name || "").trim(),
      customer_contact: String(customer.contact || "").trim(),
      customer_note: String(customer.note || "").trim(),
      original_items: items,
      subtotal: roundCurrency(totals.subtotal || 0),
      discount: roundCurrency(totals.discount || 0),
      total_pix: roundCurrency(totals.pix || 0),
      total_card: roundCurrency(totals.card || 0)
    },
    external_reference: `llsamples-${mode}-${Date.now()}`,
    statement_descriptor: "LLSAMPLES",
    back_urls: {
      success: process.env.MP_SUCCESS_URL,
      pending: process.env.MP_PENDING_URL,
      failure: process.env.MP_FAILURE_URL
    },
    auto_return: "approved"
  };

  if (process.env.MP_NOTIFICATION_URL) {
    preference.notification_url = process.env.MP_NOTIFICATION_URL;
  }

  const payerEmail = String(customer.email || "").trim();
  if (payerEmail) {
    preference.payer = { email: payerEmail };
  }

  return preference;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Método não permitido." });
  }

  if (!process.env.MP_ACCESS_TOKEN) {
    return res.status(500).json({ error: "MP_ACCESS_TOKEN não configurado na Vercel." });
  }

  try {
    const body = parseBody(req);
    const preference = buildPreference(body);

    const response = await fetch(MERCADO_PAGO_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": `llsamples-${Date.now()}-${Math.random().toString(36).slice(2)}`
      },
      body: JSON.stringify(preference)
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data?.message || "Mercado Pago rejeitou a criação da preferência.",
        details: data
      });
    }

    return res.status(200).json({
      id: data.id,
      init_point: data.init_point,
      sandbox_init_point: data.sandbox_init_point
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Erro interno ao criar checkout."
    });
  }
};
