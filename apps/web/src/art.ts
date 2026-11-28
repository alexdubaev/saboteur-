import { board, cards, other } from "virtual:game-art";

export const cardArt = (id: string, size: "standard" | "compact" = "compact") => cards[id]?.[size];
export const boardArt = (id: string, size: "standard" | "compact") => board[id]?.[size] ?? cardArt(id, size);
export const iconArt = (name: string) => other["assets/ui/icons/" + name + ".webp"];
export const logoArt = other["assets/branding/logo-ru.webp"];
export const shaftArt = other["assets/board/deep-shaft.webp"];
export const compactShaftArt = other["assets/board/deep-shaft-compact.webp"];
export const mineRock = other["assets/board/mine-rock.webp"];
export const crewPortraits = other["assets/branding/crew-portraits.webp"];
