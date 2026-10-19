const { defineConfig } = require("playwright/test");
module.exports = defineConfig({
    testDir: ".",
    testMatch: "*.spec.cjs",
    timeout: 30000,
    workers: 1,
    reporter: "list",
    outputDir: process.env.CI_BROWSER_OUTPUT_DIR || "results",
    use: { headless: true, viewport: { width: 1440, height: 1000 } },
    projects: [{ name: "workflow-chromium", use: { browserName: "chromium" } }],
});
