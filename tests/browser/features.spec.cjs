const { test, expect } = require("playwright/test");
const { open } = require("./fixture.cjs");
const { metadataFixture } = require("./metadata-fixture.cjs");
async function editor(page, fixture) {
    const server = await open(page, fixture.overrides);
    await page.locator("[data-manager-item]").first().click();
    await expect(page.locator("#mmoManagerFields")).toBeVisible();
    return server;
}
test("metadata edits survive navigation and remain local until explicitly reviewed", async ({ page }) => {
    const fixture = metadataFixture(),
        server = await editor(page, fixture);
    await page.locator("#mmoValue_overview").fill("Unfinished biography");
    await page.locator("#mmoWorkspaceBack").click();
    await page.locator('[data-view="rules"]').click();
    await page.getByRole("button", { name: "Resume", exact: true }).click();
    await expect(page.locator("#mmoValue_overview")).toHaveValue("Unfinished biography");
    expect(server.calls.filter((x) => x.method !== "GET")).toEqual([]);
    expect(server.errors).toEqual([]);
});
test("optional empty decisions are explicit while required titles cannot be cleared", async ({ page }) => {
    const fixture = metadataFixture(),
        server = await editor(page, fixture);
    const overview = page.locator('[data-field="overview"]');
    await overview.locator("summary").click();
    await overview.getByRole("button", { name: "Keep empty", exact: true }).click();
    await expect(overview.locator("[data-value]")).toBeDisabled();
    await expect(overview.locator("[data-field-status]")).toContainText("Explicitly empty");
    expect(await page.locator('[data-field="title"]').getByRole("button", { name: "Keep empty", exact: true }).count()).toBe(0);
    await page.locator("#mmoManagerPreview").click();
    await expect(page.locator("#mmoPreviewArea")).toBeVisible();
    expect(server.calls.find((x) => x.path === "preview").body.metadataEdits[0].fields.overview.mode).toBe("empty");
    expect(server.calls.some((x) => x.path === "activate")).toBe(false);
    expect(server.errors).toEqual([]);
});
test("confirmed source lookup offers values without approval or activation", async ({ page }) => {
    const fixture = metadataFixture(),
        server = await editor(page, fixture);
    await page.locator('[data-item-tab="sources"]').click();
    await page.locator("#mmoManagerSourceConfirm").check();
    await page.locator("#mmoManagerCompare").click();
    await expect(page.locator("#mmoManagerSourceResult")).toContainText("Offered overview");
    await expect(page.locator("#mmoManagerSourceResult")).toContainText("source date is incomplete");
    expect(server.calls.filter((x) => x.method !== "GET").map((x) => x.path)).toEqual(["manager/compare"]);
    await page.locator('[data-source-field="overview"]').click();
    await page.locator('[data-item-tab="metadata"]').click();
    await expect(page.locator("#mmoValue_overview")).toHaveValue("Offered overview");
    expect(server.calls.some((x) => x.path === "activate")).toBe(false);
    expect(server.errors).toEqual([]);
});
test("source failure preserves the unfinished metadata edit", async ({ page }) => {
    const fixture = metadataFixture(),
        server = await editor(page, fixture);
    await page.locator("#mmoValue_overview").fill("Keep this local edit");
    await page.route("http://localhost/MusicMetadataManager/manager/compare", (route) =>
        route.fulfill({
            status: 502,
            contentType: "application/json",
            body: JSON.stringify({ code: "source_unavailable", error: "Synthetic source unavailable" }),
        }),
    );
    await page.locator('[data-item-tab="sources"]').click();
    await page.locator("#mmoManagerSourceConfirm").check();
    await page.locator("#mmoManagerCompare").click();
    await expect(page.locator("#mmoAlertAnnouncements")).toContainText("Synthetic source unavailable");
    await page.locator('[data-item-tab="metadata"]').click();
    await expect(page.locator("#mmoValue_overview")).toHaveValue("Keep this local edit");
    expect(server.calls.some((x) => x.path === "activate")).toBe(false);
    expect(server.errors).toEqual([]);
});
test("artwork empty and stop-managing decisions remain reviewable local edits", async ({ page }) => {
    const fixture = metadataFixture(),
        server = await editor(page, fixture);
    await page.locator('[data-item-tab="artwork"]').click();
    await page.locator('[data-image-empty="Primary"]').click();
    await expect(page.locator("#mmoManagerImages")).toContainText("Explicitly empty");
    await page.locator("#mmoManagerPreview").click();
    await expect(page.locator("#mmoPreviewArea")).toBeVisible();
    expect(server.calls.find((x) => x.path === "preview").body.metadataEdits[0].images.Primary.mode).toBe("empty");
    expect(server.calls.some((x) => x.path === "activate")).toBe(false);
    expect(server.errors).toEqual([]);
});
test("album child track navigation exposes disc and track numbers", async ({ page }) => {
    const fixture = metadataFixture(),
        server = await editor(page, fixture);
    await page.locator('[data-item-tab="tracks"]').click();
    await expect(page.locator("#mmoAlbumTracks")).toContainText("Child track");
    await expect(page.locator("#mmoAlbumTracks")).toContainText("Disc 2 · 3");
    expect(server.errors).toEqual([]);
});
test("non-music dependencies keep shared metadata read-only", async ({ page }) => {
    const fixture = metadataFixture();
    fixture.details.dependencies.canEdit = false;
    fixture.details.dependencies.nonMusic = [{ id: "other", name: "Movie", path: "/movies/file", library: "", roles: ["Actor"] }];
    const server = await editor(page, fixture);
    await expect(page.locator("#mmoManagerReadOnly")).toBeVisible();
    await expect(page.locator("#mmoManagerSave")).toBeDisabled();
    await expect(page.locator("#mmoManagerPreview")).toBeDisabled();
    expect(server.calls.filter((x) => x.method !== "GET")).toEqual([]);
    expect(server.errors).toEqual([]);
});
test("blocked issues present evidence without offering deletion", async ({ page }) => {
    const fixture = metadataFixture();
    fixture.overrides["manager/issues"] = {
        revision: 0,
        archivedReports: [],
        items: [
            {
                key: "blocked:fixture",
                type: "blocked",
                status: "blocked",
                name: "Protected artist",
                reason: "User data prevents cleanup",
                canRepair: false,
                canDelete: false,
                canAcknowledge: false,
                itemId: null,
                identityId: null,
                causeCode: "cleanup-protected",
                context: {},
                guidance: {
                    group: "diagnostics",
                    summary: "Dependencies prevent safe cleanup",
                    action: "Inspect dependencies",
                    path: null,
                    evidence: { ...fixture.details.dependencies, userData: 1, canDelete: false },
                },
            },
        ],
    };
    const server = await open(page, fixture.overrides);
    await page.locator('[data-view="issues"]').click();
    await page.locator("#mmoIssueGroup").selectOption("diagnostics");
    await expect(page.locator("#mmoIssueRows")).toContainText("Protected artist");
    await page.locator("[data-issue-open]").first().click();
    await expect(page.locator("#mmoIssuePanel")).toContainText("User-data entries");
    expect(await page.locator("#mmoIssuePanel [data-issue-choice=cleanup]").count()).toBe(0);
    expect(server.calls.filter((x) => x.method !== "GET")).toEqual([]);
    expect(server.errors).toEqual([]);
});

test("artist identity aliases and representatives remain editable without activating", async ({ page }) => {
    const identity = {
        id: "identity",
        preferredName: "Canonical artist",
        aliases: ["Alias"],
        libraries: ["fixture-library"],
        artistId: "artist",
        personId: "person",
        artistIds: [],
        personIds: [],
        musicBrainzId: null,
    };
    const document = {
        schemaVersion: 1,
        revision: 0,
        active: [],
        drafts: [],
        identities: [identity],
        identityDrafts: [],
        policies: [],
        policyDrafts: [],
    };
    const server = await open(page, {
        rules: document,
        "identities/records": { artists: [{ id: "artist", name: "Native artist" }], persons: [{ id: "person", name: "Native person" }] },
    });
    await page.locator('[data-view="rules"]').click();
    await page.locator('[data-action="identityEditActive"]').click();
    await expect(page.locator("#mmoIdentityName")).toHaveValue("Canonical artist");
    await expect(page.locator("#mmoIdentityArtist")).toHaveValue("artist");
    await expect(page.locator("#mmoIdentityPerson")).toHaveValue("person");
    await page.locator("#mmoIdentityAliases").fill("Alias\n天神子兎音");
    await page.locator("#mmoWorkspaceBack").click();
    await page.getByRole("button", { name: "Resume", exact: true }).click();
    await expect(page.locator("#mmoIdentityAliases")).toHaveValue("Alias\n天神子兎音");
    expect(server.calls.filter((call) => call.method !== "GET")).toEqual([]);
    expect(server.errors).toEqual([]);
});

test("bulk review includes only explicitly selected saved drafts", async ({ page }) => {
    const rule = (id) => ({
        id,
        label: "Draft " + id,
        kind: "track",
        path: "/fixture-media/" + id + ".flac",
        credit: "",
        names: [],
        role: "artists",
        libraries: ["fixture-library"],
        fields: { decisions: { title: { mode: "approved", value: "Title" } } },
        trackDefaults: {},
    });
    const document = {
        schemaVersion: 1,
        revision: 2,
        active: [],
        drafts: [rule("first"), rule("second")],
        identities: [],
        identityDrafts: [],
        policies: [],
        policyDrafts: [],
    };
    const server = await open(page, { rules: document });
    await page.locator('[data-view="rules"]').click();
    await page.locator('[data-change-select="rule:first"]').check();
    await page.locator('[data-bulk-action="apply"]').click();
    await expect(page.locator("#mmoPreviewArea")).toBeVisible();
    expect(server.calls.find((call) => call.path === "preview").body.activateIds).toEqual(["first"]);
    expect(server.calls.some((call) => call.path === "activate")).toBe(false);
    expect(server.errors).toEqual([]);
});

test("report acknowledgment archives an occurrence without retrying corrections", async ({ page }) => {
    let acknowledged = false;
    const issue = {
        key: "report:failure",
        type: "report",
        status: "report",
        name: "Recorded failure",
        reason: "An earlier operation failed",
        canRepair: false,
        canDelete: false,
        canAcknowledge: true,
        itemId: null,
        identityId: null,
        causeCode: "application-failure",
        context: { id: "failure", message: "An earlier operation failed", createdAt: "2026-01-01T00:00:00Z", itemId: null, archivedAt: null },
        guidance: { group: "diagnostics", summary: "An earlier operation failed", action: "Investigate failure", path: null, evidence: {} },
    };
    const server = await open(page, {
        "manager/issues": () => ({ revision: 0, items: acknowledged ? [] : [issue], archivedReports: [] }),
        "manager/errors/acknowledge": (request) => {
            acknowledged = true;
            return { acknowledged: request.postDataJSON().ids };
        },
    });
    await page.locator('[data-view="issues"]').click();
    await page.locator("#mmoIssueGroup").selectOption("diagnostics");
    await page.locator('[data-issue-select="report:failure"]').check();
    await page.locator('[data-issue-action="acknowledge"]').click();
    await expect(page.locator("#mmoIssueRows")).not.toContainText("Recorded failure");
    expect(server.calls.filter((call) => call.method !== "GET").map((call) => call.path)).toEqual(["manager/errors/acknowledge"]);
    expect(server.errors).toEqual([]);
});

test("duplicate draft commands share one pending write and preserve notification ownership", async ({ page }) => {
    let release,
        writes = 0;
    const pending = new Promise((resolve) => {
        release = resolve;
    });
    const server = await open(page, {
        drafts: async () => {
            writes++;
            await pending;
            return { saved: "fixture" };
        },
    });
    await page.locator('[data-view="rules"]').click();
    await page.locator("#mmoNew").click();
    await page.locator("#mmoLibraries").selectOption(["fixture-library"]);
    await page.locator("#mmoPath").fill("/fixture-media/track.flac");
    await page.locator("#mmoFieldstitle").fill("Reviewed title");
    await page.locator("#mmoSaveDraft").click();
    await expect.poll(() => writes).toBe(1);
    await page.evaluate(() => {
        document.querySelector("#mmoSaveDraft").click();
        document.querySelector("#mmoSaveDraft").click();
    });
    expect(writes).toBe(1);
    await expect(page.locator("#mmoSaveDraft")).toHaveAttribute("aria-busy", "true");
    release();
    await expect(page.locator("#mmoSaveDraft")).not.toHaveAttribute("aria-busy", "true");
    expect(server.calls.some((call) => call.path === "activate")).toBe(false);
    expect(server.errors).toEqual([]);
});
