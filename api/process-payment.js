const { validateCoupon, roundCurrency } = require("../lib/coupon-utils");

const PAYMENT_API = "https://api.mercadopago.com/v1/payments";

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

function sanitizeItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => ({
      title: String(item?.title || "").trim(),
      unit_price: roundCurrency(item?.unit_price || 0),
      quantity: Number(item?.quantity || 1)
    }))
    .filter((item) => item.title && item.unit_price > 0 && item.quantity > 0);
}

function buildTotals(items, couponCode) {
  const subtotal = roundCurrency(items.reduce((sum, item) => sum + (item.unit_price * item.quantity), 0));
  const couponResult = validateCoupon(couponCode, {
    subtotal,
    itemsCount: items.reduce((sum, item) => sum + item.quantity, 0)
  });

  if (couponCode && !couponResult.valid) {
    throw new Error(couponResult.error || "Cupom inválido.");
  }

  const discount = couponResult.valid ? couponResult.coupon.discount : 0;
  const discountedSubtotal = roundCurrency(Math.max(0, subtotal - discount));

  return {
    subtotal,
    discount,
    pix: discountedSubtotal,
    card: roundCurrency(discountedSubtotal * 1.0524),
    coupon: couponResult.valid ? couponResult.coupon : null
  };
}

function getAmountForMethod(paymentMethodId, totals) {
  return paymentMethodId === "pix" ? totals.pix : totals.card;
}

function buildDescription(items) {
  if (items.length === 1) return items[0].title;
  return `Pedido LL Samples (${items.length} itens)`;
}

function buildPaymentBody(formData, items, totals) {
  const paymentMethodId = String(formData?.payment_method_id || "").trim();
  if (!paymentMethodId) {
    throw new Error("Método de pagamento não informado pelo checkout.");
  }

  const amount = getAmountForMethod(paymentMethodId, totals);
  if (amount <= 0) {
    throw new Error("Valor final do pagamento inválido.");
  }

  const payer = formData?.payer || {};
  const identification = payer?.identification || {};

  const body = {
    transaction_amount: amount,
    description: buildDescription(items),
    payment_method_id: paymentMethodId,
    payer: {
      email: String(payer.email || "").trim(),
      first_name: String(payer.first_name || "").trim(),
      last_name: String(payer.last_name || "").trim()
    },
    metadata: {
      store: "LL Samples",
      coupon_code: totals.coupon?.code || "",
      coupon_label: totals.coupon?.label || "",
      coupon_discount: totals.discount,
      original_items: items,
      subtotal: totals.subtotal,
      discount: totals.discount,
      total_pix: totals.pix,
      total_card: totals.card
    },
    external_reference: `llsamples-transparent-${Date.now()}`,
    notification_url: process.env.MP_NOTIFICATION_URL
  };

  if (identification.type && identification.number) {
    body.payer.identification = {
      type: String(identification.type).trim(),
      number: String(identification.number).trim()
    };
  }

  if (paymentMethodId !== "pix") {
    body.token = String(formData?.token || "").trim();
    body.installments = Number(formData?.installments || 1);
    body.issuer_id = formData?.issuer_id ? String(formData.issuer_id).trim() : undefined;

    if (!body.token) {
      throw new Error("Token do cartão não recebido.");
    }
  }

  if (!body.payer.email) {
    throw new Error("O e-mail do pagador é obrigatório.");
  }

  return body;
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
    const items = sanitizeItems(body.items);
    if (!items.length) {
      throw new Error("Nenhum item válido foi enviado.");
    }

    const totals = buildTotals(items, body.coupon?.code);
    const paymentBody = buildPaymentBody(body.formData || {}, items, totals);

    const response = await fetch(PAYMENT_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": `llsamples-payment-${Date.now()}-${Math.random().toString(36).slice(2)}`
      },
      body: JSON.stringify(paymentBody)
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({
        error: data?.message || "Mercado Pago rejeitou o pagamento.",
        details: data
      });
    }

    return res.status(200).json({
      payment_id: data.id,
      status: data.status,
      status_detail: data.status_detail,
      payment_type_id: data.payment_type_id,
      point_of_interaction_type: data?.point_of_interaction?.type || "",
      totals,
      qr_code: data?.point_of_interaction?.transaction_data?.qr_code || "",
      qr_code_base64: data?.point_of_interaction?.transaction_data?.qr_code_base64 || "",
      ticket_url: data?.point_of_interaction?.transaction_data?.ticket_url || data?.transaction_details?.external_resource_url || ""
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Erro ao processar pagamento transparente."
    });
  }
};
