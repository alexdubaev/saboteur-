import { board, cards, other } from "virtual:game-art";

export const cardArt = (id: string, size: "standard" | "compact" = "compact") => cards[id]?.[size];
export const boardArt = (id: string, size: "standard" | "compact") => board[id]?.[size] ?? cardArt(id, size);
export const iconArt = (name: string) => other["assets/ui/icons/" + name + ".webp"];
export const logoArt = other["assets/branding/logo-ru.webp"];
export const corridorArt = other["assets/board/mine-scene-corridor.webp"];
export const junctionArt = other["assets/board/mine-scene-junction.webp"];
