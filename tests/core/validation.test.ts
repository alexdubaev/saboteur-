import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { validateCatalog, validateRuleset } from "../../packages/game-core/src/index.js";

export const rawCatalog = JSON.parse(readFileSync(new URL("../../data/card-catalog-v2.json", import.meta.url), "utf8"));
export const rawRuleset = JSON.parse(readFileSync(new URL("../../data/rulesets/playtest-expedition-v0.json", import.meta.url), "utf8"));

test("R01: validates the independent catalog and 66-copy profile", () => {
  const catalog = validateCatalog(rawCatalog);
  const ruleset = validateRuleset(rawRuleset, catalog);
  expect(catalog.cards.filter(card => card.kind === "tunnel")).toHaveLength(16);
  expect(catalog.cards.filter(card => card.kind === "action")).toHaveLength(11);
  expect(ruleset.deck.total).toBe(66);
  expect(() => validateCatalog({
    ...rawCatalog,
    cards: [...rawCatalog.cards, rawCatalog.cards[0]],
  })).toThrow(/duplicate/i);
  expect(() => validateCatalog({
    ...rawCatalog,
    cards: rawCatalog.cards.map((card: { kind: string }) => card.kind === "action" ? { ...card, effect: "eval" } : card),
  })).toThrow();
  expect(() => validateRuleset({
    ...rawRuleset,
    victory: { ...rawRuleset.victory, traitors: { type: "unknown-policy" } },
  }, catalog)).toThrow();
  expect(() => validateRuleset({
    ...rawRuleset,
    deck: { ...rawRuleset.deck, total: 65 },
  }, catalog)).toThrow(/deck/i);
  expect(() => validateRuleset({
    ...rawRuleset,
    handSizeByPlayers: { ...rawRuleset.handSizeByPlayers, 10: 10 },
  }, catalog)).toThrow(/deal/i);
});

test("R01: rejects mismatched ports on adjacent fixed tiles before a match starts", () => {
  const catalog = validateCatalog(rawCatalog);
  expect(() => validateRuleset({
    ...rawRuleset,
    board: {
      ...rawRuleset.board,
      goalSlots: [{ id: "north", x: 0, y: -1 }, ...rawRuleset.board.goalSlots.slice(1)],
    },
  }, catalog)).toThrow(/fixed board ports/i);
});
