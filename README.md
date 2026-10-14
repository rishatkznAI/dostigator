# Достигатор

Отдельное mobile-first web/PWA приложение для жизненных целей, проектов и дисциплины. Оно помогает выбрать конечный результат, разбить его на конкретные действия, держать максимум три главных дела на день, поддерживать привычки и проводить честный недельный обзор.

## Возможности

- цели и проекты по сферам жизни;
- причина цели, срок, прогресс и состояние;
- конкретные следующие действия;
- «Фокус 3» — не больше трёх главных действий на день;
- привычки, недельная норма и текущая серия;
- полноценный TrainLog-модуль: программа A/B/C, библиотека упражнений, подходы, вес, повторения, RIR, разминка, замена и пропуск упражнения;
- проверка готовности, таймер тренировки и отдыха, офлайн-черновик и безопасная синхронизация;
- сравнение каждого рабочего подхода с последним завершённым результатом, индивидуальная цель по весу/повторам/секундам и оценка факта; в облегчённом режиме прибавка не предлагается;
- журнал кардио: время, дистанция, усилие, пульс и редактируемые заметки с облачным сохранением и отдельной офлайн-очередью;
- пошаговое сопровождение тренировки, быстрый перенос цели/результата, заготовка следующего подхода по факту предыдущего и оценка запаса кнопками; заготовки не считаются выполненными;
- шкала усилия кардио 1–10 с подсказками по дыханию и разговорному тесту;
- история тренировок, прогресс по упражнениям, замеры тела, питание, шаги и недельный PDF-отчёт;
- прозрачный индекс дисциплины;
- недельный обзор: победы, препятствия и следующий фокус;
- offline cache и идемпотентная очередь изменений с client UUID;
- JSON-резервная копия и неразрушающее восстановление;
- Supabase Auth: пароль, magic link и восстановление пароля;
- installable PWA.

## Стек

- React 19 + TypeScript 6 + Vite 8;
- React Router;
- Supabase JS;
- vite-plugin-pwa / Workbox;
- Vitest + Testing Library;
- mobile-first CSS без UI-framework.

Требуется Node.js 22+ и pnpm.

## Запуск

```bash
pnpm install --frozen-lockfile
cp .env.example .env
pnpm dev
```

В `.env` нужны только браузерные параметры:

```text
VITE_SUPABASE_URL=https://vbxkcvygfakmosjvxjwh.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Secret/service-role key не используется и не должен попадать в `VITE_*`.

## Supabase

Приложение использует существующий project `vbxkcvygfakmosjvxjwh`. Жизненные цели хранятся в таблицах с префиксом `dostigator_`:

- `dostigator_areas`;
- `dostigator_goals`;
- `dostigator_actions`;
- `dostigator_habits`;
- `dostigator_habit_checkins`;
- `dostigator_weekly_reviews`.

Тренировочный модуль использует прежнюю изолированную схему TrainLog:

- `exercise_library`, `workout_templates`, `workout_template_items`;
- `workout_sessions`, `workout_session_exercises`, `workout_sets`;
- `body_measurements`, `nutrition_entries`, `daily_activity`.

Программа A/B/C и техника упражнений загружаются из базы, а не зашиты в интерфейс.

Schema changes находятся только в `supabase/migrations/`. У каждой таблицы включён RLS и есть отдельные SELECT/INSERT/UPDATE/DELETE ownership policies. `anon` не имеет table grants, а frontend не передаёт `user_id` при записи. Composite foreign keys не позволяют привязать действие или привычку к объекту другого пользователя.

### Выпуск тренировочного baseline

`20260825051101_create_trainlog_core_schema.sql` — идемпотентный baseline TrainLog. Его версия совпадает с первой миграцией, уже записанной в production, поэтому чистые окружения получают схему с нуля, а существующее окружение корректно пропускает её при `supabase db push`.

## Offline

Последний снимок данных хранится локально под ключом конкретного Supabase user ID. Новые записи получают UUID на клиенте. При отсутствии сети upsert/delete складываются в очередь, повторяются после события `online` и удаляются только после обработки. Supabase API responses не попадают в Workbox runtime cache.

## Индекс дисциплины

- 50% — выполнение выбранного дневного фокуса;
- 30% — соблюдение привычек;
- 20% — завершённые действия по целям.

Это подсказка для недельного обзора, а не оценка личности.

## Проверки

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:all
```

`src/lib/security.remote.test.ts` проверяет, что anon не читает пользовательские таблицы. `tests/security/rls.sql` — транзакционный User A/User B тест и всегда завершает работу через `ROLLBACK`.

## Deployment

GitHub Pages workflow собирает приложение с base path `/dostigator/`, выполняет `test:all` и добавляет SPA fallback. Repository secrets:

- `VITE_SUPABASE_URL`;
- `VITE_SUPABASE_PUBLISHABLE_KEY`.

Для Railway подготовлены `Dockerfile`, `Caddyfile` и `railway.json`. Caddy слушает порт `8080`, отдаёт SPA routes и предоставляет `/health`.

В Supabase Authentication → URL Configuration нужно добавить production URL в Site URL/Redirect URLs, включая `/reset-password`.
