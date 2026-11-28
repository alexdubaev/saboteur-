import { expect, test } from "@playwright/test";
import type { RoomSnapshot } from "../../packages/protocol/src/index.js";

for (const outcome of ["error", "success"] as const) {
  test(`ответ чата покинутой комнаты не меняет новую комнату: ${outcome}`, async ({ page }) => {
    const member = { seatId: "host", name: "Старатель", avatarId: "miner", bot: false, present: true, ready: true };
    const snapshot = (roomId: string, code: string): RoomSnapshot => ({
      room: { roomId, code, hostSeatId: member.seatId, mySeatId: member.seatId, seats: [member], turnTimeoutSeconds: null, deadlineAt: null },
      match: null, sequence: 1, journal: [], chat: [],
    });
    const oldRoom = snapshot("old-room", "OLDROOM2");
    const newRoom = snapshot("new-room", "NEWRAAM2");
    let release!: () => void;
    let received!: () => void;
    const requested = new Promise<void>((resolve) => { received = resolve; });
    const delayed = new Promise<void>((resolve) => { release = resolve; });
    await page.routeWebSocket("**/ws", (socket) => {
      socket.onMessage((message) => {
        const request = JSON.parse(String(message));
        socket.send(JSON.stringify({ type: "SNAPSHOT", ...(request.roomId === oldRoom.room.roomId ? oldRoom : newRoom) }));
      });
    });
    await page.route("**/api/entry", (route) => route.fulfill({ json: { canCreateRooms: false } }));
    await page.route("**/api/rooms/old-room", (route) => route.fulfill({ json: oldRoom }));
    await page.route("**/api/rooms/old-room/leave", (route) => route.fulfill({ json: { ok: true } }));
    await page.route("**/api/rooms/join", (route) => route.fulfill({ json: newRoom }));
    await page.route("**/api/rooms/old-room/chat", async (route) => {
      received();
      await delayed;
      await route.fulfill(outcome === "error" ? { status: 404, json: { code: "ROOM_NOT_FOUND" } } : { json: oldRoom });
    });
    await page.goto("/?room=old-room");
    await expect(page.getByTestId("invite-code")).toHaveText("OLDROOM2");
    await page.getByRole("textbox", { name: "Сообщение" }).fill("Привет");
    await page.getByRole("button", { name: "Отправить сообщение" }).click();
    await requested;
    await page.getByRole("button", { name: "Покинуть комнату" }).click();
    await page.getByRole("textbox", { name: "Код приглашения" }).fill("NEWRAAM2");
    await page.getByRole("button", { name: "Войти по коду" }).click();
    await expect(page.getByTestId("invite-code")).toHaveText("NEWRAAM2");
    await page.getByRole("textbox", { name: "Сообщение" }).fill("Привет");
    const response = page.waitForResponse("**/api/rooms/old-room/chat");
    release();
    await response;
    await expect(page.getByTestId("invite-code")).toHaveText("NEWRAAM2");
    await expect(page.getByRole("textbox", { name: "Сообщение" })).toHaveValue("Привет");
    await expect(page.getByRole("alert")).toHaveCount(0);
  });
}
