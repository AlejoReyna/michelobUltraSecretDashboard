import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import cors from "cors";
import express, { type Request, type Response, type NextFunction } from "express";
import { loadConfig, type ExporterConfig } from "./config.js";
import { getHealth } from "./health.js";
import { redact } from "./redact.js";
import { getDecisions, getExecutions, getGuardrails, getPositions, getStatus, getWallet, parseLimit } from "./telemetry.js";
import { startTwakAutoRefresh, stopTwakAutoRefresh } from "./twak.js";

function authMatches(authorization: string | undefined, expectedToken: string): boolean {
  const presented = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];

  if (!presented) {
    return false;
  }

  const actual = Buffer.from(presented);
  const expected = Buffer.from(expectedToken);

  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function sendJson(res: Response, payload: unknown, status = 200) {
  res.status(status).json(redact(payload));
}

export function createApp(config: ExporterConfig = loadConfig()) {
  const app = express();

  app.disable("x-powered-by");
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin) {
          callback(null, true);
          return;
        }

        if (config.dashboardOrigin && origin === config.dashboardOrigin) {
          callback(null, true);
          return;
        }

        callback(new Error("Origin not allowed"));
      },
    }),
  );

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path === "/health") {
      next();
      return;
    }

    if (!config.token) {
      sendJson(res, { ok: false, error: "AGENT_EXPORTER_TOKEN is not configured" }, 503);
      return;
    }

    if (!authMatches(req.header("authorization"), config.token)) {
      sendJson(res, { ok: false, error: "Unauthorized" }, 401);
      return;
    }

    next();
  });

  app.get("/health", async (_req, res) => {
    sendJson(res, await getHealth(config.cascadeAiPath));
  });

  app.get("/status", async (req, res) => {
    sendJson(res, await getStatus(config.cascadeAiPath, parseLimit(req.query.limit)));
  });

  app.get("/wallet", async (req, res) => {
    sendJson(res, await getWallet(config.cascadeAiPath, parseLimit(req.query.limit)));
  });

  app.get("/decisions", async (req, res) => {
    sendJson(res, await getDecisions(config.cascadeAiPath, parseLimit(req.query.limit)));
  });

  app.get("/executions", async (req, res) => {
    sendJson(res, await getExecutions(config.cascadeAiPath, parseLimit(req.query.limit)));
  });

  app.get("/positions", async (_req, res) => {
    sendJson(res, await getPositions(config.cascadeAiPath));
  });

  app.get("/guardrails", async (_req, res) => {
    sendJson(res, await getGuardrails(config.cascadeAiPath));
  });

  app.use((_req, res) => {
    sendJson(res, { ok: false, error: "Not found" }, 404);
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    sendJson(res, { ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
  });

  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = loadConfig();
  const app = createApp(config);
  startTwakAutoRefresh();

  const server = app.listen(config.port, () => {
    console.log(`Cascade AI exporter listening on ${config.port}`);
  });

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      stopTwakAutoRefresh();
      server.close(() => {
        process.exit(0);
      });
    });
  }
}
