const express = require("express");
const { jsPDF } = require("jspdf");
const autoTableModule = require("jspdf-autotable");
const {
  getServices,
  getStats,
  replaceServices,
  searchServices
} = require("./database");
const { normalizeSearchText, normalizeUnit } = require("./normalization");
const { scrapeSeinfra } = require("./scraper");

const router = express.Router();
const autoTable = autoTableModule.default || autoTableModule.autoTable || autoTableModule;

let syncInProgress = false;

function formatCurrency(value) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(Number(value || 0));
}

function formatNumber(value) {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4
  }).format(Number(value || 0));
}

function addTable(doc, options) {
  if (typeof autoTable === "function") {
    autoTable(doc, options);
    return;
  }

  if (typeof doc.autoTable === "function") {
    doc.autoTable(options);
    return;
  }

  throw new Error("Plugin jspdf-autotable indisponivel.");
}

function buildBudgetPdf(items) {
  const doc = new jsPDF({
    orientation: "landscape",
    unit: "mm",
    format: "a4"
  });

  const emittedAt = new Date();
  const total = items.reduce(
    (sum, item) => sum + Number(item.quantidade || 0) * Number(item.valor_unitario || 0),
    0
  );

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("Orçamento SEINFRA", 14, 16);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(`Data de emissão: ${emittedAt.toLocaleDateString("pt-BR")}`, 14, 23);

  addTable(doc, {
    startY: 30,
    head: [[
      "Atividade",
      "Conta",
      "Código",
      "Descrição",
      "Un",
      "Qtd.",
      "Valor unit.",
      "Total"
    ]],
    body: items.map((item) => {
      const itemTotal = Number(item.quantidade || 0) * Number(item.valor_unitario || 0);
      return [
        item.atividade || "-",
        item.conta || "-",
        item.codigo || "-",
        item.descricao || "-",
        item.unidade || "-",
        formatNumber(item.quantidade),
        formatCurrency(item.valor_unitario),
        formatCurrency(itemTotal)
      ];
    }),
    styles: {
      font: "helvetica",
      fontSize: 8,
      cellPadding: 2,
      overflow: "linebreak",
      valign: "middle"
    },
    headStyles: {
      fillColor: [15, 76, 92],
      textColor: 255,
      fontStyle: "bold"
    },
    alternateRowStyles: {
      fillColor: [244, 247, 248]
    },
    columnStyles: {
      0: { cellWidth: 34 },
      1: { cellWidth: 18, halign: "center" },
      2: { cellWidth: 20, halign: "center" },
      3: { cellWidth: 92 },
      4: { cellWidth: 14, halign: "center" },
      5: { cellWidth: 20, halign: "right" },
      6: { cellWidth: 28, halign: "right" },
      7: { cellWidth: 28, halign: "right" }
    },
    margin: { left: 14, right: 14 }
  });

  const finalY = doc.lastAutoTable?.finalY || 30;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(`Total geral: ${formatCurrency(total)}`, 283, finalY + 10, { align: "right" });

  return Buffer.from(doc.output("arraybuffer"));
}

router.get("/health", async (_req, res, next) => {
  try {
    const stats = await getStats();
    res.json({
      status: "online",
      timestamp: new Date().toISOString(),
      database: stats
    });
  } catch (error) {
    next(error);
  }
});

router.post("/sync-seinfra", async (_req, res, next) => {
  if (syncInProgress) {
    res.status(409).json({
      success: false,
      message: "A sincronização da base SEINFRA já está em andamento."
    });
    return;
  }

  syncInProgress = true;

  try {
    const scrapeResult = await scrapeSeinfra({
      onLog: (message) => console.log(message)
    });

    if (scrapeResult.services.length === 0) {
      res.status(502).json({
        success: false,
        message: "Nenhum serviço foi encontrado na SEINFRA. A base local não foi alterada.",
        errors: scrapeResult.errors
      });
      return;
    }

    const saved = await replaceServices(scrapeResult.services);
    res.json({
      success: true,
      changed: saved.changed,
      total: saved.total,
      checkedAt: saved.checkedAt,
      updatedAt: saved.updatedAt,
      visitedPages: scrapeResult.visitedPages,
      errors: scrapeResult.errors,
      foundKnownServices: scrapeResult.foundKnownServices,
      message: saved.changed
        ? `Base SEINFRA atualizada com ${saved.total} serviços.`
        : "Base SEINFRA conferida. Nenhuma alteração encontrada."
    });
  } catch (error) {
    next(error);
  } finally {
    syncInProgress = false;
  }
});

router.get("/services", async (_req, res, next) => {
  try {
    const services = await getServices();
    const stats = await getStats();
    res.json({
      success: true,
      total: services.length,
      lastUpdate: stats.lastUpdate,
      lastCheck: stats.lastCheck,
      services
    });
  } catch (error) {
    next(error);
  }
});

router.get("/services/search", async (req, res, next) => {
  try {
    const q = normalizeSearchText(req.query.q || "");
    const unit = req.query.unit ? normalizeUnit(req.query.unit) : "";
    const services = await searchServices({
      q,
      unit,
      limit: Number(req.query.limit || 200)
    });

    res.json({
      success: true,
      total: services.length,
      services
    });
  } catch (error) {
    next(error);
  }
});

router.post("/budget/pdf", async (req, res, next) => {
  try {
    const items = Array.isArray(req.body) ? req.body : req.body?.items;

    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({
        success: false,
        message: "Envie ao menos um item de orçamento."
      });
      return;
    }

    const pdf = buildBudgetPdf(items);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="orcamento-seinfra.pdf"');
    res.send(pdf);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
