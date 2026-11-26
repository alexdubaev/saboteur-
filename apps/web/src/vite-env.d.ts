declare module "virtual:game-art" {
  export const cards: Record<string, { standard: string; compact: string } | undefined>;
  export const board: typeof cards;
  export const other: Record<string, string>;
}
