# @inso_web/els-express

[![npm version](https://img.shields.io/npm/v/@inso_web/els-express.svg)](https://www.npmjs.com/package/@inso_web/els-express)
[![npm downloads](https://img.shields.io/npm/dm/@inso_web/els-express.svg)](https://www.npmjs.com/package/@inso_web/els-express)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](https://www.typescriptlang.org/)
[![license MIT](https://img.shields.io/npm/l/@inso_web/els-express.svg)](./LICENSE)

Express middleware для **Error Logs Service (ELS)**: request-scoped логгер `req.log`, автологирование запросов, error handler. Drop-in замена `pino-http` + `morgan` + `winston` без транзитивных зависимостей.

## Что внутри

- `createELSExpressLogger({ client })` — middleware, который кладёт в `req.log` дочерний логгер с `requestId`, опционально логирует каждый запрос.
- `createELSErrorHandler(client)` — стандартный Express error-handler, отправляет необработанные исключения в ELS вместе со stack trace.
- Полная совместимость API с [@inso_web/els-client](https://www.npmjs.com/package/@inso_web/els-client) — методы `info` / `warn` / `error` / `child` идентичны Pino.

---

## UI: что вы получаете

ELS из коробки даёт админ-панель — все события из вашего Express-приложения попадают в неё.

### Список логов с фильтрами

![Список логов](https://raw.githubusercontent.com/official-inso/els-go/main/docs/screenshots/01-error-logs-list.png)

Виртуальная таблица всех событий: trace ID, приложение, источник, уровень, сообщение, страница, IP. Левый сайдбар — фасеты по приложению, окружению, **версии**, источнику, уровню, браузеру, языку, IP, категории ошибки.

### Детальная карточка с метаданными

![Детальная карточка](https://raw.githubusercontent.com/official-inso/els-go/main/docs/screenshots/02-event-detail-info.png)

Время сервера/клиента, IP с гео, окружение, **версия приложения**, fingerprint, session ID. Карточки повторений и корреляция событий справа.

### AI-диагностика ошибок

![AI диагностика](https://raw.githubusercontent.com/official-inso/els-go/main/docs/screenshots/03-error-detail-ai.png)

Stack trace с распарсенными фреймами + AI-анализ что именно сломалось и как чинить.

### Аналитика и регрессии по версиям

![Аналитика](https://raw.githubusercontent.com/official-inso/els-go/main/docs/screenshots/04-analytics-dashboard.png)

Total / critical+errors / warnings / error rate. AI-обзор слева, timeline в центре, donut'ы по приложению/источнику/уровню. **Виджет «Регрессии»**: какие fingerprint'ы появились впервые в свежей версии и какие пропали.

### Управление API-ключами

![API ключи](https://raw.githubusercontent.com/official-inso/els-go/main/docs/screenshots/05-api-keys.png)
![Действия с ключом](https://raw.githubusercontent.com/official-inso/els-go/main/docs/screenshots/06-api-key-actions.png)

Scoped-ключи (write/read/read-any), live/test environments, ротация без даунтайма.

### Избранные события

![Избранные](https://raw.githubusercontent.com/official-inso/els-go/main/docs/screenshots/07-favorites.png)

Закладки на конкретные trace ID — для расследований, не теряются между сессиями.

---

## Установка

```bash
npm install @inso_web/els-client @inso_web/els-express
```

`@inso_web/els-client` — peer-зависимость (создаёт сам клиент), `els-express` — обёртка.

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
  appVersion: process.env.BUILD_VERSION, // см. секцию ниже
});

const app = express();

// 1. Подключаем middleware: req.log + автоматический request log
app.use(createELSExpressLogger({
  client,
  ignorePaths: [/^\/health/],   // не логируем health checks
  autoLogRequests: true,        // GET /api/users → 200 (45ms)
}));

// 2. В обработчиках используем req.log — он уже привязан к requestId
app.get('/api/users/:id', (req, res) => {
  req.log.info({ userId: req.params.id }, 'Fetching user');
  // ...
});

// 3. Глобальный error-handler для unhandled exceptions
app.use(createELSErrorHandler(client));

app.listen(3000);
```

После этого в админ-панели ELS:

- Каждый запрос с `requestId` (можно отфильтровать по нему).
- Всё что прошло через `req.log` — структурированными событиями.
- Все unhandled errors — со stack trace и AI-диагностикой.

---

## Версионирование

Прокидывайте `BUILD_VERSION` через Dockerfile / CI и передавайте в `appVersion`. ELS принимает любой формат до 128 символов: `semver`, `CalVer`, date-compact (`YYYYMMDDHHmmss`), git SHA, opaque.

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

В аналитике появляется виджет регрессий: «эта ошибка впервые увидена в v20260507120000, в v20260506180000 её не было».

---

## API

### `createELSExpressLogger(options)`

Возвращает Express middleware, кладущий в `req.log` request-scoped логгер.

| Опция | Тип | По умолчанию | Описание |
|---|---|---|---|
| `client` | `ELSClient` | — | Экземпляр клиента ELS (обязательно) |
| `ignorePaths` | `Array<string \| RegExp>` | `[]` | Пути, которые middleware пропускает |
| `autoLogRequests` | `boolean` | `true` | Логировать каждый запрос (`METHOD URL → STATUS (Xms)`) |
| `requestIdHeader` | `string` | `'x-request-id'` | Откуда брать готовый requestId (если есть) |
| `genRequestId` | `() => string` | UUID v4 | Генератор requestId если в заголовке нет |

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

Express error-handler. Использовать **последним** в цепочке middleware:

```ts
app.use(createELSErrorHandler(client));
```

Отправляет в ELS:
- `message`, `stack`, `url`, `method`, `statusCode`
- `requestId` если был в `req.id`
- `level: 'critical'` для 5xx, `'error'` иначе

---

## Подавление шума

Если хотите логировать запросы более тонко (например, исключить 401/403/404 — это обычно не баги, а ожидаемые отказы), отключите `autoLogRequests` и сделайте свой finish-handler:

```ts
app.use(createELSExpressLogger({ client, autoLogRequests: false }));
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const status = res.statusCode;
    if (status === 401 || status === 403 || status === 404) return; // шум
    const duration = Date.now() - start;
    const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
    req.log[level]({ status, duration, method: req.method, url: req.originalUrl },
      `${req.method} ${req.originalUrl} → ${status} (${duration}ms)`);
  });
  next();
});
```

---

## Process-level handlers

Express не ловит `unhandledRejection` и `uncaughtException` — нужны глобальные хэндлеры:

```ts
process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  client.error(err, '[unhandledRejection]');
});

process.on('uncaughtException', (err, origin) => {
  client.fatal({ err, origin }, '[uncaughtException]');
});
```

---

## FAQ

**Чем отличается от pino-http?** API совместим, но без runtime-зависимости от `pino` и без отдельного transport-пакета — события сразу уходят в ELS.

**Можно использовать с `cors`/`helmet`/etc?** Да, middleware никак не конфликтует.

**А что если ELS недоступен?** Клиент fire-and-forget: при сетевой ошибке логирует в `console.error`, ваш сервер продолжает работать.

---

## License

[MIT](./LICENSE) © INSOWEB
