Достигатор — локальная V2.1, 22.10.2026

Продолжение последней версии с UX-исправлениями, точными секундами кардио и атомарной облачной синхронизацией. Production не изменён.
Node >=22. Установить зависимости из pnpm-lock.yaml: pnpm install --frozen-lockfile.
pnpm dev:local — открыть http://127.0.0.1:4192/training.
Без внешних ключей: тестовый владелец, синтетическая история, локальный шлюз.
Полные A и B: 6 упражнений, 15 подходов каждая. C: 30–45 минут кардио; бицепс, трицепс, икры по 2 подхода по желанию, изначально не выбраны.
Старые черновики продолжаются со своим составом; V2.1 начнётся в следующей новой сессии.
V2.1 — штатная программа продукта. Флаг VITE_LOCAL_PROGRAM_V21 и файл .env.local для её активации больше не нужны.
V2.1 хранится в src/lib/program-v21.json. Штатный src/lib/training-program.ts возвращает эту ревизию в обычной сборке, не изменяя старые облачные шаблоны и их кэш. Предпросмотр использует тот же загрузчик и штатный useTemplates. Новые черновики получают версию, снимки упражнений и отдых. Название V2.1 входит в сохраняемый снимок сессии.
Аддитивная миграция добавляет только два новых ключа exercise_library для FK; перед синхронизацией новых упражнений на настоящем backend необходимо применить её сначала на изолированном стенде. Миграция здесь проверялась только во временной PostgreSQL.

Проверки: pnpm lint; pnpm typecheck; pnpm test; pnpm test:proposal; pnpm test:postgres; pnpm build.
Для обычной сборки без облачных доступов допустимы только build-time фиктивные VITE_SUPABASE_URL=https://example.invalid и VITE_SUPABASE_PUBLISHABLE_KEY=local-build-test — это не рабочее облачное подключение.
Wi-Fi: собрать tools/phone-preview/vite.config.mjs, скопировать mobile-preview-bootstrap.js, acceptance.html, phone-checklist.css в tools/phone-preview/dist, запустить serve.py с текущими приватными --host и --network, --port 4194, --hours 12. Вход — URL из session.json. Сохранять тот же origin для прежних данных браузера.
Холодный офлайн: отдельная QA-сборка tools/phone-preview/offline.config.mjs с service worker на loopback; HTTP LAN на телефоне не даёт PWA-гарантий.
Никаких deploy, push, production-миграций и сбросов данных не выполнялось. Production NO-GO до HTTP и физической мобильной приёмки.
