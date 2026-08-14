# Подработка 24 — развёртывание

## 1. Локальный запуск (с API и SQLite)

```bash
cd server
pip install -r requirements.txt
```

Создайте `server/.env` (см. `.env.example`) и впишите токен из @BotFather:

```
BOT_TOKEN=123456789:AAF...
ADMIN_TG_IDS=123456789      # ваши telegram id (числовые) — права администратора
BASE_URL=https://myservice.onrender.com   # публичный адрес (для ссылок в уведомлениях)
BLOCK_THRESHOLD=3           # жалоб до автоблокировки аккаунта (по умолчанию 3)
```

Запуск (из корня проекта):

```bash
python server/run.py
```

Откройте `http://localhost:8137`. FastAPI отдаёт и API (`/api/...`), и статику (index.html, css, js, fonts) — это единый сервер.

- Без `BOT_TOKEN` сервер работает в **демо-режиме**: вход под демо-пользователем «Иван Петров», подпись initData не проверяется.
- С `BOT_TOKEN` проверяется подпись `initData` (HMAC-SHA256). Вне Telegram или при неверной подписи — 401, приложение переключается в офлайн-режим (localStorage).

## 2. Публикация в Telegram

### Про Vercel

**Vercel для этого проекта не подходит.** Vercel рассчитан на статику и serverless-функции (Node), а наш бэкенд — **постоянный Python-процесс с SQLite**. В serverless-окружении файл БД эфемерный: данные будут теряться между вызовами. Для FastAPI + SQLite выбирайте **Render**, **Railway** или VPS (ниже). Если позже захотите Vercel — надо будет заменить SQLite на Supabase/PostgreSQL.

### Вариант А: Render (рекомендую, бесплатный тариф)

1. Создайте репозиторий на GitHub и загрузите туда весь проект (включая `server/`, `requirements.txt`, `js/`, `css/`, `index.html`).
2. Зарегистрируйтесь на https://render.com → **New → Web Service** → подключите репозиторий.
3. Render определит Python сам. Укажите команды:
   - **Build:** `pip install -r requirements.txt`
   - **Start:** `uvicorn server.app:app --host 0.0.0.0 --port $PORT`
4. Добавьте переменные окружения: `BOT_TOKEN`, `ADMIN_TG_IDS` (ваши числовые telegram id через запятую).
5. Нажмите **Deploy**, дождитесь статуса *Live*. Получите URL вида `https://ваш-сервис.onrender.com`.
6. В **@BotFather**: `/newapp` → укажите этот HTTPS-URL (для существующего бота — `Bot Settings → Menu Button`).
7. Впишите username вашего бота в `js/telegram.js` (`botName`) и перезалейте файл.
8. Откройте бота в Telegram → кнопка «Меню».

### Вариант Б: Railway

1. GitHub-репозиторий, как выше.
2. https://railway.app → **New Project → Deploy from GitHub repo**.
3. Railway сам установит зависимости из `requirements.txt`.
4. **Settings → Command:** `uvicorn server.app:app --host 0.0.0.0 --port $PORT`
5. Переменные: `BOT_TOKEN`, `ADMIN_TG_IDS`.
6. **Settings → Networking** → включите публичный домен (HTTPS).
7. Далее пункты 6–8 из варианта А.

### Вариант В: свой сервер (VPS)

```bash
pip install -r requirements.txt
uvicorn server.app:app --host 0.0.0.0 --port 8000
```

Обязательно проксируйте через **Nginx + HTTPS** (certbot). Без HTTPS Telegram не откроет Mini App.

> **Важно про БД:** SQLite — это файл `server/p24.db`. Он создаётся на диске сервера автоматически. На Render/Railway бесплатный диск переживает перезапуски. Для масштаба > 100 пользователей рассмотрите PostgreSQL (замените `db.py`).

## 3. Как это устроено

- **Фронтенд** (ванильный JS): при старте вызывает `POST /api/auth` с `initData`, получает токен сессии и профиль; дальше все данные — через REST API с заголовком `Authorization: Bearer <token>`.
- **Бэкенд** (FastAPI + SQLite): проверка подписи initData, пользователи, заказы, отклики, отзывы, уведомления. БД создаётся и наполняется демо-данными автоматически при первом запуске (`server/p24.db`).
- Если API недоступен (нет сети/сервера) — приложение автоматически работает в офлайн-демо на localStorage.

## 4. Основные эндпоинты

| Метод | Путь | Назначение |
|---|---|---|
| POST | `/api/auth` | вход по initData → `{token, user}` |
| GET | `/api/me` | профиль + мои заказы/отклики/уведомления |
| PATCH | `/api/me` | обновить роль/навыки/телефон/имя |
| GET | `/api/orders` | список заказов |
| POST | `/api/orders` | создать заказ |
| GET | `/api/orders/{id}` | карточка заказа |
| POST | `/api/orders/{id}/respond` | откликнуться |
| POST | `/api/orders/{id}/cancel_respond` | отменить отклик |
| POST | `/api/orders/{id}/assign` | назначить исполнителя (автор) |
| POST | `/api/orders/{id}/reject` | отклонить отклик (автор) |
| POST | `/api/orders/{id}/complete` | завершить заказ |
| POST | `/api/orders/{id}/review` | оставить отзыв (1–5 звёзд) |
| POST | `/api/orders/{id}/report` | пожаловаться на заказ (причина + комментарий) |
| DELETE | `/api/orders/{id}` | удалить заказ (автор — свой открытый; админ — любой) |
| GET | `/api/admin/reports` | список жалоб (только админ) |
| POST | `/api/admin/reports/{id}/resolve` | пометить жалобу решённой (админ) |
| GET | `/api/admin/users/blocked` | список заблокированных пользователей (админ) |
| POST | `/api/admin/users/{id}/unblock` | восстановить доступ (админ) |
| POST | `/api/notifications/read` | отметить уведомления прочитанными |

### Модерация

- **Жалоба на заказ** — любой пользователь (кроме автора), одна на заказ. Причина + комментарий.
- **Автоблокировка** — после `BLOCK_THRESHOLD` (по умолчанию 3) новых жалоб на заказы пользователя его аккаунт блокируется: он не может создавать заказы и откликаться (в приложении — баннер с предупреждением).
- **Уведомления админу** — при каждой жалобе и блокировке администраторам из `ADMIN_TG_IDS` приходит сообщение в Telegram (кнопка «Заблокированные» в профиле → «Восстановить»).

## 5. Дальнейшие шаги (необязательно)

- Переход на **PostgreSQL/Supabase**: заменить `db.py` на psycopg2/SQLAlchemy.
- **Хранение фото** пользователей в облаке (Bot API умеет отдавать аватар через `getFile`).
- Webhook/уведомления в Telegram напрямую (бот пишет исполнителю при назначении).