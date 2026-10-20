const { test, expect } = require("playwright/test");
const { open } = require("./fixture.cjs");
test("landing and rule editor fit wide and narrow viewports", async ({ browser }) => {
    for (const width of [1440, 390]) {
        const page = await browser.newPage({ viewport: { width, height: 1000 } });
        const fixture = await open(page);
        await expect(page.locator("#musicMetadataManagerPage")).toBeVisible();
        await expect(page.locator("#mmoInventoryFind")).toBeVisible();
        await page.locator("[data-view=rules]").click();
        await page.locator("#mmoNew").click();
        await expect(page.locator("#mmoWorkspace")).toBeVisible();
        await expect(page.locator("#mmoSaveDraft")).toBeEnabled();
        const widthOfPage = await page.evaluate(() => document.documentElement.scrollWidth);
        expect(widthOfPage).toBeLessThanOrEqual(width);
        expect(fixture.errors).toEqual([]);
        await page.close();
    }
});
test("keyboard navigation retains unfinished edits without a server write", async ({ page }) => {
    const fixture = await open(page);
    await page.locator("[data-view=rules]").focus();
    await page.keyboard.press("Enter");
    await page.locator("#mmoNew").click();
    await page.locator("#mmoLabel").fill("Unfinished fixture");
    await page.locator("#mmoWorkspaceBack").click();
    await expect(page.locator("#mmoLocalEdits")).toContainText("Unfinished rule edit");
    await page.getByRole("button", { name: "Resume", exact: true }).click();
    await expect(page.locator("#mmoLabel")).toHaveValue("Unfinished fixture");
    expect(fixture.calls.filter((call) => call.method !== "GET")).toEqual([]);
    expect(fixture.errors).toEqual([]);
});
test("saving a draft and preparing review never implicitly activate it", async ({ page }) => {
    const fixture = await open(page);
    await page.locator("[data-view=rules]").click();
    await page.locator("#mmoNew").click();
    await page.locator("#mmoLibraries").selectOption(["fixture-library"]);
    await page.locator("#mmoPath").fill("/fixture-media/track.wav");
    await page.locator("#mmoLabel").fill("Fixture draft");
    await page.locator("#mmoFieldstitle").fill("Reviewed title");
    await page.locator("#mmoSaveDraft").click();
    await expect.poll(() => fixture.document.drafts.length).toBe(1);
    await page.locator("#mmoWorkspaceBack").click();
    await page.locator("#mmoPreviewAll").click();
    await expect(page.locator("#mmoPreviewArea")).toBeVisible();
    expect(fixture.calls.some((call) => call.path === "activate")).toBe(false);
    expect(fixture.errors).toEqual([]);
});

test("dark host theme keeps the narrow editor usable", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 1000 });
    const fixture = await open(page);
    await page.addStyleTag({
        content:
            ":root{color-scheme:dark;--jf-palette-background-default:#181818;--jf-palette-primary-main:#4aa5cf}body{background:#181818;color:#eee}",
    });
    await page.locator("[data-view=rules]").click();
    await page.locator("#mmoNew").click();
    await page.locator("#mmoLabel").fill("Dark theme draft");
    await expect(page.locator("#mmoLabel")).toHaveValue("Dark theme draft");
    await expect(page.locator("#mmoSaveDraft")).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    expect(fixture.errors).toEqual([]);
});
test("a late inventory response cannot replace a newer search", async ({ page }) => {
    const fixture = await open(page);
    let release,
        arrived = false;
    const held = new Promise((resolve) => {
        release = resolve;
    });
    await page.route(/\/MusicMetadataManager\/manager\/inventory\?/, async (route) => {
        const older = new URL(route.request().url()).searchParams.get("search") === "older";
        if (older) {
            arrived = true;
            await held;
        }
        await route.fulfill({
            contentType: "application/json",
            body: JSON.stringify({ total: older ? 99 : 2, start: 0, limit: 12, view: "grouped", items: [] }),
        });
    });
    await page.locator("#mmoInventorySearch").fill("older");
    // Keep the click and filter change in one dispatch turn to exercise event ownership,
    // independently of browser timer scheduling and CI speed.
    await page.evaluate(() => {
        document.querySelector("#mmoInventoryFind").click();
        document.querySelector("#mmoInventorySearch").value = "newer";
        const filter = document.querySelector("#mmoInventoryView");
        filter.value = "native";
        filter.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await expect.poll(() => arrived).toBe(true);
    await expect(page.locator("#mmoInventoryCount")).toContainText("2 results");
    const response = page.waitForResponse((response) => new URL(response.url()).searchParams.get("search") === "older");
    release();
    await response;
    await page.evaluate(() => new Promise(requestAnimationFrame));
    await expect(page.locator("#mmoInventoryCount")).toContainText("2 results");
    expect(fixture.errors).toEqual([]);
});
test("a failed draft write announces the outcome and preserves local edits", async ({ page }) => {
    const fixture = await open(page);
    let release,
        arrived = false;
    const held = new Promise((resolve) => {
        release = resolve;
    });
    await page.route("http://localhost/MusicMetadataManager/drafts", async (route) => {
        arrived = true;
        await held;
        await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Synthetic persistence failure" }) });
    });
    await page.locator("[data-view=rules]").click();
    await page.locator("#mmoNew").click();
    await page.locator("#mmoLibraries").selectOption(["fixture-library"]);
    await page.locator("#mmoPath").fill("/fixture-media/track.wav");
    await page.locator("#mmoLabel").fill("Preserved local edit");
    await page.locator("#mmoFieldstitle").fill("Fixture title");
    await page.locator("#mmoSaveDraft").click();
    await expect.poll(() => arrived).toBe(true);
    await expect(page.locator("#mmoSaveDraft")).toHaveAttribute("aria-busy", "true");
    release();
    await expect(page.locator("#mmoAlertAnnouncements")).not.toBeEmpty();
    await expect(page.locator("#mmoLabel")).toHaveValue("Preserved local edit");
    expect(fixture.document.active).toEqual([]);
    expect(fixture.errors).toEqual([]);
});
