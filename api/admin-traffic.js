const { getTrafficStats, isGithubTrafficConfigured } = require("../lib/github-traffic-log");

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Método não permitido." });
  }

  if (!isGithubTrafficConfigured()) {
    return res.status(500).json({ error: "Log no GitHub não está configurado na Vercel." });
  }

  try {
    const stats = await getTrafficStats();
    return res.status(200).json({ ok: true, stats });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Erro ao carregar visitas." });
  }
};
