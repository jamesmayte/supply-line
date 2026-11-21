import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const repoRoot = fileURLToPath(new URL(".", import.meta.url));

// Phase 1 harness (Vite) + test config (Vitest) in one file.
// Relative base so the build works under https://<user>.github.io/supply-line/
export default defineConfig({
  root: "harness",
  base: "./",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
  test: {
    root: repoRoot,
    include: ["tests/**/*.test.ts"],
    globals: true,
  },
});
