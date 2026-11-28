import { expect, test, type WebSocketRoute } from "@playwright/test";
import type { RoomSnapshot } from "../../packages/protocol/src/index.js";

test("новые правила показывают одну жилу, приватную разведку и раунд без победителя", async ({ page }) => {
  const roomId = "82edc0a7-2001-4118-82a0-ae9f30e4be64";
  const member = { seatId: "host", name: "Старатель", avatarId: "miner", bot: false, present: true, ready: true };
  const move = { type: "PLAY_SCOUT", instanceId: "scout", goalSlotId: "g1" } as const;
  const match: NonNullable<RoomSnapshot["match"]> = {
    matchId: "3df69d80-15d5-4ef9-a701-02b11e251f1d", phase: "TURN", revision: 4, roundNo: 1, rounds: 3,
    requiredOre: 1, maxTurns: null, turnNumber: 0, turnSeatId: member.seatId, deckCount: 49,
    board: [{ x: 8, y: 0, rotation: 0, kind: "goal", goalSlotId: "g1", assetId: "goal-hidden", revealed: false }],
    seats: [{ seatId: member.seatId, handCount: 1, brokenTools: [] }],
    outcome: null, summaryAcknowledged: [],
    self: {
      seatId: member.seatId, role: "prospector", roleAcknowledged: true, score: 0, roundScore: 0,
      hand: [{ instanceId: "scout", typeId: "action-scout", assetId: "action-scout" }], scoutResults: [],
    },
    moves: [move],
  };
  const initial: RoomSnapshot = {
    room: { roomId, code: "SCOUT444", hostSeatId: member.seatId, mySeatId: member.seatId, seats: [member], turnTimeoutSeconds: null, deadlineAt: null },
    match, sequence: 4, journal: [], chat: [],
  };
  let channel: WebSocketRoute | undefined;
  await page.setViewportSize({ width: 360, height: 800 });
  await page.routeWebSocket("**/ws", (socket) => {
    channel = socket;
    socket.onMessage(() => socket.send(JSON.stringify({ type: "SNAPSHOT", ...initial })));
  });
  await page.route("**/api/session", (route) => route.fulfill({ json: { name: member.name, avatarId: member.avatarId } }));
  await page.route(`**/api/rooms/${roomId}`, (route) => route.fulfill({ json: initial }));
  await page.route(`**/api/rooms/${roomId}/commands`, (route) => {
    expect(route.request().postDataJSON().command).toEqual(move);
    return route.fulfill({ json: { type: "ACK", ok: true, revision: 5 } });
  });

  await page.goto("/?room=" + roomId);
  const stats = page.getByLabel("Счётчики партии");
  await expect(stats.getByRole("term").filter({ hasText: /^Золото$/ })).toBeVisible();
  await expect(stats.getByRole("definition").filter({ hasText: /^0\/1$/ })).toBeVisible();
  await expect(stats.getByRole("term").filter({ hasText: /^Ход$/ })).toBeVisible();
  await expect(stats.getByRole("definition").filter({ hasText: /^0$/ })).toBeVisible();
  await page.getByRole("button", { name: "Разведка", exact: true }).click();
  await page.getByRole("button", { name: "Камера 1 · закрыта" }).click();
  await page.getByRole("button", { name: "Подтвердить ход" }).click();
  const dialog = page.getByRole("dialog", { name: "Моя разведка" });
  await expect(dialog.getByRole("status")).toHaveText("Ждём результат разведки…");
  channel!.send(JSON.stringify({
    type: "SNAPSHOT", ...initial, sequence: 5,
    match: { ...match, revision: 5, turnNumber: 1, moves: [], self: {
      ...match.self, hand: [], scoutResults: [{ goalSlotId: "g1", content: "ore", assetId: "goal-gold" }],
    } },
  }));
  await expect(dialog.getByText("Золотая жила")).toBeVisible();
  await dialog.getByRole("button", { name: "Закрыть" }).click();
  await expect(page.getByRole("img", { name: "Камера 1 · закрыта" })).toBeVisible();
  await page.getByRole("button", { name: "Моя разведка" }).click();
  await expect(dialog.getByText("Золотая жила")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  await dialog.getByRole("button", { name: "Закрыть" }).click();
  channel!.send(JSON.stringify({
    type: "SNAPSHOT", ...initial, sequence: 6,
    match: { ...match, phase: "ROUND_SUMMARY", revision: 6, turnSeatId: null, turnNumber: 67, deckCount: 0, moves: [],
      board: [{ ...match.board[0], assetId: "goal-gold", revealed: true, reachable: false }],
      seats: [{ seatId: member.seatId, handCount: 0, brokenTools: [], role: "prospector" }],
      outcome: { winner: "none", reason: "exhaustion", connectedOre: 0, finisherSeatId: member.seatId },
      self: { ...match.self, hand: [] },
    },
  }));
  const result = page.getByRole("dialog", { name: "Итоги раунда 1" });
  await expect(result.getByText("Раунд без победителя")).toBeVisible();
  await expect(result.getByText("Ваше начисление +0")).toBeVisible();
  channel!.send(JSON.stringify({
    type: "SNAPSHOT", ...initial, sequence: 7,
    match: { ...match, phase: "MATCH_FINISHED", revision: 7, roundNo: 3, turnSeatId: null, turnNumber: 67, deckCount: 0, moves: [],
      finalScores: [{ seatId: member.seatId, score: 0 }], winnerSeatIds: [], self: { ...match.self, hand: [] },
    },
  }));
  const final = page.getByRole("dialog", { name: "Итоги экспедиции" });
  await expect(final.getByText("В матче нет победителя")).toBeVisible();
});
