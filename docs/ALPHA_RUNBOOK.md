# Запуск закрытой альфы

Команды выполняются из корня проекта. Понадобятся Node.js 24.15.0+ из ветки 24, pnpm 11.25.0 и Docker Compose. Для браузерной проверки установите Chromium через Playwright, для проверки WebP нужны Python 3.10+ и Pillow с поддержкой WebP.

## Локальная установка

1. Скопируйте `.env.example` в `.env`. На Linux используется `cp .env.example .env`, в PowerShell — `Copy-Item .env.example .env`.
2. Задайте собственный локальный `POSTGRES_PASSWORD` и заполните `DATABASE_URL` по шаблону `postgresql://gold:<пароль>@127.0.0.1:55437/gold`. В URL кодируйте зарезервированные символы пароля. Поля `APP_ORIGIN=http://127.0.0.1:4173`, `HOST=127.0.0.1` и `PORT=4174` подходят для разработки.
3. Поднимите PostgreSQL, примените миграции и запустите API.

   ```sh
   pnpm install --frozen-lockfile
   docker compose up -d --wait db
   pnpm migrate
   pnpm dev:server
   ```

4. Во втором терминале запустите `pnpm dev`. Откройте `http://127.0.0.1:4173`. Для сетевой партии используйте отдельные профили браузера, чтобы участники получали разные гостевые cookie. При `PLAYTEST_MODE=1` ведущий может добавить обозначенных ботов.

Если Windows, Docker Desktop или сеть блокируют 55437, возьмите свободный 35437 или 45437 и одновременно поменяйте `POSTGRES_PORT` и адрес `DATABASE_URL`. Для тестовой БД используйте отдельный Compose project и свободный порт. При пересечении локальных сетей задайте свободную приватную подсеть через `POSTGRES_SUBNET`. Windows-ошибку `ENOBUFS` на loopback можно обойти запуском проверки API и PostgreSQL в одном изолированном Linux-окружении.

`pnpm build` собирает статический клиент в `apps/web/dist`. Служебный запуск API — `pnpm server`. Приложение читает каталог и профиль при старте, поэтому API запускается из корня checkout с миграциями и файлами `data/`.

## LAN и внешний закрытый тест

- Используйте HTTPS даже для LAN-адреса, потому что клиент создаёт ID команд через Web Crypto. Дайте тестерам HTTPS-адрес или локальное DNS-имя, доступное через VPN либо LAN, и доверенный устройствами сертификат. Укажите этот origin без завершающего слеша в `APP_ORIGIN`.
- Закрывайте доступ к reverse proxy VPN, LAN или списком разрешённых адресов. Выдавайте приглашения участникам закрытой группы.
- С того же HTTPS-origin отдавайте статику `apps/web/dist`, проксируйте `/api/*` и `/ws` к `127.0.0.1:4174`, сохраняйте `Origin` и поддерживайте WebSocket Upgrade. Для WebP с версией из манифеста `?v=…` включите публичное immutable-кеширование. API уже возвращает `Cache-Control: no-store`.
- Оставьте PostgreSQL, внутренний API-порт и `/health/*` на loopback или во внутренней сети. Изоляция особенно важна для `/health/metrics`, который содержит агрегированные числа комнат, подключений и команд. Для внешней проверки без ботов задайте `PLAYTEST_MODE=0`.

### Отдельный стенд для сетевой игры с ботами

В `deploy/playtest` описан отдельный Compose-проект без опубликованных портов. Сервер, PostgreSQL и шлюз используют свои сети и том. Для закрытой группы шлюз добавляет пароль поверх обычных гостевых сессий. Он проксирует HTTPS API и WebSocket с одного адреса. Служебные запросы `/health/*` со стороны игроков получают `404`.

На машине сборки подготовьте новый пустой каталог `release` из проверенного checkout. В путях ниже он находится рядом с репозиторием.

```sh
mkdir ../release
cp package.json pnpm-lock.yaml pnpm-workspace.yaml ../release/
cp -R data migrations ../release/
pnpm exec tsc -p deploy/playtest/tsconfig.json --outDir ../release
pnpm build --outDir ../release/web
pnpm --dir ../release install --prod --frozen-lockfile --ignore-scripts --config.node-linker=hoisted
```

Перенесите `release`, `compose.yaml` и `Caddyfile` на Linux в каталог стенда. В `release` нужны права чтения для контейнеров. Рядом с `compose.yaml` создайте `.env` с правами `0600`. Задайте отдельный `POSTGRES_PASSWORD` из случайных букв и цифр, `PLAYTEST_USER`, `PLAYTEST_HASH` и `APP_ORIGIN`. Для `PLAYTEST_HASH` используйте `caddy hash-password --bcrypt-cost 12` с вводом по stdin и одинарные кавычки в `.env`, чтобы Compose сохранил знаки `$`. Секреты хранятся отдельно от сборки и Git.

Для временного внешнего теста сначала задайте `APP_ORIGIN=https://playtest.invalid` и запустите только `docker compose up -d tunnel`. Дождитесь регистрации адреса в `docker compose logs tunnel`, укажите назначенный HTTPS-origin без завершающего слеша в `.env` и проверьте шлюз. С другого устройства `GET /` без пароля должен вернуть `401`. Quick Tunnel выдаёт другой адрес после перезапуска. После смены адреса обновите `APP_ORIGIN`, пересоздайте `app` и раздайте новые приглашения. Для постоянного адреса нужен собственный HTTPS-вход.

```sh
docker compose config --quiet
docker compose up -d --wait db
docker compose run --rm app node apps/server/src/migrate.js
docker compose up -d --wait app gateway
```

Проверьте `ready` внутри `app`, вход с двух отдельных браузерных сессий, нажатие «Добавить бота», ход на общем поле и восстановление после обновления. Чтобы остановить этот стенд, используйте `docker compose stop tunnel gateway app db` из его каталога. Снимок перед будущим обновлением храните вне каталога релиза, а предыдущий релиз сохраняйте до успешной проверки нового. Для остановки том базы сохраняется.

## Проверки

Установите `TEST_DATABASE_URL` для отдельной тестовой PostgreSQL на loopback. Запуски Vitest и сетевой замер создают свои схемы. Без переменной интеграционные тесты пропускаются. Браузерный прогон ожидает локальный API на 4174 с `PLAYTEST_MODE=1` и отдельной тестовой БД.

```sh
pnpm check
pnpm build
pnpm exec playwright install chromium
pnpm e2e
python tools/verify_assets_v2.py package
python tools/verify_assets_v2.py tunnels
python tools/verify_assets_v2.py board
python tools/verify_assets_v2.py dist --dist apps/web/dist
pnpm simulate --matches-per-size 100 --seed 20261127
pnpm exec tsx scripts/check-alpha-network.ts matches
pnpm exec tsx scripts/check-alpha-network.ts load
```

`matches` завершает по одной сетевой партии для 3, 6 и 10 программных клиентов. `load` открывает 200 WebSocket-соединений и проверяет 720 команд в 20 комнатах с локальной задержкой подтверждения p95 ≤150 мс. Оба сценария получают роли, допустимые ходы и обновления от реального сервера и завершаются удалением только созданной ими схемы.

Для браузерных замеров остановите Vite dev, оставьте локальный тестовый API на 4174 и отдайте сборку на 4173. Режим `moves` использует обозначенных ботов и создаёт тестовый матч. Оба запуска включают ограничение сети в Chromium до 10 Мбит/с и RTT 100 мс.

```sh
pnpm exec vite preview --config apps/web/vite.config.ts --host 127.0.0.1 --port 4173 --strictPort
```

В другом терминале запустите `pnpm exec tsx scripts/check-alpha-browser.ts` для меню и готовности в лобби или `pnpm exec tsx scripts/check-alpha-browser.ts moves` для игровых подтверждений.

## Мониторинг и остановка

- `GET /health/live` подтверждает ответ процесса. `GET /health/ready` проверяет доступность БД и таблицы комнат. `GET /health/metrics` выдаёт активные комнаты, сокеты, число команд, суммарное время обработки команд и число resync.
- Сервер выдаёт структурированные записи запуска, остановки и ошибок. Диагностику источника ошибки ведите без cookie, секретов, ролей, карт, частной разведки или текста чата.
- Остановите процесс Node через Ctrl+C или SIGTERM. Он завершит прослушивание и закроет WebSocket и пул БД. При возвращении откройте прежний профиль браузера с действующей cookie и дождитесь нового снимка.
- Гостевая сессия действует 30 дней. Лобби доступно 24 часа после создания, комната завершённого или прерванного матча — 7 дней. У активного матча лимита хранения комнаты нет. Истечение доступа само по себе не удаляет записи из PostgreSQL.

## Резервирование и восстановление

Перед обновлением сохраните согласованную копию БД в защищённое место вне репозитория. Матчи и сессии требуют одинаковой защиты с основной базой. Команды ниже предполагают локальный сервис Compose `db` с пользователем и базой `gold`.

```sh
docker compose exec -T db pg_dump -U gold -d gold -Fc -f /tmp/gold-alpha.dump
docker compose cp db:/tmp/gold-alpha.dump ../gold-alpha.dump
```

Для прогона восстановления поднимите `db` в отдельном локальном проекте Compose с новым томом, свободным портом и отдельной подсетью. Передайте копию в этот контейнер, создайте пустую БД `gold_restore` и проверьте её на тестовом сервере.

```sh
docker compose -p gold-alpha-restore cp ../gold-alpha.dump db:/tmp/gold-alpha.dump
docker compose -p gold-alpha-restore exec -T db createdb -U gold gold_restore
docker compose -p gold-alpha-restore exec -T db pg_restore -U gold -d gold_restore --exit-on-error --single-transaction --no-owner /tmp/gold-alpha.dump
```

Во временной конфигурации укажите восстановленную БД, запустите подходящую версию кода, `pnpm migrate` и `pnpm server`. Проверьте readiness, восстановление комнаты, ревизию и загрузку персонального снимка тестовой сессии. Для действующей альфы переключайте конфигурацию только после успешной проверки копии и сохранения прежней БД. Дампы удаляйте согласно согласованному сроку хранения.

Учебный прогон на PostgreSQL 17.11 подтвердил восстановление активной комнаты и исходной гостевой сессии в отдельной тестовой БД. После запуска API персональный снимок и ревизия совпали с исходными. [Результаты прогона](ALPHA_ACCEPTANCE.md).
