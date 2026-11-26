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
  "baseCommit": "48629bb",
  "startedAt": "2026-11-27T00:38:40+03:00",
  "updatedAt": "2026-11-27T01:36:51+03:00",
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
      "finishedAt": "2026-11-27T00:44:35+03:00",
      "note": "Все 43 требования имеют секции ТЗ или критерии таска"
    },
    {
      "id": "plan",
      "status": "done",
      "startedAt": "2026-11-27T00:42:00+03:00",
      "finishedAt": "2026-11-27T00:43:15+03:00"
    },
    {
      "id": "build",
      "status": "done",
      "startedAt": "2026-11-27T00:43:15+03:00",
      "finishedAt": "2026-11-27T01:27:21+03:00"
    },
    {
      "id": "review",
      "status": "done",
      "startedAt": "2026-11-27T01:27:21+03:00",
      "finishedAt": "2026-11-27T01:27:42+03:00"
    },
    {
      "id": "final",
      "status": "active",
      "startedAt": "2026-11-27T01:27:42+03:00"
    }
  ],
  "requirements": {
    "total": 43,
    "done": 41,
    "inTicket": 0,
    "inSpec": 0,
    "placeholder": 2,
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
      "status": "done",
      "startedAt": "2026-11-27T00:43:21+03:00",
      "finishedAt": "2026-11-27T01:10:12+03:00",
      "retries": 0,
      "repairs": 0,
      "tests": {
        "passed": 1,
        "failed": 0
      },
      "commit": "7ddcdde"
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
      "blockedBy": [],
      "wave": 1,
      "zone": [
        "packages/game-core/",
        "packages/config/",
        "tests/core/"
      ],
      "review": "нет",
      "model": "сильная",
      "status": "done",
      "startedAt": "2026-11-27T00:48:28+03:00",
      "finishedAt": "2026-11-27T01:03:54+03:00",
      "retries": 0,
      "repairs": 0,
      "tests": {
        "passed": 16,
        "failed": 0
      },
      "commit": "faa35e7"
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
      "status": "done",
      "startedAt": "2026-11-27T00:52:00+03:00",
      "finishedAt": "2026-11-27T01:17:55+03:00",
      "retries": 0,
      "repairs": 0,
      "tests": {
        "passed": 8,
        "failed": 0
      },
      "commit": "8668f4e"
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
      "blockedBy": [],
      "wave": 1,
      "zone": [
        "assets/",
        "data/asset-manifest.json",
        "tools/verify_assets_v2.py",
        "tools/prepare_*",
        "docs/ALPHA_ASSETS.md"
      ],
      "review": "нет",
      "model": "обычная",
      "status": "done",
      "startedAt": "2026-11-27T00:47:59+03:00",
      "finishedAt": "2026-11-27T01:08:25+03:00",
      "retries": 0,
      "repairs": 1,
      "repairFindings": [
        "Вход и камеры должны пройти строгую геометрию; подготовлены четыре иллюстрации без рамок, исходные WebP сохраняются."
      ],
      "tests": {
        "passed": 3,
        "failed": 0
      },
      "commit": "06d60b9"
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
      "status": "done",
      "startedAt": "2026-11-27T00:54:07+03:00",
      "retries": 0,
      "repairs": 0,
      "finishedAt": "2026-11-27T01:24:37+03:00",
      "tests": {
        "passed": 2,
        "failed": 0
      },
      "commit": "adc0b70"
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
        "04"
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
      "status": "done",
      "retries": 0,
      "repairs": 0,
      "startedAt": "2026-11-27T01:15:55+03:00",
      "finishedAt": "2026-11-27T01:34:04+03:00",
      "tests": {
        "passed": 4,
        "failed": 0
      },
      "commit": "23f856b"
    }
  ],
  "tests": {
    "passed": 25,
    "failed": 0
  },
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
  "concerns": [
    "Агрегированные метрики /health/metrics в контуре мониторинга; при закрытом HTTPS-прокси маршрутизируются только приложение, /api и /ws."
  ],
  "blind": {
    "checked": 6,
    "matched": 4,
    "mismatches": [
      "E4: пакет, геометрия и сборка проверены; художественная приёмка остаётся открытой.",
      "E5: технические прогоны прошли; требуются живые партии, физические устройства и LAN/HTTPS с участниками."
    ]
  },
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
    "2026-11-27T00:42:48+03:00",
    "2026-11-27T00:43:13+03:00",
    "2026-11-27T00:43:15+03:00",
    "2026-11-27T00:43:21+03:00",
    "2026-11-27T00:44:35+03:00",
    "2026-11-27T00:47:57+03:00",
    "2026-11-27T00:47:58+03:00",
    "2026-11-27T00:47:59+03:00",
    "2026-11-27T00:48:26+03:00",
    "2026-11-27T00:48:27+03:00",
    "2026-11-27T00:48:28+03:00",
    "2026-11-27T00:51:59+03:00",
    "2026-11-27T00:52:00+03:00",
    "2026-11-27T00:54:07+03:00",
    "2026-11-27T00:55:03+03:00",
    "2026-11-27T01:03:54+03:00",
    "2026-11-27T01:03:55+03:00",
    "2026-11-27T01:08:25+03:00",
    "2026-11-27T01:08:27+03:00",
    "2026-11-27T01:08:38+03:00",
    "2026-11-27T01:10:12+03:00",
    "2026-11-27T01:15:52+03:00",
    "2026-11-27T01:15:53+03:00",
    "2026-11-27T01:15:54+03:00",
    "2026-11-27T01:15:55+03:00",
    "2026-11-27T01:17:55+03:00",
    "2026-11-27T01:17:56+03:00",
    "2026-11-27T01:24:37+03:00",
    "2026-11-27T01:27:21+03:00",
    "2026-11-27T01:27:42+03:00",
    "2026-11-27T01:30:42+03:00",
    "2026-11-27T01:34:04+03:00",
    "2026-11-27T01:36:50+03:00",
    "2026-11-27T01:36:51+03:00"
  ],
  "rev": 49,
  "waiting": {
    "kind": "stop",
    "since": "2026-11-27T01:36:51+03:00",
    "note": "Рабочая локальная сборка проверена. Для полной приёмки нужны живые партии, физические устройства и художественная оценка."
  },
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
    },
    {
      "t": "2026-11-27T00:43:15+03:00",
      "k": "stage",
      "id": "build",
      "act": "start"
    },
    {
      "t": "2026-11-27T00:43:21+03:00",
      "k": "ticket",
      "ids": [
        "01"
      ],
      "act": "start"
    },
    {
      "t": "2026-11-27T00:44:35+03:00",
      "k": "gate",
      "g": "G1",
      "ok": true,
      "open": 0,
      "total": 43
    },
    {
      "t": "2026-11-27T00:44:35+03:00",
      "k": "stage",
      "id": "spec",
      "act": "done"
    },
    {
      "t": "2026-11-27T00:47:57+03:00",
      "k": "tickets",
      "n": 6
    },
    {
      "t": "2026-11-27T00:47:58+03:00",
      "k": "gate",
      "g": "G3",
      "ok": true,
      "problems": 0
    },
    {
      "t": "2026-11-27T00:47:59+03:00",
      "k": "ticket",
      "ids": [
        "04"
      ],
      "act": "start"
    },
    {
      "t": "2026-11-27T00:48:26+03:00",
      "k": "tickets",
      "n": 6
    },
    {
      "t": "2026-11-27T00:48:27+03:00",
      "k": "gate",
      "g": "G3",
      "ok": true,
      "problems": 0
    },
    {
      "t": "2026-11-27T00:48:28+03:00",
      "k": "ticket",
      "ids": [
        "02"
      ],
      "act": "start"
    },
    {
      "t": "2026-11-27T00:51:59+03:00",
      "k": "ticket",
      "ids": [
        "01"
      ],
      "act": "done",
      "tests": {
        "passed": 1,
        "failed": 0
      }
    },
    {
      "t": "2026-11-27T00:52:00+03:00",
      "k": "ticket",
      "ids": [
        "03"
      ],
      "act": "start"
    },
    {
      "t": "2026-11-27T00:54:07+03:00",
      "k": "ticket",
      "ids": [
        "05"
      ],
      "act": "start"
    },
    {
      "t": "2026-11-27T00:55:03+03:00",
      "k": "ticket",
      "ids": [
        "04"
      ],
      "act": "done",
      "tests": {
        "passed": 2,
        "failed": 1
      }
    },
    {
      "t": "2026-11-27T00:55:03+03:00",
      "k": "add",
      "key": "report",
      "n": 1
    },
    {
      "t": "2026-11-27T01:03:54+03:00",
      "k": "ticket",
      "ids": [
        "02"
      ],
      "act": "done",
      "tests": {
        "passed": 16,
        "failed": 0
      }
    },
    {
      "t": "2026-11-27T01:03:55+03:00",
      "k": "ticket",
      "ids": [
        "04"
      ],
      "act": "repair",
      "note": "Вход и камеры должны пройти строгую геометрию; подготовлены четыре иллюстрации без рамок, исходные WebP сохраняются."
    },
    {
      "t": "2026-11-27T01:08:25+03:00",
      "k": "ticket",
      "ids": [
        "04"
      ],
      "act": "done",
      "tests": {
        "passed": 3,
        "failed": 0
      }
    },
    {
      "t": "2026-11-27T01:08:27+03:00",
      "k": "add",
      "key": "report",
      "n": 1
    },
    {
      "t": "2026-11-27T01:08:38+03:00",
      "k": "ticket",
      "ids": [
        "01"
      ],
      "act": "review"
    },
    {
      "t": "2026-11-27T01:10:12+03:00",
      "k": "ticket",
      "ids": [
        "01"
      ],
      "act": "done",
      "tests": {
        "passed": 1,
        "failed": 0
      }
    },
    {
      "t": "2026-11-27T01:15:52+03:00",
      "k": "ticket",
      "ids": [
        "03"
      ],
      "act": "done",
      "tests": {
        "passed": 8,
        "failed": 0
      }
    },
    {
      "t": "2026-11-27T01:15:53+03:00",
      "k": "ticket",
      "ids": [
        "03"
      ],
      "act": "review"
    },
    {
      "t": "2026-11-27T01:15:53+03:00",
      "k": "tickets",
      "n": 6
    },
    {
      "t": "2026-11-27T01:15:54+03:00",
      "k": "gate",
      "g": "G3",
      "ok": true,
      "problems": 0
    },
    {
      "t": "2026-11-27T01:15:55+03:00",
      "k": "ticket",
      "ids": [
        "06"
      ],
      "act": "start"
    },
    {
      "t": "2026-11-27T01:17:55+03:00",
      "k": "ticket",
      "ids": [
        "03"
      ],
      "act": "done",
      "tests": {
        "passed": 8,
        "failed": 0
      }
    },
    {
      "t": "2026-11-27T01:17:56+03:00",
      "k": "add",
      "key": "concerns",
      "n": 1
    },
    {
      "t": "2026-11-27T01:24:37+03:00",
      "k": "ticket",
      "ids": [
        "05"
      ],
      "act": "done",
      "tests": {
        "passed": 2,
        "failed": 0
      }
    },
    {
      "t": "2026-11-27T01:27:21+03:00",
      "k": "ticket",
      "ids": [
        "06"
      ],
      "act": "done",
      "tests": {
        "passed": 3,
        "failed": 0
      }
    },
    {
      "t": "2026-11-27T01:27:21+03:00",
      "k": "stage",
      "id": "review",
      "act": "start"
    },
    {
      "t": "2026-11-27T01:27:42+03:00",
      "k": "stage",
      "id": "final",
      "act": "start"
    },
    {
      "t": "2026-11-27T01:30:42+03:00",
      "k": "tests",
      "passed": 25,
      "failed": 0
    },
    {
      "t": "2026-11-27T01:34:04+03:00",
      "k": "ticket",
      "ids": [
        "06"
      ],
      "act": "done",
      "tests": {
        "passed": 4,
        "failed": 0
      }
    },
    {
      "t": "2026-11-27T01:36:50+03:00",
      "k": "gate",
      "g": "G4",
      "ok": false,
      "checked": 6,
      "matched": 4
    },
    {
      "t": "2026-11-27T01:36:50+03:00",
      "k": "tests",
      "passed": 25,
      "failed": 0
    },
    {
      "t": "2026-11-27T01:36:51+03:00",
      "k": "ask",
      "kind": "stop",
      "note": "Рабочая локальная сборка проверена. Для полной приёмки нужны живые партии, физические устройства и художественная оценка."
    }
  ],
  "reqList": [
    {
      "id": "R01",
      "text": "Обнови локальную копию репозитория из ветки main",
      "status": "done"
    },
    {
      "id": "R02",
      "text": "Прочитай обновлённый AGENTS.md и docs/FULL_TECHNICAL_SPEC.md версии 2.0",
      "status": "done"
    },
    {
      "id": "R03",
      "text": "Старое ТЗ больше не действует",
      "status": "done"
    },
    {
      "id": "R04",
      "text": "Сохрани подготовленные локальные графические ассеты",
      "status": "done"
    },
    {
      "id": "R05",
      "text": "Используй [$autopilot]",
      "status": "done"
    },
    {
      "id": "R06",
      "text": "валидированный immutable Ruleset при создании матча",
      "status": "done"
    },
    {
      "id": "R07",
      "text": "ID, версию и SHA-256 канонической сериализации профиля",
      "status": "done"
    },
    {
      "id": "R08",
      "text": "16 геометрий (7 соединённых и 9 тупиковых) и 11 действий",
      "status": "done"
    },
    {
      "id": "R09",
      "text": "Граф содержит вершины (tileInstanceId, componentIndex)",
      "status": "done"
    },
    {
      "id": "R10",
      "text": "Обе жилы одновременно достижимы от входа",
      "status": "done"
    },
    {
      "id": "R11",
      "text": "Истёк лимит ходов либо исчерпаны карты без достижения цели",
      "status": "done"
    },
    {
      "id": "R12",
      "text": "Роли перераздаются каждый раунд",
      "status": "done"
    },
    {
      "id": "R13",
      "text": "личный числовой счёт",
      "status": "done"
    },
    {
      "id": "R14",
      "text": "подтверждения всех или тайм-аута 20 секунд",
      "status": "done"
    },
    {
      "id": "R15",
      "text": "Невалидный ход не меняет revision, руки, счётчик или RNG",
      "status": "done"
    },
    {
      "id": "R16",
      "text": "создание/вход в закрытую комнату, лобби, готовность",
      "status": "done"
    },
    {
      "id": "R17",
      "text": "токен в HttpOnly/SameSite cookie",
      "status": "done"
    },
    {
      "id": "R18",
      "text": "снимок JSONB с schemaVersion + журнал",
      "status": "done"
    },
    {
      "id": "R19",
      "text": "Проверять одинаковый commandId/digest прежде stale revision",
      "status": "done"
    },
    {
      "id": "R20",
      "text": "безопасный snapshot",
      "status": "done"
    },
    {
      "id": "R21",
      "text": "своя роль, экземпляры руки, разведка, начисления/сумма",
      "status": "done"
    },
    {
      "id": "R22",
      "text": "rate limit входа/чат/команд, schema и длины payload",
      "status": "done"
    },
    {
      "id": "R23",
      "text": "чат/журнал",
      "status": "done"
    },
    {
      "id": "R24",
      "text": "Вертикальный и горизонтальный телефон, компьютер",
      "status": "done"
    },
    {
      "id": "R25",
      "text": "Выбор карты, разрешённые клетки, ghost, 180°, отмена/подтвердить",
      "status": "done"
    },
    {
      "id": "R26",
      "text": "Управление мышью/тачем/клавиатурой",
      "status": "done"
    },
    {
      "id": "R27",
      "text": "Общий счёт, все победители/ничья, повтор/лобби",
      "status": "done"
    },
    {
      "id": "R28",
      "text": "Бот получает ровно PlayerView и legalMoves",
      "status": "done"
    },
    {
      "id": "R29",
      "text": "Не использовать старые SVG, не включать SVG, archive, source PNG и макеты в web dist",
      "status": "done"
    },
    {
      "id": "R30",
      "text": "вход — 4 связанных порта, раскрытая камера v0 — только W",
      "status": "done"
    },
    {
      "id": "R31",
      "text": "целевой прогон 100 завершённых матчей каждого размера 3–10 (800)",
      "status": "done"
    },
    {
      "id": "R32",
      "text": "Начальная загрузка ≤1,5 МБ и интерактивность ≤3 с",
      "status": "done"
    },
    {
      "id": "R33",
      "text": "20 комнат по 10 участников",
      "status": "done"
    },
    {
      "id": "R34",
      "text": "миграции, runbook",
      "status": "done"
    },
    {
      "id": "R35",
      "text": "Закрытые партии 3, 5–6, 10 мест",
      "status": "placeholder",
      "why": "Определено ТЗ 2.0"
    },
    {
      "id": "R36",
      "text": "отдельно хотя бы одна партия людей",
      "status": "placeholder",
      "why": "Определено ТЗ 2.0"
    },
    {
      "id": "R37",
      "text": "Не реализовывать Telegram/MAX/VK, платежи",
      "status": "done"
    },
    {
      "id": "R38",
      "text": "Публикацию и платный запуск не проводить",
      "status": "done"
    },
    {
      "id": "R39",
      "text": "На каждом этапе конкретный commit, команды и результат тестов",
      "status": "done"
    },
    {
      "id": "R40",
      "text": "сформировать missing-assets/ADR",
      "status": "done"
    },
    {
      "id": "R41",
      "text": "Срок закрытой комнаты и сессий документировать",
      "status": "done"
    },
    {
      "id": "R42",
      "text": "Не допускать вечного ожидания",
      "status": "done"
    },
    {
      "id": "R43",
      "text": "скриншоты реально собранных полей при DPR 1/2/3",
      "status": "done"
    }
  ],
  "gates": {
    "G1": {
      "ok": true,
      "at": "2026-11-27T00:44:35+03:00",
      "open": 0,
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
      "at": "2026-11-27T01:15:54+03:00",
      "problems": 0
    },
    "G4": {
      "ok": false,
      "at": "2026-11-27T01:36:50+03:00",
      "checked": 6,
      "matched": 4
    }
  },
  "result": null,
  "report": [
    "E4: пакет и стыки 16 туннелей проверены; вход и открытые камеры дали 35 расхождений геометрии и требуют исправленных экспортов. Снимки и проверка dist проводятся с реальным UI.",
    "E4: отдельные восемь WebP входа/камер прошли проверку портов и связности. Оригинальные 107 файлов сохранены; художественная приёмка и снимки работающего поля проверяются отдельно."
  ]
}
