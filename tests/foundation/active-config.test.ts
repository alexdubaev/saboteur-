import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { z } from "zod";

const root = new URL("../../", import.meta.url);
const gameConfigSchema = z.object({
  schemaVersion: z.literal(2),
  developmentRuleset: z.string(),
  cardCatalog: z.string(),
  releaseEnabled: z.boolean(),
  releaseRuleset: z.string().nullable(),
});
const rulesetSchema = z.object({
  id: z.string(),
  catalog: z.string(),
  deck: z.object({
    tunnelCopies: z.number(),
    actionCopies: z.number(),
    total: z.number(),
    copies: z.record(z.string(), z.number().int().positive()),
  }),
});
const catalogSchema = z.object({
  schemaVersion: z.literal(2),
  cards: z.array(z.object({ id: z.string(), kind: z.enum(["tunnel", "action"]) })),
});

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(new URL(path, root), "utf8"));
}

test("the closed alpha selects the active v2 catalog and a 40 + 26 card deck", () => {
  const config = gameConfigSchema.parse(readJson("data/game-config.json"));
  expect(config).toMatchObject({
    developmentRuleset: "data/rulesets/playtest-expedition-v0.json",
    cardCatalog: "data/card-catalog-v2.json",
    releaseEnabled: false,
    releaseRuleset: null,
  });

  const profile = rulesetSchema.parse(readJson(config.developmentRuleset));
  expect(profile.id).toBe("playtest-expedition-v0");
  expect(profile.catalog).toBe(config.cardCatalog);
  expect(profile.deck).toMatchObject({ tunnelCopies: 40, actionCopies: 26, total: 66 });

  const { cards } = catalogSchema.parse(readJson(config.cardCatalog));
  const cardKinds = new Map(cards.map(({ id, kind }) => [id, kind]));
  expect(cardKinds.size).toBe(cards.length);
  expect(cards.filter(({ kind }) => kind === "tunnel")).toHaveLength(16);
  expect(cards.filter(({ kind }) => kind === "action")).toHaveLength(11);

  const counts = { tunnel: 0, action: 0 };
  for (const [id, copies] of Object.entries(profile.deck.copies)) {
    const kind = cardKinds.get(id);
    if (!kind) throw new Error(`Unknown card type in active deck: ${id}`);
    counts[kind] += copies;
  }
  expect(counts).toEqual({ tunnel: 40, action: 26 });
  expect(counts.tunnel + counts.action).toBe(66);
});
