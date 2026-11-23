import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "wallet-security.spec.js",
  timeout: 30_000,
  fullyParallel: false,
  reporter: "list",
  use: {
    headless: true,
  },
});
