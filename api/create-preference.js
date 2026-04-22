const MERCADO_PAGO_API = "https://api.mercadopago.com/checkout/preferences";
const { validateCoupon, roundCurrency } = require("../lib/coupon-utils");
const { getStoreConfig } = require("../lib/store-config");

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

async function sanitizeItems(items) {
  if (!Array.isArray(items)) return [];
  const config = await getStoreConfig();
  const overrides = config?.productOverrides || {};
  const globalPricing = config?.globalPricing || {};

  return items
    .map((item) => {
      const title = String(item?.title || "").trim();
      const override = overrides[title] || {};
      const effectivePrice = override.active && Number(override.promoPrice) > 0
        ? Number(override.promoPrice)
        : applyGlobalPricing(item?.unit_price || 0, globalPricing);

      return {
        title,
        unit_price: roundCurrency(effectivePrice),
        quantity: Number(item?.quantity || 1),
        download_url: String(item?.download_url || "").trim()
      };
    })
    .filter((item) => item.title && item.unit_price > 0 && item.quantity > 0);
}

async function buildPreference(body) {
  const mode = normalizeMode(body.mode);
  const items = await sanitizeItems(body.items);

  if (!items.length) {
    throw new Error("Nenhum item válido foi enviado para pagamento.");
  }

  const customer = body.customer || {};
  const subtotal = roundCurrency(items.reduce((sum, item) => sum + (item.unit_price * item.quantity), 0));
  const config = await getStoreConfig();
  const packageState = resolvePackageForItems(items, body.packageSelection?.code, config?.packages || {});
  const couponSubtotal = packageState?.eligible ? packageState.appliedSubtotal : subtotal;
  const couponCode = String(body.coupon?.code || "").trim();
  const couponResult = await validateCoupon(body.coupon?.code, {
    subtotal: couponSubtotal,
    itemsCount: items.reduce((sum, item) => sum + item.quantity, 0)
  });

  if (couponCode && !couponResult.valid) {
    throw new Error(couponResult.error || "Cupom inválido.");
  }

  const packageDiscount = packageState?.eligible ? roundCurrency(packageState.discount || 0) : 0;
  const discount = couponResult.valid ? couponResult.coupon.discount : 0;
  const discountedSubtotal = roundCurrency(Math.max(0, couponSubtotal - discount));
  const totalPix = discountedSubtotal;
  const totalCard = roundCurrency(discountedSubtotal * 1.0524);
  const finalAmount = roundCurrency(mode === "card" ? totalCard : totalPix);

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
      package_code: packageState?.eligible ? packageState.code : "",
      package_label: packageState?.eligible ? String(packageState.label || packageState.code || "").trim() : "",
      package_quantity: packageState?.eligible ? Number(packageState.quantity || 0) : 0,
      package_fixed_price: packageState?.eligible ? Number(packageState.fixedPrice || 0) : 0,
      package_discount: packageDiscount,
      coupon_code: couponResult.valid ? couponResult.coupon.code : "",
      coupon_label: couponResult.valid ? couponResult.coupon.label : "",
      coupon_discount: discount,
      original_items: items,
      subtotal,
      package_adjusted_subtotal: couponSubtotal,
      package_discount: packageDiscount,
      discount,
      total_pix: totalPix,
      total_card: totalCard
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

  return {
    preference,
    coupon: couponResult.valid ? couponResult.coupon : null,
    totals: {
      subtotal,
      discount,
      pix: totalPix,
      card: totalCard
    }
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
    const { preference, coupon, totals } = await buildPreference(body);

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
      sandbox_init_point: data.sandbox_init_point,
      coupon,
      totals
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Erro interno ao criar checkout."
    });
  }
};

