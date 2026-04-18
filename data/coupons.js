const COUPONS = {
  BEMVINDO10: {
    code: "BEMVINDO10",
    label: "Bem-vindo 10%",
    active: false,
    type: "percent",
    value: 10,
    minSubtotal: 0,
    minItems: 1
  },
  LL20OFF: {
    code: "LL20OFF",
    label: "R$ 20 OFF",
    active: false,
    type: "fixed",
    value: 20,
    minSubtotal: 140,
    minItems: 2
  },
  TESTE98: {
    code: "TESTE98",
    label: "Teste 98%",
    active: true,
    type: "percent",
    value: 98,
    minSubtotal: 0,
    minItems: 1
  },
  TESTE99: {
    code: "TESTE99",
    label: "Teste 99%",
    active: true,
    type: "percent",
    value: 99,
    minSubtotal: 0,
    minItems: 1
  }
};

module.exports = COUPONS;
