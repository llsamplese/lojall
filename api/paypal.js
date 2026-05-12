const {
  appendOrderLead,
  assignCustomerAccessCode,
  hasApprovedPaymentLog,
  hasSuccessfulEmailLog
} = require("../lib/github-order-log");
const { buildDescription, buildTotals, sanitizeItems } = require("../lib/checkout-totals");
const { sendPurchaseApprovedEmail } = require("../lib/email-delivery");
const { registerCouponUsage } = require("../lib/coupon-utils");
const { getPaypalEnv, isPaypalConfigured, paypalRequest } = require("../lib/paypal");

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

function getAction(req, body) {
  return String(req.query?.action || body.action || "").trim().toLowerCase();
}

function normalizeCustomer(customer = {}) {
  return {
    name: String(customer.name || "").trim(),
    email: String(customer.email || "").trim().toLowerCase(),
    phone: String(customer.phone || "").trim()
  };
}

function validateCustomer(customer) {
  if (!customer.name) throw new Error("Informe o nome antes de pagar com PayPal.");
  if (!customer.email) throw new Error("Informe o e-mail antes de pagar com PayPal.");
  if (!customer.phone) throw new Error("Informe o telefone ou WhatsApp antes de pagar com PayPal.");
}

function splitName(fullName) {
  const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
  return {
    given_name: parts.shift() || "",
    surname: parts.join(" ") || ""
  };
}

function getCapture(data) {
  return data?.purchase_units?.[0]?.payments?.captures?.[0] || null;
}

function sendConfig(res) {
  const clientId = String(process.env.PAYPAL_CLIENT_ID || "").trim();
  const enabled = isPaypalConfigured();

  return res.status(200).json({
    enabled,
    clientId: enabled ? clientId : "",
    env: getPaypalEnv(),
    currency: "BRL"
  });
}

async function createOrder(req, res, body) {
  if (!isPaypalConfigured()) {
    return res.status(500).json({ error: "PayPal nao configurado na Vercel." });
  }

  const customer = normalizeCustomer(body.customer || {});
  validateCustomer(customer);

  const items = await sanitizeItems(body.items || []);
  if (!items.length) {
    return res.status(400).json({ error: "Nenhum item valido foi enviado." });
  }

  const couponCode = String(body.coupon?.code || "").trim();
  const packageCode = String(body.packageSelection?.code || "").trim();
  const totals = await buildTotals(items, couponCode, packageCode);
  const access = await assignCustomerAccessCode(customer.email);
  const reference = `llsamples-paypal-${Date.now()}`;

  const order = await paypalRequest("/v2/checkout/orders", {
    method: "POST",
    headers: {
      "PayPal-Request-Id": reference
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      payer: {
        email_address: customer.email,
        name: splitName(customer.name)
      },
      purchase_units: [
        {
          reference_id: reference.slice(0, 127),
          custom_id: reference.slice(0, 127),
          description: buildDescription(items).slice(0, 127),
          amount: {
            currency_code: "BRL",
            value: totals.card.toFixed(2)
          }
        }
      ]
    })
  });

  await appendOrderLead({
    created_at: new Date().toISOString(),
    status: "paypal_created",
    status_detail: order.status || "",
    payment_id: order.id || "",
    payment_type_id: "paypal",
    transaction_amount: totals.card,
    payer_email: customer.email,
    customer_name: customer.name,
    customer_email: customer.email,
    customer_phone: customer.phone,
    customer_access_code: access.code,
    coupon_code: totals.coupon?.code || "",
    package_code: totals.package?.code || "",
    items
  });

  return res.status(200).json({
    orderID: order.id,
    status: order.status,
    customer_access_code: access.code,
    totals
  });
}

async function captureOrder(req, res, body) {
  if (!isPaypalConfigured()) {
    return res.status(500).json({ error: "PayPal nao configurado na Vercel." });
  }

  const orderID = String(body.orderID || "").trim();
  if (!orderID) {
    return res.status(400).json({ error: "orderID e obrigatorio." });
  }

  const customer = normalizeCustomer(body.customer || {});
  const items = await sanitizeItems(body.items || []);
  if (!items.length) {
    return res.status(400).json({ error: "Nenhum item valido foi enviado." });
  }

  const couponCode = String(body.coupon?.code || "").trim();
  const packageCode = String(body.packageSelection?.code || "").trim();
  const totals = await buildTotals(items, couponCode, packageCode);
  const access = await assignCustomerAccessCode(customer.email);

  const captured = await paypalRequest(`/v2/checkout/orders/${encodeURIComponent(orderID)}/capture`, {
    method: "POST",
    headers: {
      "PayPal-Request-Id": `capture-${orderID}`
    },
    body: "{}"
  });

  const capture = getCapture(captured);
  const approved = captured.status === "COMPLETED" || capture?.status === "COMPLETED";
  const paymentId = `paypal-${String(capture?.id || captured.id || orderID).trim()}`;
  const transactionAmount = Number(capture?.amount?.value || totals.card || 0);
  const payerEmail = String(captured?.payer?.email_address || customer.email || "").trim().toLowerCase();

  const normalizedPayment = {
    id: paymentId,
    date_created: captured.create_time || new Date().toISOString(),
    date_approved: capture?.update_time || captured.update_time || new Date().toISOString(),
    status: approved ? "approved" : String(captured.status || "pending").toLowerCase(),
    status_detail: capture?.status || captured.status || "",
    payment_type_id: "paypal",
    transaction_amount: transactionAmount,
    description: "Compra Loja LL Samples via PayPal",
    payer: {
      email: payerEmail
    },
    metadata: {
      customer_name: customer.name || captured?.payer?.name?.given_name || "",
      customer_email: customer.email || payerEmail,
      customer_phone: customer.phone || "",
      customer_access_code: access.code,
      coupon_code: totals.coupon?.code || "",
      coupon_label: totals.coupon?.label || "",
      coupon_discount: totals.discount || 0,
      package_code: totals.package?.code || "",
      package_discount: totals.packageDiscount || 0,
      subtotal: totals.subtotal || 0,
      total_pix: totals.pix || 0,
      total_card: totals.card || 0,
      paypal_order_id: captured.id || orderID,
      original_items: items
    }
  };

  const shouldSkipApprovedLog = approved && await hasApprovedPaymentLog(paymentId);
  if (!shouldSkipApprovedLog) {
    await appendOrderLead({
      created_at: new Date().toISOString(),
      status: normalizedPayment.status,
      status_detail: normalizedPayment.status_detail,
      payment_id: paymentId,
      payment_type_id: "paypal",
      transaction_amount: transactionAmount,
      payer_email: payerEmail,
      customer_name: normalizedPayment.metadata.customer_name,
      customer_email: normalizedPayment.metadata.customer_email,
      customer_phone: normalizedPayment.metadata.customer_phone,
      customer_access_code: access.code,
      coupon_code: normalizedPayment.metadata.coupon_code,
      package_code: normalizedPayment.metadata.package_code,
      items
    });
  }

  let email = { sent: false, skipped: true, reason: "payment_not_approved" };
  if (approved) {
    if (normalizedPayment.metadata.coupon_code) {
      try {
        await registerCouponUsage(normalizedPayment.metadata.coupon_code, paymentId);
      } catch (couponError) {
        console.error("[paypal-coupon-usage]", couponError);
      }
    }

    const alreadySent = await hasSuccessfulEmailLog(paymentId);
    if (alreadySent) {
      email = { sent: false, skipped: true, reason: "already_sent" };
    } else {
      try {
        email = await sendPurchaseApprovedEmail(normalizedPayment);
        if (email.sent) {
          await appendOrderLead({
            created_at: new Date().toISOString(),
            event: "email_sent",
            payment_id: paymentId,
            customer_email: normalizedPayment.metadata.customer_email,
            customer_name: normalizedPayment.metadata.customer_name,
            customer_access_code: access.code,
            resend_email_id: email.id || "",
            delivery_url: email.delivery_url || ""
          });
        }
      } catch (emailError) {
        email = {
          sent: false,
          skipped: false,
          reason: emailError.message || "email_send_failed"
        };
        await appendOrderLead({
          created_at: new Date().toISOString(),
          event: "email_error",
          payment_id: paymentId,
          customer_email: normalizedPayment.metadata.customer_email,
          customer_name: normalizedPayment.metadata.customer_name,
          error: email.reason
        });
        console.error("[paypal-purchase-email]", emailError);
      }
    }
  }

  return res.status(200).json({
    status: normalizedPayment.status,
    payment_id: paymentId,
    payment_type_id: "paypal",
    customer_access_code: access.code,
    email,
    totals
  });
}

module.exports = async (req, res) => {
  try {
    const body = parseBody(req);
    const action = getAction(req, body);

    if (req.method === "GET" && (!action || action === "config")) {
      return sendConfig(res);
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return res.status(405).json({ error: "Metodo nao permitido." });
    }

    if (action === "create") {
      return await createOrder(req, res, body);
    }

    if (action === "capture") {
      return await captureOrder(req, res, body);
    }

    return res.status(400).json({ error: "Acao do PayPal invalida." });
  } catch (error) {
    console.error("[paypal]", error);
    return res.status(500).json({ error: error.message || "Erro no PayPal." });
  }
};
