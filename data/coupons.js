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
  }
};

for (let percent = 1; percent <= 99; percent += 1) {
  const code = `TESTE${percent}`;
  COUPONS[code] = {
    code,
    label: `Teste ${percent}%`,
    active: true,
    type: "percent",
    value: percent,
    minSubtotal: 0,
    minItems: 1
  };
}

module.exports = COUPONS;
