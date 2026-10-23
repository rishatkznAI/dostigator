# Проверка обновления установленной PWA

Сценарий использует отдельный временный HTTP-сервер и два независимых production build. Он не переключает режим общих API-стендов и не обращается к production Supabase. Chromium запускается с новым профилем.

1. Собрать исходный `main` `29c8808` в отдельном checkout с его `registerType: autoUpdate`:
   `GITHUB_PAGES=true VITE_SUPABASE_URL=http://127.0.0.1:4299 VITE_SUPABASE_PUBLISHABLE_KEY=isolated-pwa-update-test pnpm exec vite build --outDir ../pwa-update-build-old`
2. Собрать текущую версию с `registerType: prompt` той же командой с `--outDir ../pwa-update-build-new`.
3. Из текущего checkout выполнить:
   `DOSTIGATOR_AUDIT_OUTPUT=.cache/pwa-update-audit node tests/browser/pwa-update-audit.mjs`

При необходимости задать `PWA_OLD_BUILD`, `PWA_NEW_BUILD` и `PLAYWRIGHT_EXECUTABLE_PATH`. Путь вывода не должен содержать production credentials или backup.

Проверяются настоящий старый runtime → новый ожидающий SW без reload и потери ввода; текущий runtime → следующий ожидающий SW; «Позже» и отмена подтверждения; явное обновление; активация из другой вкладки с сохранением текста в ней. Следующая редакция SW отличается безопасным комментарием, поэтому тест проверяет реальный lifecycle, не меняя бизнес-данные. Результат JSON и три снимка сохраняются в папке вывода.

Первый переход со старой autoUpdate-версии оставляет старый сеанс открытым до закрытия всех вкладок приложения и повторного запуска. Старый runtime ещё не имеет нового уведомления. После перехода последующие обновления управляются видимым уведомлением. Физическое обновление iPhone PWA проверяется отдельно.
