const BASE_COUPONS = require("../data/coupons");
const { getStoreConfig, saveStoreConfig } = require("./store-config");

function roundCurrency(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function normalizeCouponCode(code) {
  return String(code || "").trim().toUpperCase();
}

function parseCouponDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function formatCouponDate(value) {
  const parsed = parseCouponDate(value);
  if (!parsed) return "";
  return parsed.toLocaleString("pt-BR");
}

async function getCouponsMap() {
  const config = await getStoreConfig();
  const deletedCoupons = new Set((config?.deletedCoupons || []).map((code) => normalizeCouponCode(code)));
  const merged = {
    ...BASE_COUPONS,
    ...(config?.coupons || {})
  };

  deletedCoupons.forEach((code) => {
    if (code) {
      delete merged[code];
    }
  });

  let changed = false;
  let expiredSomething = false;
  const now = Date.now();
  config.coupons = config.coupons && typeof config.coupons === "object" ? config.coupons : {};
  config.couponRuntime = config.couponRuntime && typeof config.couponRuntime === "object" ? config.couponRuntime : {};

  Object.values(merged).forEach((coupon) => {
    if (!coupon || !coupon.code || !coupon.active) return;
    const validUntil = parseCouponDate(coupon.validUntil);
    if (!validUntil || now <= validUntil.getTime()) return;

    config.coupons[coupon.code] = {
      ...coupon,
      active: false,
      validUntil: "",
      expiredAt: new Date().toISOString()
    };
    merged[coupon.code] = config.coupons[coupon.code];
    changed = true;
    expiredSomething = true;
  });

  const hasPublicActiveCoupons = Object.values(merged).some((coupon) => coupon && coupon.active && !coupon.hidden);
  if (hasPublicActiveCoupons) {
    if (config.couponRuntime.hideHomeCouponsAfterExpiry) {
      config.couponRuntime.hideHomeCouponsAfterExpiry = false;
      config.couponRuntime.lastAutoExpiredAt = "";
      changed = true;
    }
  } else if (expiredSomething) {
    config.couponRuntime.hideHomeCouponsAfterExpiry = true;
    config.couponRuntime.lastAutoExpiredAt = new Date().toISOString();
    changed = true;
  }

  if (changed) {
    await saveStoreConfig(config);
  }

  return merged;
}

async function getCouponByCode(code) {
  const normalizedCode = normalizeCouponCode(code);
  if (!normalizedCode) return null;
  const coupons = await getCouponsMap();
  return coupons[normalizedCode] || null;
}

async function validateCoupon(code, context = {}) {
  const normalizedCode = normalizeCouponCode(code);
  if (!normalizedCode) {
    return { valid: false, error: "Informe um cupom." };
  }

  const coupon = await getCouponByCode(normalizedCode);
  if (!coupon) {
    return { valid: false, error: "Cupom não encontrado." };
  }

  if (!coupon.active) {
    return { valid: false, error: "Este cupom está desativado no momento." };
  }

  const subtotal = roundCurrency(context.subtotal || 0);
  const itemsCount = Number(context.itemsCount || 0);
  const usageLimit = Number(coupon.usageLimit || 0);
  const usedCount = Number(coupon.usedCount || 0);

  if (coupon.minSubtotal && subtotal < coupon.minSubtotal) {
    return {
      valid: false,
      error: `Este cupom exige pedido mínimo de R$ ${coupon.minSubtotal.toFixed(2).replace(".", ",")}.`
    };
  }

  if (coupon.minItems && itemsCount < coupon.minItems) {
    return {
      valid: false,
      error: `Este cupom exige pelo menos ${coupon.minItems} item(ns).`
    };
  }

  if (usageLimit > 0 && usedCount >= usageLimit) {
    return {
      valid: false,
      error: "Este cupom esgotou o limite de usos."
    };
  }

  let discount = 0;
  if (coupon.type === "percent") {
    discount = subtotal * (Number(coupon.value || 0) / 100);
  } else if (coupon.type === "fixed") {
    discount = Number(coupon.value || 0);
  } else if (coupon.type === "fixed_per_item") {
    discount = Number(coupon.value || 0) * itemsCount;
  }

  discount = roundCurrency(Math.max(0, Math.min(discount, subtotal)));

  return {
    valid: true,
    coupon: {
      code: coupon.code,
      label: coupon.label || coupon.code,
      type: coupon.type,
      value: coupon.value,
      hidden: Boolean(coupon.hidden),
      validUntil: coupon.validUntil || "",
      usageLimit: usageLimit > 0 ? usageLimit : 0,
      usedCount,
      discount
    }
  };
}

async function registerCouponUsage(code, paymentId) {
  const normalizedCode = normalizeCouponCode(code);
  const normalizedPaymentId = String(paymentId || "").trim();
  if (!normalizedCode || !normalizedPaymentId) {
    return { updated: false, reason: "missing_data" };
  }

  const config = await getStoreConfig();
  const coupons = await getCouponsMap();
  const coupon = coupons[normalizedCode];
  if (!coupon) {
    return { updated: false, reason: "coupon_not_found" };
  }

  const usedPayments = Array.isArray(coupon.usedPayments)
    ? coupon.usedPayments.map((id) => String(id || "").trim()).filter(Boolean)
    : [];

  if (usedPayments.includes(normalizedPaymentId)) {
    return { updated: false, reason: "already_registered", coupon };
  }

  const nextUsedPayments = [...usedPayments, normalizedPaymentId];
  const usageLimit = Number(coupon.usageLimit || 0);
  const nextUsedCount = nextUsedPayments.length;

  config.coupons = config.coupons && typeof config.coupons === "object" ? config.coupons : {};
  config.coupons[normalizedCode] = {
    ...coupon,
    usedPayments: nextUsedPayments,
    usedCount: nextUsedCount,
    active: usageLimit > 0 ? nextUsedCount < usageLimit : coupon.active
  };

  await saveStoreConfig(config);
  return { updated: true, coupon: config.coupons[normalizedCode] };
}

module.exports = {
  getCouponsMap,
  roundCurrency,
  normalizeCouponCode,
  parseCouponDate,
  formatCouponDate,
  getCouponByCode,
  validateCoupon,
  registerCouponUsage
};
