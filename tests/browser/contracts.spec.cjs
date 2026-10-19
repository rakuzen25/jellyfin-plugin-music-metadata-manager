const { test, expect } = require("playwright/test");
const { open } = require("./fixture.cjs");
async function pixelDifference(page, before, after) {
    return page.evaluate(
        async (encoded) => {
            const images = await Promise.all(
                encoded.map(async (data) => createImageBitmap(await (await fetch("data:image/png;base64," + data)).blob())),
            );
            if (images[0].width !== images[1].width || images[0].height !== images[1].height) return { differentSize: true };
            const canvas = document.createElement("canvas");
            canvas.width = images[0].width;
            canvas.height = images[0].height;
            const context = canvas.getContext("2d", { willReadFrequently: true });
            const pixels = images.map((image) => {
                context.clearRect(0, 0, canvas.width, canvas.height);
                context.drawImage(image, 0, 0);
                image.close();
                return context.getImageData(0, 0, canvas.width, canvas.height).data;
            });
            let changed = 0,
                meaningful = 0;
            for (let index = 0; index < pixels[0].length; index += 4) {
                let delta = 0;
                for (let channel = 0; channel < 4; channel++)
                    delta = Math.max(delta, Math.abs(pixels[0][index + channel] - pixels[1][index + channel]));
                if (delta) changed++;
                if (delta > 8) meaningful++;
            }
            return { differentSize: false, changed, meaningful };
        },
        [before.toString("base64"), after.toString("base64")],
    );
}
function visuallyEqual(difference) {
    // Chromium occasionally rounds a few native-control edge channels differently.
    // Keep dimensions exact; allow at most 16 pixels with a channel delta of 8/255.
    return !difference.differentSize && difference.meaningful === 0 && difference.changed <= 16;
}
async function stableScreenshot(page) {
    await page.bringToFront();
    await page.evaluate(async () => {
        await document.fonts.ready;
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
    });
    const region = page.locator("#musicMetadataManagerPage");
    let previous = await region.screenshot({ animations: "disabled" });
    for (let attempt = 0; attempt < 8; attempt++) {
        const current = await region.screenshot({ animations: "disabled" });
        if (visuallyEqual(await pixelDifference(page, previous, current))) return current;
        if (attempt === 7) {
            await test.info().attach("unstable-before", { body: previous, contentType: "image/png" });
            await test.info().attach("unstable-after", { body: current, contentType: "image/png" });
        }
        previous = current;
    }
    throw new Error("Administrator page did not reach a stable visual state");
}
async function compare(previous, current) {
    const before = await stableScreenshot(previous),
        after = await stableScreenshot(current);
    const difference = await pixelDifference(current, before, after);
    if (!visuallyEqual(difference)) {
        await test.info().attach("baseline", { body: before, contentType: "image/png" });
        await test.info().attach("current", { body: after, contentType: "image/png" });
    }
    expect(visuallyEqual(difference), JSON.stringify(difference)).toBe(true);
}
test("module conversion preserves landing and editor appearance against the previous page", async ({ browser }) => {
    for (const width of [1440, 390]) {
        const previous = await browser.newPage({ viewport: { width, height: 1000 } }),
            current = await browser.newPage({ viewport: { width, height: 1000 } });
        const before = await open(previous, "previous"),
            after = await open(current);
        await compare(previous, current);
        for (const page of [previous, current]) {
            await page.locator("[data-view=rules]").click();
            await page.locator("#mmoNew").click();
            await expect(page.locator("#mmoWorkspace")).toBeVisible();
        }
        await compare(previous, current);
        expect(before.errors).toEqual([]);
        expect(after.errors).toEqual([]);
        await previous.close();
        await current.close();
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

test("dark host theme preserves the previous page and narrow editor", async ({ browser }) => {
    const previous = await browser.newPage({ viewport: { width: 390, height: 1000 } }),
        current = await browser.newPage({ viewport: { width: 390, height: 1000 } });
    const before = await open(previous, "previous"),
        after = await open(current);
    for (const page of [previous, current])
        await page.addStyleTag({
            content:
                ":root{color-scheme:dark;--jf-palette-background-default:#181818;--jf-palette-primary-main:#4aa5cf}body{background:#181818;color:#eee}",
        });
    await compare(previous, current);
    for (const page of [previous, current]) {
        await page.locator("[data-view=rules]").click();
        await page.locator("#mmoNew").click();
    }
    await compare(previous, current);
    expect(before.errors).toEqual([]);
    expect(after.errors).toEqual([]);
    await previous.close();
    await current.close();
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
    await page.locator("#mmoInventoryFind").click();
    await expect.poll(() => arrived).toBe(true);
    await page.locator("#mmoInventorySearch").fill("newer");
    await page.locator("#mmoInventoryView").selectOption("native");
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
