import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // Les fragments `gabarits/fragments/*.css` sont importés en `?raw` (texte brut) : sans cette ligne Vitest les
    // remplace par une chaîne vide, ce qui fausserait le rendu des gabarits dans les tests (lot 5).
    css: { include: [/gabarits\/fragments\/.*\.css/] },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
