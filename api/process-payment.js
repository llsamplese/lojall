const { validateCoupon, roundCurrency } = require("../lib/coupon-utils");
const { appendOrderLead, assignCustomerAccessCode, isGithubLoggingConfigured } = require("../lib/github-order-log");
const { getStoreConfig } = require("../lib/store-config");

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

function applyGlobalPricing(basePrice, globalPricing = {}) {
  const numericBase = roundCurrency(basePrice || 0);
  if (!globalPricing?.active || numericBase <= 0) {
    return numericBase;
  }

  const value = Number(globalPricing.value || 0);
  if (value <= 0) {
    return numericBase;
  }

  if (globalPricing.type === "fixed_price") {
    return roundCurrency(numericBase <= value ? numericBase : value);
  }

  if (globalPricing.type === "fixed") {
    return roundCurrency(Math.max(0, numericBase - value));
  }

  return roundCurrency(Math.max(0, numericBase - (numericBase * value / 100)));
}

function resolvePackageForItems(items, packageCode, packages = {}) {
  const normalizedCode = String(packageCode || "").trim().toUpperCase();
  if (!normalizedCode) {
    return null;
  }
  const pkg = packages[normalizedCode];
  if (!pkg || !pkg.active) {
    return null;
  }
  const mode = pkg.mode === "fixed_set" ? "fixed_set" : "custom_choice";
  const subtotal = roundCurrency(items.reduce((sum, item) => sum + (Number(item.unit_price || 0) * Number(item.quantity || 0)), 0));
  const fixedPrice = roundCurrency(Number(pkg.fixedPrice || 0));
  if (fixedPrice <= 0) {
    return null;
  }
  if (mode === "custom_choice") {
    const packageQuantity = Math.max(0, parseInt(String(pkg.quantity || 0), 10) || 0);
    if (!packageQuantity) {
      return null;
    }
    const expandedItems = items
      .flatMap((item) => Array.from({ length: Math.max(1, Number(item.quantity || 1)) }, () => ({
        title: String(item.title || "").trim(),
        unit_price: Number(item.unit_price || 0)
      })))
      .sort((a, b) => Number(b.unit_price || 0) - Number(a.unit_price || 0));
    const coveredItems = expandedItems.slice(0, packageQuantity);
    const quantity = expandedItems.length;
    const includedSubtotal = roundCurrency(coveredItems.reduce((sum, item) => sum + Number(item.unit_price || 0), 0));
    const eligible = quantity >= packageQuantity;
    const discount = eligible ? roundCurrency(Math.max(0, includedSubtotal - fixedPrice)) : 0;
    const appliedSubtotal = roundCurrency(subtotal - discount);
    return {
      ...pkg,
      mode,
      code: normalizedCode,
      includedItems: [],
      quantity: packageQuantity,
      eligible,
      quantitySelected: quantity,
      subtotal,
      includedSubtotal,
      fixedPrice,
      appliedSubtotal,
      discount
    };
  }
  const includedItems = Array.isArray(pkg.includedItems)
    ? pkg.includedItems.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  if (!includedItems.length) {
    return null;
  }
  const selectedTitles = new Set(items.map((item) => String(item.title || "").trim()));
  const matchedItems = items.filter((item) => includedItems.includes(String(item.title || "").trim()));
  const quantity = matchedItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const includedSubtotal = roundCurrency(matchedItems.reduce((sum, item) => sum + (Number(item.unit_price || 0) * Number(item.quantity || 0)), 0));
  const packageQuantity = includedItems.length;
  if (!packageQuantity) {
    return null;
  }
  const eligible = includedItems.every((title) => selectedTitles.has(title));
  if (!eligible) {
    return { ...pkg, mode, code: normalizedCode, includedItems, quantity: packageQuantity, eligible: false, quantitySelected: quantity, subtotal, includedSubtotal, fixedPrice, appliedSubtotal: subtotal, discount: 0 };
  }
  const discount = roundCurrency(Math.max(0, includedSubtotal - fixedPrice));
  const appliedSubtotal = roundCurrency(subtotal - discount);
  return {
    ...pkg,
    mode,
    code: normalizedCode,
    includedItems,
    quantity: packageQuantity,
    eligible,
    quantitySelected: quantity,
    subtotal,
    includedSubtotal,
    fixedPrice,
    appliedSubtotal,
    discount
  };
}

async function sanitizeItems(items) {
  if (!Array.isArray(items)) return [];
  const config = await getStoreConfig();
  const overrides = config?.productOverrides || {};
  const globalPricing = config?.globalPricing || {};
  return items
    .map((item) => ({
      title: String(item?.title || "").trim(),
      unit_price: roundCurrency((() => {
        const title = String(item?.title || "").trim();
        const override = overrides[title] || {};
        if (override.active && Number(override.promoPrice) > 0) {
          return override.promoPrice;
        }
        return applyGlobalPricing(item?.unit_price || 0, globalPricing);
      })()),
      quantity: Number(item?.quantity || 1)
    }))
    .filter((item) => item.title && item.unit_price > 0 && item.quantity > 0);
}

async function buildTotals(items, couponCode, packageCode) {
  const subtotal = roundCurrency(items.reduce((sum, item) => sum + (item.unit_price * item.quantity), 0));
  const config = await getStoreConfig();
  const packageState = resolvePackageForItems(items, packageCode, config?.packages || {});
  const couponSubtotal = packageState?.eligible ? packageState.appliedSubtotal : subtotal;
  const couponResult = await validateCoupon(couponCode, {
    subtotal: couponSubtotal,
    itemsCount: items.reduce((sum, item) => sum + item.quantity, 0)
  });

  if (couponCode && !couponResult.valid) {
    throw new Error(couponResult.error || "Cupom inválido.");
  }

  const packageDiscount = packageState?.eligible ? roundCurrency(packageState.discount || 0) : 0;
  const discount = couponResult.valid ? couponResult.coupon.discount : 0;
  const discountedSubtotal = roundCurrency(Math.max(0, couponSubtotal - discount));

  return {
    subtotal,
    package: packageState,
    packageDiscount,
    packageAdjustedSubtotal: couponSubtotal,
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

function buildPaymentBody(formData, items, totals, customerData = {}, customerAccessCode = "") {
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
  const customer = customerData || {};

  const body = {
    transaction_amount: amount,
    description: buildDescription(items),
    payment_method_id: paymentMethodId,
    payer: {
      email: String(customer.email || payer.email || "").trim(),
      first_name: String(payer.first_name || "").trim(),
      last_name: String(payer.last_name || "").trim()
    },
    metadata: {
      store: "LL Samples",
      customer_name: String(customer.name || "").trim(),
      customer_email: String(customer.email || "").trim(),
      customer_phone: String(customer.phone || "").trim(),
      customer_access_code: String(customerAccessCode || "").trim(),
      package_code: totals.package?.eligible ? totals.package.code : "",
      package_label: totals.package?.eligible ? String(totals.package.label || totals.package.code || "").trim() : "",
      package_quantity: totals.package?.eligible ? Number(totals.package.quantity || 0) : 0,
      package_fixed_price: totals.package?.eligible ? Number(totals.package.fixedPrice || 0) : 0,
      package_discount: totals.packageDiscount || 0,
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

function buildLeadRecord(paymentBody, items, totals) {
  return {
    created_at: new Date().toISOString(),
    status: "initiated",
    customer_name: paymentBody.metadata?.customer_name || "",
    customer_email: paymentBody.metadata?.customer_email || "",
    customer_phone: paymentBody.metadata?.customer_phone || "",
    customer_access_code: paymentBody.metadata?.customer_access_code || "",
    payer_email: paymentBody.payer?.email || "",
    payment_method_id: paymentBody.payment_method_id || "",
    transaction_amount: paymentBody.transaction_amount || 0,
    subtotal: totals.subtotal,
    discount: totals.discount,
    total_pix: totals.pix,
    total_card: totals.card,
    package_code: totals.package?.eligible ? totals.package.code : "",
    package_label: totals.package?.eligible ? totals.package.label || totals.package.code : "",
    package_discount: totals.packageDiscount || 0,
    coupon_code: totals.coupon?.code || "",
    items: items.map((item) => ({
      title: item.title,
      unit_price: item.unit_price,
      quantity: item.quantity
    }))
  };
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
    const items = await sanitizeItems(body.items);
    if (!items.length) {
      throw new Error("Nenhum item válido foi enviado.");
    }

    const totals = await buildTotals(items, body.coupon?.code, body.packageSelection?.code);
    const payerEmail = String(body?.formData?.payer?.email || "").trim();
    const customerAccess = await assignCustomerAccessCode(payerEmail);
    const paymentBody = buildPaymentBody(body.formData || {}, items, totals, body.customer || {}, customerAccess.code);
    const githubLog = await appendOrderLead(buildLeadRecord(paymentBody, items, totals));

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
      github_logged: githubLog.saved,
      github_log_path: githubLog.path || "",
      github_log_enabled: isGithubLoggingConfigured(),
      customer_access_code: customerAccess.code,
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

