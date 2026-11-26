window.STATE =
{
  "version": 2,
  "slug": "gold-traitors-v2",
  "dir": "2026-11-27-gold-traitors-v2--wip",
  "title": "Золото и предатели — закрытая альфа",
  "mode": "semi",
  "depth": "normal",
  "tier": "T2",
  "briefFile": "2026-11-27-brief.md",
  "memoryFile": "AGENTS.md",
  "memoryOwner": "user",
  "skillDir": "C:/Users/Alexandr/.codex/skills/autopilot",
  "baseCommit": null,
  "startedAt": "2026-11-27T00:38:40+03:00",
  "updatedAt": "2026-11-27T00:42:48+03:00",
  "finishedAt": null,
  "stages": [
    {
      "id": "preflight",
      "status": "done",
      "startedAt": "2026-11-27T00:38:40+03:00",
      "finishedAt": "2026-11-27T00:39:04+03:00"
    },
    {
      "id": "manifest",
      "status": "done",
      "startedAt": "2026-11-27T00:39:04+03:00",
      "finishedAt": "2026-11-27T00:39:40+03:00"
    },
    {
      "id": "briefing",
      "status": "done",
      "startedAt": "2026-11-27T00:39:40+03:00",
      "finishedAt": "2026-11-27T00:39:45+03:00"
    },
    {
      "id": "spec",
      "status": "done",
      "startedAt": "2026-11-27T00:39:45+03:00",
      "finishedAt": "2026-11-27T00:42:00+03:00"
    },
    {
      "id": "plan",
      "status": "active",
      "startedAt": "2026-11-27T00:42:00+03:00"
    },
    {
      "id": "build",
      "status": "pending"
    },
    {
      "id": "review",
      "status": "pending"
    },
    {
      "id": "final",
      "status": "pending"
    }
  ],
  "requirements": {
    "total": 43,
    "done": 0,
    "inTicket": 43,
    "inSpec": 0,
    "placeholder": 0,
    "deferred": 0,
    "dropped": 0
  },
  "tickets": [
    {
      "id": "01",
      "title": "Основа альфы",
      "requirements": [
        "R01",
        "R02",
        "R03",
        "R05",
        "R40"
      ],
      "blockedBy": [],
      "wave": 1,
      "zone": [
        "package.json",
        "pnpm-lock.yaml",
        "pnpm-workspace.yaml",
        "tsconfig.json",
        "eslint.config.mjs",
        "vitest.config.ts"
      ],
      "review": "да — фундамент",
      "model": "сильная",
      "status": "pending",
      "retries": 0,
      "repairs": 0
    },
    {
      "id": "02",
      "title": "Правила и граф",
      "requirements": [
        "R06",
        "R07",
        "R08",
        "R09",
        "R10",
        "R11",
        "R12",
        "R13",
        "R14",
        "R15",
        "R21",
        "R27",
        "R31"
      ],
      "blockedBy": [
        "01"
      ],
      "wave": 2,
      "zone": [
        "packages/game-core/",
        "packages/config/",
        "tests/core/"
      ],
      "review": "нет",
      "model": "сильная",
      "status": "pending",
      "retries": 0,
      "repairs": 0
    },
    {
      "id": "03",
      "title": "Сервер, комнаты и боты",
      "requirements": [
        "R16",
        "R17",
        "R18",
        "R19",
        "R20",
        "R21",
        "R22",
        "R23",
        "R27",
        "R28",
        "R34",
        "R41",
        "R42"
      ],
      "blockedBy": [
        "01"
      ],
      "wave": 2,
      "zone": [
        "apps/server/",
        "packages/protocol/",
        "packages/bots/",
        "migrations/",
        "compose.yaml",
        "tests/server/"
      ],
      "review": "да — сессии и сохранение",
      "model": "сильная",
      "status": "pending",
      "retries": 0,
      "repairs": 0
    },
    {
      "id": "04",
      "title": "Растровый комплект",
      "requirements": [
        "R04",
        "R29",
        "R30",
        "R40",
        "R43"
      ],
      "blockedBy": [
        "01"
      ],
      "wave": 2,
      "zone": [
        "assets/",
        "data/asset-manifest.json",
        "tools/verify_assets_v2.py",
        "tools/prepare_*",
        "docs/ALPHA_ASSETS.md"
      ],
      "review": "нет",
      "model": "обычная",
      "status": "pending",
      "retries": 0,
      "repairs": 0
    },
    {
      "id": "05",
      "title": "Шахта и игровые экраны",
      "requirements": [
        "R14",
        "R16",
        "R20",
        "R21",
        "R23",
        "R24",
        "R25",
        "R26",
        "R27",
        "R29",
        "R43"
      ],
      "blockedBy": [
        "01"
      ],
      "wave": 2,
      "zone": [
        "apps/web/",
        "tests/web/",
        "playwright.config.ts"
      ],
      "review": "нет",
      "model": "обычная",
      "status": "pending",
      "retries": 0,
      "repairs": 0
    },
    {
      "id": "06",
      "title": "Проверка закрытой альфы",
      "requirements": [
        "R04",
        "R31",
        "R32",
        "R33",
        "R34",
        "R35",
        "R36",
        "R37",
        "R38",
        "R39",
        "R43"
      ],
      "blockedBy": [
        "02",
        "03",
        "04",
        "05"
      ],
      "wave": 3,
      "zone": [
        "scripts/",
        "tests/acceptance/",
        "README.md",
        "docs/ALPHA_RUNBOOK.md",
        "docs/ALPHA_ACCEPTANCE.md",
        "docs/STATUS.md",
        "docs/RULES_DECISIONS.md"
      ],
      "review": "нет",
      "model": "сильная",
      "status": "pending",
      "retries": 0,
      "repairs": 0
    }
  ],
  "tests": null,
  "debt": {
    "placeholders": [],
    "assumptions": [],
    "emptyEnv": []
  },
  "additions": [],
  "coverage": {
    "found": 5,
    "fixed": 5,
    "deferred": 0,
    "items": []
  },
  "concerns": [],
  "blind": null,
  "beats": [
    "2026-11-27T00:38:40+03:00",
    "2026-11-27T00:39:04+03:00",
    "2026-11-27T00:39:39+03:00",
    "2026-11-27T00:39:40+03:00",
    "2026-11-27T00:39:45+03:00",
    "2026-11-27T00:41:02+03:00",
    "2026-11-27T00:42:00+03:00",
    "2026-11-27T00:42:46+03:00",
    "2026-11-27T00:42:47+03:00",
    "2026-11-27T00:42:48+03:00"
  ],
  "rev": 12,
  "waiting": null,
  "waits": [],
  "log": [
    {
      "t": "2026-11-27T00:38:40+03:00",
      "k": "init"
    },
    {
      "t": "2026-11-27T00:39:04+03:00",
      "k": "stage",
      "id": "manifest",
      "act": "start"
    },
    {
      "t": "2026-11-27T00:39:40+03:00",
      "k": "stage",
      "id": "briefing",
      "act": "start"
    },
    {
      "t": "2026-11-27T00:39:45+03:00",
      "k": "gate",
      "g": "G1",
      "ok": false,
      "open": 43,
      "total": 43
    },
    {
      "t": "2026-11-27T00:39:45+03:00",
      "k": "stage",
      "id": "spec",
      "act": "start"
    },
    {
      "t": "2026-11-27T00:41:02+03:00",
      "k": "tier",
      "v": "T3"
    },
    {
      "t": "2026-11-27T00:42:00+03:00",
      "k": "gate",
      "g": "G2",
      "ok": true,
      "found": 5,
      "fixed": 5,
      "deferred": 0
    },
    {
      "t": "2026-11-27T00:42:00+03:00",
      "k": "stage",
      "id": "plan",
      "act": "start"
    },
    {
      "t": "2026-11-27T00:42:46+03:00",
      "k": "tier",
      "v": "T2"
    },
    {
      "t": "2026-11-27T00:42:47+03:00",
      "k": "tickets",
      "n": 6
    },
    {
      "t": "2026-11-27T00:42:48+03:00",
      "k": "gate",
      "g": "G3",
      "ok": true,
      "problems": 0
    }
  ],
  "reqList": [
    {
      "id": "R01",
      "text": "Обнови локальную копию репозитория из ветки main",
      "status": "in-ticket"
    },
    {
      "id": "R02",
      "text": "Прочитай обновлённый AGENTS.md и docs/FULL_TECHNICAL_SPEC.md версии 2.0",
      "status": "in-ticket"
    },
    {
      "id": "R03",
      "text": "Старое ТЗ больше не действует",
      "status": "in-ticket"
    },
    {
      "id": "R04",
      "text": "Сохрани подготовленные локальные графические ассеты",
      "status": "in-ticket"
    },
    {
      "id": "R05",
      "text": "Используй [$autopilot]",
      "status": "in-ticket"
    },
    {
      "id": "R06",
      "text": "валидированный immutable Ruleset при создании матча",
      "status": "in-ticket"
    },
    {
      "id": "R07",
      "text": "ID, версию и SHA-256 канонической сериализации профиля",
      "status": "in-ticket"
    },
    {
      "id": "R08",
      "text": "16 геометрий (7 соединённых и 9 тупиковых) и 11 действий",
      "status": "in-ticket"
    },
    {
      "id": "R09",
      "text": "Граф содержит вершины (tileInstanceId, componentIndex)",
      "status": "in-ticket"
    },
    {
      "id": "R10",
      "text": "Обе жилы одновременно достижимы от входа",
      "status": "in-ticket"
    },
    {
      "id": "R11",
      "text": "Истёк лимит ходов либо исчерпаны карты без достижения цели",
      "status": "in-ticket"
    },
    {
      "id": "R12",
      "text": "Роли перераздаются каждый раунд",
      "status": "in-ticket"
    },
    {
      "id": "R13",
      "text": "личный числовой счёт",
      "status": "in-ticket"
    },
    {
      "id": "R14",
      "text": "подтверждения всех или тайм-аута 20 секунд",
      "status": "in-ticket"
    },
    {
      "id": "R15",
      "text": "Невалидный ход не меняет revision, руки, счётчик или RNG",
      "status": "in-ticket"
    },
    {
      "id": "R16",
      "text": "создание/вход в закрытую комнату, лобби, готовность",
      "status": "in-ticket"
    },
    {
      "id": "R17",
      "text": "токен в HttpOnly/SameSite cookie",
      "status": "in-ticket"
    },
    {
      "id": "R18",
      "text": "снимок JSONB с schemaVersion + журнал",
      "status": "in-ticket"
    },
    {
      "id": "R19",
      "text": "Проверять одинаковый commandId/digest прежде stale revision",
      "status": "in-ticket"
    },
    {
      "id": "R20",
      "text": "безопасный snapshot",
      "status": "in-ticket"
    },
    {
      "id": "R21",
      "text": "своя роль, экземпляры руки, разведка, начисления/сумма",
      "status": "in-ticket"
    },
    {
      "id": "R22",
      "text": "rate limit входа/чат/команд, schema и длины payload",
      "status": "in-ticket"
    },
    {
      "id": "R23",
      "text": "чат/журнал",
      "status": "in-ticket"
    },
    {
      "id": "R24",
      "text": "Вертикальный и горизонтальный телефон, компьютер",
      "status": "in-ticket"
    },
    {
      "id": "R25",
      "text": "Выбор карты, разрешённые клетки, ghost, 180°, отмена/подтвердить",
      "status": "in-ticket"
    },
    {
      "id": "R26",
      "text": "Управление мышью/тачем/клавиатурой",
      "status": "in-ticket"
    },
    {
      "id": "R27",
      "text": "Общий счёт, все победители/ничья, повтор/лобби",
      "status": "in-ticket"
    },
    {
      "id": "R28",
      "text": "Бот получает ровно PlayerView и legalMoves",
      "status": "in-ticket"
    },
    {
      "id": "R29",
      "text": "Не использовать старые SVG, не включать SVG, archive, source PNG и макеты в web dist",
      "status": "in-ticket"
    },
    {
      "id": "R30",
      "text": "вход — 4 связанных порта, раскрытая камера v0 — только W",
      "status": "in-ticket"
    },
    {
      "id": "R31",
      "text": "целевой прогон 100 завершённых матчей каждого размера 3–10 (800)",
      "status": "in-ticket"
    },
    {
      "id": "R32",
      "text": "Начальная загрузка ≤1,5 МБ и интерактивность ≤3 с",
      "status": "in-ticket"
    },
    {
      "id": "R33",
      "text": "20 комнат по 10 участников",
      "status": "in-ticket"
    },
    {
      "id": "R34",
      "text": "миграции, runbook",
      "status": "in-ticket"
    },
    {
      "id": "R35",
      "text": "Закрытые партии 3, 5–6, 10 мест",
      "status": "in-ticket"
    },
    {
      "id": "R36",
      "text": "отдельно хотя бы одна партия людей",
      "status": "in-ticket"
    },
    {
      "id": "R37",
      "text": "Не реализовывать Telegram/MAX/VK, платежи",
      "status": "in-ticket"
    },
    {
      "id": "R38",
      "text": "Публикацию и платный запуск не проводить",
      "status": "in-ticket"
    },
    {
      "id": "R39",
      "text": "На каждом этапе конкретный commit, команды и результат тестов",
      "status": "in-ticket"
    },
    {
      "id": "R40",
      "text": "сформировать missing-assets/ADR",
      "status": "in-ticket"
    },
    {
      "id": "R41",
      "text": "Срок закрытой комнаты и сессий документировать",
      "status": "in-ticket"
    },
    {
      "id": "R42",
      "text": "Не допускать вечного ожидания",
      "status": "in-ticket"
    },
    {
      "id": "R43",
      "text": "скриншоты реально собранных полей при DPR 1/2/3",
      "status": "in-ticket"
    }
  ],
  "gates": {
    "G1": {
      "ok": false,
      "at": "2026-11-27T00:39:45+03:00",
      "open": 43,
      "total": 43
    },
    "G2": {
      "ok": true,
      "at": "2026-11-27T00:42:00+03:00",
      "found": 5,
      "fixed": 5,
      "deferred": 0
    },
    "G3": {
      "ok": true,
      "at": "2026-11-27T00:42:48+03:00",
      "problems": 0
    }
  },
  "result": null
}
