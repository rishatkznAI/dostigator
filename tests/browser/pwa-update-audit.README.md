# Проверка обновления приложения

Сценарий использует отдельный временный HTTP-сервер и три production build. Он не переключает режим общих API-стендов и не обращается к production Supabase. Chromium запускается с новым профилем.

1. Собрать исходный `main` `29c8808` в отдельном checkout с его `registerType: autoUpdate`:
   `GITHUB_PAGES=true VITE_SUPABASE_URL=http://127.0.0.1:4299 VITE_SUPABASE_PUBLISHABLE_KEY=isolated-pwa-update-test pnpm exec vite build --outDir ../pwa-update-build-old`
2. Собрать текущую версию с `registerType: prompt`, `GITHUB_SHA` тестового candidate commit и `--outDir ../pwa-update-build-new`. Выполнить `prepareFreshEntry` из `scripts/prepare-pages-build.mjs` для этой папки.
3. Собрать следующий выпуск с другим `GITHUB_SHA` в `../pwa-update-build-next` и также подготовить свежий HTML alias. Это настоящий второй build с другими bundled metadata и хешами assets; комментарий в SW не имитирует новую версию.
4. Из текущего checkout выполнить:
   `DOSTIGATOR_AUDIT_OUTPUT=.cache/pwa-update-audit node tests/browser/pwa-update-audit.mjs`

При необходимости задать `PWA_OLD_BUILD`, `PWA_NEW_BUILD`, `PWA_NEXT_BUILD` и `PLAYWRIGHT_EXECUTABLE_PATH`. Папки не должны содержать credentials или backup.

Проверяются старый runtime → ожидающий SW без reload и потери ввода; foreground-проверка актуальных server metadata; компактное уведомление в пяти ширинах; отмена; явный переход этой вкладки через network alias; реальный bundled SHA после перехода; сохранение ввода соседней вкладки и waiting worker без `SKIP_WAITING`. Результат JSON и снимки сохраняются в папке вывода.

Отдельный `fresh-entry-audit.mjs` проверяет две настоящие legacy autoUpdate-вкладки при открытии network alias. Обновление в обычном браузере следует открывать в том же браузере и профиле. Физический iPhone/Яндекс и отдельные Home Screen контейнеры требуют проверки на устройстве.
