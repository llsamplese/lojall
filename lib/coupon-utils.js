const COUPONS = require("../data/coupons");

function roundCurrency(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function normalizeCouponCode(code) {
  return String(code || "").trim().toUpperCase();
}

function getCouponByCode(code) {
  const normalizedCode = normalizeCouponCode(code);
  if (!normalizedCode) return null;
  return COUPONS[normalizedCode] || null;
}

function validateCoupon(code, context = {}) {
  const normalizedCode = normalizeCouponCode(code);
  if (!normalizedCode) {
    return { valid: false, error: "Informe um cupom." };
  }

  const coupon = getCouponByCode(normalizedCode);
  if (!coupon) {
    return { valid: false, error: "Cupom não encontrado." };
  }

  if (!coupon.active) {
    return { valid: false, error: "Este cupom está desativado no momento." };
  }

  const subtotal = roundCurrency(context.subtotal || 0);
  const itemsCount = Number(context.itemsCount || 0);

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

  let discount = 0;
  if (coupon.type === "percent") {
    discount = subtotal * (Number(coupon.value || 0) / 100);
  } else if (coupon.type === "fixed") {
    discount = Number(coupon.value || 0);
  }

  discount = roundCurrency(Math.max(0, Math.min(discount, subtotal)));

  return {
    valid: true,
    coupon: {
      code: coupon.code,
      label: coupon.label || coupon.code,
      type: coupon.type,
      value: coupon.value,
      discount
    }
  };
}

module.exports = {
  roundCurrency,
  normalizeCouponCode,
  getCouponByCode,
  validateCoupon
};
