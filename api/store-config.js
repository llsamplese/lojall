const { getStoreConfig, saveStoreConfig } = require("../lib/store-config");
const { getCouponsMap } = require("../lib/coupon-utils");
const BASE_COUPONS = require("../data/coupons");
const { loadCatalogFromIndex } = require("../lib/product-catalog");
const { appendSiteVisit, appendTrafficRecord, getTrafficStats, isGithubTrafficConfigured } = require("../lib/github-traffic-log");

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
      if (String(body.action || "").trim() === "track_event") {
        const allowedEvents = new Set([
          "checkout_opened",
          "pix_submit_clicked",
          "process_payment_started",
          "pix_created",
          "pix_failed"
        ]);
        const eventName = String(body.eventName || "").trim();
        if (!allowedEvents.has(eventName)) {
          return res.status(400).json({ error: "Evento invÃ¡lido." });
        }

        const pageType = ["home", "product_direct", "package_direct"].includes(String(body.pageType || "").trim())
          ? String(body.pageType).trim()
          : "home";

        await appendTrafficRecord({
          created_at: new Date().toISOString(),
          source: "checkout_event",
          event_name: eventName,
          page_type: pageType,
          path: String(body.path || "").trim(),
          payment_method_id: String(body.paymentMethodId || "").trim(),
          payment_id: String(body.paymentId || "").trim(),
          status: String(body.status || "").trim(),
          status_detail: String(body.statusDetail || "").trim(),
          error_message: String(body.errorMessage || "").trim(),
          cart_count: Number(body.cartCount || 0),
          total_pix: Number(body.totalPix || 0),
          total_card: Number(body.totalCard || 0),
          coupon_code: String(body.couponCode || "").trim(),
          package_code: String(body.packageCode || "").trim(),
          referrer: String(req.headers.referer || "").trim(),
          user_agent: String(req.headers["user-agent"] || "").trim()
        });

        return res.status(200).json({ ok: true });
      }
      const nextConfig = body.config || body;
      if (nextConfig && nextConfig.coupons && typeof nextConfig.coupons === "object") {
        const currentCodes = new Set(Object.keys(nextConfig.coupons).map((code) => String(code || "").trim().toUpperCase()).filter(Boolean));
        nextConfig.deletedCoupons = Object.keys(BASE_COUPONS).filter((code) => !currentCodes.has(String(code || "").trim().toUpperCase()));
        nextConfig.couponRuntime = nextConfig.couponRuntime && typeof nextConfig.couponRuntime === "object" ? nextConfig.couponRuntime : {};
        const hasPublicActiveCoupons = Object.values(nextConfig.coupons).some((coupon) => coupon && coupon.active && !coupon.hidden);
        if (hasPublicActiveCoupons) {
          nextConfig.couponRuntime.hideHomeCouponsAfterExpiry = false;
          nextConfig.couponRuntime.lastAutoExpiredAt = "";
        }
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
