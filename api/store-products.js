const { loadCatalogFromIndex } = require("../lib/product-catalog");

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Método não permitido." });
  }

  try {
    const products = loadCatalogFromIndex();
    return res.status(200).json({ ok: true, products });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Erro ao carregar catálogo." });
  }
};
