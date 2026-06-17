function parseBrazilianNumber(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value).trim();
  if (!text) {
    return null;
  }

  const sanitized = text.replace(/[^\d,.-]/g, "");
  const normalized = sanitized.includes(",")
    ? sanitized.replace(/\./g, "").replace(",", ".")
    : sanitized;
  const parsed = Number.parseFloat(normalized);

  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeUnit(unit) {
  const raw = String(unit || "")
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase();

  const units = {
    M3: "m³",
    "M³": "m³",
    M2: "m²",
    "M²": "m²",
    M: "m",
    UN: "un",
    UND: "un",
    UNID: "un",
    KG: "kg",
    H: "h",
    HR: "h",
    T: "t",
    TON: "t"
  };

  return units[raw] || raw.toLowerCase();
}

function normalizeSearchText(value) {
  return String(value || "")
    .replace(/²/g, "2")
    .replace(/³/g, "3")
    .replace(/ª/g, "a")
    .replace(/º/g, "o")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\w\s.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildSearchText(service) {
  return normalizeSearchText(
    [
      service.conta,
      service.codigo,
      service.descricao,
      service.unidade,
      service.caminho,
      String(service.unidade || "").replace("²", "2").replace("³", "3")
    ].join(" ")
  );
}

module.exports = {
  buildSearchText,
  normalizeSearchText,
  normalizeUnit,
  parseBrazilianNumber
};
