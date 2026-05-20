/**
 * Минимальный пример Express + @inso_web/els-express.
 *
 * Запуск:
 *   ELS_API_KEY=els_live_xxxxxxxx npx tsx server.ts
 *
 * После запуска:
 *   curl http://localhost:3000/users/42
 *   curl http://localhost:3000/error
 */
import express from "express";
import {
  ELSClient,
  createELSExpressLogger,
  createELSErrorHandler,
} from "@inso_web/els-express";

const log = new ELSClient({
  apiKey: process.env.ELS_API_KEY || "els_live_xxxxxxxx",
  appSlug: "examples",
  serviceName: "express-basic",
  deploymentEnv: "DEV",
  minLevel: "info",
});

const app = express();
app.use(express.json());

// Middleware: req.log + req.id + auto-log finish
app.use(
  createELSExpressLogger({
    client: log,
    ignorePaths: ["/health"],
  }),
);

// Health check (не логируется благодаря ignorePaths)
app.get("/health", (_req, res) => res.json({ ok: true }));

// Простой handler — используем req.log как Pino
app.get("/users/:id", (req, res) => {
  req.log.info({ userId: req.params.id }, "Fetching user");
  res.json({ id: req.params.id, name: "Alice" });
});

// Handler с ошибкой — её поймает createELSErrorHandler
app.get("/error", (_req, _res) => {
  throw new Error("Demo error from /error endpoint");
});

// Handler с warning
app.post("/login", (req, res) => {
  req.log.warn({ ip: req.ip }, "Login attempt without 2FA");
  res.status(401).json({ error: "2FA required" });
});

// Error handler — последним
app.use(createELSErrorHandler(log));

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  log.info({ port }, "Express server started");
  console.log(`Server: http://localhost:${port}`);
});
