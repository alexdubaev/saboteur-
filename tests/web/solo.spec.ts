import { devices, expect, test } from "@playwright/test";

const sitesUrl = process.env.SITES_PREVIEW_URL;
const screens = [
  { label: "portrait", width: 390, height: 664 },
  { label: "landscape", width: 750, height: 302 },
];

test.describe("тестовая игра с ботами", () => {
  test.skip(!sitesUrl, "SITES_PREVIEW_URL нужен для отдельной статической сборки");

  for (const { label, width, height } of screens) {
    test(`сенсорная партия на экране ${width}×${height}`, async ({ browser }, testInfo) => {
      const context = await browser.newContext({ ...devices["iPhone 13"], viewport: { width, height } });
      await context.addInitScript(() => {
        let seed = 41;
        const randomValues = crypto.getRandomValues.bind(crypto);
        crypto.getRandomValues = (values) => {
          if (!(values instanceof Uint32Array) || values.length !== 1) return randomValues(values);
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
          values[0] = seed;
          return values;
        };
      });
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
        const details = page.getByRole("button", { name: "Партия", exact: true });
        await details.tap();
        const info = page.getByRole("dialog", { name: "Партия" });
        await expect(info.getByText("Бот 2", { exact: true })).toBeVisible();
        await expect(info.getByText("Бот 3", { exact: true })).toBeVisible();
        await info.getByRole("button", { name: "Закрыть" }).tap();
        const board = page.getByRole("region", { name: "Карта шахты" });
        await expect(board).toBeInViewport({ ratio: 0.99 });
        const entrance = board.getByRole("img", { name: "Вход в шахту" });
        expect((await entrance.boundingBox())?.width).toBeGreaterThanOrEqual(48);
        await board.getByRole("button", { name: "Вся шахта" }).tap();
        const chambers = board.getByRole("img", { name: /^Камера [123]/ });
        await expect(chambers).toHaveCount(3);
        for (const chamber of await chambers.all()) await expect(chamber).toBeInViewport();
        await board.getByRole("button", { name: "К ходу" }).tap();
        const hand = page.getByRole("region", { name: "Ваша рука" });
        const cards = hand.locator(".hand-card");
        const chat = page.getByRole("region", { name: "Чат", exact: true });
        const journal = page.getByRole("region", { name: "Журнал", exact: true });
        const input = chat.getByRole("textbox", { name: "Сообщение" });
        const tableFits = async () => {
          await expect(board).toBeInViewport({ ratio: 0.98 });
          await expect(hand).toBeInViewport({ ratio: 0.98 });
          await expect(chat).toBeInViewport({ ratio: 0.98 });
          await expect(journal).toBeInViewport({ ratio: 0.98 });
          await expect(input).toBeInViewport({ ratio: 0.98 });
          expect(await page.evaluate(() => window.scrollY)).toBeLessThanOrEqual(1);
        };
        await tableFits();
        await expect(cards).toHaveCount(6);
        for (const card of await cards.all()) await expect(card).toBeInViewport({ ratio: 0.98 });
        expect((await cards.first().boundingBox())?.width).toBeGreaterThanOrEqual(44);
        await input.fill("Проверяю путь к золоту");
        await chat.getByRole("button", { name: "Отправить сообщение" }).tap();
        const sent = chat.getByText("Проверяю путь к золоту");
        await expect(sent).toBeInViewport({ ratio: 0.98 });
        const target = board.getByRole("button", { name: /^Клетка / }).filter({ visible: true }).first();
        for (let i = 0; i < 6; i++) {
          await cards.nth(i).tap();
          if (await target.count()) break;
          const rotate = page.getByRole("button", { name: "Повернуть на 180°" });
          if (await rotate.isEnabled()) {
            await rotate.tap();
            if (await target.count()) break;
          }
        }
        await expect(target).toBeInViewport({ ratio: 0.98 });
        const targetSize = await target.boundingBox();
        expect(targetSize?.width).toBeGreaterThanOrEqual(48);
        expect(targetSize?.height).toBeGreaterThanOrEqual(70);
        const placed = (await target.getAttribute("aria-label"))?.replace("Клетка", "Туннель");
        expect(placed).toBeTruthy();
        await target.tap();
        const match = page.getByTestId("room-state");
        const revision = await match.getAttribute("data-revision");
        const confirm = page.getByRole("button", { name: "Подтвердить ход" });
        await expect(confirm).toBeInViewport({ ratio: 0.98 });
        await expect(page.getByRole("button", { name: "Повернуть на 180°" })).toBeInViewport({ ratio: 0.98 });
        await tableFits();
        await page.screenshot({ path: testInfo.outputPath(`${label}-placement.png`), scale: "css" });
        await confirm.tap();
        await expect(match).not.toHaveAttribute("data-revision", revision!);
        await expect(board.getByRole("img", { name: `${placed} · Автор: Старатель` })).toBeAttached();
        await expect(page.getByRole("heading", { name: "Ваш ход", exact: true })).toBeVisible();
        await expect(journal.getByText("Старатель проложил туннель")).toBeAttached();
        await expect(sent).toBeInViewport({ ratio: 0.98 });
        if (label === "portrait") {
          const matchId = await match.getAttribute("data-match");
          const playingRevision = await match.getAttribute("data-revision");
          await page.setViewportSize({ width: screens[1].width, height: screens[1].height });
          expect(await page.evaluate(() => matchMedia("(orientation: landscape)").matches)).toBe(true);
          await expect(match).toHaveAttribute("data-match", matchId!);
          await expect(match).toHaveAttribute("data-revision", playingRevision!);
          await tableFits();
          await expect(sent).toBeInViewport({ ratio: 0.98 });
          await expect(cards.last()).toBeInViewport({ ratio: 0.98 });
          expect(await viewportFits()).toBe(true);
          await page.setViewportSize({ width, height });
          await expect(match).toHaveAttribute("data-match", matchId!);
        }
        await page.screenshot({ path: testInfo.outputPath(`${label}.png`), scale: "css" });
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
