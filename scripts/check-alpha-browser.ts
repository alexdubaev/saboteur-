import { chromium, expect } from "@playwright/test";

const origin = "http://127.0.0.1:4173";
const viewport = { width: 1440, height: 900 };
const ready = /^(Я готов|Отменить готовность)$/;
const samples: number[] = [];
const matchMode = process.argv[2] === "moves";

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
try {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  page.setDefaultTimeout(8_000);
  const network = await context.newCDPSession(page);
  await network.send("Network.enable");
  await network.send("Network.setCacheDisabled", { cacheDisabled: true });
  await network.send("Network.emulateNetworkConditions", {
    offline: false, latency: 100, downloadThroughput: 1_250_000, uploadThroughput: 1_250_000,
  });
  const started = performance.now();
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  if (!await page.locator('script[type="module"][src^="/assets/"]').count()) throw new Error("Serve the production build");
  const rules = page.getByRole("button", { name: "Правила", exact: true });
  await rules.click();
  const dialog = page.getByRole("dialog", { name: "Правила" });
  await expect(dialog).toBeVisible();
  const interactiveMs = Math.round(performance.now() - started);
  await page.waitForLoadState("networkidle");
  const transferBytes = await page.evaluate(() => {
    const files = [...performance.getEntriesByType("navigation"), ...performance.getEntriesByType("resource")] as PerformanceResourceTiming[];
    return files.reduce((total, file) => total + file.transferSize, 0);
  });
  await dialog.getByRole("button", { name: "Закрыть" }).click();
  await page.getByLabel("Имя в экспедиции").fill("Замер альфы");
  await page.getByRole("button", { name: "Создать комнату" }).click();
  const toggle = page.getByRole("button", { name: ready });
  await expect(toggle).toBeEnabled();
  const probeMs = Math.round(await page.evaluate(async () => {
    const started = performance.now();
    const response = await fetch("/api/session");
    if (!response.ok) throw new Error("Session probe failed");
    await response.json();
    return performance.now() - started;
  }));
  if (probeMs < 90) throw new Error(`The 100 ms HTTP delay was not applied (probe ${probeMs} ms)`);
  if (matchMode) {
    const addBot = page.getByRole("button", { name: "Добавить бота" });
    await addBot.click();
    await expect(page.getByRole("button", { name: /^Убрать бота/ })).toHaveCount(1);
    await addBot.click();
    await expect(page.getByRole("button", { name: /^Убрать бота/ })).toHaveCount(2);
    await toggle.click();
    await page.getByRole("button", { name: "Начать матч" }).click();
    const role = page.getByRole("button", { name: "Роль понятна", exact: true });
    const endRound = page.getByRole("button", { name: "Продолжить", exact: true });
    const nextMatch = page.getByRole("button", { name: "Играть снова", exact: true });
    const myTurn = page.getByRole("heading", { name: "Ваш ход", exact: true });
    const state = page.locator("[data-revision]");
    for (let step = 0; step < 80 && samples.length < 20; step++) {
      await expect(role.or(endRound).or(nextMatch).or(myTurn).first()).toBeVisible();
      if (await role.isVisible()) {
        await role.click();
        await expect(role).toBeHidden();
      } else if (await endRound.isVisible()) {
        await endRound.click();
        await expect(endRound).toBeHidden();
      } else if (await nextMatch.isVisible()) {
        await nextMatch.click();
        await expect(nextMatch).toBeHidden();
      } else {
        const before = Number(await state.getAttribute("data-revision"));
        await page.locator(".hand-card").first().click();
        await page.getByRole("button", { name: "Сбросить в закрытую" }).click();
        const start = performance.now();
        const response = page.waitForResponse((candidate) => candidate.url().endsWith("/commands") && candidate.request().method() === "POST");
        await page.getByRole("button", { name: "Подтвердить ход" }).click();
        const ack = await (await response).json() as { ok: boolean; revision?: number };
        if (!ack.ok || ack.revision !== before + 1) throw new Error("Unexpected revision in gameplay ACK");
        await expect(state).not.toHaveAttribute("data-revision", String(before));
        samples.push(performance.now() - start);
      }
    }
    if (samples.length !== 20) throw new Error("Expected 20 confirmed gameplay commands");
  } else {
    for (let index = 0; index < 20; index++) {
      const expected = (index % 2 === 0).toString();
      await expect(toggle).toBeEnabled();
      const start = performance.now();
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-pressed", expected);
      await expect(toggle).toBeEnabled();
      samples.push(performance.now() - start);
    }
    await page.getByRole("button", { name: "Покинуть комнату" }).click();
    await expect(page.getByRole("button", { name: "Создать комнату" })).toBeVisible();
  }
  const sorted = samples.toSorted((a, b) => a - b);
  const uiAckP95Ms = Math.round(sorted[Math.ceil(sorted.length * 0.95) - 1]);
  console.log(JSON.stringify({ chromium: browser.version(), mode: matchMode ? "discards" : "lobby", viewport, transferBytes, interactiveMs, probeMs, uiAckP95Ms, samples: samples.length }));
  if (transferBytes <= 0 || transferBytes > 1_500_000 || interactiveMs > 3_000 || uiAckP95Ms > 500) {
    throw new Error("Initial bytes, interactivity or UI ACK p95 missed the alpha target");
  }
} finally {
  await browser.close();
}
