# Express basic example

Минимальный Express сервер с `@inso_web/els-express`.

## Запуск

```bash
npm install
ELS_API_KEY=els_live_xxxxxxxx npm start
```

## Эндпоинты

- `GET /health` — health check (не логируется через `ignorePaths`)
- `GET /users/:id` — успешный запрос (`req.log.info`)
- `GET /error` — throw, ловится `createELSErrorHandler`
- `POST /login` — `req.log.warn` + 401
