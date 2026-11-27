export type Port = "N" | "E" | "S" | "W";
export type Rotation = 0 | 180;
export type Tool = "pickaxe" | "lantern" | "cart";
export type Role = "prospector" | "traitor";
export type GoalContent = "ore" | "barren";
export type Rng = () => number;
export type Connections = readonly (readonly Port[])[];
export type Position = { x: number; y: number };

type CardArt = { id: string; labelRu: string; asset: string; compactAsset: string };
export type TunnelCard = CardArt & {
  kind: "tunnel";
  connections: Connections;
  allowedRotations: readonly Rotation[];
};
export type ActionCard = CardArt & { kind: "action" } & (
  | { effect: "break"; targetKind: "otherSeat"; tools: readonly Tool[] }
  | { effect: "repair"; targetKind: "seat"; tools: readonly Tool[] }
  | { effect: "collapse"; targetKind: "ordinaryTunnel"; tools: readonly [] }
  | { effect: "scout"; targetKind: "hiddenGoal"; tools: readonly [] }
);
export type CardType = TunnelCard | ActionCard;
export type Catalog = {
  readonly schemaVersion: 2;
  readonly kind: "geometry-and-effect-catalog";
  readonly note?: string;
  readonly cards: readonly Readonly<CardType>[];
};

export type Ruleset = {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly status: string;
  readonly ownerApprovedForRelease: boolean;
  readonly description: string;
  readonly catalog: string;
  readonly players: Readonly<{ min: number; max: number }>;
  readonly rounds: number;
  readonly handSizeByPlayers: Readonly<Record<string, number>>;
  readonly traitorCountByPlayers: Readonly<Record<string, number>>;
  readonly traitorlessChancePercentByPlayers?: Readonly<Record<string, number>>;
  readonly deck: Readonly<{
    tunnelCopies: number;
    actionCopies: number;
    total: number;
    copies: Readonly<Record<string, number>>;
  }>;
  readonly board: Readonly<{
    coordinateLimit: number;
    origin: Readonly<Position & { assetId: string; connections: Connections }>;
    goalSlots: readonly Readonly<Position & { id: string }>[];
    goalContents: readonly GoalContent[];
    publicGoalPorts: readonly Port[];
    goalTerminal: true;
    goalAssets: Readonly<{ hidden: string; ore: string; barrenOptions: readonly string[] }>;
  }>;
  readonly turn: Readonly<{
    actionsPerTurn: 1;
    drawAfterNonterminalMove: 1;
    refillDiscard: false;
    maxTurnsFormula: Readonly<{ perPlayer: number; constant: number }> | null;
    skipEmptyHand: true;
    timeoutDefaultSeconds: number | null;
    timeoutPolicy: "discard-first-by-instance-order";
  }>;
  readonly tools: Readonly<{
    types: readonly Tool[];
    anyBreakBlocksTunnel: boolean;
    allowSelfBreak: boolean;
    allowDuplicateBreak: false;
    repairOneAtATime: true;
  }>;
  readonly victory: Readonly<{
    prospectors: Readonly<{ type: "simultaneously-reachable-ore"; required: number }>;
    traitors: Readonly<{ type: "turn-budget-or-exhaustion-without-goal" }>;
  }>;
  readonly rewards: Readonly<{
    mode: "numeric-ledger";
    prospectorWinEach: number;
    prospectorFinisherBonus: number;
    traitorWinFormula: Readonly<{ base: number; missingConnectedOreMultiplier: number }>;
    privateUntilMatchEnd: true;
    illustrations: Readonly<Record<string, string>>;
  }>;
  readonly startingSeat: Readonly<{
    firstRound: "random";
    nextRound: "advance-previous-round-starter";
  }>;
  readonly publication: Readonly<{
    internalOnly: boolean;
    requiresOwnerApprovedRuleset: boolean;
    requiresRightsReview: boolean;
  }>;
};

export type Definition = Readonly<{ catalog: Catalog; ruleset: Ruleset; digest: string }>;
export type MatchDefinition = Definition;
export type MatchOptions = { matchId: string; seatIds: readonly string[] };

export type MatchPhase =
  | "LOBBY" | "ROUND_SETUP" | "ROLE_REVEAL" | "TURN"
  | "ROUND_RESOLVED" | "REWARD_SETTLEMENT" | "ROUND_SUMMARY"
  | "MATCH_FINISHED" | "ABANDONED";

export type CardCommand =
  | ({ type: "PLAY_TUNNEL"; instanceId: string; rotation: Rotation } & Position)
  | { type: "PLAY_BREAK"; instanceId: string; targetSeatId: string }
  | { type: "PLAY_REPAIR"; instanceId: string; targetSeatId: string; tool: Tool }
  | ({ type: "PLAY_COLLAPSE"; instanceId: string } & Position)
  | { type: "PLAY_SCOUT"; instanceId: string; goalSlotId: string }
  | { type: "DISCARD"; instanceId: string };
export type Command = CardCommand | { type: "ACK_ROLE" | "EXPIRE_ROLE_REVEAL" | "ACK_SUMMARY" | "ABANDON" };
export type GameCommand = Command;

export type CardInstance = { instanceId: string; typeId: string };
export type ScoutResult = { goalSlotId: string; assetId: string; content: GoalContent };
export type Goal = ScoutResult & Position & { revealed: boolean; reachable: boolean };
export type SeatState = {
  seatId: string;
  role: Role | null;
  hand: CardInstance[];
  brokenTools: Partial<Record<Tool, CardInstance>>;
  scoutResults: ScoutResult[];
  score: number;
  roundScore: number;
  roleAcknowledged: boolean;
};

export type TunnelTile = CardInstance & Position & { rotation: Rotation };
export type BoardTile = Position & {
  instanceId: string;
  connections: Connections;
  kind: "origin" | "tunnel" | "goal";
  terminal?: boolean;
};
export type Graph = {
  nodes: ReadonlyMap<string, ReadonlySet<string>>;
  originComponents: readonly string[];
};

export type Outcome = {
  winner: "prospectors" | "traitors" | "none";
  reason: "ore" | "turn-limit" | "exhaustion";
  connectedOre: number;
  finisherSeatId: string | null;
};
export type RewardEntry = { roundNo: number; seatId: string; points: number };
export type SeatScore = { seatId: string; score: number };

export type MatchState = {
  schemaVersion: 1;
  matchId: string;
  revision: number;
  phase: MatchPhase;
  roundNo: number;
  readonly definition: Definition;
  seats: SeatState[];
  board: TunnelTile[];
  goals: Goal[];
  deck: CardInstance[];
  discard: CardInstance[];
  roundStarterSeatId: string | null;
  turnSeatId: string | null;
  turnNumber: number;
  maxTurns: number | null;
  outcome: Outcome | null;
  rewards: RewardEntry[];
  summaryAcknowledged: string[];
};

export type CommandErrorCode =
  | "NOT_MEMBER" | "NOT_YOUR_TURN" | "WRONG_PHASE" | "CARD_NOT_IN_HAND"
  | "ILLEGAL_PLACEMENT" | "INVALID_TARGET" | "TOOL_BROKEN" | "INVALID_COMMAND"
  | "ALREADY_ACKNOWLEDGED";

export type MatchEvent = {
  type: Command["type"] | "ROUND_SETUP" | "ROLE_REVEAL" | "TURN_STARTED" |
    "GOAL_REVEALED" | "ROUND_RESOLVED" | "REWARD_SETTLEMENT" | "ROUND_SUMMARY" |
    "MATCH_FINISHED";
  actorSeatId: string | null;
  data?: Readonly<Record<string, string | number | boolean | null>>;
};
export type CommitResult =
  | { ok: true; state: MatchState; events: MatchEvent[] }
  | { ok: false; code: CommandErrorCode };

export type PublicBoardTile = Position & {
  placedBySeatId?: string;
  rotation: Rotation;
  assetId: string;
  kind: "origin" | "tunnel" | "goal";
  goalSlotId?: string;
  revealed?: boolean;
  reachable?: boolean;
};
export type PublicView = {
  matchId: string;
  revision: number;
  phase: MatchPhase;
  roundNo: number;
  rounds: number;
  turnSeatId: string | null;
  turnNumber: number;
  maxTurns: number | null;
  requiredOre: number;
  deckCount: number;
  seats: { seatId: string; handCount: number; brokenTools: Tool[]; role?: Role }[];
  board: PublicBoardTile[];
  outcome: Outcome | null;
  finalScores?: SeatScore[];
  winnerSeatIds?: string[];
  summaryAcknowledged: string[];
};
export type PlayerView = PublicView & {
  self: {
    seatId: string;
    role: Role | null;
    hand: (CardInstance & { assetId: string })[];
    scoutResults: ScoutResult[];
    score: number;
    roundScore: number;
    roleAcknowledged: boolean;
  };
  moves: Command[];
};
