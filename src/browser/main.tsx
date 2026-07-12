import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import {
  applyThemeChoice,
  applyThemeClass,
  readInitialTheme,
  readInitialThemeChoice,
} from "./theme.ts";

applyThemeClass(readInitialTheme());
applyThemeChoice(readInitialThemeChoice());

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
