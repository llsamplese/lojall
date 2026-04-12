const { validateCoupon, roundCurrency } = require("../lib/coupon-utils");

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

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Método não permitido." });
  }

  try {
    const body = parseBody(req);
    const subtotal = roundCurrency(body.subtotal || 0);
    const itemsCount = Number(body.itemsCount || 0);
    const result = validateCoupon(body.code, { subtotal, itemsCount });

    if (!result.valid) {
      return res.status(400).json(result);
    }

    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({ valid: false, error: error.message || "Erro ao validar cupom." });
  }
};
