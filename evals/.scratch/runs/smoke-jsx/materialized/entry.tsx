import { createRoot } from "react-dom/client";
import * as authored from "./Component.tsx";

const exportedValues = Object.values(authored);
const Component = authored.default ?? exportedValues.find((value) => typeof value === "function");

if (typeof Component !== "function") {
  throw new Error("the authored module exports no component function");
}

const container = document.getElementById("root");
if (container === null) throw new Error("the mount point is missing");

createRoot(container).render(<Component />);
