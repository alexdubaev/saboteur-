import { createRoot } from "react-dom/client";
import { App } from "./app.js";
import "./styles.css";

const element = document.getElementById("root");
if (!element) throw new Error("Missing game root");
const root = createRoot(element);
root.render(<App />);
import.meta.hot?.dispose(() => root.unmount());
