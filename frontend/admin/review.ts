import type { ImageDecision, FieldDecision } from "./contracts.ts";
import type { MetadataPreview } from "./responses.ts";
import type { Change } from "./contracts.ts";
import { operationError } from "./errors.ts";
import type { Features } from "./features.ts";
export function createReview(features: Features) {
    // Reviews remain bound to the server-issued token and exact configuration revision.
    function diffBlock(field: string, before: unknown, after: unknown, annotation = "") {
        return (
            '<section class="mmo-field"><h4>' +
            features.api.esc(features.navigation.human(field)) +
            '</h4><div class="mmo-diff"><div><strong>Before</strong><p class="mmo-value">' +
            features.api.esc(features.navigation.formatValue(before)) +
            '</p></div><div><strong>After</strong><p class="mmo-value">' +
            features.api.esc(features.navigation.formatValue(after)) +
            "</p></div></div>" +
            (annotation ? '<p class="secondaryText">' + features.api.esc(annotation) + "</p>" : "") +
            "</section>"
        );
    }
    function reviewArtwork(images: Record<string, ImageDecision>, stored: Record<string, string[]> | undefined, itemId: string) {
        return Object.entries(images || {})
            .filter(([, d]) => d.mode !== "unmanaged")
            .map(
                ([type, d]) =>
                    '<section class="mmo-image-card"><h4>' +
                    features.api.esc(type) +
                    '</h4><div class="mmo-image-pair"><figure><figcaption>Current</figcaption>' +
                    (stored?.[type]?.length
                        ? '<img class="mmo-artwork" src="' +
                          features.api.esc(features.navigation.nativeImage(itemId, type)) +
                          '" alt="Current artwork" />'
                        : "<p>No image</p>") +
                    "</figure><figure><figcaption>After</figcaption>" +
                    (d.mode === "approved"
                        ? '<img class="mmo-artwork" data-pin-image="' + features.api.esc(d.hash) + '" alt="Reviewed artwork" />'
                        : "<p>Kept empty</p>") +
                    "</figure></div>" +
                    (d.hash ? "<details><summary>Validated image hash</summary><p>" + features.api.esc(d.hash) + "</p></details>" : "") +
                    "</section>",
            )
            .join("");
    }
    function requestedMetadataIds(change: Partial<Change>) {
        const policies = [
            ...(change.metadataEdits || []),
            ...features.api.doc.policyDrafts.filter((p) => (change.activatePolicies || []).includes(p.id)),
        ];
        return new Set(
            policies
                .flatMap((p) =>
                    p.identityId
                        ? features.api.doc.identities.filter((i) => i.id === p.identityId).flatMap((i) => [i.artistId, i.personId])
                        : [p.itemId],
                )
                .map((x) => x?.replaceAll("-", "")),
        );
    }
    function reviewFieldChanged(change: Partial<Change>, row: MetadataPreview, field: string) {
        const same = (a: string, b: string) => a?.replaceAll("-", "") === b?.replaceAll("-", "");
        const proposals = [
            ...(change.metadataEdits || []),
            ...features.api.doc.policyDrafts.filter((p) => (change.activatePolicies || []).includes(p.id)),
        ];
        const proposal = proposals.find((p) => (p.identityId ? p.identityId === row.identityId : same(p.itemId, row.id)));
        if (!proposal) return true;
        let original:
            | {
                  fields: Record<string, FieldDecision>;
              }
            | undefined = features.api.doc.policies.find((p) => p.id === proposal.id);
        if (
            !original &&
            features.managerUi.managerDetails &&
            (same(features.managerUi.managerDetails.id, row.id) || proposal.identityId === features.managerUi.managerDetails.policy.identityId)
        )
            original = features.managerUi.managerDetails.policy;
        if (!original) {
            const rule = features.api.doc.active.find((r) => r.id === row.policyId);
            if (rule) {
                const fields = { ...rule.fields.decisions };
                for (const key of features.rules.keys)
                    if (rule.fields[key] != null && !fields[key]) fields[key] = { mode: "approved", value: rule.fields[key] };
                original = { fields };
            }
        }
        const before = original?.fields[field] || { mode: "unmanaged" },
            after = proposal.fields[field] || { mode: "unmanaged" };
        return before.mode !== after.mode || JSON.stringify(before.value) !== JSON.stringify(after.value) || before.snapshotId !== after.snapshotId;
    }
    function reviewOperations(change: Partial<Change>) {
        const rows = [];
        for (const rule of change.edits || []) {
            const old = features.api.doc.active.find((r) => r.id === rule.id);
            rows.push(
                '<section class="mmo-field"><h3>Correction: ' +
                    features.api.esc(rule.label || rule.credit || rule.path) +
                    "</h3>" +
                    (old?.label !== rule.label ? diffBlock("Label", old?.label, rule.label) : "") +
                    "<p>" +
                    features.api.esc(
                        rule.kind === "alias"
                            ? "Credit mapping · " + rule.role
                            : rule.kind === "album"
                              ? "Album folder and track defaults"
                              : "Exact track correction",
                    ) +
                    "</p><details><summary>Reviewed rule definition</summary><pre>" +
                    features.api.esc(JSON.stringify(rule, null, 2)) +
                    "</pre></details></section>",
            );
        }
        for (const [key, list, type, operation] of [
            ["activateIds", features.api.doc.drafts, "correction", "Activate"],
            ["disableIds", features.api.doc.active, "correction", "Disable"],
            ["deleteIds", features.api.doc.active, "correction", "Delete"],
            ["activatePolicies", features.api.doc.policyDrafts, "metadata policy", "Activate"],
            ["disablePolicies", features.api.doc.policies, "metadata policy", "Stop managing"],
            ["deletePolicies", features.api.doc.policies, "metadata policy", "Delete"],
            ["disableIdentities", features.api.doc.identities, "identity", "Disable"],
            ["deleteIdentities", features.api.doc.identities, "identity", "Delete"],
        ] as [
            keyof Pick<
                Change,
                | "activateIds"
                | "disableIds"
                | "deleteIds"
                | "activatePolicies"
                | "disablePolicies"
                | "deletePolicies"
                | "disableIdentities"
                | "deleteIdentities"
            >,
            {
                id: string;
                preferredName?: string;
                label?: string;
                credit?: string;
                path?: string;
            }[],
            string,
            string,
        ][]) {
            for (const id of change[key] || []) {
                const entry = (list || []).find((x) => x.id === id);
                if (!entry) continue;
                rows.push(
                    '<section class="mmo-field"><h3>' +
                        features.api.esc(operation + " " + type + ": " + (entry.preferredName || entry.label || entry.credit || entry.path || id)) +
                        "</h3>" +
                        (type === "identity"
                            ? "<p>Remove the shared API view. Stored artist records, release credits, and deliberate favorite changes are retained.</p>"
                            : type === "metadata policy" && operation !== "Activate"
                              ? "<p>Current approved values are retained; future refreshes return to Jellyfin.</p>"
                              : "") +
                        "<details><summary>Current / proposed definition</summary><pre>" +
                        features.api.esc(JSON.stringify(entry, null, 2)) +
                        "</pre></details></section>",
                );
            }
        }
        return rows.join("");
    }
    function operationSummary(change: Partial<Change>) {
        return Object.entries(change)
            .filter(([, v]) => Array.isArray(v) && v.length)
            .map(
                ([k, v]) =>
                    (({
                        edits: "Correction edits",
                        metadataEdits: "Metadata edits",
                        identityEdits: "Identity edits",
                        activateIds: "Activate corrections",
                        disableIds: "Disable corrections",
                        deleteIds: "Delete corrections",
                        activateIdentities: "Activate identities",
                        disableIdentities: "Disable identities",
                        deleteIdentities: "Delete identities",
                        activatePolicies: "Activate metadata",
                        disablePolicies: "Disable metadata",
                        deletePolicies: "Delete metadata",
                        relinquish: "Stop managing / restore",
                        cleanupIds: "Orphan deletions",
                    })[k] || k) +
                    ": " +
                    v.length,
            )
            .join(" · ");
    }
    async function returnFromReview() {
        const message = features.notifications.notifications.scope();
        const origin = features.navigation.ui.reviewOrigin,
            applying = features.actions.actions.isPending("mmoActivate");
        features.api.reviewToken = null;
        features.actions.actions.setDisabled(features.api.q("mmoActivate"), true);
        features.api.reviewEpoch++;
        if (origin?.screen === "workspace" && origin.editor) {
            features.navigation.displayScreen("workspace");
            features.navigation.ui.editor = origin.editor;
            await features.managerUi.selectItemTab(origin.tab || "metadata");
            window.scrollTo(0, origin.scroll || 0);
            features.api.q("mmoWorkspaceTitle").focus({ preventScroll: true });
        } else if (origin?.screen === "issue" && features.issueGuidance.issuePanelState)
            await features.issueGuidance.openIssuePanel(features.issueGuidance.issuePanelState.issue, features.issueGuidance.issuePanelState.guided);
        else await features.navigation.showDestination(origin?.view || features.navigation.ui.view, false, true);
        message(
            applying
                ? "Review closed. Applying changes continues; its result will appear when ready."
                : "Review closed. No active changes were applied.",
        );
    }
    return {
        initialize() {
            features.rules.preview = async function (change, bulk = null, issues = null) {
                const message = features.notifications.notifications.scope();
                if (
                    !issues &&
                    features.issueGuidance.issueEditor &&
                    features.navigation.ui.editor &&
                    features.issueGuidance.issueEditor.key === features.navigation.ui.editor.key
                )
                    issues = { action: "repair", eligible: [features.issueGuidance.issueEditor.issue], skipped: [] };
                features.navigation.captureEditor();
                const epoch = ++features.api.reviewEpoch;
                features.api.reviewToken = null;
                features.actions.actions.setDisabled(features.api.q("mmoActivate"), true);
                message("Preparing review…", "loading");
                const origin = {
                    screen: features.navigation.ui.screen,
                    view: features.navigation.ui.view,
                    editor: features.navigation.ui.editor ? { ...features.navigation.ui.editor } : null,
                    tab: features.navigation.ui.itemTab,
                    scroll: window.scrollY,
                };
                const p = await features.api.api("preview", "POST", change);
                if (
                    origin.editor &&
                    features.navigation.ui.editor?.key === origin.editor.key &&
                    features.navigation.ui.editor.sequence !== origin.editor.sequence
                ) {
                    message("Edits changed while preparing review. Preview again to review the current edit.", "warning");
                    return;
                }
                if (epoch !== features.api.reviewEpoch) return;
                if (typeof p.revision === "number" && p.revision < features.api.doc.revision) {
                    message("Configuration changed while preparing review. Preview again before applying.", "warning");
                    return;
                }
                features.navigation.ui.previewRevision = p.revision;
                features.navigation.ui.reviewOrigin = origin;
                features.navigation.ui.previewChange = structuredClone(change);
                features.navigation.ui.bulkReview = bulk;
                features.bulk.renderBulkReview(bulk);
                features.navigation.ui.issueReview = issues;
                features.issues.renderIssueReview(issues);
                features.api.reviewToken = p.token;
                features.navigation.displayScreen("review");
                const warnings = [...(p.warnings || []), ...(p.unmatchedRules || []).map((x) => "Unmatched active correction: " + x)];
                const changedRows = p.items.filter((row) => (row.changedFields || []).length || (row.releasedFields || []).length);
                features.api.q("mmoPreviewSummary").textContent =
                    changedRows.length +
                    " music items with changed values or management. " +
                    (p.items.length - changedRows.length) +
                    " already match active corrections. " +
                    warnings.join(" ");
                const identityIds = new Set([
                    ...(change.identityEdits || []).map((i) => i.id),
                    ...(change.activateIdentities || []),
                    ...(change.metadataEdits || []).map((p) => p.identityId),
                ]);
                let html = (p.identities || [])
                    .filter((i) => identityIds.has(i.id))
                    .map(
                        (i) =>
                            '<section class="mmo-field"><h3>' +
                            features.api.esc(i.name) +
                            "</h3>" +
                            features.nativeLinks.nativeLink(i.bindings.find((b) => b.type === "MusicArtist")?.id, i.name, false) +
                            "<p>Aliases: " +
                            features.api.esc(i.aliases.join(", ")) +
                            "</p><p>Credits and scrobbling unchanged. " +
                            features.api.esc(i.favoritePolicy) +
                            "</p><p>Linked records: " +
                            i.bindings
                                .map(
                                    (x) => features.api.esc(x.name || "Missing binding") + features.nativeLinks.nativeLink(x.id, x.name || "binding"),
                                )
                                .join(", ") +
                            "</p><details><summary>Combined releases (" +
                            (i.affectedItems || []).length +
                            ")</summary>" +
                            (i.affectedItems || [])
                                .map((x) => "<p>" + features.api.esc(x.path) + features.nativeLinks.nativeLink(x.id, x.path) + "</p>")
                                .join("") +
                            "</details></section>",
                    )
                    .join("");
                html += changedRows
                    .map(
                        (row) =>
                            '<section class="mmo-field"><h3>' +
                            features.api.esc(row.path.split("/").at(-1)) +
                            "</h3>" +
                            features.nativeLinks.nativeLink(row.id, row.path, false) +
                            "<details><summary>Path</summary><p>" +
                            features.api.esc(row.path) +
                            "</p></details>" +
                            (row.locked ? '<p class="mmo-warning">Existing locks are preserved; managed fields override them.</p>' : "") +
                            Object.keys(row.after)
                                .filter(
                                    (k) => JSON.stringify(row.before[k]) !== JSON.stringify(row.after[k]) || (row.releasedFields || []).includes(k),
                                )
                                .map((k) =>
                                    diffBlock(k, row.before[k], row.after[k], row.releasedFields.includes(k) ? "Stop managing and refresh" : ""),
                                )
                                .join("") +
                            "</section>",
                    )
                    .join("");
                const ids = requestedMetadataIds(change);
                const selected = (p.metadata || []).filter(
                    (row) =>
                        ids.has(row.id?.replaceAll("-", "")) ||
                        (change.edits || []).some((r) => r.metadata?.id === row.policyId) ||
                        (change.activateIds || []).includes(row.policyId),
                );
                html += selected
                    .map(
                        (row) =>
                            '<section class="mmo-field"><h3>' +
                            features.api.esc(row.name) +
                            "</h3>" +
                            features.nativeLinks.nativeLink(row.id, row.name, false) +
                            (row.error ? '<p class="mmo-warning">' + features.api.esc(row.error) + "</p>" : "") +
                            (row.scrobblingRelevant
                                ? '<p class="mmo-warning">Title or artist-credit changes can affect future scrobbles. Review the release credits carefully.</p>'
                                : '<p class="secondaryText">This metadata operation leaves scrobbling credits unchanged.</p>') +
                            Object.entries(row.after || {})
                                .filter(
                                    ([field]) =>
                                        reviewFieldChanged(change, row, field) &&
                                        !changedRows.some((r) => r.id === row.id && (r.changedFields || []).includes(field)),
                                )
                                .map(([field, value]) =>
                                    diffBlock(field, row.before?.[field], value, "Approved management will be reasserted after refresh."),
                                )
                                .join("") +
                            reviewArtwork(row.images, row.storedImages, row.id) +
                            (row.locks?.length ? "<p>Native locks: " + features.api.esc(row.locks.join(", ")) + "</p>" : "") +
                            "</section>",
                    )
                    .join("");
                html += (p.restoration || [])
                    .map(
                        (row) =>
                            '<section class="mmo-field"><h3>' +
                            features.api.esc(row.name) +
                            " · " +
                            features.api.esc(row.operation) +
                            "</h3>" +
                            features.nativeLinks.nativeLink(row.id, row.name, false) +
                            "<p>" +
                            (row.operation === "stop managing"
                                ? "Current approved values are retained. Future refreshes return to Jellyfin."
                                : "Recorded original values will be restored; this differs from stopping management.") +
                            "</p>" +
                            (row.fields || Object.keys(row.after || {})).map((f) => diffBlock(f, row.before?.[f], row.after?.[f])).join("") +
                            "</section>",
                    )
                    .join("");
                html += (p.cleanup || [])
                    .map(
                        (row) =>
                            '<section class="mmo-field"><h3>Delete verified orphan: ' +
                            features.api.esc(row.name) +
                            "</h3>" +
                            features.nativeLinks.nativeLink(row.id, row.name, false) +
                            "<p>Dependencies: " +
                            row.dependencies.music.length +
                            " music uses · " +
                            row.dependencies.nonMusic.length +
                            " non-music uses · " +
                            row.dependencies.descendants +
                            " descendants · " +
                            row.dependencies.linkedReferences +
                            " linked references · " +
                            row.dependencies.userData +
                            " user-data entries · " +
                            row.dependencies.bindings.length +
                            " identity bindings · " +
                            row.dependencies.policies.length +
                            ' policies.</p><p class="mmo-warning">Internal metadata and artwork will be removed. Source files are retained. Recovery material will be saved, and dependencies are checked again before deletion.</p><details><summary>Internal files affected</summary>' +
                            row.files.map((f) => "<p>" + features.api.esc(typeof f === "string" ? f : JSON.stringify(f)) + "</p>").join("") +
                            "</details></section>",
                    )
                    .join("");
                html += reviewOperations(change);
                if (!html) html = "<p>Review the requested rule or identity operation below. No current media values differ.</p>";
                html +=
                    "<details><summary>Requested operations</summary><p>" +
                    features.api.esc(operationSummary(change)) +
                    "</p></details><details><summary>Diagnostic JSON</summary><pre>" +
                    features.api.esc(JSON.stringify(p, null, 2)) +
                    "</pre></details>";
                features.api.q("mmoPreview").innerHTML = html;
                features.actions.actions.setDisabled(
                    features.api.q("mmoActivate"),
                    selected.some((r) => r.error),
                );
                features.navigation.hydratePins(features.api.q("mmoPreview"));
                message("");
                window.scrollTo(0, 0);
                features.api.q("mmoReviewTitle").focus({ preventScroll: true });
            };
            features.api.q("mmoReviewBack").onclick = () => features.api.perform(returnFromReview);
            features.api.q("mmoReviewCancel").onclick = () => features.api.perform(returnFromReview);
            features.api.q("mmoActivate").onclick = () =>
                features.api.perform(async (operation) => {
                    const message = features.notifications.notifications.scope(operation);
                    if (!features.api.reviewToken) throw Error("Preview the current changes first.");
                    const token = features.api.reviewToken,
                        change = features.navigation.ui.previewChange,
                        origin = features.navigation.ui.reviewOrigin,
                        issueContext = features.navigation.ui.issueReview,
                        bulkContext = features.navigation.ui.bulkReview;
                    features.actions.actions.setDisabled(features.api.q("mmoActivate"), true);
                    message("Applying changes…", "loading");
                    let activationResult;
                    try {
                        activationResult = await features.api.api("activate", "POST", { token });
                    } catch (caughtError) {
                        const e = operationError(caughtError);
                        if (features.api.reviewToken === token) {
                            features.api.reviewToken = null;
                            features.actions.actions.setDisabled(features.api.q("mmoActivate"), true);
                        }
                        throw e;
                    }
                    if (features.api.reviewToken === token) {
                        features.api.reviewToken = null;
                        features.api.reviewEpoch++;
                        features.actions.actions.setDisabled(features.api.q("mmoActivate"), true);
                    }
                    const issueSummary = features.issues.completeIssueOperation(issueContext, activationResult);
                    if (features.navigation.ui.issueReview === issueContext) features.navigation.ui.issueReview = null;
                    features.bulk.completeBulk(bulkContext);
                    if (features.navigation.ui.bulkReview === bulkContext) features.navigation.ui.bulkReview = null;
                    // Clear only committed local edits, preserving unrelated unfinished work.
                    for (const [key, entry] of features.navigation.ui.locals) {
                        const committed =
                            (entry.type === "metadata" && (change!.metadataEdits || []).some((p) => p.id === entry.data.id)) ||
                            (entry.type === "rule" && (change!.edits || []).some((p) => p.id === entry.data.id)) ||
                            (entry.type === "identity" && (change!.identityEdits || []).some((p) => p.id === entry.data.id));
                        if (committed) {
                            const proposed =
                                entry.type === "metadata" ? change!.metadataEdits : entry.type === "rule" ? change!.edits : change!.identityEdits;
                            const reviewed = (proposed || []).find((p) => p.id === entry.data.id);
                            if (JSON.stringify(entry.data) === JSON.stringify(reviewed)) features.navigation.ui.locals.delete(key);
                            else entry.baselineChanged = true;
                        }
                    }
                    const batchIds = new Set((change!.metadataEdits || []).map((p) => p.id));
                    features.managerUi.managerBatch = features.managerUi.managerBatch.filter(
                        (p) => !batchIds.has(p.id) || !change!.metadataEdits!.some((reviewed) => JSON.stringify(reviewed) === JSON.stringify(p)),
                    );
                    await features.rules.load();
                    features.navigation.ui.issueLoaded = false;
                    if (!features.notifications.notifications.valid(operation)) {
                        message(
                            issueSummary || "Changes applied. Corrections are queued.",
                            issueContext?.action === "cleanup" &&
                                (!(activationResult.cleanupResults || []).length ||
                                    activationResult.cleanupResults.some((r) => r.outcome !== "deleted"))
                                ? "warning"
                                : "success",
                        );
                        return;
                    }
                    features.navigation.ui.editor = null;
                    await features.navigation.showDestination(origin?.view || "rules", false);
                    if (features.navigation.ui.view === "library") await features.managerUi.managerInventory();
                    message(
                        issueSummary || "Changes applied. Corrections are queued.",
                        issueContext?.action === "cleanup" &&
                            (!(activationResult.cleanupResults || []).length || activationResult.cleanupResults.some((r) => r.outcome !== "deleted"))
                            ? "warning"
                            : "success",
                    );
                });
        },
        get diffBlock() {
            return diffBlock;
        },
        get reviewArtwork() {
            return reviewArtwork;
        },
        get requestedMetadataIds() {
            return requestedMetadataIds;
        },
        get reviewFieldChanged() {
            return reviewFieldChanged;
        },
        get reviewOperations() {
            return reviewOperations;
        },
        get operationSummary() {
            return operationSummary;
        },
        get returnFromReview() {
            return returnFromReview;
        },
    };
}
