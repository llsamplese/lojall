const { validateCoupon, roundCurrency } = require("./coupon-utils");
const { getStoreConfig } = require("./store-config");

const CARD_SURCHARGE = 1.0524;
const PAYPAL_SURCHARGE = 1.0161;
const PAYPAL_FIXED_FEE = 0.60;

function applyGlobalPricing(basePrice, globalPricing = {}) {
  const numericBase = roundCurrency(basePrice || 0);
  if (!globalPricing?.active || numericBase <= 0) return numericBase;

  const value = Number(globalPricing.value || 0);
  if (value <= 0) return numericBase;

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
  if (!normalizedCode) return null;

  const pkg = packages[normalizedCode];
  if (!pkg || !pkg.active) return null;

  const validUntil = String(pkg.validUntil || "").trim();
  if (validUntil) {
    const parsed = new Date(validUntil);
    if (!Number.isNaN(parsed.getTime()) && Date.now() > parsed.getTime()) return null;
  }

  const mode = pkg.mode === "fixed_set" ? "fixed_set" : "custom_choice";
  const subtotal = roundCurrency(items.reduce((sum, item) => sum + (Number(item.unit_price || 0) * Number(item.quantity || 0)), 0));
  const fixedPrice = roundCurrency(Number(pkg.fixedPrice || 0));
  if (fixedPrice <= 0) return null;

  if (mode === "custom_choice") {
    const packageQuantity = Math.max(0, parseInt(String(pkg.quantity || 0), 10) || 0);
    if (!packageQuantity) return null;

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
      appliedSubtotal: roundCurrency(subtotal - discount),
      discount
    };
  }

  const includedItems = Array.isArray(pkg.includedItems)
    ? pkg.includedItems.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  if (!includedItems.length) return null;

  const selectedTitles = new Set(items.map((item) => String(item.title || "").trim()));
  const matchedItems = items.filter((item) => includedItems.includes(String(item.title || "").trim()));
  const quantity = matchedItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const includedSubtotal = roundCurrency(matchedItems.reduce((sum, item) => sum + (Number(item.unit_price || 0) * Number(item.quantity || 0)), 0));
  const packageQuantity = includedItems.length;
  if (!packageQuantity) return null;

  const eligible = includedItems.every((title) => selectedTitles.has(title));
  if (!eligible) {
    return { ...pkg, mode, code: normalizedCode, includedItems, quantity: packageQuantity, eligible: false, quantitySelected: quantity, subtotal, includedSubtotal, fixedPrice, appliedSubtotal: subtotal, discount: 0 };
  }

  const discount = roundCurrency(Math.max(0, includedSubtotal - fixedPrice));
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
    appliedSubtotal: roundCurrency(subtotal - discount),
    discount
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
      const unitPrice = override.active && Number(override.promoPrice) > 0
        ? roundCurrency(override.promoPrice)
        : applyGlobalPricing(item?.unit_price || 0, globalPricing);

      return {
        title,
        unit_price: unitPrice,
        quantity: Number(item?.quantity || 1)
      };
    })
    .filter((item) => item.title && item.unit_price > 0 && item.quantity > 0);
}

async function buildTotals(items, couponCode, packageCode) {
  const subtotal = roundCurrency(items.reduce((sum, item) => sum + (item.unit_price * item.quantity), 0));
  const config = await getStoreConfig();
  const packageState = resolvePackageForItems(items, packageCode, config?.packages || {});
  const couponSubtotal = packageState?.eligible ? packageState.appliedSubtotal : subtotal;
  const couponResult = await validateCoupon(couponCode, {
    subtotal: couponSubtotal,
    itemsCount: items.reduce((sum, item) => sum + item.quantity, 0),
    hasPackage: Boolean(packageState?.eligible)
  });

  if (couponCode && !couponResult.valid) {
    throw new Error(couponResult.error || "Cupom inválido.");
  }

  const packageDiscount = packageState?.eligible ? roundCurrency(packageState.discount || 0) : 0;
  const discount = couponResult.valid ? couponResult.coupon.discount : 0;
  const discountedSubtotal = roundCurrency(Math.max(0, couponSubtotal - discount));

  const cardTotal = roundCurrency(discountedSubtotal * CARD_SURCHARGE);
  const paypalFee = roundCurrency((cardTotal * (PAYPAL_SURCHARGE - 1)) + PAYPAL_FIXED_FEE);
  const paypalTotal = roundCurrency(cardTotal + paypalFee);

  return {
    subtotal,
    package: packageState,
    packageDiscount,
    packageAdjustedSubtotal: couponSubtotal,
    discount,
    pix: discountedSubtotal,
    card: cardTotal,
    paypal: paypalTotal,
    paypalFee,
    coupon: couponResult.valid ? couponResult.coupon : null
  };
}

function buildDescription(items) {
  if (items.length === 1) return items[0].title;
  return `Pedido LL Samples (${items.length} itens)`;
}

module.exports = {
  applyGlobalPricing,
  buildDescription,
  buildTotals,
  resolvePackageForItems,
  sanitizeItems
};
