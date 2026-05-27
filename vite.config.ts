import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: fileURLToPath(new URL("./src/browser", import.meta.url)),
  build: {
    outDir: fileURLToPath(new URL("./dist/browser", import.meta.url)),
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5174,
    strictPort: true,
  },
  resolve: {
    alias: {
      "@shared": fileURLToPath(new URL("./src/shared", import.meta.url)),
      "@browser": fileURLToPath(new URL("./src/browser", import.meta.url)),
    },
  },
});
