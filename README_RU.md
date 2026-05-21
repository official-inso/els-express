# @inso_web/els-express

[![npm version](https://img.shields.io/npm/v/@inso_web/els-express.svg)](https://www.npmjs.com/package/@inso_web/els-express)
[![npm downloads](https://img.shields.io/npm/dm/@inso_web/els-express.svg)](https://www.npmjs.com/package/@inso_web/els-express)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](https://www.typescriptlang.org/)
[![license MIT](https://img.shields.io/npm/l/@inso_web/els-express.svg)](./LICENSE)

Express middleware для **Inso Error Logs Service (ELS)** — управляемого SaaS централизованного сбора событий (от debug до fatal) с AI-диагностикой ошибок. Добавляет `req.log`, автологирование запросов и error handler, отправляющий unhandled-исключения в ELS. Drop-in замена `pino-http` + `morgan` + Sentry Express middleware с **нулевыми runtime-зависимостями**.

> 🇬🇧 [English version → README.md](README.md)

---

## Содержание

- [Что вы получаете](#что-вы-получаете)
- [Установка](#установка)
- [Быстрый старт](#быстрый-старт)
- [Когда middleware vs ручной захват](#когда-middleware-vs-ручной-захват)
- [Ключевые концепции](#ключевые-концепции)
- [Конфигурация](#конфигурация)
- [Миграция](#миграция)
  - [С morgan](#с-morgan)
  - [С pino-http](#с-pino-http)
  - [С @sentry/node (Express middleware)](#с-sentrynode-express-middleware)
- [Версионирование](#версионирование)
- [Quick reference](#quick-reference)
- [Почему ELS](#почему-els)
- [Process-level handlers](#process-level-handlers)
- [API](#api)
- [Другие ELS SDK](#другие-els-sdk)
- [Тарифы](#тарифы)
- [Лицензия](#лицензия)

---

## Что вы получаете

ELS из коробки даёт встроенную админ-панель. Каждое событие, отправленное этим SDK, попадает туда — с полнотекстовым поиском, фасетной фильтрацией, AI-диагностикой и обнаружением регрессий по версиям.

| | |
|---|---|
| ![Список логов](https://raw.githubusercontent.com/official-inso/els-go/main/docs/screenshots/01-error-logs-list.png) | ![Карточка события](https://raw.githubusercontent.com/official-inso/els-go/main/docs/screenshots/02-event-detail-info.png) |
| Виртуальная таблица с фасетным сайдбаром (приложение, окружение, **версия**, источник, уровень, браузер, IP, категория). Live-режим обновляет данные каждые 5с. | Полные метаданные события: время, гео, окружение, **версия приложения**, fingerprint, session, карточки повторений, корреляция в рамках сессии. |
| ![AI-диагностика](https://raw.githubusercontent.com/official-inso/els-go/main/docs/screenshots/03-error-detail-ai.png) | ![Аналитика](https://raw.githubusercontent.com/official-inso/els-go/main/docs/screenshots/04-analytics-dashboard.png) |
| Распарсенный stack trace + AI-анализ: что сломалось, где, как чинить. | Timeline, donut'ы, топ URL/IP, тепловая карта по часам, **виджет регрессий по версиям**. |

---

## Установка

```bash
npm install @inso_web/els-client @inso_web/els-express
```

`@inso_web/els-client` — peer-зависимость (она создаёт сам клиент), `els-express` — обёртка для Express.

**Требования:** Node.js 18+, Express 4 или 5.

---

## Быстрый старт

```ts
import express from 'express';
import { ELSClient } from '@inso_web/els-client';
import { createELSExpressLogger, createELSErrorHandler } from '@inso_web/els-express';

const client = new ELSClient({
  apiKey: process.env.ELS_API_KEY!,
  appSlug: 'my-app',
  serviceName: 'api',
  deploymentEnv: 'PRODUCTION',
  appVersion: process.env.BUILD_VERSION,
});

const app = express();

// 1. Middleware: req.log + автологирование запросов
app.use(createELSExpressLogger({
  client,
  ignorePaths: [/^\/health/],
  autoLogRequests: true,        // → GET /api/users → 200 (45ms)
}));

// 2. В обработчиках используем req.log — он уже привязан к requestId
app.get('/api/users/:id', (req, res) => {
  req.log.info({ userId: req.params.id }, 'Fetching user');
  // ...
});

// 3. Глобальный error-handler для unhandled exceptions (ПОСЛЕДНИМ в цепочке)
app.use(createELSErrorHandler(client));

app.listen(3000);
```

Ещё нет API-ключа? **[Зарегистрируйтесь на lk.insoweb.ru](https://lk.insoweb.ru)** — займёт минуту.

В панели ELS появится:

- Каждый запрос с `requestId` (можно фильтровать).
- Всё, что прошло через `req.log` — структурированными событиями.
- Все unhandled-ошибки со stack trace и AI-диагностикой.

---

## Когда middleware vs ручной захват

| Сценарий | Что брать |
|---|---|
| Нужен `requestId` per-request и готовый request-лог | `createELSExpressLogger({ client })` |
| Уже есть tracing-система с `x-request-id` | `createELSExpressLogger({ client, requestIdHeader: 'x-request-id' })` |
| Не нужны авто-строки запросов, только ручной `req.log.*` | `createELSExpressLogger({ client, autoLogRequests: false })` |
| Долгие job'ы вне request-цикла | `client.error(...)` / `client.info(...)` напрямую |
| Cron / queue worker в том же процессе | Переиспользовать `client`, без middleware |
| Кастомная стратегия finish (фильтр 4xx, sample 2xx) | `autoLogRequests: false` + свой `res.on('finish')` |

Middleware никогда не throw'ит при ошибке отправки — пишет в `console.error`, ваши обработчики безопасны.

---

## Ключевые концепции

### Request-scoped логгер

`req.log` — это `ELSClient.child({ requestId, ... })`. Bindings путешествуют с каждым последующим `req.log.*(...)` внутри запроса.

### Две middleware с разными ролями

`createELSExpressLogger` — **request middleware**: запускается рано и декорирует `req`. `createELSErrorHandler` — **error middleware** с сигнатурой `(err, req, res, next)`: Express передаёт сюда только ошибки. Регистрируйте error-handler **после** всех маршрутов и middleware.

### Sync API, async транспорт

`req.log.error(err, 'failed')` возвращается мгновенно. HTTP POST уходит в фоне. Процесс не блокируется на сети.

---

## Конфигурация

### `createELSExpressLogger(options)`

| Опция | Тип | По умолчанию | Описание |
|---|---|---|---|
| `client` | `ELSClient` | — | Экземпляр клиента ELS (обязательно) |
| `ignorePaths` | `Array<string \| RegExp>` | `[]` | Пути, которые middleware пропускает |
| `autoLogRequests` | `boolean` | `true` | Логировать каждый запрос (`METHOD URL → STATUS (Xms)`) |
| `requestIdHeader` | `string` | `'x-request-id'` | Готовый requestId из заголовка |
| `genRequestId` | `() => string` | UUID v4 | Генератор requestId если заголовка нет |

После подключения:

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

Express error-handler. Использовать **последним** в цепочке middleware. Захватывает:

- `message`, `stack`, `url`, `method`, `statusCode`
- `requestId` если `req.id` есть
- `level: 'critical'` для 5xx, `'error'` иначе

---

## Миграция

### С morgan

`morgan` пишет access-логи в stdout. ELS отправляет структурированные события в фильтруемую панель.

**Было:**

```ts
import express from 'express';
import morgan from 'morgan';

const app = express();
app.use(morgan('combined'));
app.use(morgan('tiny', {
  skip: (_req, res) => res.statusCode < 400,
}));
```

**Стало:**

```ts
import express from 'express';
import { ELSClient } from '@inso_web/els-client';
import { createELSExpressLogger } from '@inso_web/els-express';

const client = new ELSClient({ apiKey, appSlug: 'my-app' });
const app = express();
app.use(createELSExpressLogger({
  client,
  autoLogRequests: true,        // аналог morgan('tiny')
  ignorePaths: [/^\/health/],
}));
```

| morgan | ELS | Заметки |
|---|---|---|
| `morgan('combined')` | `autoLogRequests: true` | Одно структурированное событие на запрос |
| `morgan('tiny')` | `autoLogRequests: true` | Та же идея, без формат-строк |
| `skip: (req, res) => ...` | `ignorePaths` + кастомный `res.on('finish')` | Гранулярный skip — через ручной handler |
| `:response-time` | автоматически | Поле `meta.duration` |
| `:res[x-trace-id]` | `req.id` / `requestId` | Авто-UUID если нет |

**Подводные камни:**

- morgan пишет plain text в stdout; ELS шлёт JSON в сеть — `tail -f` уходит. Оставьте `pm2 logs`, `journalctl` или отдельный stdout-транспорт для ops-shell.
- Кастомные токены 1-в-1 не переносятся — используйте `req.log.info({ field }, ...)`.

---

### С pino-http

API близко по дизайну. Главная разница: нет peer-зависимости от `pino` и нет отдельного transport-пакета.

**Было:**

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

**Стало:**

```ts
import express from 'express';
import { ELSClient } from '@inso_web/els-client';
import { createELSExpressLogger } from '@inso_web/els-express';

const client = new ELSClient({ apiKey, appSlug: 'my-app', minLevel: 'info' });
const app = express();
app.use(createELSExpressLogger({ client }));

app.get('/users/:id', (req, res) => {
  req.log.info({ userId: req.params.id }, 'fetched');
  res.send('ok');
});
```

| pino-http | ELS | Заметки |
|---|---|---|
| `pinoHttp({ logger })` | `createELSExpressLogger({ client })` | Та же роль |
| `req.log` | `req.log` | Тот же ключ, тот же API |
| `genReqId` | `genRequestId` | То же |
| `pinoHttp.startTime` | `req.id` генерируется лениво | Не нужно вручную |
| `serializers.req/res` | через `BeforeSend` или преобразование при вызове | Опции serializers нет |
| Transport-пакет (`pino-loki`) | не нужен | HTTP-транспорт встроен |

**Подводные камни:**

- pino-http по умолчанию логирует на `info`; ELS делает то же при `autoLogRequests: true`. Для строгого режима поднимите `minLevel` до `'warn'`.
- `customLogLevel(req, res, err)` в pino-http аналога нет — реализуйте через `autoLogRequests: false` + custom `res.on('finish')`.

---

### С @sentry/node (Express middleware)

**Было:**

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
// ... маршруты ...
app.use(Sentry.Handlers.errorHandler());
```

**Стало:**

```ts
import express from 'express';
import { ELSClient } from '@inso_web/els-client';
import { createELSExpressLogger, createELSErrorHandler } from '@inso_web/els-express';

const client = new ELSClient({
  apiKey: process.env.ELS_API_KEY!,
  appSlug: 'my-app',
  deploymentEnv: 'PRODUCTION',
  appVersion: process.env.BUILD_VERSION,
});

const app = express();
app.use(createELSExpressLogger({ client }));
// ... маршруты ...
app.use(createELSErrorHandler(client));
```

| Sentry | ELS | Заметки |
|---|---|---|
| `Sentry.Handlers.requestHandler()` | `createELSExpressLogger({ client })` | Та же позиция в цепочке |
| `Sentry.Handlers.errorHandler()` | `createELSErrorHandler(client)` | Та же позиция (последним) |
| `Sentry.Handlers.tracingHandler()` | не предоставляется | ELS не делает tracing |
| `dsn` | `apiKey` + `appSlug` | Три явных поля |
| `environment` | `deploymentEnv` | Фиксированный enum |
| `release` | `appVersion` | Любая строка ≤128 символов |
| Source maps upload | не предоставляется | Оставьте Sentry рядом, если критично |

**Подводные камни:**

- ELS не делает tracing — `tracingHandler` уберите. Sentry Performance — оставляйте отдельно.
- Per-request scope-тэги в Sentry чисто ложатся на `req.log.child({ ...tags })`.

---

## Версионирование

Передавайте `BUILD_VERSION` через Dockerfile и CI. ELS принимает любую строку ≤128 символов: semver, CalVer, date-compact (`YYYYMMDDHHmmss`), git SHA, opaque.

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

В аналитике появится виджет «Регрессии»: «эта ошибка впервые увидена в v20260507120000, в v20260506180000 её не было».

---

## Quick reference

| Нужно | Делайте |
|---|---|
| Per-request логгер | `req.log.info({ ... }, '...')` |
| Игнор health-checks | `ignorePaths: [/^\/health/]` |
| Прокинуть upstream trace id | `requestIdHeader: 'x-trace-id'` |
| Подавить шум 4xx | `autoLogRequests: false` + custom `res.on('finish')` |
| Захват unhandled-ошибок | `app.use(createELSErrorHandler(client))` (последним) |
| Process-level crashes | `process.on('uncaughtException', ...)` (см. ниже) |
| Один клиент на все модули | Singleton из `lib/els.ts` |

---

## Почему ELS

ELS для Node.js — сфокусированный SaaS для логирования, а не observability-комбайн. Оптимизирован под скорость захвата, AI-диагностику и дешевизну интеграции.

- **Меньше веса.** Нет транзитивных deps в middleware; один пакет без зависимостей на Node.
- **Ноль внешних API.** Только `POST /errors[/batch]` и `GET /health`.
- **AI-диагностика** на каждом stack trace — без аддонов и дополнительной настройки.
- **5 минут интеграции.** Install → API-ключ → готово.
- **Прозрачные тарифы.** Цены в личном кабинете.

### Подробное сравнение

| Категория | ELS | Sentry | Datadog / New Relic | Grafana Loki | LogRocket / Logtail / BetterStack |
|---|---|---|---|---|---|
| Модель хостинга | Managed SaaS | SaaS или self-hosted | Только SaaS | Self-hosted / Grafana Cloud | SaaS |
| Runtime-зависимости SDK | Ноль | Средне (саб-SDK, интеграции) | Тяжёлый агент + tracing | Promtail / агент | Средне |
| Время интеграции | ~5 мин | 10–20 мин | 30–60 мин | Часы — дни | 10–20 мин |
| AI-диагностика | Встроена | Платный аддон | Платный аддон | Нет | Нет |
| Группировка / fingerprint | Да | Да | Да | Вручную через LogQL | Частично |
| Source-map upload | Нет | Да | Да | н/п | Частично |
| Session replay (frontend) | Нет | Платно | Платно | н/п | Да (core) |
| Distributed tracing / APM | Нет | Частично | Да (core) | Да с Tempo | Нет |
| Метрики инфраструктуры | Нет | Нет | Да (core) | Да с Mimir | Нет |
| Хранение на free-тарифе | 24 часа | 30 дней (лимит объёма) | Только триал | Self-cost | 3–30 дней |
| Поддержка / документация на русском | Нативно | Сообщество | Ограничено | Сообщество | Нет |

### Когда ELS — неподходящий выбор

- Нужен один вендор на **APM + логи + метрики** одним счётом — берите Datadog или New Relic.
- Триаж фронтенда строится вокруг **DOM session replay** — LogRocket или Sentry Replay.
- Публичное мобильное приложение, нужны symbolication и ANR-детект — Firebase Crashlytics или Sentry Mobile.

Во всех остальных сценариях — backend-ошибки, JS-ошибки фронта, request-логи, структурированные события с version-aware-аналитикой — ELS даёт самый короткий путь до рабочей панели.

→ **Регистрация на [lk.insoweb.ru](https://lk.insoweb.ru)** для API-ключа.

---

## Process-level handlers

Express не ловит `unhandledRejection` и `uncaughtException` — нужны глобальные обработчики:

```ts
process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  client.error(err, '[unhandledRejection]');
});

process.on('uncaughtException', (err, origin) => {
  client.fatal({ err, origin }, '[uncaughtException]');
});
```

Совет — flush очереди на exit, чтобы не потерять последний батч:

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

Полный `ELSConfig` reference — см. [@inso_web/els-client](https://github.com/official-inso/els-client).

---

## Другие ELS SDK

Тот же wire-формат, та же панель — выбирайте по стеку.

**Node.js**
- [`@inso_web/els-client`](https://github.com/official-inso/els-client) — базовый TS / Node / browser клиент
- [`@inso_web/els-express`](https://github.com/official-inso/els-express) — Express middleware (этот репо)
- [`@inso_web/els-next`](https://github.com/official-inso/els-next) — хелперы для Next.js (App + Pages router)
- [`@inso_web/els-nest`](https://github.com/official-inso/els-nest) — NestJS module
- [`@inso_web/els-react`](https://github.com/official-inso/els-react) — React Provider, hooks, ErrorBoundary
- [`@inso_web/els-vue`](https://github.com/official-inso/els-vue) — Vue 3 plugin

**Другие стеки**
- [`Inso.Els`](https://github.com/official-inso/els-csharp) — .NET (Core + ASP.NET Core + ILogger)
- [`io.github.official-inso:els-core`](https://github.com/official-inso/els-java) — Java + Spring Boot starter + SLF4J
- [`github.com/official-inso/els-go`](https://github.com/official-inso/els-go) — Go

---

## Тарифы

Free-тариф — **хранение логов 24 часа**. Полный прайс на **[lk.insoweb.ru](https://lk.insoweb.ru)**.

---

## Лицензия

[MIT](./LICENSE) © INSOWEB
