const path = require("path");
const cheerio = require("cheerio");
const {
  buildSearchText,
  normalizeUnit,
  parseBrazilianNumber
} = require("./normalization");

const DEFAULT_BASE_URL =
  "https://sin.seinfra.ce.gov.br/site-seinfra/siproce/desonerada/html/2.1.html?a=1698150683595";
const DEFAULT_MAX_PAGES = 1200;
const DEFAULT_MAX_DEPTH = 8;
const DEFAULT_DELAY_MS = 80;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function logWithHandler(onLog, message) {
  if (typeof onLog === "function") {
    onLog(message);
    return;
  }

  console.log(message);
}

async function fetchWithHttp(url) {
  if (typeof fetch !== "function") {
    throw new Error("Fetch nativo indisponivel nesta versao do Node.js.");
  }

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; OrcamentoSeinfraBot/1.0)",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ao acessar ${url}`);
  }

  return response.text();
}

async function fetchWithPlaywright(url) {
  const { chromium } = require("playwright");
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
    return await page.content();
  } finally {
    await browser.close();
  }
}

async function fetchPageHtml(url, useBrowserFallback = true) {
  try {
    return await fetchWithHttp(url);
  } catch (error) {
    if (!useBrowserFallback) {
      throw error;
    }

    return fetchWithPlaywright(url);
  }
}

function normalizeUrl(rawHref, currentUrl) {
  if (!rawHref) {
    return null;
  }

  const href = String(rawHref).trim();
  if (
    !href ||
    href.startsWith("#") ||
    href.startsWith("javascript:") ||
    href.startsWith("mailto:") ||
    href.startsWith("tel:")
  ) {
    return null;
  }

  let url;
  try {
    url = new URL(href, currentUrl);
  } catch {
    return null;
  }

  const isSameHost = url.hostname === "sin.seinfra.ce.gov.br";
  const isSameTable = url.pathname.includes("/site-seinfra/siproce/desonerada/");
  const isHtml = url.pathname.toLowerCase().endsWith(".html");
  const ignored = /download|imprimir|print|voltar/i.test(href) || /download/i.test(url.pathname);

  if (!isSameHost || !isSameTable || !isHtml || ignored) {
    return null;
  }

  url.hash = "";
  return url.toString();
}

function shouldFollowTableLink(url, includeCompositionLinks = false) {
  if (includeCompositionLinks) {
    return true;
  }

  const fileName = path.basename(new URL(url).pathname, ".html");
  return /^\d+(?:\.\d+)*$/.test(fileName);
}

function extractLinks(html, currentUrl, options = {}) {
  const $ = cheerio.load(html);
  const links = new Set();

  $("a[href]").each((_, element) => {
    const linkText = $(element).text().trim();
    if (/voltar|imprimir|download/i.test(linkText)) {
      return;
    }

    const url = normalizeUrl($(element).attr("href"), currentUrl);
    if (url && shouldFollowTableLink(url, options.includeCompositionLinks)) {
      links.add(url);
    }
  });

  return [...links];
}

function derivePathFromUrl(url) {
  const { pathname } = new URL(url);
  const fileName = path.basename(pathname, ".html");

  if (/^\d+(?:\.\d+)*$/.test(fileName)) {
    return fileName;
  }

  return "";
}

function extractServicesFromHtml(html, url) {
  const $ = cheerio.load(html);
  const pagePath = derivePathFromUrl(url);
  const services = [];

  $("table tbody tr").each((_, row) => {
    const cells = $(row)
      .find("td")
      .map((__, cell) => $(cell).text().replace(/\s+/g, " ").trim())
      .get();

    if (cells.length < 5) {
      return;
    }

    const [conta, codigo, descricao, unidadeRaw, valorRaw] = cells;
    const value = parseBrazilianNumber(valorRaw);
    const unit = normalizeUnit(unidadeRaw);

    if (!/^\d+(?:\.\d+)+$/.test(conta)) {
      return;
    }

    if (!/^[A-Z]{1,4}\d{2,6}$/i.test(codigo)) {
      return;
    }

    if (!descricao || value === null) {
      return;
    }

    const service = {
      conta,
      codigo: codigo.toUpperCase(),
      descricao,
      unidade: unit,
      valor_unitario: value,
      caminho: pagePath || conta.split(".").slice(0, -1).join("."),
      url_origem: url
    };

    service.texto_busca = buildSearchText(service);
    services.push(service);
  });

  return services;
}

async function scrapeSeinfra(options = {}) {
  const baseUrl = options.baseUrl || process.env.SEINFRA_BASE_URL || DEFAULT_BASE_URL;
  const maxPages = Number(options.maxPages || process.env.SEINFRA_MAX_PAGES || DEFAULT_MAX_PAGES);
  const maxDepth = Number(options.maxDepth || process.env.SEINFRA_MAX_DEPTH || DEFAULT_MAX_DEPTH);
  const delayMs = Number(options.delayMs ?? process.env.SEINFRA_DELAY_MS ?? DEFAULT_DELAY_MS);
  const onLog = options.onLog;
  const visited = new Set();
  const queued = new Set([baseUrl]);
  const queue = [{ url: baseUrl, depth: 0 }];
  const servicesByKey = new Map();
  const errors = [];

  logWithHandler(onLog, `Iniciando coleta SEINFRA em ${baseUrl}`);

  while (queue.length > 0 && visited.size < maxPages) {
    const current = queue.shift();
    queued.delete(current.url);

    if (visited.has(current.url) || current.depth > maxDepth) {
      continue;
    }

    visited.add(current.url);
    logWithHandler(onLog, `[${visited.size}/${maxPages}] ${current.url}`);

    try {
      const html = await fetchPageHtml(current.url, options.useBrowserFallback !== false);
      const services = extractServicesFromHtml(html, current.url);

      for (const service of services) {
        servicesByKey.set(`${service.conta}|${service.codigo}`, service);
      }

      if (current.depth < maxDepth) {
        for (const link of extractLinks(html, current.url, {
          includeCompositionLinks: options.includeCompositionLinks ||
            process.env.SEINFRA_INCLUDE_COMPOSITIONS === "true"
        })) {
          if (!visited.has(link) && !queued.has(link)) {
            queued.add(link);
            queue.push({ url: link, depth: current.depth + 1 });
          }
        }
      }
    } catch (error) {
      const message = `${current.url}: ${error.message}`;
      errors.push(message);
      logWithHandler(onLog, `Erro ignorado: ${message}`);
    }

    if (delayMs > 0) {
      await sleep(delayMs);
    }
  }

  const services = [...servicesByKey.values()].sort((a, b) =>
    `${a.conta} ${a.codigo}`.localeCompare(`${b.conta} ${b.codigo}`, "pt-BR", { numeric: true })
  );

  return {
    services,
    total: services.length,
    visitedPages: visited.size,
    errors,
    foundKnownServices: {
      C5011: services.some((service) => service.codigo === "C5011"),
      C2779: services.some((service) => service.codigo === "C2779")
    }
  };
}

async function syncDatabase() {
  const { initDatabase, replaceServices } = require("./database");
  await initDatabase();

  const result = await scrapeSeinfra({
    onLog: (message) => console.log(message)
  });

  if (result.services.length === 0) {
    throw new Error("Nenhum servico foi encontrado. A base local nao foi alterada.");
  }

  const saved = await replaceServices(result.services);
  console.log(`Base atualizada com ${saved.total} servicos em ${saved.updatedAt}.`);
  return saved;
}

async function testKnownServices() {
  const result = await scrapeSeinfra({
    maxPages: 40,
    maxDepth: 2,
    delayMs: 0,
    useBrowserFallback: false,
    onLog: () => {}
  });

  const missing = Object.entries(result.foundKnownServices)
    .filter(([, found]) => !found)
    .map(([code]) => code);

  if (missing.length > 0) {
    throw new Error(`Servicos esperados nao encontrados: ${missing.join(", ")}`);
  }

  console.log(`Teste OK: C5011 e C2779 encontrados em ${result.total} servicos.`);
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const action = args.includes("--test") ? "test" : "sync";

  const runner = action === "test" ? testKnownServices : syncDatabase;
  runner().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_BASE_URL,
  extractLinks,
  extractServicesFromHtml,
  scrapeSeinfra,
  testKnownServices
};
