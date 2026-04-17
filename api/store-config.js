const { getStoreConfig, saveStoreConfig } = require("../lib/store-config");
const { getCouponsMap } = require("../lib/coupon-utils");

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
  if (req.method === "GET") {
    try {
      const config = await getStoreConfig();
      const coupons = await getCouponsMap();
      return res.status(200).json({ ok: true, config, coupons });
    } catch (error) {
      return res.status(500).json({ error: error.message || "Erro ao carregar configuração da loja." });
    }
  }

  if (req.method === "POST") {
    try {
      const body = parseBody(req);
      const config = await saveStoreConfig(body.config || body);
      const coupons = await getCouponsMap();
      return res.status(200).json({ ok: true, config, coupons });
    } catch (error) {
      return res.status(500).json({ error: error.message || "Erro ao salvar configuração da loja." });
    }
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "Método não permitido." });
};