# АС «Учёт инструментов» на Supabase (ДЗ5)

**Репозиторий проекта:** https://github.com/KamilGrf/tool-accounting. Весь ДЗ5 (база, приложение, тесты, документация) хранится в нём. Работающий сайт: https://tool-accounting.vercel.app/

Каталог инструментов, выдача и возврат, просрочки, отчёты. Версия на **Supabase**: сервера нет, браузер работает с базой PostgreSQL напрямую, а доступ ограничивают политики безопасности строк (RLS) и функции в самой базе.

```
Браузер (React, Vite)  ──supabase-js──►  Supabase: Auth (вход) + PostgREST (API) + PostgreSQL
   статика на Vercel                      роли, RLS, функции выдачи/возврата, отчёты
```

Подробности: схема, права, функции, безопасность, проверка и ограничения — в [backend_documentation.md](backend_documentation.md); CI/CD, вход через Google и аналитика — в [integration_documentation.md](integration_documentation.md). Предыдущая версия (Node.js API + PostgreSQL в Docker) сохранена в истории этого репозитория.

## Что в репозитории

| Путь | Содержание |
|---|---|
| `supabase/migrations/` | 6 миграций: схема, профили и роли, права и RLS, представления и функции, проверка здоровья, журнал событий приложения |
| `supabase/seed.sql` | Демонстрационные данные (14 инструментов, 5 сотрудников, 3 выдачи) |
| `supabase/tests/` | Тесты базы: `run.sh` (SQL), `http.sh` (через PostgREST), заглушка `auth_stub.sql` |
| `frontend/` | React-приложение (`.env.example` — шаблон настроек) |
| `backend_documentation.md` | Документация |

## Быстрый старт

Нужны Node.js 22.5+ и аккаунт на [supabase.com](https://supabase.com) (создаёт человек, я его создать не могу).

**1. Проект Supabase.** Создайте проект, запомните пароль базы (он в приложении не нужен).

**2. База.** Откройте SQL Editor и выполните по очереди файлы из `supabase/migrations/` (по порядку номеров), затем, если нужны демо-данные, `supabase/seed.sql`.

**3. Вход.** В разделе Authentication включите вход по email и паролю. Для быстрой проверки отключите подтверждение email (иначе после регистрации приложение попросит подтвердить почту; оба случая обработаны). Чтобы закрыть саморегистрацию, отключите новые регистрации.

**4. Руководитель.** Зарегистрируйтесь в приложении (или создайте пользователя в Authentication → Users), затем выполните в SQL Editor:

```sql
update public.profiles set role = 'manager' where email = 'ваш@email';
```

Все новые пользователи становятся кладовщиками: роль ни из токена, ни из запроса клиента взять нельзя.

**5. Настройки приложения.** Project Settings → API: скопируйте Project URL и anon public key.

```bash
cd frontend
cp .env.example .env     # впишите значения
npm install
npm run dev              # http://localhost:5173
```

**6. Публикация (Vercel).** Новый проект из репозитория, **Root Directory = `frontend`**, в Environment Variables добавьте `VITE_SUPABASE_URL` и `VITE_SUPABASE_ANON_KEY`. Файл `frontend/vercel.json` уже содержит правило для React Router. В Supabase (Authentication → URL Configuration) укажите адрес сайта на Vercel.

> Названия пунктов меню Supabase и Vercel приведены по памяти и могут отличаться: интерфейс я не открывал, а проект Supabase не создавал.

## Тесты

```bash
cd frontend
npm run lint           # ESLint
npm run format:check   # Prettier
npm test               # 158 тестов интерфейса, слоя доступа и функции здоровья (+ 10 интеграционных пропускаются)
```

Проверки базы (105 проверок SQL и слой доступа против PostgREST, скрипты `supabase/tests/run.sh` и `http.sh`) локально запускать не нужно: они выполняются в CI (GitHub Actions, задание «Database») при каждом пуше.

Проверки базы идут на PostgreSQL 16 с заглушкой схемы `auth`, а не на самом Supabase: вход (GoTrue), настройки панели и ограничения тарифа этим не проверяются.
