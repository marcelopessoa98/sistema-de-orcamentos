const { getStats, initDatabase } = require("../src/server/database");

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    sendJson(res, 405, { success: false, message: "Metodo nao permitido." });
    return;
  }

  try {
    await initDatabase();
    const stats = await getStats();
    sendJson(res, 200, {
      status: "online",
      timestamp: new Date().toISOString(),
      database: stats
    });
  } catch (error) {
    sendJson(res, 500, {
      success: false,
      message: error.message || "Erro interno do servidor."
    });
  }
};
