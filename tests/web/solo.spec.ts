import { devices, expect, test } from "@playwright/test";

const sitesUrl = process.env.SITES_PREVIEW_URL;
const screens = [
  { label: "portrait", width: 390, height: 664 },
  { label: "landscape", width: 750, height: 278 },
];

function seedRandom(initialSeed: number) {
  let seed = initialSeed;
  const randomValues = crypto.getRandomValues.bind(crypto);
  crypto.getRandomValues = (values) => {
    if (!(values instanceof Uint32Array) || values.length !== 1) return randomValues(values);
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    values[0] = seed;
    return values;
  };
}

test.describe("тестовая игра с ботами", () => {
  test.skip(!sitesUrl, "SITES_PREVIEW_URL нужен для отдельной статической сборки");

  for (const { label, width, height } of screens) {
    test(`сенсорная партия на экране ${width}×${height}`, async ({ browser }, testInfo) => {
      const context = await browser.newContext({ ...devices["iPhone 13"], viewport: { width, height } });
      await context.addInitScript(() => {
        Object.defineProperty(document, "fullscreenEnabled", { value: false, configurable: true });
      });
      await context.addInitScript(seedRandom, 41);
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
        const play = page.getByRole("button", { name: "Начать игру" });
        await expect(play).toBeInViewport({ ratio: 0.99 });
        await play.tap();
        const role = page.getByRole("dialog", { name: "Моя роль" });
        await expect.poll(() => role.evaluate((dialog) => dialog.scrollHeight - dialog.clientHeight)).toBeLessThanOrEqual(1);
        await expect(role.getByRole("button", { name: "Роль понятна" })).toBeInViewport({ ratio: 0.99 });
        const roleName = await role.getByRole("heading", { level: 3 }).innerText();
        await role.getByRole("button", { name: "Роль понятна" }).tap();
        await expect(page.getByRole("heading", { name: "Ваш ход", exact: true })).toBeVisible();
        const screenMode = page.getByRole("button", { name: "Во весь экран", exact: true });
        const roleButton = page.locator(".phone-role");
        const checkHeader = async (showRoleName: boolean) => {
          await expect(screenMode).toBeInViewport({ ratio: 0.98 });
          await expect(roleButton).toBeInViewport({ ratio: 0.98 });
          await expect(roleButton).toHaveAccessibleName(showRoleName ? roleName : "Роль");
          const stats = page.getByLabel("Счётчики партии");
          for (const name of ["Раунд", "Ход", "Колода", "Золото"]) {
            await expect(stats.getByText(name, { exact: true })).toBeInViewport();
          }
          const crew = page.getByRole("region", { name: "Участники" });
          for (const name of ["Вы", "Бот 2", "Бот 3"]) {
            const player = crew.getByRole("listitem").filter({ hasText: name });
            const label = player.getByText(name, { exact: true });
            await expect(label).toBeInViewport();
            expect(await label.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
            await expect(player.getByLabel(/^Карт в руке:/)).toBeInViewport();
          }
        };
        await checkHeader(true);
        await roleButton.tap();
        await expect(role.getByText(roleName, { exact: true })).toBeVisible();
        await role.getByRole("button", { name: "Закрыть" }).tap();
        await screenMode.tap();
        const help = page.getByRole("dialog", { name: "Во весь экран" });
        await expect(help.getByText(/На экран/)).toBeVisible();
        await help.getByRole("button", { name: "Закрыть" }).tap();
        const board = page.getByRole("region", { name: "Карта шахты" });
        const mapViewport = board.getByRole("region", { name: /^Поле шахты/ });
        const camera = () => mapViewport.evaluate((viewport) => {
          const world = viewport.querySelector(".board-world")!;
          const matrix = new DOMMatrixReadOnly(getComputedStyle(world).transform);
          const { width, height } = viewport.getBoundingClientRect();
          return {
            scale: matrix.a,
            x: Math.round((width / 2 - matrix.e) / matrix.a),
            y: Math.round((height / 2 - matrix.f) / matrix.a),
          };
        });
        await expect(board).toBeInViewport({ ratio: 0.99 });
        const entrance = board.getByRole("img", { name: "Вход в шахту" });
        expect((await entrance.boundingBox())?.width).toBeGreaterThanOrEqual(48);
        await board.getByRole("button", { name: "Вся шахта" }).tap();
        const chambers = board.getByRole("img", { name: /^Камера [123]/ });
        await expect(chambers).toHaveCount(3);
        for (const chamber of await chambers.all()) await expect(chamber).toBeInViewport();
        const hand = page.getByRole("region", { name: "Ваша рука" });
        const cards = hand.locator(".hand-card");
        const overview = await camera();
        await cards.first().tap();
        await expect.poll(camera).toEqual(overview);
        await page.getByRole("button", { name: "Отменить выбор" }).tap();
        await expect.poll(camera).toEqual(overview);
        await board.getByRole("button", { name: "К ходу" }).tap();
        await expect.poll(async () => (await camera()).scale).toBeGreaterThan(overview.scale);
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
        await board.getByRole("button", { name: "Отдалить" }).tap();
        await mapViewport.press("ArrowUp");
        const fixedView = await camera();
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
        await expect.poll(camera).toEqual(fixedView);
        await expect(target).toBeInViewport({ ratio: 0.98 });
        const targetSize = await target.boundingBox();
        expect(targetSize?.width).toBeGreaterThanOrEqual(42);
        expect(targetSize?.height).toBeGreaterThanOrEqual(62);
        const placed = (await target.getAttribute("aria-label"))?.replace("Клетка", "Туннель");
        expect(placed).toBeTruthy();
        await target.tap();
        await expect.poll(camera).toEqual(fixedView);
        const match = page.getByTestId("room-state");
        const revision = await match.getAttribute("data-revision");
        const confirm = page.getByRole("button", { name: "Подтвердить ход" });
        await expect(confirm).toBeInViewport({ ratio: 0.98 });
        await expect(page.getByRole("button", { name: "Повернуть на 180°" })).toBeInViewport({ ratio: 0.98 });
        await tableFits();
        await page.screenshot({ path: testInfo.outputPath(`${label}-placement.png`), scale: "css" });
        await confirm.tap();
        await expect(match).not.toHaveAttribute("data-revision", revision!);
        const tunnel = board.getByRole("img", { name: `${placed} · Автор: Старатель` });
        await expect(tunnel).toBeAttached();
        await expect(page.getByRole("heading", { name: "Ваш ход", exact: true })).toBeVisible();
        await expect.poll(camera).toEqual(fixedView);
        const damage = board.getByRole("status");
        await expect(damage.getByText("Кирка", { exact: true })).toBeInViewport();
        await expect(damage.getByText("Туннели заблокированы")).toBeInViewport();
        await expect(journal.getByText("Бот 2 сломал вам кирку")).toBeAttached();
        const ownEntry = journal.getByRole("listitem").filter({ hasText: "Старатель проложил туннель" }).first();
        const ownColor = await tunnel.locator("..").evaluate((tile) => getComputedStyle(tile).color);
        await expect(ownEntry.getByText("Старатель", { exact: true })).toHaveCSS("color", ownColor);
        const botTunnel = board.getByRole("img", { name: /^Туннель .* · Автор: Бот 3$/ }).first();
        const botEntry = journal.getByRole("listitem").filter({ hasText: "Бот 3 проложил туннель" }).first();
        const botColor = await botTunnel.locator("..").evaluate((tile) => getComputedStyle(tile).color);
        await expect(botEntry.getByText("Бот 3", { exact: true })).toHaveCSS("color", botColor);
        await expect(sent).toBeInViewport({ ratio: 0.98 });
        if (label === "portrait") {
          const matchId = await match.getAttribute("data-match");
          const playingRevision = await match.getAttribute("data-revision");
          await page.setViewportSize({ width: screens[1].width, height: screens[1].height });
          expect(await page.evaluate(() => matchMedia("(orientation: landscape)").matches)).toBe(true);
          await expect(match).toHaveAttribute("data-match", matchId!);
          await expect(match).toHaveAttribute("data-revision", playingRevision!);
          await tableFits();
          await checkHeader(true);
          await expect.poll(camera).toEqual(fixedView);
          await expect(sent).toBeInViewport({ ratio: 0.98 });
          await expect(cards.last()).toBeInViewport({ ratio: 0.98 });
          expect(await viewportFits()).toBe(true);
          await page.setViewportSize({ width: 360, height });
          await checkHeader(true);
          expect(await viewportFits()).toBe(true);
          await page.setViewportSize({ width: 320, height });
          await checkHeader(false);
          await page.setViewportSize({ width, height });
          await expect(match).toHaveAttribute("data-match", matchId!);
          await checkHeader(true);
        }
        await page.screenshot({ path: testInfo.outputPath(`${label}.png`), scale: "css" });
        expect(await viewportFits()).toBe(true);

        await page.getByRole("button", { name: "Выйти из партии" }).tap();
        await page.getByRole("dialog", { name: "Выйти из партии" }).getByRole("button", { name: "В меню" }).tap();
        await expect(page.getByRole("button", { name: "Начать игру" })).toBeVisible();
        expect(networkCalls).toEqual([]);
        expect(errors).toEqual([]);
      } finally {
        await context.close();
      }
    });
  }

  test("поломка кирки отключает строительство и снимается после ремонта", async ({ browser }) => {
    const context = await browser.newContext({ ...devices["iPhone 13"], viewport: { width: 750, height: 278 } });
    try {
      await context.addInitScript(seedRandom, 22);
      const page = await context.newPage();
      await page.goto(sitesUrl!);
      await page.getByRole("button", { name: "Начать игру" }).tap();
      await page.getByRole("button", { name: "Роль понятна" }).tap();
      const turn = page.getByRole("heading", { name: "Ваш ход", exact: true });
      await expect(turn).toBeVisible();
      const confirm = page.getByRole("button", { name: "Подтвердить ход" });
      const board = page.getByRole("region", { name: "Карта шахты" });
      const hand = page.getByRole("region", { name: "Ваша рука" });
      const journal = page.getByRole("region", { name: "Журнал", exact: true });
      const damage = board.getByRole("status");
      await expect(damage).toHaveCount(0);
      await hand.getByRole("button", { name: "Раздельные тупики N–E", exact: true }).tap();
      await board.getByRole("button", { name: "Клетка 0, 1", exact: true }).tap();
      await confirm.tap();
      await expect(turn).toBeVisible();
      await expect(damage).toContainText("Туннели заблокированы");
      await expect(damage.getByText("Кирка", { exact: true })).toBeVisible();
      const blockedCard = hand.getByRole("button", { name: "Раздельные тупики N–W", exact: true });
      await expect(blockedCard).toHaveAccessibleDescription(/Туннели заблокированы.*Кирка/u);
      await blockedCard.tap();
      await expect(board.getByRole("button", { name: /^Клетка / })).toHaveCount(0);
      await expect(hand.getByRole("button", { name: "Повернуть на 180°" })).toBeDisabled();
      await hand.getByRole("button", { name: "Сбросить в закрытую" }).tap();
      await confirm.tap();
      await expect(turn).toBeVisible();
      await expect(damage.getByText("Кирка", { exact: true })).toBeVisible();
      await hand.getByRole("button", { name: "Ремонт кирки", exact: true }).tap();
      await hand.getByRole("combobox", { name: "Цель карты" }).selectOption({ label: "Старатель · Кирка" });
      await confirm.tap();
      await expect(turn).toBeVisible();
      await expect(damage).toHaveCount(0);
      await expect(journal.getByText("Старатель починил себе кирку")).toBeAttached();
      await hand.getByRole("button", { name: "Четыре раздельных тупика", exact: true }).tap();
      await expect(board.getByRole("button", { name: "Клетка 0, -1", exact: true })).toBeAttached();
      await hand.getByRole("button", { name: "Сломанная кирка", exact: true }).tap();
      await hand.getByRole("combobox", { name: "Цель карты" }).selectOption({ label: "Бот 3" });
      await confirm.tap();
      await expect(journal.getByText("Старатель сломал кирку игроку «Бот 3»")).toBeAttached();
    } finally {
      await context.close();
    }
  });

  test("девять ботов играют за одним столом", async ({ browser }) => {
    const context = await browser.newContext({ ...devices["iPhone 13"], viewport: screens[0] });
    try {
      await context.addInitScript(seedRandom, 41);
      const page = await context.newPage();
      await page.goto(sitesUrl!);
      const count = page.getByRole("combobox", { name: "Число ботов" });
      await expect(count).toHaveValue("2");
      await count.selectOption("9");
      await page.getByRole("button", { name: "Начать игру" }).tap();
      await page.getByRole("button", { name: "Роль понятна" }).tap();
      const turn = page.getByRole("heading", { name: "Ваш ход", exact: true });
      await expect(turn).toBeVisible();
      const crew = page.getByRole("region", { name: "Участники" });
      await expect(crew.getByRole("listitem")).toHaveCount(10);
      await crew.getByText("Бот 10", { exact: true }).scrollIntoViewIfNeeded();
      await expect(crew.getByText("Бот 10", { exact: true })).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

      const hand = page.getByRole("region", { name: "Ваша рука" });
      await expect(hand.locator(".hand-card")).toHaveCount(4);
      await hand.locator(".hand-card").first().tap();
      await hand.getByRole("button", { name: "Сбросить в закрытую" }).tap();
      await hand.getByRole("button", { name: "Подтвердить ход" }).tap();
      const journal = page.getByRole("region", { name: "Журнал", exact: true });
      await expect(journal.getByText("Бот 10", { exact: true }).first()).toBeAttached({ timeout: 8000 });
      await expect(turn).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("звук запускается после касания и отключается на весь следующий ход", async ({ browser, browserName }) => {
    test.skip(browserName !== "chromium", "Эта проверка использует Web Audio в Chromium");
    const context = await browser.newContext({ ...devices["iPhone 13"], viewport: screens[0] });
    try {
      await context.addInitScript(seedRandom, 41);
      await context.addInitScript(() => {
        const start = OscillatorNode.prototype.start;
        OscillatorNode.prototype.start = function (when?: number) {
          start.call(this, when);
          const root = document.documentElement;
          root.dataset.tones = String(Number(root.dataset.tones ?? 0) + 1);
        };
      });
      const page = await context.newPage();
      await page.goto(sitesUrl!);
      const tones = () => page.evaluate(() => Number(document.documentElement.dataset.tones ?? 0));
      expect(await tones()).toBe(0);
      await page.getByRole("button", { name: "Начать игру" }).tap();
      await expect.poll(tones).toBeGreaterThan(0);
      await page.getByRole("button", { name: "Роль понятна" }).tap();
      const turn = page.getByRole("heading", { name: "Ваш ход", exact: true });
      await expect(turn).toBeVisible();
      const hand = page.getByRole("region", { name: "Ваша рука" });
      const discard = async () => {
        await hand.locator(".hand-card").first().tap();
        await hand.getByRole("button", { name: "Сбросить в закрытую" }).tap();
        await hand.getByRole("button", { name: "Подтвердить ход" }).tap();
        await expect(turn).toBeHidden();
        await expect(turn).toBeVisible();
      };
      const first = await tones();
      await discard();
      expect(await tones()).toBeGreaterThan(first);
      await page.getByRole("button", { name: "Выключить звук" }).tap();
      const muted = await tones();
      await discard();
      expect(await tones()).toBe(muted);
      await page.getByRole("button", { name: "Включить звук" }).tap();
      await expect.poll(tones).toBeGreaterThan(muted);
    } finally {
      await context.close();
    }
  });
});
