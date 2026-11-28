# Границы, решённые в спецификации

Источник требований — AGENTS.md и docs/FULL_TECHNICAL_SPEC.md 2.0. Сопоставление ниже входит в контракт тасков. Использовать относительные ESM-импорты с .js для TS-исходников и type-only импорты для DTO на клиенте. Корневой tsconfig поддерживает NodeNext, JSX react-jsx и strict.

## Core и конфигурация

packages/game-core/src/index.ts экспортирует validateCatalog(raw), validateRuleset(raw,catalog), newMatch(definition, { matchId, seatIds }, rng), startRound(state, rng), legalMoves(state, seatId), applyCommand(state, seatId, command, rng), evaluateOutcome, settleRewards, publicView(state), playerView(state, seatId), assertInvariants, rotatePorts, buildGraph и reachableComponents. definition содержит каталог, профиль и digest. RNG — () => number в [0,1). MatchState JSON-совместим, для сохранённых снимков у него schemaVersion, matchId, revision, phase, roundNo. Ключ commit-result — {ok:true,state,events} или {ok:false,code}. Core принимает только доменные команды без сетевого envelope. Игровые команды и свойства из §6 ТЗ, ACK_ROLE (по месту), EXPIRE_ROLE_REVEAL (только сервер), ACK_SUMMARY (по месту), ABANDON (только сервер после проверки прав). При успешном reducer revision увеличивается на один. Внутренние автоматические этапы проходят атомарно, но отражаются в безопасном журнале.

PublicView содержит matchId, revision, phase, roundNo, rounds, turnSeatId, turnNumber, maxTurns, deckCount, seats [{seatId, handCount, brokenTools, role?}], board [{x,y,rotation,assetId,kind,goalSlotId?,revealed?,reachable?}], outcome, finalScores и winnerSeatIds после матча, summaryAcknowledged как публичный прогресс. PlayerView расширяет PublicView полями self {seatId,role,hand:[{instanceId,typeId,assetId}],scoutResults:[{goalSlotId,assetId,content}],score,roundScore,roleAcknowledged} и moves (список доменных команд). Предоставлять снимок игроку только после проверки места. Внутренние состояния и seed закрыты. Идентификаторы мест и экземпляров непрозрачны.

## Сеть

apps/server владеет Hono, WS, сессией, авторизацией и событиями; packages/protocol валидирует wire команды, чат, лобби и входящие подписки. packages/bots принимает только PlayerView и тот же список ходов. Снимок GET /api/rooms/:roomId и WS type=SNAPSHOT содержит {room:{roomId,code,hostSeatId,mySeatId,seats:[{seatId,name,avatarId,ready,present,bot}],turnTimeoutSeconds},match:PlayerView|null,chat:[{messageId,seatId,name,text,at}],journal:[{sequence,actorSeatId,type,revision,at,data?}],sequence}. Сессия POST /api/session/guest {name}, GET /api/session; POST /api/rooms {}, POST /api/rooms/join {code}, POST /api/rooms/:roomId/leave. Гость получает cookie, тело не содержит токен. Для UI используется единый origin и dev proxy.

Управление комнатой и игра POST /api/rooms/:roomId/commands либо WS {type:'COMMAND',roomId,matchId,expectedRevision,commandId,command}. Команды лобби SET_READY {ready}, ADD_BOT, REMOVE_BOT {seatId}, SET_TIMER {seconds}, START_MATCH, REPLAY, ABANDON. Игровые команды как в core. HTTP ack и WS ACK {type:'ACK',commandId,ok,revision?,code?}; после успешного изменения сервер отправляет персональные снимки. WS SUBSCRIBE/RESYNC {type,roomId}, чат POST /api/rooms/:roomId/chat {text}. HTTP мутации возвращают snapshot или ack и ошибки с {code}. Использовать 127.0.0.1 в локальных командах. cwd корень. DB port для тестов переопределяемый; никаких реальных хранилищ. Dev сервер API на 4174, Vite на 4173, endpoints /health/live и /health/ready.

## Браузер и изображения

apps/web владеет React UI, Vite, CSS и transport. UI читает runtime manifest, карта получает URLs из manifest by assetId; статический Vite allowlist совпадает с проверенными манифестом raster files. UI не загружает сырые конфиги или полный core state из сети. Элементы целей опираются на slotId и x/y из DTO. Код приглашения передаётся query-параметром join. Серверная реализация может согласовать добавочные безопасные поля через этот файл, имена выше меняются только при согласовании с соседним таском.

## Независимые проверки

Core tests и сценарии R, postgres integration N, отдельные browser contexts U, QA манифеста и снимки A, load и симулятор E5. У каждого блока собственные файлы в tests или своем пакете. Журнал E0–E5 и ADR ведутся локально. Незавершённые проверки сохраняют реальный статус.

## Правила разработки

pnpm install --frozen-lockfile, pnpm check, pnpm exec vitest run <файл>, pnpm build, pnpm e2e. Корневые зависимости и lockfile принадлежат 01. Все изменения только в этом worktree. Основная копия и ZIP/JPG владельца остаются сохранены. Не публиковать, не мержить и не удалять файлы пользователя. Каждый исполнитель записывает точные команды, код возврата, незавершённые критерии и конкретные пути для коммита.
