# АС «Учёт инструментов» — backend на PostgreSQL и интеграция с frontend (ДЗ5)

Система учёта инструментов склада: каталог, выдача и возврат, контроль просрочек, отчёты. Версия 2: данные хранятся в PostgreSQL, доступ — по входу и ролям.

```
Браузер ──► Frontend (React, Vite :5173) ──/api──► API (Node.js :3001) ──► PostgreSQL 16 (Docker)
                         cookie сессии (HttpOnly)       роли, валидация, журнал
```

Подробности: архитектура, API, безопасность, процесс разработки с ИИ — в [backend_documentation.md](backend_documentation.md).

## Что в репозитории

| Путь | Содержание |
|---|---|
| `docker-compose.yml` | PostgreSQL 16 + API; секреты из `.env` |
| `.env.example` | Шаблон настроек (копия → `.env`, `change-me` заменить) |
| `backend/` | API (Node.js, пакет `pg`), `migrations/`, `Dockerfile`, интеграционные тесты |
| `frontend/` | React-приложение (интегрировано с API) |
| `backend_documentation.md` | Документация (архитектура, развёртывание, API, примеры, процесс с ИИ) |

## Быстрый старт (локально)

Нужны Docker Desktop и Node.js 22.5+.

```bash
# 1. Настройки: скопируйте шаблон и замените все change-me
cp .env.example .env
#    JWT_SECRET: openssl rand -hex 32 ; пароль БД и пароль руководителя — любые длинные

# 2. База данных и API (миграции и начальные данные применяются при старте)
docker compose up -d --build
curl http://localhost:3001/api/health        # {"status":"ok"}

# 3. Frontend
cd frontend
npm install
npm run dev                                  # http://localhost:5173
```

Регистрация кладовщиков включается переменной `ALLOW_REGISTRATION=true` (по умолчанию выключена; в `.env.example` для демо включена).

Войти можно как **руководитель** (`MANAGER_LOGIN` / `MANAGER_PASSWORD` из вашего `.env`) или зарегистрировать **кладовщика** на экране входа.

## Тесты

```bash
# backend: 40 интеграционных тестов на настоящем PostgreSQL (нужен `docker compose up -d db`)
cd backend && npm install && npm test

# frontend: 23 теста, backend не нужен
cd frontend && npm test
```

Тесты backend создают и пересоздают отдельную базу `tools_test` в том же контейнере; рабочая база `tools` не затрагивается.

## Полезные команды

```bash
docker compose logs -f api          # журнал API (JSON, по строке на событие)
docker compose stop db              # смоделировать сбой БД (API ответит 503)
docker compose down                 # остановить; данные сохраняются в томе pgdata
docker compose down -v              # остановить и УДАЛИТЬ данные БД
```
