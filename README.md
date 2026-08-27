# Достигатор

Отдельное mobile-first web/PWA приложение для жизненных целей, проектов и дисциплины. Оно помогает выбрать конечный результат, разбить его на конкретные действия, держать максимум три главных дела на день, поддерживать привычки и проводить честный недельный обзор.

## Возможности

- цели и проекты по сферам жизни;
- причина цели, срок, прогресс и состояние;
- конкретные следующие действия;
- «Фокус 3» — не больше трёх главных действий на день;
- привычки, недельная норма и текущая серия;
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

Приложение использует существующий project `vbxkcvygfakmosjvxjwh`, но не использует таблицы TrainLog. Все объекты имеют префикс `dostigator_`:

- `dostigator_areas`;
- `dostigator_goals`;
- `dostigator_actions`;
- `dostigator_habits`;
- `dostigator_habit_checkins`;
- `dostigator_weekly_reviews`.

Schema changes находятся только в `supabase/migrations/`. У каждой таблицы включён RLS и есть отдельные SELECT/INSERT/UPDATE/DELETE ownership policies. `anon` не имеет table grants, а frontend не передаёт `user_id` при записи. Composite foreign keys не позволяют привязать действие или привычку к объекту другого пользователя.

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
