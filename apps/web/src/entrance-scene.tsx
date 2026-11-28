import { compactShaftArt, shaftArt } from "./art.js";

export function EntranceScene() {
  return <picture className="entrance-scene" aria-hidden="true">
    <source media="(max-width: 730px)" srcSet={compactShaftArt} />
    <img src={shaftArt} fetchPriority="high" width={1536} height={1024} alt="" />
  </picture>;
}
