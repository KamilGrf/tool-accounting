# АС «Учёт инструментов» — frontend (Supabase)

Одностраничное приложение на React. Данные и вход — через Supabase (`@supabase/supabase-js`), собственного сервера нет. Настройка базы и запуск всей системы — в [../README.md](../README.md), устройство и права — в [../backend_documentation.md](../backend_documentation.md). Интерфейс построен по концепции 3 «Корпоративный» из ДЗ3.

## Возможности

| Экран | Что делает |
|---|---|
| **Вход / регистрация** | Вход по email и паролю, регистрация кладовщика (с учётом подтверждения почты), сообщение «Сессия истекла», выход |
| **Инструменты** | Поиск и фильтры, таблица, карточка с историей выдач, добавление, выдача, приём возврата, продление срока; списание — только руководитель |
| **Выдача и возврат** | Список выдач с фильтрами «Активные / Просроченные / Все», приём возврата, дни просрочки |
| **Отчёт** (руководитель) | Показатели, категории, топ сотрудников, использование инструментов, просрочки, экспорт CSV (файл собирается в браузере) |

Если не заданы `VITE_SUPABASE_URL` и `VITE_SUPABASE_ANON_KEY`, вместо приложения показывается сообщение о настройке.

## Запуск

```bash
cp .env.example .env     # впишите Project URL и anon key из Supabase (Project Settings → API)
npm install
npm run dev              # http://localhost:5173
```

## Тесты и сборка

```bash
npm run lint           # ESLint
npm run format:check   # Prettier (npm run format: исправить)
npm test               # 70 тестов; интеграционные (8) пропускаются без PostgREST
npm run build          # продакшен-сборка в dist/
```

Проверки базы выполняются в CI (GitHub Actions, задание «Database») при каждом пуше.

## Структура

```
src/
  api/          supabase.js (клиент с таймаутом), client.js (разбор ошибок), index.js (функции по сценариям)
  auth/         AuthContext (сессия Supabase, выход при её окончании)
  hooks/        useAsync, useDebounced, useSubmit
  components/   ui.jsx, forms.jsx, Layout.jsx
  pages/        LoginPage, ToolsPage, IssuesPage, ReportPage
  utils/        format.js, csv.js (CSV просрочек), toolPayload.js (нормализация формы инструмента)
  test/         setup.js, mockApi.js (подмена слоя API в тестах страниц), renderWithAuth.jsx
```
