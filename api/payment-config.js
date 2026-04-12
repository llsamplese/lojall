module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Método não permitido." });
  }

  if (!process.env.MP_PUBLIC_KEY) {
    return res.status(500).json({ error: "MP_PUBLIC_KEY não configurada na Vercel." });
  }

  return res.status(200).json({
    publicKey: process.env.MP_PUBLIC_KEY
  });
};
