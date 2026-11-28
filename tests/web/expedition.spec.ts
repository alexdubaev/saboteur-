import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";

test("меню использует утверждённый растровый логотип и открывает правила", async ({ page }) => {
  await page.goto("/");
  const logo = page.getByRole("img", { name: "Золото и предатели" });
  await expect(logo).toBeVisible({ timeout: 1500 });
  await expect(logo).toHaveJSProperty("complete", true);
  expect(await logo.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Правила" }).click();
  const rules = page.getByRole("dialog", { name: "Правила экспедиции" });
  await expect(rules.getByText("Путь к золоту · v1")).toBeVisible();
  await expect(rules.getByText(/в 20% раундов все становятся старателями/)).toBeVisible();
});

test("изолированные гости играют три раунда и возвращаются после потери связи", async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const contexts = await Promise.all([
    browser.newContext({ viewport: { width: 1920, height: 1080 } }),
    browser.newContext({ viewport: { width: 360, height: 800 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }),
    browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 }),
  ]);
  let portraitSocket: WebSocketRoute | undefined;
  await contexts[1].routeWebSocket("**/ws", (socket) => {
    portraitSocket = socket;
    socket.connectToServer();
  });
  const guests: Page[] = [];
  for (const context of contexts) guests.push(await context.newPage());
  const names = ["Аврора", "Геолог", "Кварц"];
  const [host, portrait, landscape] = guests;
  try {
    await host.goto("/");
    await host.getByLabel("Имя в экспедиции").fill(names[0]);
    await host.getByRole("button", { name: "Создать комнату" }).click();
    await expect(host.getByRole("heading", { name: "Комната экспедиции" })).toBeVisible({ timeout: 4000 });
    await host.getByRole("button", { name: "Добавить бота" }).click();
    const bot = host.getByRole("button", { name: /^Убрать бота / });
    await expect(bot).toBeVisible();
    await bot.click();
    await expect(bot).toBeHidden();
    const timer = host.getByLabel("Секунд на ход");
    await timer.fill("90");
    await host.getByRole("button", { name: "Сохранить" }).click();
    await expect(host.getByText("90 с на ход")).toBeVisible();
    await timer.clear();
    await host.getByRole("button", { name: "Сохранить" }).click();
    await expect(host.getByText("Ходы без ограничения времени")).toBeVisible();
    const invitation = (await host.getByTestId("invite-code").textContent())?.trim();
    expect(invitation).toMatch(/^[23456789A-HJ-KM-NP-Z]{8}$/);
    for (const [offset, guest] of [portrait, landscape].entries()) {
      await guest.goto("/?join=" + invitation);
      await guest.getByLabel("Имя в экспедиции").fill(names[offset + 1]);
      await expect(guest.getByLabel("Код приглашения", { exact: true })).toHaveValue(invitation!);
      await guest.getByRole("button", { name: "Войти по коду" }).click();
      await expect(guest.getByRole("heading", { name: "Комната экспедиции" })).toBeVisible();
    }
    for (const guest of guests) {
      await guest.getByRole("button", { name: "Я готов" }).click();
      await expect(guest.getByRole("button", { name: "Отменить готовность" })).toBeVisible();
    }
    await portrait.getByRole("textbox", { name: "Сообщение" }).fill("Всем удачи в шахте!");
    await portrait.getByRole("button", { name: "Отправить сообщение" }).click();
    await expect(host.getByText("Всем удачи в шахте!")).toBeVisible();
    await host.getByRole("button", { name: "Начать матч" }).click();

    const state = (page: Page) => page.getByTestId("room-state");
    const roomId = await state(host).getAttribute("data-room");
    const initialMatch = await state(host).getAttribute("data-match");
    const identities = new Set<string>();
    const instances = new Set<string>();
    for (const page of guests) {
      await expect(state(page)).toHaveAttribute("data-room", roomId!);
      await expect(state(page)).toHaveAttribute("data-match", initialMatch!);
      await expect(page.getByRole("dialog", { name: "Моя роль" }).locator(".role-art")).toHaveCount(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
      const privateView = await page.evaluate(async (id) => {
        const response = await fetch("/api/rooms/" + id);
        return (await response.json()).match;
      }, roomId);
      expect(privateView.seats.every((seat: object) => !Object.hasOwn(seat, "role") && !Object.hasOwn(seat, "hand"))).toBe(true);
      expect(identities.has(privateView.self.seatId)).toBe(false);
      identities.add(privateView.self.seatId);
      expect(privateView.self.hand).toHaveLength(6);
      expect(privateView.requiredOre).toBe(1);
      expect(privateView.maxTurns).toBeNull();
      expect(privateView.board.filter((tile: { kind: string }) => tile.kind === "goal").map((tile: { x: number }) => tile.x)).toEqual([8, 8, 8]);
      for (const card of privateView.self.hand) {
        expect(instances.has(card.instanceId)).toBe(false);
        instances.add(card.instanceId);
      }
    }

    async function synchronize() {
      await expect.poll(async () => {
        const revisions = await Promise.all(guests.map((page) => state(page).getAttribute("data-revision")));
        return revisions.every((revision) => revision && revision === revisions[0]);
      }).toBe(true);
    }

    async function acknowledge(label: string) {
      for (const guest of guests) {
        await synchronize();
        const before = await state(guest).getAttribute("data-revision");
        await guest.getByRole("button", { name: label, exact: true }).click();
        await expect(state(guest)).not.toHaveAttribute("data-revision", before!);
      }
    }

    let placed = false;
    for (let round = 1; round <= 3; round++) {
      await acknowledge("Роль понятна");
      if (round === 1) {
        await expect(portrait.getByRole("region", { name: "Карта шахты" })).toBeVisible();
        await expect(portrait.getByRole("img", { name: "Вход в шахту" })).toHaveJSProperty("complete", true);
        const startImage = portrait.getByRole("img", { name: "Вход в шахту" });
        const width = (await startImage.boundingBox())!.width;
        await portrait.getByRole("button", { name: "Приблизить" }).tap();
        expect((await startImage.boundingBox())!.width).toBeGreaterThan(width);
        await portrait.getByRole("button", { name: "Вся шахта" }).tap();
        for (const phone of [portrait, landscape]) {
          await expect(phone.getByRole("heading", { name: "Чат", exact: true })).toBeVisible();
          await expect(phone.getByRole("heading", { name: "Журнал", exact: true })).toBeVisible();
        }
        const desktopStart = host.getByRole("img", { name: "Вход в шахту" });
        const beforeKeyboard = (await desktopStart.boundingBox())!.width;
        const viewport = host.getByRole("region", { name: /^Поле шахты/ });
        await viewport.press("=");
        expect((await desktopStart.boundingBox())!.width).toBeGreaterThan(beforeKeyboard);
        await viewport.press("0");
        const interrupted = portraitSocket;
        expect(interrupted).toBeDefined();
        await interrupted!.close({ code: 1012, reason: "Test transport interruption" });
        await expect(portrait.getByText("Связь потеряна. Переподключаемся…")).toBeVisible({ timeout: 15_000 });
        await expect.poll(() => portraitSocket).not.toBe(interrupted);
        await expect(portrait.getByText("Связь потеряна. Переподключаемся…")).toBeHidden({ timeout: 20_000 });
        await synchronize();
      }
      for (let step = 0; step < 67; step++) {
        if (await host.getByRole("dialog", { name: `Итоги раунда ${round}` }).isVisible()) break;
        await synchronize();
        const active = await Promise.all(guests.map((page) => page.getByRole("heading", { name: "Ваш ход", exact: true }).isVisible()));
        expect(active.filter(Boolean)).toHaveLength(1);
        const current = guests[active.indexOf(true)];
        const before = await state(current).getAttribute("data-revision");
        const hand = current.getByRole("region", { name: "Ваша рука" }).locator(".hand-card");
        let cell = current.getByRole("button", { name: /^Клетка / }).first();
        if (!placed) {
          for (const card of await hand.all()) {
            await card.click();
            if (!await cell.isVisible()) {
              const rotate = current.getByRole("button", { name: "Повернуть на 180°" });
              if (await rotate.isVisible()) await rotate.click();
            }
            if (await cell.isVisible()) break;
          }
        } else {
          await hand.first().click();
        }
        const placement = !placed && await cell.isVisible();
        if (placement) {
          const label = (await cell.getAttribute("aria-label"))!;
          cell = current.getByRole("button", { name: label, exact: true });
          await cell.click();
          await expect(cell).toHaveAttribute("aria-pressed", "true");
          await expect(cell.locator("img")).toBeVisible();
        } else {
          await current.getByRole("button", { name: "Сбросить в закрытую" }).click();
        }
        await expect(state(current)).toHaveAttribute("data-revision", before!);
        await current.getByRole("button", { name: "Подтвердить ход" }).click();
        await expect(state(current)).not.toHaveAttribute("data-revision", before!);
        if (placement) {
          placed = true;
          await synchronize();
          for (const [index, page] of guests.entries()) {
            const mine = page.getByRole("region", { name: "Карта шахты" });
            const author = names[active.indexOf(true)];
            const tunnel = mine.getByRole("img", { name: new RegExp(`^Туннель .* · Автор: ${author}$`) });
            await expect(tunnel).toBeVisible();
            const frameColor = await tunnel.evaluate((image) => getComputedStyle(image.parentElement!, "::before").borderTopColor);
            const visibleAuthor = index > 0 && index === active.indexOf(true) ? "Вы" : author;
            const nameColor = await page.getByRole("region", { name: "Участники" }).getByText(visibleAuthor, { exact: true })
              .locator(".seat-color").evaluate((dot) => getComputedStyle(dot).backgroundColor);
            expect(frameColor).toBe(nameColor);
            const lastGoal = (await mine.getByRole("img", { name: /^Камера 3 / }).boundingBox())!;
            const toolbar = (await mine.getByLabel("Управление картой").boundingBox())!;
            const coversGoal = toolbar.x < lastGoal.x + lastGoal.width &&
              toolbar.x + toolbar.width > lastGoal.x && toolbar.y < lastGoal.y + lastGoal.height;
            expect(coversGoal).toBe(false);
            await mine.screenshot({ path: testInfo.outputPath(`шахта-${index + 1}x.png`) });
          }
        }
      }
      for (const guest of guests) await expect(guest.getByRole("dialog", { name: `Итоги раунда ${round}` })).toBeVisible();
      await acknowledge("Продолжить");
    }
    expect(placed).toBe(true);
    await expect(host.getByRole("dialog", { name: "Итоги экспедиции" })).toBeVisible();
    await host.getByRole("button", { name: "Играть снова" }).click();
    await expect(state(host)).not.toHaveAttribute("data-match", initialMatch!);
    await expect(host.getByRole("dialog", { name: "Моя роль" })).toBeVisible();
  } finally {
    await Promise.allSettled(contexts.map((context) => context.close()));
  }
});
