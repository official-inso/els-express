# @inso_web/els-express

[![npm version](https://img.shields.io/npm/v/@inso_web/els-express.svg)](https://www.npmjs.com/package/@inso_web/els-express)
[![npm downloads](https://img.shields.io/npm/dm/@inso_web/els-express.svg)](https://www.npmjs.com/package/@inso_web/els-express)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](https://www.typescriptlang.org/)
[![license MIT](https://img.shields.io/npm/l/@inso_web/els-express.svg)](./LICENSE)

Express middleware for the **Inso Error Logs Service (ELS)** — a managed SaaS for centralised error and event logging with AI-assisted triage. Adds `req.log`, automatic request logging, and an error handler that ships unhandled exceptions to ELS. Drop-in replacement for `pino-http` + `morgan` + Sentry's Express middleware with **zero runtime dependencies**.

> 🇷🇺 [Русская версия → README_RU.md](README_RU.md) &nbsp;•&nbsp; 📚 [SDKs overview → ../README.md](../README.md)

---

## Table of contents

- [What you get](#what-you-get)
- [Install](#install)
- [Quick Start](#quick-start)
- [When to use the middleware vs manual capture](#when-to-use-the-middleware-vs-manual-capture)
- [Core concepts](#core-concepts)
- [Configuration](#configuration)
- [Migration](#migration)
  - [From morgan](#from-morgan)
  - [From pino-http](#from-pino-http)
  - [From @sentry/node (Express middleware)](#from-sentrynode-express-middleware)
- [Versioning](#versioning)
- [Quick reference](#quick-reference)
- [Why ELS](#why-els)
- [Process-level handlers](#process-level-handlers)
- [API](#api)
- [Other ELS SDKs](#other-els-sdks)
- [Pricing](#pricing)
- [License](#license)

---

## What you get

A built-in dashboard with full-text search, faceted filtering, AI-assisted diagnosis, and a regressions-by-version widget.

![ELS dashboard preview](https://raw.githubusercontent.com/official-inso/els-go/main/docs/screenshots/01-error-logs-list.png)

→ **[Full UI tour with all 4 screenshots](../README.md#what-you-get)**

---

## Install

```bash
npm install @inso_web/els-client @inso_web/els-express
```

`@inso_web/els-client` is a peer dependency that creates the actual client; `els-express` is the Express wrapper.

**Requirements:** Node.js 18+, Express 4 or 5.

---

## Quick Start

```ts
import express from 'express';
import { ELSClient } from '@inso_web/els-client';
import { createELSExpressLogger, createELSErrorHandler } from '@inso_web/els-express';

const client = new ELSClient({
  endpoint: 'https://api.insoweb.ru/els',
  apiKey: process.env.ELS_API_KEY!,
  appSlug: 'my-app',
  serviceName: 'api',
  deploymentEnv: 'PRODUCTION',
  appVersion: process.env.BUILD_VERSION,
});

const app = express();

// 1. Middleware: req.log + automatic request log
app.use(createELSExpressLogger({
  client,
  ignorePaths: [/^\/health/],
  autoLogRequests: true,        // → GET /api/users → 200 (45ms)
}));

// 2. Handlers use req.log — already bound to requestId
app.get('/api/users/:id', (req, res) => {
  req.log.info({ userId: req.params.id }, 'Fetching user');
  // ...
});

// 3. Global error handler for unhandled exceptions (LAST in the chain)
app.use(createELSErrorHandler(client));

app.listen(3000);
```

Don't have an API key yet? **[Sign up at lk.insoweb.ru](https://lk.insoweb.ru)** — takes under a minute.

After this, in the ELS dashboard you see:

- Every request tagged with `requestId` (filterable).
- Everything that went through `req.log` as a structured event.
- All unhandled errors with stack trace and AI-assisted diagnosis.

---

## When to use the middleware vs manual capture

| Scenario | Use |
|---|---|
| Want per-request `requestId` and an out-of-the-box request log | `createELSExpressLogger({ client })` |
| Already have a tracing system that sets `x-request-id` | `createELSExpressLogger({ client, requestIdHeader: 'x-request-id' })` |
| Don't want auto-request rows, only manual `req.log.*` | `createELSExpressLogger({ client, autoLogRequests: false })` |
| Long-running jobs outside the request cycle | `client.error(...)` / `client.info(...)` directly |
| Cron / queue worker in the same process | Reuse the `client`, skip the middleware |
| Need a custom request-finish strategy (filter 4xx, sample 2xx) | `autoLogRequests: false` + your own `res.on('finish')` |

The middleware never throws on failure to send — it falls back to `console.error` so your route handlers remain safe.

---

## Core concepts

### Request-scoped logger

`req.log` is an `ELSClient.child({ requestId, ... })` — the bindings travel with every subsequent `req.log.*(...)` call inside the request.

### Two middlewares, two roles

`createELSExpressLogger` is a **request middleware**: it runs early and decorates `req`. `createELSErrorHandler` is an **error middleware** with the four-arg signature `(err, req, res, next)`: Express only forwards errors to it. Always register the error handler **after** all routes and other middlewares.

### Sync surface, async transport

`req.log.error(err, 'failed')` returns synchronously. The actual HTTP POST happens off-band. The host process is never blocked on the network.

---

## Configuration

### `createELSExpressLogger(options)`

| Option | Type | Default | Description |
|---|---|---|---|
| `client` | `ELSClient` | — | ELS client instance (required) |
| `ignorePaths` | `Array<string \| RegExp>` | `[]` | Paths the middleware skips |
| `autoLogRequests` | `boolean` | `true` | Log each request (`METHOD URL → STATUS (Xms)`) |
| `requestIdHeader` | `string` | `'x-request-id'` | Pre-existing request-id header to honour |
| `genRequestId` | `() => string` | UUID v4 | Generator when the header is absent |

After mounting:

```ts
declare global {
  namespace Express {
    interface Request {
      log: import('@inso_web/els-client').Logger;
      id: string; // requestId
    }
  }
}
```

### `createELSErrorHandler(client)`

Express error handler. Use **last** in the middleware chain. Captures:

- `message`, `stack`, `url`, `method`, `statusCode`
- `requestId` if `req.id` is set
- `level: 'critical'` for 5xx, `'error'` otherwise

---

## Migration

### From morgan

`morgan` ships access logs to stdout. ELS ships structured events to a queryable dashboard.

**Before:**

```ts
import express from 'express';
import morgan from 'morgan';

const app = express();
app.use(morgan('combined'));
app.use(morgan('tiny', {
  skip: (_req, res) => res.statusCode < 400,
}));
```

**After:**

```ts
import express from 'express';
import { ELSClient } from '@inso_web/els-client';
import { createELSExpressLogger } from '@inso_web/els-express';

const client = new ELSClient({ endpoint, apiKey, appSlug: 'my-app' });
const app = express();
app.use(createELSExpressLogger({
  client,
  autoLogRequests: true,        // analogous to morgan('tiny')
  ignorePaths: [/^\/health/],
}));
```

| morgan concept | ELS equivalent | Notes |
|---|---|---|
| `morgan('combined')` | `autoLogRequests: true` | One structured event per request |
| `morgan('tiny')` | `autoLogRequests: true` | Same idea, no format strings |
| `skip: (req, res) => ...` | `ignorePaths` + custom `res.on('finish')` | More granular skip needs manual handler |
| `:response-time` token | Captured automatically | Field `meta.duration` |
| `:res[x-trace-id]` token | `req.id` / `requestId` | Auto-generated UUID if missing |

**Gotchas:**

- morgan writes plain text to stdout; ELS sends JSON to the network — you lose `tail -f` access. Keep one of: `pm2 logs`, `journalctl`, or a separate stdout transport for ops shells.
- Custom tokens don't translate one-to-one — use `req.log.info({ field }, ...)` instead.

---

### From pino-http

API surface is intentionally close. The big difference: no `pino` peer dependency, no separate transport package.

**Before:**

```ts
import express from 'express';
import pinoHttp from 'pino-http';
import pino from 'pino';

const logger = pino({ level: 'info' });
const app = express();
app.use(pinoHttp({ logger, genReqId: () => crypto.randomUUID() }));

app.get('/users/:id', (req, res) => {
  req.log.info({ userId: req.params.id }, 'fetched');
  res.send('ok');
});
```

**After:**

```ts
import express from 'express';
import { ELSClient } from '@inso_web/els-client';
import { createELSExpressLogger } from '@inso_web/els-express';

const client = new ELSClient({ endpoint, apiKey, appSlug: 'my-app', minLevel: 'info' });
const app = express();
app.use(createELSExpressLogger({ client }));

app.get('/users/:id', (req, res) => {
  req.log.info({ userId: req.params.id }, 'fetched');
  res.send('ok');
});
```

| pino-http | ELS | Notes |
|---|---|---|
| `pinoHttp({ logger })` | `createELSExpressLogger({ client })` | Same role |
| `req.log` | `req.log` | Same name, same API |
| `genReqId` | `genRequestId` | Same idea |
| `pinoHttp.startTime` | `req.id` is generated lazily | No need to set manually |
| `serializers.req/res` | Pre-shape in `BeforeSend` or `req.log.info(...)` | No serializer option |
| Transport package (e.g. `pino-loki`) | Not needed | HTTP transport is built-in |

**Gotchas:**

- pino-http logs requests at `info` by default; ELS does the same when `autoLogRequests: true`. To match a stricter logger, bump `minLevel` to `'warn'`.
- pino-http's `customLogLevel(req, res, err)` has no direct equivalent — implement via `autoLogRequests: false` + a custom `res.on('finish')` finisher.

---

### From @sentry/node (Express middleware)

**Before:**

```ts
import express from 'express';
import * as Sentry from '@sentry/node';

Sentry.init({
  dsn: 'https://public@sentry.example.com/1',
  environment: 'production',
  release: process.env.BUILD_VERSION,
});

const app = express();
app.use(Sentry.Handlers.requestHandler());
// ... routes ...
app.use(Sentry.Handlers.errorHandler());
```

**After:**

```ts
import express from 'express';
import { ELSClient } from '@inso_web/els-client';
import { createELSExpressLogger, createELSErrorHandler } from '@inso_web/els-express';

const client = new ELSClient({
  endpoint: 'https://api.insoweb.ru/els',
  apiKey: process.env.ELS_API_KEY!,
  appSlug: 'my-app',
  deploymentEnv: 'PRODUCTION',
  appVersion: process.env.BUILD_VERSION,
});

const app = express();
app.use(createELSExpressLogger({ client }));
// ... routes ...
app.use(createELSErrorHandler(client));
```

| Sentry | ELS | Notes |
|---|---|---|
| `Sentry.Handlers.requestHandler()` | `createELSExpressLogger({ client })` | Same position in the chain |
| `Sentry.Handlers.errorHandler()` | `createELSErrorHandler(client)` | Same position (last) |
| `Sentry.Handlers.tracingHandler()` | Not provided | ELS does not do tracing |
| `dsn` | `endpoint` + `apiKey` + `appSlug` | Three explicit fields |
| `environment` | `deploymentEnv` | Fixed enum |
| `release` | `appVersion` | Any string ≤128 chars |
| Source maps upload | Not provided | Pair with Sentry if critical |

**Gotchas:**

- ELS does not perform tracing — drop `tracingHandler`. If you rely on Sentry Performance, keep it alongside.
- Sentry's per-request scope tagging maps cleanly to `req.log.child({ ...tags })`.

---

## Versioning

Pass `BUILD_VERSION` through Dockerfile and CI. ELS accepts any string ≤128 chars: semver, CalVer, date-compact (`YYYYMMDDHHmmss`), git SHA, opaque.

```Dockerfile
ARG BUILD_VERSION=dev
ENV BUILD_VERSION=$BUILD_VERSION
```

```yaml
# .gitlab-ci.yml
- export BUILD_VERSION=$(date -u +%Y%m%d%H%M%S)
- docker build --build-arg BUILD_VERSION="$BUILD_VERSION" ...
```

```ts
new ELSClient({ ..., appVersion: process.env.BUILD_VERSION });
```

In the dashboard you get a "Regressions" widget: "this error first seen in v20260507120000, not present in v20260506180000."

---

## Quick reference

| Need | Use |
|---|---|
| Per-request logger | `req.log.info({ ... }, '...')` |
| Skip health checks | `ignorePaths: [/^\/health/]` |
| Honour upstream trace id | `requestIdHeader: 'x-trace-id'` |
| Suppress 4xx noise | `autoLogRequests: false` + custom `res.on('finish')` |
| Capture unhandled errors | `app.use(createELSErrorHandler(client))` (last) |
| Process-level crashes | `process.on('uncaughtException', ...)` (see below) |
| One client across modules | Export a singleton from `lib/els.ts` |

---

## Why ELS

ELS for Node.js is a focused logging SaaS, not a full observability suite. It optimises for capture speed, AI-driven triage, and a low integration cost.

- **Lower weight.** No transitive deps in the middleware; one dependency-free package on Node.
- **Zero external API calls.** Only `POST /errors[/batch]` and `GET /health`.
- **AI-assisted diagnosis** on every stack trace — no add-ons, no extra setup.
- **5-minute integration.** Install → set API key → done.
- **Predictable price.** Tariffs live in the dashboard.

| Feature | ELS | Sentry | Datadog | Loki | LogRocket |
|---|---|---|---|---|---|
| AI on stack traces | Built-in | Paid add-on | Paid add-on | None | None |
| Zero-dep SDK | Yes | No | No | No | No |
| Free tier retention | 24h | 30d (limited) | Trial only | Self-cost | 3–30d |
| Setup time | ~5 min | 10–20 min | 30–60 min | Hours | 10–20 min |

ELS does **not** ship full APM / tracing, source-map upload, session replay, frontend RUM, or infra metrics. If any of those is critical — pair ELS with Grafana / Datadog or stay on Sentry.

→ **Sign up at [lk.insoweb.ru](https://lk.insoweb.ru)** to grab an API key.

---

## Process-level handlers

Express does not catch `unhandledRejection` and `uncaughtException` — you need global handlers:

```ts
process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  client.error(err, '[unhandledRejection]');
});

process.on('uncaughtException', (err, origin) => {
  client.fatal({ err, origin }, '[uncaughtException]');
});
```

Tip: a tail flush on exit prevents losing the last batch in the queue:

```ts
process.on('beforeExit', () => client.flush());
```

---

## API

```ts
function createELSExpressLogger(opts: {
  client: ELSClient;
  ignorePaths?: Array<string | RegExp>;
  autoLogRequests?: boolean;
  requestIdHeader?: string;
  genRequestId?: () => string;
}): express.RequestHandler;

function createELSErrorHandler(client: ELSClient): express.ErrorRequestHandler;
```

Full `ELSConfig` reference — see [@inso_web/els-client](../js/README.md).

---

## Other ELS SDKs

Same wire format, same dashboard — pick by stack.

**Node.js family**
- [`@inso_web/els-client`](../js/README.md) — base TS / Node / browser client
- [`@inso_web/els-express`](../express/README.md) — Express middleware (this package)
- [`@inso_web/els-next`](../next/README.md) — Next.js helpers (App + Pages router)
- [`@inso_web/els-nest`](../nest/README.md) — NestJS module
- [`@inso_web/els-react`](../react/README.md) — React Provider, hooks, ErrorBoundary
- [`@inso_web/els-vue`](../vue/README.md) — Vue 3 plugin

**Other stacks**
- [`Inso.Els`](../csharp/README.md) — .NET (Core + ASP.NET Core + ILogger)
- [`io.github.official-inso:els-core`](../java/README.md) — Java + Spring Boot starter + SLF4J
- [`github.com/official-inso/els-go`](../els-go/README.md) — Go

→ **Full overview & comparison:** [../README.md](../README.md) · [github.com/official-inso/els-go/blob/main/sdks/README.md](https://github.com/official-inso/els-go/blob/main/sdks/README.md)

---

## Pricing

Free tier — **24-hour log retention**. See **[lk.insoweb.ru](https://lk.insoweb.ru)** for the full tariff matrix.

---

## License

[MIT](./LICENSE) © INSOWEB
