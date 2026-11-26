import { createHash } from "node:crypto";
import { z } from "zod";
import { beside, cellKey, directions, ports } from "./graph.js";
import type { Catalog, Definition, Ruleset } from "./types.js";

const id = z.string().min(1).regex(/^[a-z0-9][a-z0-9-]*$/);
const text = z.string().min(1);
const port = z.enum(["N", "E", "S", "W"]);
const tool = z.enum(["pickaxe", "lantern", "cart"]);
const nonnegative = z.int().nonnegative();
const positive = z.int().positive();
const rotations = z.array(z.union([z.literal(0), z.literal(180)])).min(1);
const connections = z.array(z.array(port).min(1)).min(1);
const position = { x: z.int(), y: z.int() };
const cardArt = { id, labelRu: text, asset: text, compactAsset: text };
const actionArt = { ...cardArt, kind: z.literal("action") };
const cardSchema = z.union([
  z.strictObject({ ...cardArt, kind: z.literal("tunnel"), connections, allowedRotations: rotations }),
  z.strictObject({ ...actionArt, effect: z.literal("break"), targetKind: z.literal("otherSeat"), tools: z.array(tool).length(1) }),
  z.strictObject({ ...actionArt, effect: z.literal("repair"), targetKind: z.literal("seat"), tools: z.array(tool).min(1).max(2) }),
  z.strictObject({ ...actionArt, effect: z.literal("collapse"), targetKind: z.literal("ordinaryTunnel"), tools: z.tuple([]) }),
  z.strictObject({ ...actionArt, effect: z.literal("scout"), targetKind: z.literal("hiddenGoal"), tools: z.tuple([]) }),
]);
const catalogSchema = z.strictObject({
  schemaVersion: z.literal(2),
  kind: z.literal("geometry-and-effect-catalog"),
  note: text.optional(),
  cards: z.array(cardSchema).min(1),
});
const rulesetSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id,
  status: text,
  ownerApprovedForRelease: z.boolean(),
  description: text,
  catalog: text,
  players: z.strictObject({ min: positive.min(2), max: positive.min(2) }),
  rounds: positive,
  handSizeByPlayers: z.record(z.string(), positive),
  traitorCountByPlayers: z.record(z.string(), positive),
  deck: z.strictObject({
    tunnelCopies: nonnegative,
    actionCopies: nonnegative,
    total: positive,
    copies: z.record(id, nonnegative),
  }),
  board: z.strictObject({
    coordinateLimit: positive.max(128),
    origin: z.strictObject({ ...position, assetId: id, connections }),
    goalSlots: z.array(z.strictObject({ ...position, id })).min(1),
    goalContents: z.array(z.enum(["ore", "barren"])).min(1),
    publicGoalPorts: z.array(port).min(1),
    goalTerminal: z.literal(true),
    goalAssets: z.strictObject({ hidden: id, ore: id, barrenOptions: z.array(id) }),
  }),
  turn: z.strictObject({
    actionsPerTurn: z.literal(1),
    drawAfterNonterminalMove: z.literal(1),
    refillDiscard: z.literal(false),
    maxTurnsFormula: z.strictObject({ perPlayer: nonnegative, constant: nonnegative }),
    skipEmptyHand: z.literal(true),
    timeoutDefaultSeconds: positive.nullable(),
    timeoutPolicy: z.literal("discard-first-by-instance-order"),
  }),
  tools: z.strictObject({
    types: z.array(tool).min(1),
    anyBreakBlocksTunnel: z.boolean(),
    allowSelfBreak: z.boolean(),
    allowDuplicateBreak: z.literal(false),
    repairOneAtATime: z.literal(true),
  }),
  victory: z.strictObject({
    prospectors: z.strictObject({ type: z.literal("simultaneously-reachable-ore"), required: positive }),
    traitors: z.strictObject({ type: z.literal("turn-budget-or-exhaustion-without-goal") }),
  }),
  rewards: z.strictObject({
    mode: z.literal("numeric-ledger"),
    prospectorWinEach: nonnegative,
    prospectorFinisherBonus: nonnegative,
    traitorWinFormula: z.strictObject({ base: nonnegative, missingConnectedOreMultiplier: nonnegative }),
    privateUntilMatchEnd: z.literal(true),
    illustrations: z.record(z.string().regex(/^[1-9][0-9]*$/), id),
  }),
  startingSeat: z.strictObject({
    firstRound: z.literal("random"),
    nextRound: z.literal("advance-previous-round-starter"),
  }),
  publication: z.strictObject({
    internalOnly: z.boolean(),
    requiresOwnerApprovedRuleset: z.boolean(),
    requiresRightsReview: z.boolean(),
  }),
});

function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function unique(values: readonly unknown[], description: string): void {
  ensure(new Set(values).size === values.length, "Duplicate " + description);
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

export function validateCatalog(raw: unknown): Catalog {
  const catalog = catalogSchema.parse(raw);
  unique(catalog.cards.map(card => card.id), "card ID");
  for (const card of catalog.cards) {
    if (card.kind === "tunnel") {
      unique(card.connections.flat(), "port on " + card.id);
      unique(card.allowedRotations, "rotation on " + card.id);
    } else {
      unique(card.tools, "tool on " + card.id);
    }
  }
  return freeze(catalog);
}

export function validateRuleset(raw: unknown, catalog: Catalog): Ruleset {
  const ruleset = rulesetSchema.parse(raw);
  const { board, deck, players, rewards, tools, turn, victory } = ruleset;
  const cards = new Map(catalog.cards.map(card => [card.id, card]));
  unique(tools.types, "tool type");
  let tunnels = 0;
  let actions = 0;
  for (const [typeId, copies] of Object.entries(deck.copies)) {
    const card = cards.get(typeId);
    ensure(card, "Unknown deck card: " + typeId);
    if (card.kind === "tunnel") {
      tunnels += copies;
    } else {
      actions += copies;
      ensure(copies === 0 || card.tools.every(tool => tools.types.includes(tool)), "Unknown action tool on " + typeId);
    }
  }
  ensure(tunnels === deck.tunnelCopies && actions === deck.actionCopies && tunnels + actions === deck.total,
    "Deck counts do not match declared totals");
  ensure(players.min <= players.max && players.max <= deck.total, "Invalid player limits");
  const tableSize = players.max - players.min + 1;
  ensure(Object.keys(ruleset.handSizeByPlayers).length === tableSize &&
    Object.keys(ruleset.traitorCountByPlayers).length === tableSize, "Player tables must match player limits");
  for (let n = players.min; n <= players.max; n++) {
    const hand = ruleset.handSizeByPlayers[String(n)];
    const traitors = ruleset.traitorCountByPlayers[String(n)];
    ensure(hand > 0 && hand * n <= deck.total, "Impossible deal for player count " + n);
    ensure(traitors > 0 && traitors < n, "Impossible role distribution for player count " + n);
    const maxTurns = turn.maxTurnsFormula.perPlayer * n + turn.maxTurnsFormula.constant;
    ensure(Number.isSafeInteger(maxTurns) && maxTurns > 0, "Invalid turn budget for player count " + n);
  }
  ensure(board.origin.connections.length === 1, "Origin must be a single connected component");
  unique(board.origin.connections.flat(), "origin port");
  unique(board.publicGoalPorts, "goal port");
  unique(board.goalSlots.map(slot => slot.id), "goal slot ID");
  const fixedTiles = [
    { ...board.origin, ports: board.origin.connections.flat() },
    ...board.goalSlots.map(slot => ({ ...slot, ports: board.publicGoalPorts })),
  ];
  unique(fixedTiles.map(({ x, y }) => cellKey(x, y)), "board position");
  ensure(fixedTiles.every(({ x, y }) => Math.abs(x) <= board.coordinateLimit && Math.abs(y) <= board.coordinateLimit),
    "Fixed board position outside coordinate bounds");
  const fixedCells = new Map(fixedTiles.map(tile => [cellKey(tile.x, tile.y), tile]));
  for (const tile of fixedTiles) {
    for (const port of ports) {
      const { x, y } = beside(tile, port);
      const neighbor = fixedCells.get(cellKey(x, y));
      ensure(!neighbor || tile.ports.includes(port) === neighbor.ports.includes(directions[port].opposite),
        "Adjacent fixed board ports must match");
    }
  }
  ensure(board.goalSlots.length === board.goalContents.length, "Goal slots and contents do not match");
  const oreCount = board.goalContents.filter(content => content === "ore").length;
  ensure(oreCount >= victory.prospectors.required, "Victory requires more ore than the board provides");
  ensure(board.goalContents.every(content => content !== "barren") || board.goalAssets.barrenOptions.length > 0,
    "Barren goals require a public asset");
  unique([board.goalAssets.hidden, board.goalAssets.ore, ...board.goalAssets.barrenOptions], "goal asset ID");
  const maxReward = Math.max(
    rewards.prospectorWinEach + rewards.prospectorFinisherBonus,
    rewards.traitorWinFormula.base + victory.prospectors.required * rewards.traitorWinFormula.missingConnectedOreMultiplier,
  );
  ensure(Number.isSafeInteger(maxReward * ruleset.rounds), "Invalid cumulative score range");
  return freeze(ruleset);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  const record = value as Record<string, unknown>;
  return "{" + Object.keys(record).sort().map(key => JSON.stringify(key) + ":" + canonicalJson(record[key])).join(",") + "}";
}

export function rulesetDigest(ruleset: Ruleset): string {
  return createHash("sha256").update(canonicalJson(ruleset)).digest("hex");
}

const pinnedDefinitions = new WeakSet<Definition>();

export function createDefinition(rawCatalog: unknown, rawRuleset: unknown): Definition {
  const catalog = validateCatalog(rawCatalog);
  const ruleset = validateRuleset(rawRuleset, catalog);
  const definition = Object.freeze({ catalog, ruleset, digest: rulesetDigest(ruleset) });
  pinnedDefinitions.add(definition);
  return definition;
}
export function pinDefinition(definition: Definition): Definition {
  if (pinnedDefinitions.has(definition)) return definition;
  const copy = createDefinition(definition.catalog, definition.ruleset);
  if (copy.digest !== definition.digest) throw new Error("Ruleset digest mismatch");
  return copy;
}
