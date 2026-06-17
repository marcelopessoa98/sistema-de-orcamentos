const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");

const dataDir = path.resolve(__dirname, "../../data");
const defaultDbPath = process.env.VERCEL
  ? path.join("/tmp", "seinfra.sqlite")
  : path.join(dataDir, "seinfra.sqlite");
const dbPath = process.env.SEINFRA_DB_PATH || defaultDbPath;

let dbPromise;

function serviceKey(service) {
  return `${service.conta}|${service.codigo}`;
}

function serviceSnapshot(service) {
  return {
    conta: String(service.conta || ""),
    codigo: String(service.codigo || ""),
    descricao: String(service.descricao || ""),
    unidade: String(service.unidade || ""),
    valor_unitario: Number(service.valor_unitario || 0),
    caminho: String(service.caminho || ""),
    url_origem: String(service.url_origem || ""),
    texto_busca: String(service.texto_busca || "")
  };
}

function hasServiceChanges(currentServices, nextServices) {
  if (currentServices.length !== nextServices.length) {
    return true;
  }

  const currentByKey = new Map(
    currentServices.map((service) => [serviceKey(service), serviceSnapshot(service)])
  );

  return nextServices.some((service) => {
    const current = currentByKey.get(serviceKey(service));
    const next = serviceSnapshot(service);

    if (!current) {
      return true;
    }

    return Object.keys(next).some((key) => current[key] !== next[key]);
  });
}

async function getDb() {
  if (!dbPromise) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    dbPromise = open({
      filename: dbPath,
      driver: sqlite3.Database
    });
  }

  return dbPromise;
}

async function initDatabase() {
  const db = await getDb();
  await db.exec(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conta TEXT NOT NULL,
      codigo TEXT NOT NULL,
      descricao TEXT NOT NULL,
      unidade TEXT NOT NULL,
      valor_unitario REAL NOT NULL,
      caminho TEXT,
      url_origem TEXT,
      texto_busca TEXT,
      data_atualizacao TEXT NOT NULL,
      UNIQUE(conta, codigo)
    );

    CREATE INDEX IF NOT EXISTS idx_services_codigo ON services(codigo);
    CREATE INDEX IF NOT EXISTS idx_services_unidade ON services(unidade);
    CREATE INDEX IF NOT EXISTS idx_services_texto_busca ON services(texto_busca);

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

async function replaceServices(services) {
  const db = await getDb();
  const checkedAt = new Date().toISOString();
  const currentServices = await getServices();
  const changed = hasServiceChanges(currentServices, services);

  if (!changed) {
    await setMeta("last_check", checkedAt);
    return {
      changed: false,
      checkedAt,
      total: services.length,
      updatedAt: await getMeta("last_sync")
    };
  }

  const updatedAt = checkedAt;

  await db.exec("BEGIN TRANSACTION");

  try {
    await db.run("DELETE FROM services");

    const statement = await db.prepare(`
      INSERT INTO services (
        conta,
        codigo,
        descricao,
        unidade,
        valor_unitario,
        caminho,
        url_origem,
        texto_busca,
        data_atualizacao
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(conta, codigo) DO UPDATE SET
        descricao = excluded.descricao,
        unidade = excluded.unidade,
        valor_unitario = excluded.valor_unitario,
        caminho = excluded.caminho,
        url_origem = excluded.url_origem,
        texto_busca = excluded.texto_busca,
        data_atualizacao = excluded.data_atualizacao
    `);

    for (const service of services) {
      await statement.run(
        service.conta,
        service.codigo,
        service.descricao,
        service.unidade,
        service.valor_unitario,
        service.caminho || "",
        service.url_origem || "",
        service.texto_busca || "",
        updatedAt
      );
    }

    await statement.finalize();
    await setMeta("last_sync", updatedAt);
    await setMeta("last_check", checkedAt);
    await db.exec("COMMIT");

    return { changed: true, checkedAt, updatedAt, total: services.length };
  } catch (error) {
    await db.exec("ROLLBACK");
    throw error;
  }
}

async function getServices() {
  const db = await getDb();
  return db.all(`
    SELECT *
    FROM services
    ORDER BY id
  `);
}

async function searchServices({ q = "", unit = "", limit = 200 } = {}) {
  const db = await getDb();
  const params = [];
  const clauses = ["1 = 1"];
  const tokens = String(q || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  for (const token of tokens) {
    clauses.push("texto_busca LIKE ?");
    params.push(`%${token}%`);
  }

  if (unit) {
    clauses.push("unidade = ?");
    params.push(unit);
  }

  params.push(Number(limit) || 200);

  return db.all(
    `
      SELECT *
      FROM services
      WHERE ${clauses.join(" AND ")}
      ORDER BY id
      LIMIT ?
    `,
    params
  );
}

async function getStats() {
  const db = await getDb();
  const row = await db.get("SELECT COUNT(*) AS total, MAX(data_atualizacao) AS lastUpdate FROM services");
  const lastSync = await getMeta("last_sync");
  const lastCheck = await getMeta("last_check");

  return {
    total: row?.total || 0,
    lastUpdate: row?.lastUpdate || lastSync || null,
    lastCheck: lastCheck || null
  };
}

async function setMeta(key, value) {
  const db = await getDb();
  await db.run(
    `
      INSERT INTO meta (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `,
    key,
    value
  );
}

async function getMeta(key) {
  const db = await getDb();
  const row = await db.get("SELECT value FROM meta WHERE key = ?", key);
  return row?.value || null;
}

module.exports = {
  dbPath,
  getServices,
  getStats,
  initDatabase,
  replaceServices,
  searchServices
};
