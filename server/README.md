# waiter-api

Серверный сервис, который держит секреты, **недопустимые во фронтовом бандле**:

- `SUPABASE_WAITER_SERVICE_KEY` — service-role ключ (обходит RLS), для загрузки документов в Storage;
- `OCR_TOKEN` — токен распознавания паспорта;
- `N8N_WEBHOOK_SECRET` — секрет вебхука отправки SMS.

Раньше всё это было в `VITE_…` переменных и попадало в браузер. Теперь фронт ходит к этим эндпоинтам, а секреты живут только здесь.

## Эндпоинты

| Метод | Путь | Назначение |
|---|---|---|
| `GET` | `/health` | Проверка живости |
| `POST` | `/api/upload-document` | multipart: `waiterId`, `path`, `file` → `{ url }` |
| `POST` | `/api/ocr` | multipart: `file` → `{ results: [{label,text}] }` |
| `POST` | `/api/send-sms` | JSON: `{ waiterId, phone, name }` → `{ ok }` |

## Локальный запуск

```bash
cd server
cp .env.example .env   # заполнить значениями
npm install
npm run dev
```

## Деплой на VPS (Cloud.ru)

1. Установить Node.js 20+.
2. Скопировать папку `server/` на сервер, выполнить `npm ci`.
3. Создать `server/.env` с **РОТИРОВАННЫМИ** ключами (старые скомпрометированы — лежали в git и бандле).
4. `CORS_ORIGIN` = домен фронта (например `https://waiter.example.ru`).
5. Запустить как сервис (systemd или pm2):
   ```bash
   pm2 start src/index.js --name waiter-api
   ```
6. Поставить за nginx с TLS (наружу — только HTTPS, не сам порт Node).

### Вариант с Docker

```bash
docker build -t waiter-api ./server
docker run -d --env-file ./server/.env -p 8080:8080 --name waiter-api waiter-api
```

## Связь с фронтом

Во фронте задать `VITE_API_URL` = публичный адрес этого сервиса
(например `https://api.example.ru`). См. `Waiter-app/.env.example`.

## TODO (следующие шаги безопасности)

- Бакет `waiter-documents` сейчас **публичный** — фото паспортов доступны по прямой ссылке.
  Сделать приватным и отдавать через signed URLs (после введения нормальной авторизации).
- Добавить rate-limiting на `/api/send-sms` (защита от SMS-флуда).
