const { initDatabase, replaceServices } = require("../src/server/database");
const { scrapeSeinfra } = require("../src/server/scraper");

let syncInProgress = false;

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function getScrapeOptions() {
  if (!process.env.VERCEL) {
    return {
      onLog: (message) => console.log(message)
    };
  }

  return {
    delayMs: Number(process.env.SEINFRA_DELAY_MS || 0),
    maxDepth: Number(process.env.SEINFRA_MAX_DEPTH || 4),
    maxPages: Number(process.env.SEINFRA_MAX_PAGES || 80),
    onLog: () => {},
    useBrowserFallback: false
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { success: false, message: "Metodo nao permitido." });
    return;
  }

  if (syncInProgress) {
    sendJson(res, 409, {
      success: false,
      message: "A sincronizacao da base SEINFRA ja esta em andamento."
    });
    return;
  }

  syncInProgress = true;

  try {
    await initDatabase();
    const scrapeResult = await scrapeSeinfra(getScrapeOptions());

    if (scrapeResult.services.length === 0) {
      sendJson(res, 502, {
        success: false,
        message: "Nenhum servico foi encontrado na SEINFRA. A base local nao foi alterada.",
        errors: scrapeResult.errors
      });
      return;
    }

    const saved = await replaceServices(scrapeResult.services);
    sendJson(res, 200, {
      success: true,
      changed: saved.changed,
      total: saved.total,
      checkedAt: saved.checkedAt,
      updatedAt: saved.updatedAt,
      visitedPages: scrapeResult.visitedPages,
      errors: scrapeResult.errors,
      foundKnownServices: scrapeResult.foundKnownServices,
      message: saved.changed
        ? `Base SEINFRA atualizada com ${saved.total} servicos.`
        : "Base SEINFRA conferida. Nenhuma alteracao encontrada."
    });
  } catch (error) {
    sendJson(res, 500, {
      success: false,
      message: error.message || "Erro interno do servidor."
    });
  } finally {
    syncInProgress = false;
  }
};
