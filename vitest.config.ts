import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(
        new URL("./tests/server-only.ts", import.meta.url),
      ),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["tests/*.test.ts"],
          exclude: ["tests/database.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "database",
          include: ["tests/database.test.ts"],
          testTimeout: 20000,
          hookTimeout: 30000,
          fileParallelism: false,
        },
      },
    ],
  },
});
