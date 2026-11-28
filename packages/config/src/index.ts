import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { createDefinition } from "../../game-core/src/validation.js";
import type { Definition } from "../../game-core/src/types.js";

export { createDefinition } from "../../game-core/src/validation.js";
export type { Definition } from "../../game-core/src/types.js";

const configSchema = z.object({
  schemaVersion: z.literal(2),
  cardCatalog: z.string().regex(/^data\/[a-z0-9/-]+\.json$/),
  developmentRuleset: z.string().regex(/^data\/rulesets\/[a-z0-9-]+\.json$/),
  releaseRuleset: z.null(),
  releaseEnabled: z.literal(false),
});

async function readJson(root: string, path: string): Promise<unknown> {
  return JSON.parse(await readFile(resolve(root, path), "utf8"));
}

export async function loadActiveDefinition(root = fileURLToPath(new URL("../../../", import.meta.url))): Promise<Definition> {
  const config = configSchema.parse(await readJson(root, "data/game-config.json"));
  const [catalog, ruleset] = await Promise.all([
    readJson(root, config.cardCatalog),
    readJson(root, config.developmentRuleset),
  ]);
  const definition = createDefinition(catalog, ruleset);
  if (definition.ruleset.catalog !== config.cardCatalog || !definition.ruleset.publication.internalOnly) {
    throw new Error("Active development profile must reference the configured catalog and remain internal");
  }
  return definition;
}
