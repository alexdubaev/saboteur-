# Дополнения к AGENTS.md

«Золото и предатели» — браузерная закрытая альфа для 3–10 игроков с экспериментальным профилем «Две жилы» v0.

## Команды

- Из корня, Node.js 24.15.0+ в ветке 24, pnpm 11.25.0. `pnpm install --frozen-lockfile --offline` воспроизведена в чистой копии с заполненным кешем.
- Локальная PostgreSQL 17 через `docker compose up -d --wait db`. Применить `pnpm migrate`, запустить `pnpm server`, в другом терминале выполнить `pnpm build` и `pnpm exec vite preview --config apps/web/vite.config.ts --host 127.0.0.1 --port 4173 --strictPort`. API на 4174. [Порядок настройки](../../docs/ALPHA_RUNBOOK.md).
- `pnpm check` — типы, линтер и Vitest. С изолированной PostgreSQL полный Vitest дал 25/25. Точечно по сети — `pnpm exec vitest run tests/server/network.test.ts` с `TEST_DATABASE_URL`. Без неё восемь сетевых тестов пропускаются.
- `pnpm e2e` — Chromium с отдельными контекстами и тестовым API в режиме playtest. `python tools/verify_assets_v2.py dist --dist apps/web/dist` — сверка собранных WebP с обоими манифестами.

## Где работать

- [Архитектура и поток данных](../../docs/architecture.md). Порядок решений и терминология — [ADR](../../docs/adr/) и [CONTEXT.md](../../CONTEXT.md).
- [Доменный API](../../packages/game-core/src/index.ts), [активные данные](../../data/game-config.json) и [профиль v0](../../data/rulesets/playtest-expedition-v0.json).
- [Контракты HTTP/WS](../../packages/protocol/src/index.ts), [транзакции комнаты](../../apps/server/src/rooms.ts), [миграция](../../migrations/001_initial.sql).
- [Вход в клиент](../../apps/web/src/app.tsx), [HTTP и переподключение](../../apps/web/src/network.ts), [Vite и реестр графики](../../apps/web/vite.config.ts).

## Подводные камни

- Для полной сетевой проверки на Windows ошибки loopback `ENOBUFS` и блокировка отдельных портов воспроизводились. Изолированное Linux-окружение с API и PostgreSQL прошло проверку. При смене порта БД укажите его и в пробросе Compose, и в строке подключения.
- Проверяйте приватные проекции в разных браузерных контекстах. Cookie привязана к гостевой сессии. В Vite клиент и прокси используют один origin.
- Манифест поставки владельца сохраняет байты WebP из ZIP. Для входа и открытых камер есть отдельный реестр производных файлов. Источники, контрольные суммы и команды сверки — в [документе по графике](../../docs/ALPHA_ASSETS.md).

## Окружение

- `DATABASE_URL` — БД API и миграций. `TEST_DATABASE_URL` — отдельная loopback БД для интеграции и нагрузочного сценария.
- `POSTGRES_PASSWORD`, `POSTGRES_PORT`, `POSTGRES_SUBNET` — пароль локального Compose, проброс порта и подсеть.
- `APP_ORIGIN`, `HOST`, `PORT` — origin клиента и адрес привязки API. `PLAYTEST_MODE` открывает ведущему управление ботами. `PLAYWRIGHT_CHROMIUM_EXECUTABLE` задаёт установленный Chromium для Playwright.

## Как здесь работает Autopilot

Сборка ведётся навыком `/autopilot`. Требования, спецификация и таски — в `.autopilot/`.
Прогресс — `.autopilot/dashboard.html`. Требование из `manifest.md` может снять
только пользователь. Прерванную сборку продолжает «продолжи автопилот».

### Правка без автопилота

Для обычной правки начните с `.autopilot/PROGRESS.md` после его появления в завершённой сборке. Для затронутых решений откройте ADR и исходное требование. После проверки отметьте исправленный пункт и решение владельца в `PROGRESS.md`.

### История git

Следуйте действующей политике владельца для временной ветки от актуального `origin/main`, затронутых локальных проверок и проверенного PR. Для навигации используйте адресную историю файла, поиск по идентификатору требования и отметку `Autopilot: сборка сдана`. В связанном с требованием коммите сохраняйте трейлер `Requirements: Rxx`.
