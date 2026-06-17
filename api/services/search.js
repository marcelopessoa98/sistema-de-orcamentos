const { initDatabase, searchServices } = require("../../src/server/database");
const { normalizeSearchText, normalizeUnit } = require("../../src/server/normalization");

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
    const query = req.query || {};
    const q = normalizeSearchText(query.q || "");
    const unit = query.unit ? normalizeUnit(query.unit) : "";
    const services = await searchServices({
      q,
      unit,
      limit: Number(query.limit || 200)
    });

    sendJson(res, 200, {
      success: true,
      total: services.length,
      services
    });
  } catch (error) {
    sendJson(res, 500, {
      success: false,
      message: error.message || "Erro interno do servidor."
    });
  }
};
