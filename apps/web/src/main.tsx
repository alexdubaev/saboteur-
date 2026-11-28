import { createRoot } from "react-dom/client";
import { App } from "./app.js";
import "./styles.css";

const element = document.getElementById("root");
if (!element) throw new Error("Missing game root");
const root = createRoot(element);
if (import.meta.env.MODE === "sites") {
  void import("./solo-app.js").then(({ SoloApp }) => root.render(<SoloApp />));
} else {
  root.render(<App />);
}
import.meta.hot?.dispose(() => root.unmount());
