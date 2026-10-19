const fs = require("node:fs");
const path = require("node:path");
const emptyDocument = () => ({
    schemaVersion: 3,
    revision: 0,
    active: [],
    drafts: [],
    identities: [],
    identityDrafts: [],
    policies: [],
    policyDrafts: [],
});
async function open(page, variant = "current") {
    const errors = [],
        calls = [],
        document = emptyDocument();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
        window.ApiClient = {
            getUrl: (path) => "http://localhost/" + path,
            getImageUrl: (id) => "http://localhost/image/" + id,
            serverId: () => "fixture-server",
            setRequestHeaders: (headers) => {
                headers.Authorization = 'MediaBrowser Token="fixture-only"';
            },
            ajax: async (options) => {
                const response = await fetch(options.url, {
                    method: options.type,
                    headers: { Authorization: 'MediaBrowser Token="fixture-only"', "Content-Type": "application/json" },
                    body: options.data,
                });
                if (!response.ok) throw { status: response.status, responseText: await response.text() };
                return response.json();
            },
        };
    });
    await page.route("http://localhost/**", async (route) => {
        const request = route.request(),
            url = new URL(request.url()),
            api = url.pathname.replace("/MusicMetadataManager/", "");
        if (url.pathname === "/page") {
            const file =
                variant === "previous" ? path.join(__dirname, "fixtures/previous-page.html") : path.join(__dirname, "../../dist/web/config.html");
            await route.fulfill({
                contentType: "text/html; charset=utf-8",
                body: "<!doctype html><html><body>" + fs.readFileSync(file, "utf8") + "</body></html>",
            });
            return;
        }
        calls.push({ path: api, method: request.method(), body: request.postDataJSON() });
        let data;
        if (api === "libraries") data = [{ id: "fixture-library", name: "Fixture music", paths: ["/fixture-media"] }];
        else if (api === "rules" || api === "export") data = document;
        else if (api === "status")
            data = {
                revision: document.revision,
                active: 0,
                drafts: document.drafts.length,
                managedItems: 0,
                pending: 0,
                refreshPending: 0,
                errors: [],
                reports: [],
                unmatchedRules: [],
                identityStatus: [],
            };
        else if (api === "identities/records") data = { artists: [], persons: [] };
        else if (api === "manager/issues") data = { revision: document.revision, items: [], archivedReports: [] };
        else if (api === "manager/navigation") data = { items: {}, rules: {}, paths: {} };
        else if (api === "manager/inventory") data = { total: 0, start: 0, limit: 12, view: "grouped", items: [] };
        else if (api === "drafts" && request.method() === "POST") {
            const rule = request.postDataJSON();
            document.drafts.push(rule);
            document.revision++;
            data = {};
        } else if (api === "preview")
            data = {
                token: "fixture-review",
                revision: document.revision,
                items: [],
                metadata: [],
                restoration: [],
                cleanup: [],
                identities: [],
                unmatchedRules: [],
                warnings: [],
            };
        else {
            await route.fulfill({
                status: 404,
                contentType: "application/json",
                body: JSON.stringify({ error: "Unhandled fixture endpoint: " + api }),
            });
            return;
        }
        await route.fulfill({ contentType: "application/json", body: JSON.stringify(data) });
    });
    await page.goto("http://localhost/page#/configurationpage?name=musicmetadatamanager");
    await page.locator("#musicMetadataManagerPage").dispatchEvent("pageshow");
    await page.waitForFunction(() => document.querySelector("#mmoInventoryCount")?.textContent.includes("results"));
    return { errors, calls, document };
}
module.exports = { open };
