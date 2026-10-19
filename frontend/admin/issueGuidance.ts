import { operationError } from "./errors.ts";
import type { ActivationResult, Issue, IssueContext, IssueEvidence, IssueVerification, NativeRecord } from "./responses.ts";
import type { ArtistIdentity } from "./contracts.ts";
import type { Features } from "./features.ts";
export function createIssueGuidance(features: Features) {
    // Guidance is visit-local. Backend facts drive choices; choices never apply edits.
    let issuePanelState: {
        issue: Issue;
        guided: boolean;
        request: number;
    } | null = null;
    let issueEditor: {
        issue: Issue;
        guided: boolean;
        choice: string;
        full: boolean;
        key: string;
    } | null = null;
    let issueVerification: IssueVerification | null = null;
    let issueCheckTimer: ReturnType<typeof setTimeout> | null = null,
        issueCheckSerial = 0;
    const issueTypeNames: Record<string, string> = {
        credit: "Unresolved credit",
        binding: "Broken binding",
        repair: "Repair candidate",
        orphan: "Verified orphan",
        blocked: "Blocked record",
        report: "Application report",
        unmatched: "Unmatched correction",
        recreated: "Recreated record",
        audit: "Audit failure",
    };
    const issueNameKey = (value: unknown) =>
        String(value || "")
            .normalize("NFC")
            .toUpperCase();
    function issueChoice(label: string, choice: string, description = "") {
        return (
            '<div class="mmo-issue-choice">' +
            features.navigation.nativeButton(label, 'data-issue-choice="' + choice + '"') +
            (description ? '<p class="secondaryText">' + features.api.esc(description) + "</p>" : "") +
            "</div>"
        );
    }
    function issueExample(issue: Issue) {
        const e = issue.guidance.evidence || {},
            uses = e.items || e.music || [];
        const item = uses[0];
        let html = item
            ? '<section class="mmo-issue-example"><strong>' +
              features.api.esc(item.name) +
              "</strong>" +
              features.nativeLinks.nativeLink(item.id, item.name) +
              '<p class="secondaryText mmo-value">' +
              features.api.esc(item.path) +
              "</p>" +
              (e.credit
                  ? "<p>" + features.api.esc(e.role === "albumArtists" ? "Album artist" : "Performer") + ": " + features.api.esc(e.credit) + "</p>"
                  : "") +
              "</section>"
            : "";
        if (issue.type === "repair")
            html +=
                "<p>Stored name: <strong>" +
                features.api.esc(issue.name) +
                "</strong><br>Metadata-folder name: <strong>" +
                features.api.esc((e.path || "").split("/").filter(Boolean).at(-1)) +
                '</strong></p><p class="secondaryText">A different name can be legitimate. Compare credits and source evidence before changing it.</p>';
        if (issue.type === "binding") html += "<p>Missing: <strong>" + features.api.esc(e.missing!.join(", ")) + "</strong></p>";
        if (uses.length > 1)
            html +=
                "<details><summary>All affected items (" +
                uses.length +
                ")</summary>" +
                uses
                    .map(
                        (u) =>
                            "<p>" +
                            features.api.esc(u.name) +
                            features.nativeLinks.nativeLink(u.id, u.name) +
                            '<br><span class="secondaryText mmo-value">' +
                            features.api.esc(u.path) +
                            "</span></p>",
                    )
                    .join("") +
                "</details>";
        return html;
    }
    function dependencyEvidence(e: IssueEvidence | null) {
        if (!e || !Array.isArray(e.music)) return "";
        const values = [
            ["Music uses", e.music.length],
            ["Non-music uses", e.nonMusic!.length],
            ["Descendants", e.descendants],
            ["Linked references", e.linkedReferences],
            ["User-data entries", e.userData],
            ["Identity bindings", e.bindings!.length],
            ["Managed policies", e.policies!.length],
        ];
        return (
            '<dl class="mmo-issue-dependencies">' +
            values
                .filter(([, n]) => n)
                .map(([name, n]) => "<dt>" + name + "</dt><dd>" + n + "</dd>")
                .join("") +
            "</dl>" +
            (e.canDelete
                ? "<p>No blocking dependencies found.</p>"
                : '<p class="secondaryText">Keep legitimate dependencies. User data is not removed by this plugin.</p>')
        );
    }
    async function openIssuePanel(issue: Issue | undefined, guided = false) {
        if (!issue) throw Error("This finding is no longer present. Refresh Issues.");
        features.navigation.captureEditor();
        features.rules.invalidateReview();
        if (features.navigation.ui.screen === "list") {
            features.navigation.ui.scroll.set("issues", window.scrollY);
            features.navigation.ui.listFocus = {
                view: "issues",
                element: document.activeElement as HTMLElement | null,
                selector: '[data-issue-open="' + CSS.escape(issue.key) + '"]',
            };
        }
        features.navigation.ui.request++;
        resetIssueEditor();
        features.navigation.ui.editor = null;
        features.navigation.ui.stack = [];
        features.navigation.ui.view = "issues";
        issuePanelState = { issue, guided, request: features.navigation.ui.request };
        features.navigation.displayScreen("issue");
        features.api.q("mmoIssuePanelTitle").textContent = issue.name;
        const e = issue.guidance.evidence || {};
        let choices = "";
        const references = [...(e.items || []), ...(e.music || []), ...(e.nonMusic || []), ...(e.candidates || [])];
        const evidenceLinks = references.length
            ? "<details><summary>Related Jellyfin pages</summary>" +
              [...new Map(references.map((x) => [x.id, x])).values()]
                  .map((x) => "<p>" + features.api.esc(x.name || x.id) + features.nativeLinks.nativeLink(x.id, x.name || "related item") + "</p>")
                  .join("") +
              "</details>"
            : "";
        switch (issue.type) {
            case "credit":
                if (issue.identityId) choices += issueChoice("Repair existing identity binding", "binding");
                choices += issueChoice(
                    "Link existing artist",
                    "link",
                    "Keep the original credited name; choose the identity or native records explicitly.",
                );
                choices += issueChoice("Split combined credit", "split", "Enter each intended performer yourself. No automatic splitting.");
                choices += issueChoice("Investigate missing artist", "missing");
                break;
            case "binding":
                choices += issueChoice("Select replacement representatives", "binding");
                break;
            case "repair":
                if (issue.canRepair)
                    choices += issueChoice("Review metadata and sources", "metadata") + issueChoice("Link an artist identity", "link");
                choices += issueChoice("Inspect native record", "inspect");
                break;
            case "orphan":
                choices +=
                    issueChoice("Review deletion", "cleanup", "Review internal metadata/artwork removal and recovery material. Audio stays intact.") +
                    issueChoice("Inspect record", "inspect");
                break;
            case "blocked":
                choices += dependencyEvidence(e);
                choices += issueChoice("Inspect record and dependencies", "inspect");
                for (const id of e.bindings || [])
                    choices += features.navigation.nativeButton("Inspect identity binding", 'data-issue-binding="' + features.api.esc(id) + '"');
                for (const id of e.policies || [])
                    choices += features.navigation.nativeButton("Inspect managed policy", 'data-issue-policy="' + features.api.esc(id) + '"');
                break;
            case "unmatched":
                choices +=
                    issueChoice("Update target and scope", "rule") +
                    issueChoice("Review disable", "disable") +
                    issueChoice("Review delete", "delete") +
                    '<p class="secondaryText">If the media is temporarily unavailable, leave this correction active.</p>';
                break;
            case "recreated":
                choices += dependencyEvidence(e) + issueChoice("Inspect record and current uses", "inspect");
                if (e.canDelete) choices += issueChoice("Review orphan deletion again", "cleanup");
                else if (e.canEdit && e.music?.length) choices += issueChoice("Review artist metadata", "metadata");
                break;
            case "report":
                choices +=
                    '<details><summary>Original error</summary><p class="mmo-value">' +
                    features.api.esc(e.message || issue.reason) +
                    "</p></details>";
                if (issue.itemId) choices += issueChoice("Inspect affected item", "inspect");
                if (["cleanup-review-stale", "cleanup-failure"].includes(issue.causeCode))
                    choices += issueChoice("Check current cleanup eligibility", "recheck");
                else if (issue.causeCode === "application-failure" && issue.itemId)
                    choices += issueChoice(
                        "Reapply active corrections",
                        "reapply",
                        "Explicit retry of active corrections across the library; this does not retry cleanup.",
                    );
                choices += issueChoice("Archive report", "archive", "Archive this occurrence only. No correction is retried.");
                break;
            case "audit":
                choices +=
                    '<details><summary>Inspection error</summary><p class="mmo-value">' +
                    features.api.esc(issue.reason) +
                    "</p></details>" +
                    (issue.causeCode === "inspection-access-denied"
                        ? "<p>Inspect filesystem permissions and library access, then check again.</p>"
                        : issue.causeCode === "inspection-io-failure"
                          ? "<p>Check the affected path and available storage, then check again.</p>"
                          : "");
                if (issue.itemId) choices += issueChoice("Inspect affected item", "inspect");
                choices += issueChoice("Check again", "recheck");
                break;
        }
        features.api.q("mmoIssuePanelBody").innerHTML =
            '<p class="secondaryText">' +
            features.api.esc(issueTypeNames[issue.type]) +
            "</p><p>" +
            features.api.esc(issue.guidance.summary) +
            "</p>" +
            features.nativeLinks.issueNativeLink(issue, false) +
            issueExample(issue) +
            evidenceLinks +
            '<div id="mmoIssueChoices">' +
            choices +
            '</div><div id="mmoIssueDecision" hidden></div><details><summary>Evidence and technical details</summary><p class="mmo-value">' +
            features.api.esc(issue.guidance.path || "") +
            "</p><pre>" +
            features.api.esc(JSON.stringify({ cause: issue.causeCode, reason: issue.reason, evidence: e }, null, 2)) +
            "</pre></details>" +
            (guided
                ? '<div class="mmo-actions">' +
                  features.navigation.nativeButton("Skip this repair", 'data-issue-choice="skip"') +
                  features.navigation.nativeButton("Return to Issues", 'data-issue-choice="return"') +
                  "</div>"
                : "");
        features.navigation.normalizeControls(features.api.q("mmoIssuePanel"));
        features.api.q("mmoIssuePanelTitle").focus({ preventScroll: true });
        window.scrollTo(0, 0);
    }
    function resetIssueEditor() {
        for (const el of features.api.page.querySelectorAll<HTMLElement>("[data-issue-hidden]")) {
            el.hidden = false;
            delete el.dataset.issueHidden;
        }
        features.api.q("mmoIssueEditorContext").hidden = true;
        issueEditor = null;
    }
    function focusIssueEditor(issue: Issue, guided: boolean, choice: string, full = false) {
        issueEditor = { issue, guided, choice, full, key: features.navigation.ui.editor!.key };
        features.navigation.ui.editor!.issueRepair = issueEditor;
        features.api.q("mmoIssueEditorContext").hidden = false;
        features.api.q("mmoIssueEditorSummary").textContent =
            issue.name +
            " · " +
            ({
                split: "Enter the intended names, then preview.",
                binding: "Select missing representatives, then preview.",
                link: "Confirm aliases and representatives, then preview.",
                metadata: "Compare and approve the intended artist values.",
                rule: "Update the target or scope, then preview.",
                inspect: "Inspect the evidence; no changes are required.",
            }[choice] || "Review the intended repair.");
        const hide = (el: HTMLElement | null | undefined) => {
            if (el && !el.hidden) {
                el.hidden = true;
                el.dataset.issueHidden = "true";
            }
        };
        applyIssueFieldFocus();
        if (!full && features.navigation.ui.editor!.type === "identity") {
            for (const id of ["mmoIdentityArtists", "mmoIdentityPersons", "mmoIdentityMbid"]) hide(features.api.q(id).closest<HTMLElement>("label"));
            for (const id of ["mmoLocalSuggestions", "mmoBrainzSuggestions", "mmoIdentitySuggestions"]) hide(features.api.q(id));
        }
        if (!full && features.navigation.ui.editor!.type === "rule" && choice === "rule") {
            hide(features.api.q("mmoFieldsArea"));
            hide(features.api.q("mmoAliasArea").querySelector<HTMLTextAreaElement>("textarea")?.closest<HTMLElement>("label"));
        }
        features.api.q("mmoIssueFullWorkspace").hidden = !features.api.page.querySelector<HTMLElement>("[data-issue-hidden]");
        if (features.navigation.ui.editor!.dirty) features.navigation.captureEditor();
        if (guided) {
            features.api.q("mmoRepairControls").hidden = false;
            features.api.q("mmoRepairContext").textContent =
                "Repair " + (features.issues.repairQueue!.index + 1) + " of " + features.issues.repairQueue!.tasks.length + ": " + issue.name;
            features.api.q("mmoRepairStage").disabled =
                features.navigation.ui.editor!.type === "metadata" && features.api.q("mmoManagerPreview").disabled;
        }
    }
    function applyIssueFieldFocus() {
        if (
            !issueEditor ||
            !features.navigation.ui.editor ||
            issueEditor.key !== features.navigation.ui.editor.key ||
            issueEditor.full ||
            features.navigation.ui.editor.type !== "metadata" ||
            issueEditor.choice !== "metadata"
        )
            return;
        for (const el of features.api.q("mmoManagerFields").querySelectorAll<HTMLElement>("[data-field],.mmo-advanced")) {
            if (el.matches(".mmo-advanced") || !["title", "sortName", "overview"].includes(el.dataset.field!)) {
                el.hidden = true;
                el.dataset.issueHidden = "true";
            }
        }
    }
    async function editIssueTarget(choice: string, identity?: ArtistIdentity) {
        const state = issuePanelState,
            { issue, guided } = state!;
        if (choice === "binding") {
            identity = features.api.doc.identityDrafts.concat(features.api.doc.identities).find((i) => i.id === issue.identityId);
            if (!identity) throw Error("Identity no longer exists. Refresh Issues.");
        }
        if (identity) {
            await features.identities.editIdentity(identity);
            if (issuePanelState !== state || features.navigation.ui.screen !== "workspace") return;
            if (choice === "link" && !features.api.doc.identities.concat(features.api.doc.identityDrafts).some((i) => i.id === identity.id))
                features.navigation.markDirty();
            if (choice === "link" && issue.type === "credit") {
                const aliases = features.api.q("mmoIdentityAliases").value.split("\n").filter(Boolean);
                if (![features.api.q("mmoIdentityName").value, ...aliases].some((n) => issueNameKey(n) === issueNameKey(issue.name))) {
                    features.api.q("mmoIdentityAliases").value = [...aliases, issue.name].join("\n");
                    features.navigation.markDirty();
                }
            }
        } else if (choice === "split") {
            const e = issue.guidance.evidence!;
            const mapping = features.api.doc.drafts
                .concat(features.api.doc.active)
                .find(
                    (r) =>
                        r.kind === "alias" && r.credit === issue.name && r.libraries.includes(e.library!) && (r.role === e.role || r.role === "both"),
                );
            features.rules.edit(
                mapping || {
                    id: crypto.randomUUID().replaceAll("-", ""),
                    label: "Repair credit: " + issue.name,
                    kind: "alias",
                    credit: issue.name,
                    names: [],
                    role: e.role,
                    libraries: [e.library!],
                },
            );
            if (!mapping) features.navigation.markDirty();
        } else if (choice === "rule") features.rules.edit(issue.context);
        else await features.managerUi.managerOpen(issue.itemId);
        if (issuePanelState !== state || features.navigation.ui.screen !== "workspace") return;
        focusIssueEditor(issue, guided, choice);
    }
    async function showArtistChoices() {
        const state = issuePanelState,
            request = features.navigation.ui.request;
        const records = await features.api.api("identities/records");
        if (issuePanelState !== state || request !== features.navigation.ui.request || features.navigation.ui.screen !== "issue") return;
        const { issue } = state!,
            e = issue.guidance.evidence || {};
        const scope = e.library || e.music?.[0]?.library;
        const identities = features.api.doc.identityDrafts
            .concat(features.api.doc.identities)
            .filter((i, index, all) => all.findIndex((x) => x.id === i.id) === index && (!scope || i.libraries.includes(scope)));
        const candidates = e.candidates || [];
        const rank = (r: NativeRecord) =>
            candidates.find((c) => c.id === r.id)?.match || (issueNameKey(r.name) === issueNameKey(issue.name) ? "name" : null);
        const order = (match: string | number | null) =>
            ({ identity: 0, name: 1, "metadata-folder": 2 })[String(match) as "identity" | "name" | "metadata-folder"] ?? 3;
        const options = (rows: NativeRecord[]) =>
            '<option value="">Choose a record</option>' +
            [...rows]
                .sort((a, b) => order(rank(a)) - order(rank(b)) || a.name.localeCompare(b.name))
                .map(
                    (r) =>
                        '<option value="' +
                        features.api.esc(r.id) +
                        '">' +
                        features.api.esc(r.name) +
                        " · " +
                        features.api.esc(r.id.slice(0, 8)) +
                        (rank(r)
                            ? " — " +
                              features.api.esc(
                                  (
                                      {
                                          identity: "existing identity member",
                                          name: "exact name match",
                                          "metadata-folder": "metadata-folder match",
                                      } as Record<string, string>
                                  )[rank(r)!],
                              )
                            : "") +
                        "</option>",
                )
                .join("");
        const matching = (i: ArtistIdentity) =>
            issueNameKey(i.preferredName) === issueNameKey(issue.name) || i.aliases.some((a) => issueNameKey(a) === issueNameKey(issue.name));
        features.api.q("mmoIssueChoices").hidden = true;
        features.api.q("mmoIssueDecision").hidden = false;
        features.api.q("mmoIssueDecision").innerHTML =
            "<h3>Choose the artist explicitly</h3>" +
            (identities.length
                ? '<label class="selectContainer">Existing identity<select is="emby-select" id="mmoIssueIdentity"><option value="">Choose an identity</option>' +
                  identities
                      .sort((a, b) => Number(matching(b)) - Number(matching(a)) || a.preferredName.localeCompare(b.preferredName))
                      .map(
                          (i) =>
                              '<option value="' +
                              features.api.esc(i.id) +
                              '">' +
                              features.api.esc(i.preferredName) +
                              (matching(i) ? " — recognized name" : "") +
                              "</option>",
                      )
                      .join("") +
                  "</select></label>" +
                  features.navigation.nativeButton("Use chosen identity", 'data-issue-choice="use-identity" disabled')
                : "") +
            '<details><summary>Create an identity using existing records</summary><p class="secondaryText">Both endpoint-compatible representatives are required. This creates no native artist records.</p><label>Preferred page name<input is="emby-input" id="mmoIssuePreferredName" value="' +
            features.api.esc(issue.name) +
            '" /></label><label>MusicArtist representative<select is="emby-select" id="mmoIssueArtist">' +
            options(records.artists) +
            '</select></label><label>Person representative<select is="emby-select" id="mmoIssuePerson">' +
            options(records.persons) +
            "</select></label>" +
            features.navigation.nativeButton("Use chosen records", 'data-issue-choice="use-records" disabled') +
            "</details>" +
            features.navigation.nativeButton("Back to choices", 'data-issue-choice="choices"');
        features.api.q("mmoIssueDecision").insertAdjacentHTML("beforeend", '<div id="mmoIssueCandidateLinks" class="mmo-actions"></div>');
        features.navigation.normalizeControls(features.api.q("mmoIssueDecision"));
    }
    function stopIssueVerification() {
        if (issueCheckTimer !== null) clearTimeout(issueCheckTimer);
        issueCheckTimer = null;
        issueCheckSerial++;
    }
    function beginIssueVerification(context: IssueContext, result: Partial<ActivationResult>) {
        stopIssueVerification();
        issueVerification = { context, result, started: Date.now(), rows: context.eligible.map((issue) => ({ issue, state: "Applied · checking" })) };
        renderIssueResults();
        if (features.navigation.ui.view === "issues" && ["list", "issue"].includes(features.navigation.ui.screen)) void checkIssueResolution();
    }
    function renderIssueResults() {
        const node = features.api.q("mmoIssueResults");
        node.hidden = !issueVerification;
        if (!issueVerification) return;
        const focused =
            node.contains(document.activeElement as HTMLElement | null) &&
            (document.activeElement as HTMLElement | null)!.matches("[data-issue-result-check]");
        const expanded = node.querySelector<HTMLDetailsElement>("details")?.open;
        const rows = issueVerification.rows,
            resolved = rows.filter((r) => r.state === "Resolved").length,
            remaining = rows.filter((r) => r.state === "Still needs attention").length;
        const checking = rows.filter((r) => r.state === "Applied · checking").length,
            unverified = rows.length - resolved - remaining - checking;
        const entries = rows
            .map(
                (r) =>
                    "<p><strong>" +
                    features.api.esc(r.issue.name) +
                    "</strong>" +
                    features.nativeLinks.issueNativeLink(r.issue) +
                    " — " +
                    features.api.esc(r.state) +
                    (r.reason ? '<br><span class="secondaryText">' + features.api.esc(r.reason) + "</span>" : "") +
                    "</p>" +
                    (r.recoveryPath
                        ? '<details><summary>Recovery material</summary><p class="mmo-value">' + features.api.esc(r.recoveryPath) + "</p></details>"
                        : ""),
            )
            .join("");
        node.innerHTML =
            '<h3>Repair results</h3><p role="status">' +
            resolved +
            " resolved · " +
            remaining +
            " remaining" +
            (checking ? " · " + checking + " applied, checking" : "") +
            (unverified ? " · " + unverified + " unverified" : "") +
            "</p>" +
            (rows.length === 1
                ? entries
                : "<details" + (expanded ? " open" : "") + "><summary>Results (" + rows.length + ")</summary>" + entries + "</details>") +
            '<div class="mmo-actions">' +
            features.navigation.nativeButton("Check again", "data-issue-result-check") +
            "</div>";
        if (focused) node.querySelector<HTMLElement>("[data-issue-result-check]")!.focus({ preventScroll: true });
    }
    async function checkIssueResolution() {
        if (
            !issueVerification ||
            !features.api.page.isConnected ||
            features.navigation.ui.view !== "issues" ||
            !["list", "issue"].includes(features.navigation.ui.screen)
        )
            return;
        if (issueCheckTimer !== null) clearTimeout(issueCheckTimer);
        issueCheckTimer = null;
        const verification = issueVerification,
            serial = ++issueCheckSerial,
            listSerial = ++features.navigation.ui.issueRequest;
        try {
            const [status, data] = await Promise.all([features.api.api("status"), features.api.api("manager/issues")]);
            if (serial !== issueCheckSerial || verification !== issueVerification || !features.api.page.isConnected) return;
            if (listSerial !== features.navigation.ui.issueRequest) {
                issueCheckTimer = setTimeout(() => void checkIssueResolution(), 5000);
                return;
            }
            // Resolution requires a successful fresh audit and settled worker, never a vanished row alone.
            const expected = verification.result.revision;
            const pending =
                    !!(status.pending || status.refreshPending) ||
                    (typeof expected === "number" && (data.revision < expected || status.revision < expected)),
                timedOut = Date.now() - verification.started >= 60000;
            features.issues.issueItems = data.items;
            features.issues.issueArchived = data.archivedReports;
            features.navigation.ui.issueLoaded = true;
            features.issues.renderIssues();
            features.api.q("mmoIssuesMessage").textContent = features.issues.issueItems.length + " findings across all views.";
            for (const row of verification.rows) {
                const outcome = (verification.result.cleanupResults || []).find(
                    (o) => o.id.replaceAll("-", "") === row.issue.itemId?.replaceAll("-", ""),
                );
                row.recoveryPath = outcome?.recoveryPath;
                const still = data.items.some((i) => i.key === row.issue.key),
                    audit = data.items.some((i) => i.type === "audit" && (row.issue.type === "credit" || i.itemId === row.issue.itemId));
                if (outcome && outcome.outcome !== "deleted") {
                    row.state = "Still needs attention";
                    row.reason = outcome.reason;
                } else if (pending) {
                    row.state = timedOut ? "Couldn’t verify yet" : "Applied · checking";
                    row.reason = timedOut ? "Processing remains pending. Check again when it finishes." : "";
                } else if (audit && row.issue.type !== "audit") {
                    row.state = "Couldn’t verify yet";
                    row.reason = "Inspection did not complete for affected items.";
                } else {
                    row.state = still ? "Still needs attention" : "Resolved";
                    row.reason = still ? "A fresh check still finds this condition." : "";
                }
            }
            renderIssueResults();
            if (pending && !timedOut) issueCheckTimer = setTimeout(() => void checkIssueResolution(), 5000);
        } catch (caughtError) {
            const error = operationError(caughtError);
            if (serial !== issueCheckSerial || verification !== issueVerification) return;
            if (listSerial !== features.navigation.ui.issueRequest) {
                issueCheckTimer = setTimeout(() => void checkIssueResolution(), 5000);
                return;
            }
            for (const row of verification.rows) {
                row.state = "Couldn’t verify yet";
                row.reason = "The issue check failed. Check again; no writes are retried.";
            }
            renderIssueResults();
        }
    }
    const issueRouteChanged = () => {
        if (!location.hash.toLowerCase().includes("configurationpage?name=musicmetadatamanager")) stopIssueVerification();
    };
    const issueDetached = new MutationObserver(() => {
        if (!features.api.page.isConnected) {
            stopIssueVerification();
            issueDetached.disconnect();
            window.removeEventListener("hashchange", issueRouteChanged);
        }
    });
    return {
        initialize() {
            features.api.q("mmoIssuePanelBody").onchange = (event) => {
                const identity = features.api.page.querySelector<HTMLButtonElement>('[data-issue-choice="use-identity"]'),
                    records = features.api.page.querySelector<HTMLButtonElement>('[data-issue-choice="use-records"]');
                if (
                    features.api.find("mmoIssueCandidateLinks") &&
                    ["mmoIssueIdentity", "mmoIssueArtist", "mmoIssuePerson"].includes((event.target as HTMLElement).id)
                ) {
                    const chosen = features.api.doc.identities.find((i) => i.id === features.api.find("mmoIssueIdentity")?.value);
                    features.api.q("mmoIssueCandidateLinks").innerHTML =
                        features.nativeLinks.nativeLink(chosen?.artistId, chosen?.preferredName, false) +
                        features.nativeLinks.nativeLink(features.api.find("mmoIssueArtist")?.value, "selected MusicArtist", false) +
                        features.nativeLinks.nativeLink(features.api.find("mmoIssuePerson")?.value, "selected Person", false);
                }
                if (identity) features.actions.actions.setDisabled(identity, !features.api.q("mmoIssueIdentity").value);
                if (records)
                    features.actions.actions.setDisabled(
                        records,
                        !features.api.q("mmoIssueArtist").value ||
                            !features.api.q("mmoIssuePerson").value ||
                            !features.api.q("mmoIssuePreferredName").value.trim(),
                    );
            };
            features.api.q("mmoIssuePanelBody").oninput = features.api.q("mmoIssuePanelBody").onchange;
            features.api.q("mmoIssuePanelBack").onclick = () => features.api.perform(() => features.navigation.showDestination("issues", true, true));
            features.api.q("mmoIssueEditorBack").onclick = () => features.api.perform(() => openIssuePanel(issueEditor!.issue, issueEditor!.guided));
            features.api.q("mmoIssueFullWorkspace").onclick = () => {
                if (issueEditor) issueEditor.full = true;
                for (const el of features.api.page.querySelectorAll<HTMLElement>("[data-issue-hidden]")) {
                    el.hidden = false;
                    delete el.dataset.issueHidden;
                }
                features.api.q("mmoIssueFullWorkspace").hidden = true;
            };
            features.api.q("mmoIssuePanelBody").onclick = (e) => {
                const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
                if (!b) return;
                features.api.perform(async (operation) => {
                    const state = issuePanelState,
                        { issue } = state!,
                        choice = b.dataset.issueChoice;
                    if (b.dataset.issueBinding) {
                        const i = features.api.doc.identityDrafts.concat(features.api.doc.identities).find((x) => x.id === b.dataset.issueBinding);
                        if (!i) throw Error("Binding no longer exists. Refresh Issues.");
                        await editIssueTarget("link", i);
                        return;
                    }
                    if (b.dataset.issuePolicy) {
                        const id = b.dataset.issuePolicy,
                            p = features.api.doc.policyDrafts.concat(features.api.doc.policies).find((x) => x.id === id),
                            r = features.api.doc.drafts.concat(features.api.doc.active).find((x) => x.id === id);
                        if (p)
                            await features.managerUi.managerOpen(
                                p.itemId || features.api.doc.identities.find((i) => i.id === p.identityId)?.artistId,
                                p,
                            );
                        else if (r) features.rules.edit(r);
                        else throw Error("Policy no longer exists. Refresh Issues.");
                        if (issuePanelState === state && features.navigation.ui.screen === "workspace")
                            focusIssueEditor(issue, state!.guided, "inspect");
                        return;
                    }
                    if (!choice) return;
                    if (choice === "link") return showArtistChoices();
                    if (choice === "choices") return openIssuePanel(issue, state!.guided);
                    if (choice === "use-identity") {
                        const id = features.api.q("mmoIssueIdentity").value,
                            identity = features.api.doc.identityDrafts.concat(features.api.doc.identities).find((i) => i.id === id);
                        if (!identity) throw Error("Choose an identity first.");
                        return editIssueTarget("link", identity);
                    }
                    if (choice === "use-records") {
                        const artistId = features.api.q("mmoIssueArtist").value,
                            personId = features.api.q("mmoIssuePerson").value,
                            name = features.api.q("mmoIssuePreferredName").value.trim(),
                            ev = issue.guidance.evidence!;
                        if (!artistId || !personId || !name) throw Error("Choose both representatives and a page name.");
                        return editIssueTarget("link", {
                            id: crypto.randomUUID().replaceAll("-", ""),
                            preferredName: name,
                            aliases: issueNameKey(name) === issueNameKey(issue.name) ? [] : [issue.name],
                            libraries: ev.library ? [ev.library] : [...new Set((ev.music || []).map((u) => u.library))],
                            artistId,
                            personId,
                            artistIds: [],
                            personIds: [],
                        });
                    }
                    if (["metadata", "inspect", "binding", "split", "rule"].includes(choice)) return editIssueTarget(choice);
                    if (choice === "cleanup")
                        return features.rules.preview({ cleanupIds: [issue.itemId!] }, null, { action: "cleanup", eligible: [issue], skipped: [] });
                    if (choice === "disable" || choice === "delete")
                        return features.rules.preview({ [choice === "disable" ? "disableIds" : "deleteIds"]: [issue.context.id] }, null, {
                            action: "repair",
                            eligible: [issue],
                            skipped: [],
                        });
                    if (choice === "archive") {
                        await features.api.api("manager/errors/acknowledge", "POST", { ids: [issue.context.id] });
                        features.issues.issueSelection.delete(issue.key);
                        await features.issues.managerIssues();
                        if (features.notifications.notifications.valid(operation)) await features.navigation.showDestination("issues");
                        features.notifications.notifications.scope(operation)("Report archived. No corrections were retried.");
                        return;
                    }
                    if (choice === "reapply") {
                        await features.api.api("apply", "POST", {});
                        beginIssueVerification({ action: "repair", eligible: [issue], skipped: [] }, {});
                        features.notifications.notifications.scope(operation)(
                            "Active corrections queued. The original report remains until explicitly archived.",
                        );
                        return;
                    }
                    if (choice === "recheck") {
                        await features.issues.managerIssues();
                        if (issuePanelState === state && features.navigation.ui.screen === "issue") {
                            const current = features.issues.issueItems.find((i) => i.key === issue.key);
                            if (current) await openIssuePanel(current, state!.guided);
                            else {
                                beginIssueVerification({ action: "check", eligible: [issue], skipped: [] }, {});
                                await features.navigation.showDestination("issues");
                            }
                        }
                        return;
                    }
                    if (choice === "missing") {
                        const examples = issue.guidance.evidence!.items || [],
                            id = examples[0]?.id;
                        features.api.q("mmoIssueDecision").hidden = false;
                        features.api.q("mmoIssueDecision").innerHTML =
                            "<h3>Find or discover the native artist first</h3><p>Inspect an affected release’s credits and provider settings. Use Jellyfin’s metadata controls to identify the correct artist or refresh discovery, then check again.</p>" +
                            features.nativeLinks.nativeLink(id, examples[0]?.name, false) +
                            '<p class="secondaryText">No record is created and no refresh runs automatically. Identity linking needs both MusicArtist and Person representatives.</p>' +
                            features.navigation.nativeButton("Check again", 'data-issue-choice="recheck"');
                        return;
                    }
                    if (choice === "skip") {
                        features.issues.repairQueue!.staged.delete(features.issues.repairQueue!.tasks[features.issues.repairQueue!.index]!.key);
                        features.issues.repairQueue!.index++;
                        return features.issues.openRepairTask();
                    }
                    if (choice === "return") return features.navigation.showDestination("issues");
                });
            };
            features.api.q("mmoIssueResults").onclick = (e) => {
                if ((e.target as HTMLElement).closest<HTMLElement>("[data-issue-result-check]"))
                    features.api.perform(() => {
                        if (issueVerification) issueVerification.started = Date.now();
                        return checkIssueResolution();
                    });
            };
            for (const event of ["pagehide", "viewhide", "viewbeforehide"]) features.api.page.addEventListener(event, stopIssueVerification);
            for (const event of ["pageshow", "viewshow"])
                features.api.page.addEventListener(event, () => {
                    if (issueVerification && features.navigation.ui.view === "issues") void checkIssueResolution();
                });
            window.addEventListener("hashchange", issueRouteChanged);
            issueDetached.observe(document.body, { childList: true, subtree: true });
        },
        get issuePanelState() {
            return issuePanelState;
        },
        set issuePanelState(value: typeof issuePanelState) {
            issuePanelState = value;
        },
        get issueEditor() {
            return issueEditor;
        },
        set issueEditor(value: typeof issueEditor) {
            issueEditor = value;
        },
        get issueVerification() {
            return issueVerification;
        },
        set issueVerification(value: typeof issueVerification) {
            issueVerification = value;
        },
        get issueCheckTimer() {
            return issueCheckTimer;
        },
        set issueCheckTimer(value: typeof issueCheckTimer) {
            issueCheckTimer = value;
        },
        get issueCheckSerial() {
            return issueCheckSerial;
        },
        set issueCheckSerial(value: typeof issueCheckSerial) {
            issueCheckSerial = value;
        },
        get issueTypeNames() {
            return issueTypeNames;
        },
        get issueNameKey() {
            return issueNameKey;
        },
        get issueChoice() {
            return issueChoice;
        },
        get issueExample() {
            return issueExample;
        },
        get dependencyEvidence() {
            return dependencyEvidence;
        },
        get openIssuePanel() {
            return openIssuePanel;
        },
        get resetIssueEditor() {
            return resetIssueEditor;
        },
        get focusIssueEditor() {
            return focusIssueEditor;
        },
        get applyIssueFieldFocus() {
            return applyIssueFieldFocus;
        },
        get editIssueTarget() {
            return editIssueTarget;
        },
        get showArtistChoices() {
            return showArtistChoices;
        },
        get stopIssueVerification() {
            return stopIssueVerification;
        },
        get beginIssueVerification() {
            return beginIssueVerification;
        },
        get renderIssueResults() {
            return renderIssueResults;
        },
        get checkIssueResolution() {
            return checkIssueResolution;
        },
        get issueRouteChanged() {
            return issueRouteChanged;
        },
        get issueDetached() {
            return issueDetached;
        },
    };
}
