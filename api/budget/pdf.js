const { jsPDF } = require("jspdf");
const autoTableModule = require("jspdf-autotable");

const autoTable = autoTableModule.default || autoTableModule.autoTable || autoTableModule;

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

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
  doc.text("Orcamento SEINFRA", 14, 16);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(`Data de emissao: ${emittedAt.toLocaleDateString("pt-BR")}`, 14, 23);

  addTable(doc, {
    startY: 30,
    head: [[
      "Atividade",
      "Conta",
      "Codigo",
      "Descricao",
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

async function readJsonBody(req) {
  if (req.body) {
    if (Buffer.isBuffer(req.body)) {
      return JSON.parse(req.body.toString("utf8"));
    }

    return typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  }

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const body = Buffer.concat(chunks).toString("utf8");
  return body ? JSON.parse(body) : {};
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { success: false, message: "Metodo nao permitido." });
    return;
  }

  try {
    const body = await readJsonBody(req);
    const items = Array.isArray(body) ? body : body?.items;

    if (!Array.isArray(items) || items.length === 0) {
      sendJson(res, 400, {
        success: false,
        message: "Envie ao menos um item de orcamento."
      });
      return;
    }

    const pdf = buildBudgetPdf(items);

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="orcamento-seinfra.pdf"');
    res.end(pdf);
  } catch (error) {
    sendJson(res, 500, {
      success: false,
      message: error.message || "Erro interno do servidor."
    });
  }
};
