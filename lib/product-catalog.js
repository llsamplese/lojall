const fs = require("fs");
const path = require("path");
const vm = require("vm");

const INDEX_PATH = path.join(process.cwd(), "index.html");

function loadCatalogFromIndex() {
  const content = fs.readFileSync(INDEX_PATH, "utf8");
  const match = content.match(/const samplesData = \[(?<body>[\s\S]*?)\n\s*\];/);
  if (!match?.groups?.body) {
    throw new Error("Não foi possível localizar samplesData no index.html.");
  }

  const arrayLiteral = `[${match.groups.body}]`;
  const samples = vm.runInNewContext(arrayLiteral);
  if (!Array.isArray(samples)) {
    throw new Error("Catálogo inválido em index.html.");
  }

  return samples.map((sample) => ({
    nome: String(sample?.nome || "").trim(),
    valor: Number(sample?.valor || 0),
    video: String(sample?.video || "").trim()
  })).filter((sample) => sample.nome);
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
