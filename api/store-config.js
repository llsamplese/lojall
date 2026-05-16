const { getStoreConfig, saveStoreConfig } = require("../lib/store-config");
const { getCouponsMap } = require("../lib/coupon-utils");
const BASE_COUPONS = require("../data/coupons");
const DOWNLOAD_LINKS = require("../data/download-links");
const { loadCatalogFromIndex } = require("../lib/product-catalog");
const { appendSiteVisit, appendTrafficRecord, getTrafficStats, isGithubTrafficConfigured } = require("../lib/github-traffic-log");
const {
  isGithubConfigured,
  getRepo,
  getBranch,
  getExistingFile,
  writeFile
} = require("../lib/github-repo");

const PRODUCTS_PATH = "data/products.js";
const DOWNLOAD_LINKS_PATH = "data/download-links.js";

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

function normalizePrice(value) {
  return Number(String(value ?? 0).replace(",", ".")) || 0;
}

function getProductsWithDownloads() {
  return loadCatalogFromIndex().map((product, index) => {
    const nome = String(product?.nome || "").trim();
    return {
      nome,
      valor: normalizePrice(product?.valor),
      video: String(product?.video || "").trim(),
      downloadUrl: String(DOWNLOAD_LINKS?.[nome] || "").trim(),
      order: index + 1,
      originalName: nome
    };
  });
}

function normalizeProduct(product, index) {
  return {
    originalName: String(product?.originalName || product?.nome || "").trim(),
    nome: String(product?.nome || "").trim(),
    valor: normalizePrice(product?.valor),
    video: String(product?.video || "").trim(),
    downloadUrl: String(product?.downloadUrl || product?.download_url || "").trim(),
    order: Number.parseInt(String(product?.order || index + 1), 10) || index + 1
  };
}

function normalizeProductList(inputProducts) {
  if (!Array.isArray(inputProducts)) {
    throw new Error("Envie a lista de produtos para salvar.");
  }

  const products = inputProducts
    .map(normalizeProduct)
    .filter((product) => product.nome)
    .sort((a, b) => a.order - b.order || a.nome.localeCompare(b.nome, "pt-BR"));

  if (!products.length) {
    throw new Error("Cadastre pelo menos um sample.");
  }

  const names = new Set();
  products.forEach((product) => {
    const key = product.nome.toLowerCase();
    if (names.has(key)) {
      throw new Error(`Produto duplicado: ${product.nome}`);
    }
    names.add(key);
  });

  return products.map((product, index) => ({
    ...product,
    order: index + 1
  }));
}

function serializeProducts(products) {
  const publicProducts = products.map((product) => ({
    nome: product.nome,
    valor: product.valor,
    video: product.video
  }));

  return `const LL_PRODUCTS = ${JSON.stringify(publicProducts, null, 2)};\n\nif (typeof module !== "undefined" && module.exports) {\n  module.exports = LL_PRODUCTS;\n}\n\nif (typeof window !== "undefined") {\n  window.LL_PRODUCTS = LL_PRODUCTS;\n}\n`;
}

function serializeDownloadLinks(downloadLinks) {
  return `module.exports = ${JSON.stringify(downloadLinks, null, 2)};\n`;
}

function buildNextDownloadLinks(products) {
  const nextLinks = { ...(DOWNLOAD_LINKS || {}) };
  const activeNames = new Set(products.map((product) => product.nome));
  const previousNames = new Set(loadCatalogFromIndex().map((product) => product.nome));

  products.forEach((product) => {
    if (product.originalName && product.originalName !== product.nome) {
      delete nextLinks[product.originalName];
    }

    if (product.downloadUrl) {
      nextLinks[product.nome] = product.downloadUrl;
    } else {
      delete nextLinks[product.nome];
    }
  });

  previousNames.forEach((name) => {
    if (!activeNames.has(name)) {
      delete nextLinks[name];
    }
  });

  const orderedLinks = products.reduce((acc, product) => {
    if (nextLinks[product.nome]) acc[product.nome] = nextLinks[product.nome];
    return acc;
  }, {});

  Object.keys(nextLinks).sort((a, b) => a.localeCompare(b, "pt-BR")).forEach((name) => {
    if (!orderedLinks[name]) orderedLinks[name] = nextLinks[name];
  });

  return orderedLinks;
}

async function saveProductsToGithub(inputProducts) {
  if (!isGithubConfigured()) {
    throw new Error("GitHub não está configurado na Vercel para salvar produtos.");
  }

  const products = normalizeProductList(inputProducts);
  const downloadLinks = buildNextDownloadLinks(products);
  const repo = getRepo();
  const branch = getBranch();
  const [productsFile, downloadLinksFile] = await Promise.all([
    getExistingFile(repo, PRODUCTS_PATH, branch),
    getExistingFile(repo, DOWNLOAD_LINKS_PATH, branch)
  ]);

  await writeFile(
    repo,
    PRODUCTS_PATH,
    branch,
    serializeProducts(products),
    productsFile.sha,
    "Update product catalog"
  );

  await writeFile(
    repo,
    DOWNLOAD_LINKS_PATH,
    branch,
    serializeDownloadLinks(downloadLinks),
    downloadLinksFile.sha,
    "Update product download links"
  );

  return products;
}

module.exports = async (req, res) => {
  if (req.method === "GET") {
    try {
      const view = String(req.query?.view || "").trim().toLowerCase();
      if (view === "products") {
        const products = getProductsWithDownloads();
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
      if (String(body.action || "").trim() === "save_products") {
        const products = await saveProductsToGithub(body.products);
        return res.status(200).json({ ok: true, products });
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
