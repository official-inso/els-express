import type {
  Request,
  Response,
  NextFunction,
  RequestHandler,
  ErrorRequestHandler,
} from "express";
import type { ELSClient, Logger } from "@inso_web/els-client";
import { randomUUID } from "node:crypto";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      log: Logger;
      id: string;
    }
  }
}

/** Options for {@link createELSExpressLogger}. */
export interface ELSExpressOptions {
  /** The ELS client (which is also the logger). */
  client: ELSClient;
  /** Request-id generator. Default: UUID v4. */
  genReqId?: (req: Request) => string;
  /** HTTP header carrying the request id. Default: `'x-request-id'`. */
  reqIdHeader?: string;
  /** Auto-log every finished request. Default: `true`. */
  autoLogRequests?: boolean;
  /** Skip logging for these paths (exact strings or regexes). */
  ignorePaths?: (string | RegExp)[];
}

/**
 * Express middleware который добавляет `req.log` (child logger) и `req.id` (request id),
 * прокидывает request id в response header, и автоматически логирует завершённые запросы.
 *
 * @example
 * import { ELSClient, createELSExpressLogger } from '@inso_web/els-express';
 * const log = new ELSClient({ apiKey, appSlug });
 * app.use(createELSExpressLogger({ client: log }));
 * app.get('/users/:id', (req, res) => {
 *   req.log.info({ userId: req.params.id }, 'Fetching user');
 *   res.json({ ok: true });
 * });
 */
/** Coerces an Express header value (string | string[] | undefined) to a string. */
function headerStr(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export function createELSExpressLogger(opts: ELSExpressOptions): RequestHandler {
  const reqIdHeader = opts.reqIdHeader || "x-request-id";
  const autoLog = opts.autoLogRequests !== false;
  const ignore = opts.ignorePaths || [];

  return (req: Request, res: Response, next: NextFunction) => {
    if (
      ignore.some((p) => (typeof p === "string" ? req.path === p : p.test(req.path)))
    ) {
      return next();
    }

    const incoming = req.headers[reqIdHeader];
    const reqId =
      (typeof incoming === "string" && incoming) ||
      opts.genReqId?.(req) ||
      randomUUID();

    req.id = reqId;
    res.setHeader(reqIdHeader, reqId);
    const al = headerStr(req.headers["accept-language"]);
    req.log = opts.client.child({
      requestId: reqId,
      method: req.method,
      url: req.originalUrl,
      ip: req.ip,
      // Auto-extract request context — these keys map to ErrorEntry fields.
      // Normalize to the ELS schema limits (language ≤ 20 → first tag,
      // userAgent ≤ 1000, referrer ≤ 2000) so a raw header never gets the
      // whole entry rejected with a 400.
      userAgent: headerStr(req.headers["user-agent"]).slice(0, 1000) || undefined,
      referrer: headerStr(req.headers["referer"]).slice(0, 2000) || undefined,
      language: al.split(",")[0]?.trim().slice(0, 20) || undefined,
    });

    if (autoLog) {
      const start = Date.now();
      res.on("finish", () => {
        const duration = Date.now() - start;
        const status = res.statusCode;
        const level: "error" | "warn" | "info" =
          status >= 500 ? "error" : status >= 400 ? "warn" : "info";
        const fn = req.log[level].bind(req.log);
        fn(
          { status, duration, contentLength: res.getHeader("content-length") },
          `${req.method} ${req.originalUrl} → ${status} (${duration}ms)`,
        );
      });
    }

    next();
  };
}

/**
 * Express error handler — ловит unhandled exceptions, шлёт в ELS, отвечает 500.
 *
 * @example
 * app.use(createELSErrorHandler(log));
 */
export function createELSErrorHandler(client: ELSClient): ErrorRequestHandler {
  return (err: Error, req: Request, res: Response, _next: NextFunction) => {
    const log = (req as Request).log || client;
    log.error(err, `Unhandled error in ${req.method} ${req.originalUrl}`);
    if (!res.headersSent) {
      res.status(500).json({
        error: "Internal Server Error",
        requestId: (req as Request).id,
      });
    }
  };
}
