const STORE_CONFIG = require("../data/store-config.json");
const { normalizeConfig } = require("./store-config");

function getBundledStoreConfig() {
  return normalizeConfig(STORE_CONFIG);
}

module.exports = {
  getBundledStoreConfig
};
