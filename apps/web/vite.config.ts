import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const root = fileURLToPath(new URL("./", import.meta.url));
const workspace = fileURLToPath(new URL("../../", import.meta.url));
const manifest = JSON.parse(readFileSync(join(workspace, "data/asset-manifest.json"), "utf8")) as {
  schemaVersion: number;
  cards: CardRaster[];
  otherAssets: Raster[];
};
const boardManifest = JSON.parse(readFileSync(join(workspace, "data/board-art-v2.json"), "utf8")) as {
  schemaVersion: number;
  cards: CardRaster[];
};
type Raster = { path: string; sha256: string };
type CardRaster = { id: string; variants: (Raster & { purpose: "standard" | "compact" })[] };

function gameArt(): Plugin {
  const virtualModule = "virtual:game-art";
  const assets = new Map<string, Raster>();
  const urls = new Map<string, string>();
  if (manifest.schemaVersion !== 3 || boardManifest.schemaVersion !== 1) throw new Error("Game art manifest schema mismatch");
  for (const asset of [...[...manifest.cards, ...boardManifest.cards].flatMap((card) => card.variants), ...manifest.otherAssets]) {
    if (!/^assets\/(?:[a-z0-9-]+\/)*[a-z0-9-]+\.webp$/.test(asset.path) || assets.has(asset.path)) {
      throw new Error("Invalid or duplicate raster path: " + asset.path);
    }
    assets.set(asset.path, asset);
    urls.set(asset.path, "/" + asset.path + "?v=" + asset.sha256.slice(0, 12));
  }
  const cardUrls = (cards: CardRaster[]) => Object.fromEntries(cards.map((card) => [
    card.id, Object.fromEntries(card.variants.map((variant) => [variant.purpose, urls.get(variant.path)])),
  ]));
  const other = Object.fromEntries(manifest.otherAssets.map((asset) => [asset.path, urls.get(asset.path)]));
  return {
    name: "game-art",
    resolveId(id) {
      if (id === virtualModule) return "\0" + virtualModule;
    },
    load(id) {
      if (id === "\0" + virtualModule) {
        return "export const cards = " + JSON.stringify(cardUrls(manifest.cards)) + "; export const board = " + JSON.stringify(cardUrls(boardManifest.cards)) + "; export const other = " + JSON.stringify(other);
      }
    },
    configureServer(server) {
      server.middlewares.use("/assets", async (request, response, next) => {
        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        const raster = assets.get("assets" + url.pathname);
        if (!raster) return next();
        try {
          const bytes = await readFile(join(workspace, raster.path));
          response.setHeader("Content-Type", "image/webp");
          const versioned = url.searchParams.get("v") === raster.sha256.slice(0, 12);
          response.setHeader("Cache-Control", versioned ? "public, max-age=31536000, immutable" : "no-cache");
          response.end(request.method === "HEAD" ? undefined : bytes);
        } catch (error) {
          next(error);
        }
      });
    },
    async generateBundle() {
      for (const raster of assets.values()) {
        this.emitFile({ type: "asset", fileName: raster.path, source: await readFile(join(workspace, raster.path)) });
      }
    },
  };
}

export default defineConfig({
  root,
  publicDir: false,
  plugins: [gameArt(), react()],
  server: {
    fs: { strict: true, allow: [root] },
    proxy: { "/api": "http://127.0.0.1:4174", "/ws": { target: "http://127.0.0.1:4174", ws: true } },
  },
});
