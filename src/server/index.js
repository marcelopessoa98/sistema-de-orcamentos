const path = require("path");
const express = require("express");
const routes = require("./routes");
const { initDatabase } = require("./database");

const app = express();
const port = Number(process.env.PORT || 3000);
const publicDir = path.resolve(__dirname, "../../public");
const rootDir = path.resolve(__dirname, "../..");
const databaseReady = initDatabase();

app.use(express.json({ limit: "5mb" }));
app.use(express.static(publicDir));
app.use("/vendor/fuse.min.mjs", express.static(path.join(rootDir, "node_modules/fuse.js/dist/fuse.min.mjs")));
app.use("/vendor/lucide.min.js", express.static(path.join(rootDir, "node_modules/lucide/dist/umd/lucide.min.js")));
app.use(async (_req, _res, next) => {
  try {
    await databaseReady;
    next();
  } catch (error) {
    next(error);
  }
});
app.use("/api", routes);

app.get("*", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({
    success: false,
    message: error.message || "Erro interno do servidor."
  });
});

if (require.main === module) {
  databaseReady
    .then(() => {
      app.listen(port, () => {
        console.log(`Sistema de Orçamento SEINFRA em http://localhost:${port}`);
      });
    })
    .catch((error) => {
      console.error("Falha ao inicializar o banco SQLite:", error);
      process.exit(1);
    });
}

module.exports = app;
