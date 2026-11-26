import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    exclude: [
      ...configDefaults.exclude,
      ".autopilot/**",
      "archive/**",
      "art-source/**",
      "references/**",
      "**/dist/**",
      "**/*.e2e.{test,spec}.?(c|m)[jt]s?(x)",
      "tests/web/**",
    ],
  },
});
