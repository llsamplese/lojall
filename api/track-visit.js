const { appendSiteVisit } = require("../lib/github-traffic-log");

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
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || "Erro ao registrar visita." });
  }
};
