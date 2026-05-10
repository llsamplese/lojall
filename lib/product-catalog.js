const products = require('../data/products.js');

function normalizeCatalogProduct(sample) {
  return {
    nome: String(sample?.nome || '').trim(),
    valor: Number(sample?.valor || 0),
    video: String(sample?.video || '').trim()
  };
}

function loadCatalogFromIndex() {
  if (!Array.isArray(products)) {
    throw new Error('Catálogo inválido em data/products.js.');
  }

  return products
    .map(normalizeCatalogProduct)
    .filter((sample) => sample.nome);
}

function buildCatalogMap() {
  return loadCatalogFromIndex().reduce((acc, sample) => {
    acc[sample.nome] = sample;
    return acc;
  }, {});
}

module.exports = {
  loadCatalogFromIndex,
  buildCatalogMap
};
