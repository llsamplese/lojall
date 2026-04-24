const { getStoreConfig, saveStoreConfig } = require("../lib/store-config");
const { getCouponsMap } = require("../lib/coupon-utils");
const BASE_COUPONS = require("../data/coupons");
const { loadCatalogFromIndex } = require("../lib/product-catalog");
const { appendSiteVisit, getTrafficStats, isGithubTrafficConfigured } = require("../lib/github-traffic-log");

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
      const view = String(req.query?.view || "").trim().toLowerCase();
      if (view === "products") {
        const products = loadCatalogFromIndex();
        return res.status(200).json({ ok: true, products });
      }
      if (view === "traffic") {
        if (!isGithubTrafficConfigured()) {
          return res.status(500).json({ error: "Log no GitHub não está configurado na Vercel." });
        }
        const stats = await getTrafficStats();
        return res.status(200).json({ ok: true, stats });
      }
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
      if (String(body.action || "").trim() === "track_visit") {
        const pageType = ["home", "product_direct", "package_direct"].includes(String(body.pageType || "").trim())
          ? String(body.pageType).trim()
          : "home";

        await appendSiteVisit({
          created_at: new Date().toISOString(),
          source: "storefront_visit",
          page_type: pageType,
          path: String(body.path || "").trim(),
          referrer: String(req.headers.referer || "").trim(),
          user_agent: String(req.headers["user-agent"] || "").trim()
        });

        return res.status(200).json({ ok: true });
      }
      const nextConfig = body.config || body;
      if (nextConfig && nextConfig.coupons && typeof nextConfig.coupons === "object") {
        const currentCodes = new Set(Object.keys(nextConfig.coupons).map((code) => String(code || "").trim().toUpperCase()).filter(Boolean));
        nextConfig.deletedCoupons = Object.keys(BASE_COUPONS).filter((code) => !currentCodes.has(String(code || "").trim().toUpperCase()));
      }
      const config = await saveStoreConfig(nextConfig);
      const coupons = await getCouponsMap();
      return res.status(200).json({ ok: true, config, coupons });
    } catch (error) {
      return res.status(500).json({ error: error.message || "Erro ao salvar configuração da loja." });
    }
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "Método não permitido." });
};
