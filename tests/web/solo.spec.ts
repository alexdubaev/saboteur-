import { devices, expect, test } from "@playwright/test";

const sitesUrl = process.env.SITES_PREVIEW_URL;
const screens = [
  { label: "portrait", width: 390, height: 664 },
  { label: "landscape", width: 768, height: 340 },
];

test.describe("тестовая игра с ботами", () => {
  test.skip(!sitesUrl, "SITES_PREVIEW_URL нужен для отдельной статической сборки");

  for (const { label, width, height } of screens) {
    test(`сенсорная партия на экране ${width}×${height}`, async ({ browser }, testInfo) => {
      const context = await browser.newContext({ ...devices["iPhone 13"], viewport: { width, height } });
      const page = await context.newPage();
      const networkCalls: string[] = [];
      const errors: string[] = [];
      page.on("request", (request) => {
        const url = new URL(request.url());
        if (url.pathname.startsWith("/api/") || url.origin !== new URL(sitesUrl!).origin) networkCalls.push(request.url());
      });
      page.on("websocket", (socket) => networkCalls.push(socket.url()));
      page.on("pageerror", (error) => errors.push(error.message));
      const viewportFits = () => page.evaluate(() =>
        document.documentElement.scrollWidth <= window.innerWidth);
      try {
        await page.goto(sitesUrl!);
        await expect(page.getByRole("heading", { name: "Золото и предатели" })).toBeVisible();
        await expect(page.getByRole("button", { name: "Создать комнату" })).toHaveCount(0);
        expect(await viewportFits()).toBe(true);
        const play = page.getByRole("button", { name: "Играть с двумя ботами" });
        await expect(play).toBeInViewport({ ratio: 0.99 });
        await play.tap();
        const role = page.getByRole("dialog", { name: "Моя роль" });
        await expect(role.getByRole("button", { name: "Роль понятна" })).toBeInViewport({ ratio: 0.99 });
        await role.getByRole("button", { name: "Роль понятна" }).tap();
        await expect(page.getByRole("heading", { name: "Ваш ход", exact: true })).toBeVisible();
        const crew = page.getByRole("region", { name: "Участники" });
        for (const name of ["Старатель", "Бот 2", "Бот 3"]) {
          const player = crew.getByText(name, { exact: true });
          await expect(player).toBeInViewport();
          const { clientWidth, scrollWidth } = await player.evaluate((label) =>
            ({ clientWidth: label.clientWidth, scrollWidth: label.scrollWidth }));
          expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
        }
        const hand = page.getByRole("region", { name: "Ваша рука" });
        await expect(hand.getByRole("button")).toHaveCount(6);
        await expect(hand.getByRole("button").last()).toBeInViewport({ ratio: 0.99 });
        await expect(page.getByText("Золото 0/1")).toBeVisible();
        expect(await viewportFits()).toBe(true);

        const board = page.getByRole("region", { name: "Карта шахты" });
        await expect(board).toBeInViewport({ ratio: 0.99 });
        const chambers = board.getByRole("img", { name: /^Камера [123]/ });
        await expect(chambers).toHaveCount(3);
        for (const chamber of await chambers.all()) await expect(chamber).toBeInViewport({ ratio: 0.99 });
        const entrance = board.getByRole("img", { name: "Вход в шахту" });
        const widthBefore = (await entrance.boundingBox())?.width ?? 0;
        expect(widthBefore).toBeGreaterThan(0);
        await board.getByRole("button", { name: "Приблизить" }).tap();
        expect((await entrance.boundingBox())?.width ?? 0).toBeGreaterThan(widthBefore * 1.1);
        await board.getByRole("button", { name: "Показать всё поле" }).tap();
        await hand.getByRole("button").first().tap();
        await page.getByRole("button", { name: "Сбросить в закрытую" }).tap();
        const match = page.getByTestId("room-state");
        const revision = await match.getAttribute("data-revision");
        await page.getByRole("button", { name: "Подтвердить ход" }).tap();
        await expect(match).not.toHaveAttribute("data-revision", revision!);
        await expect(page.getByRole("heading", { name: "Ваш ход", exact: true })).toBeVisible();
        if (label === "portrait") {
          const matchId = await match.getAttribute("data-match");
          const playingRevision = await match.getAttribute("data-revision");
          await page.setViewportSize({ width: screens[1].width, height: screens[1].height });
          expect(await page.evaluate(() => matchMedia("(orientation: landscape)").matches)).toBe(true);
          await expect(match).toHaveAttribute("data-match", matchId!);
          await expect(match).toHaveAttribute("data-revision", playingRevision!);
          await expect(board).toBeInViewport({ ratio: 0.99 });
          await expect(hand.getByRole("button").last()).toBeInViewport({ ratio: 0.99 });
          expect(await viewportFits()).toBe(true);
          await page.setViewportSize({ width, height });
          await expect(match).toHaveAttribute("data-match", matchId!);
        }
        await page.screenshot({ path: testInfo.outputPath(`${label}.png`), fullPage: true });
        expect(await viewportFits()).toBe(true);

        await page.getByRole("button", { name: "Выйти из партии" }).tap();
        await page.getByRole("dialog", { name: "Выйти из партии" }).getByRole("button", { name: "В меню" }).tap();
        await expect(page.getByRole("button", { name: "Играть с двумя ботами" })).toBeVisible();
        expect(networkCalls).toEqual([]);
        expect(errors).toEqual([]);
      } finally {
        await context.close();
      }
    });
  }
});
