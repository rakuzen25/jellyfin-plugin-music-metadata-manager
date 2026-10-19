import type { ArtistIdentity, Rule, MetadataPolicy } from "./contracts.ts";
import { operationError } from "./errors.ts";
import type { Features } from "./features.ts";
export function createChanges(features: Features) {
    // One filtered management view, reusing the existing mutation handlers.
    function changeRow(name: string, type: string, live: boolean, pending: boolean, edit: string, actions: string, family: string, id: string) {
        const entry:
            | {
                  identityId?: string | null;
                  metadata?: MetadataPolicy | null;
                  artistId?: string;
                  itemId?: string;
                  id: string;
                  kind?: string;
                  path?: string;
              }
            | undefined =
            family === "identity"
                ? [...features.api.doc.identities, ...features.api.doc.identityDrafts].find((x) => x.id === id)
                : family === "policy"
                  ? [...features.api.doc.policies, ...features.api.doc.policyDrafts].find((x) => x.id === id)
                  : [...features.api.doc.active, ...features.api.doc.drafts].find((x) => x.id === id);
        const identity =
            family === "policy" && entry?.identityId
                ? [...features.api.doc.identities, ...features.api.doc.identityDrafts].find((x) => x.id === entry.identityId)
                : null;
        const native =
            family === "rule"
                ? entry?.metadata
                    ? features.nativeLinks.nativeLink(entry.metadata.itemId, name)
                    : features.nativeLinks.nativeRuleLink(entry)
                : features.nativeLinks.nativeLink(family === "identity" ? entry?.artistId : identity?.artistId || entry?.itemId, name);
        return features.table.tableRow({
            name,
            type:
                type === "mapping"
                    ? "Credit mapping"
                    : type === "identity"
                      ? "Artist identity"
                      : type === "metadata"
                        ? "Item metadata"
                        : "Correction",
            status: live ? "Active" + (pending ? " · pending changes" : "") : "Saved draft",
            attributes:
                'data-change-type="' +
                features.api.esc(type) +
                '" data-change-state="' +
                (pending ? "pending" : live ? "active" : "draft") +
                '" data-change-key="' +
                features.api.esc(family + ":" + id) +
                '"',
            selection: features.table.tableCheckbox(name, 'data-change-select="' + features.api.esc(family + ":" + id) + '"'),
            primary: edit,
            native,
            actions,
        });
    }
    function renderChanges() {
        if (!features.api.doc) return;
        features.rowMenu.closeRowMenu();
        features.api.q("mmoRules").innerHTML = features.api.doc.active
            .concat(features.api.doc.drafts.filter((d) => !features.api.doc.active.some((a) => a.id === d.id)))
            .map((r) => {
                const live = features.api.doc.active.some((a) => a.id === r.id),
                    pending = live && features.api.doc.drafts.some((d) => d.id === r.id);
                const type = r.metadata ? "metadata" : r.kind === "alias" ? "mapping" : "correction";
                const edit = features.rules.button(live ? "editActive" : "editDraft", r.id, "Edit");
                const actions =
                    (pending
                        ? features.rules.button("editDraft", r.id, "Resume pending changes") +
                          features.rules.button("deleteDraft", r.id, "Discard pending changes") +
                          features.rules.button("activate", r.id, "Review pending changes")
                        : "") +
                    (live
                        ? features.rules.button("disable", r.id, "Review disable") + features.rules.button("delete", r.id, "Review delete")
                        : features.rules.button("activate", r.id, "Review & apply") + features.rules.button("deleteDraft", r.id, "Delete draft"));
                return changeRow(r.label || r.path || r.credit, type, live, pending, edit, actions, "rule", r.id);
            })
            .join("");
        features.identities.renderIdentities();
        features.managerUi.renderMetadataDrafts();
        filterChanges();
    }
    let changeStart = 0;
    function filterChanges(reset = false) {
        if (reset) changeStart = 0;
        if (reset) {
            features.bulk.bulkSelection.clear();
            features.rules.invalidateReview();
        }
        const type = features.api.q("mmoChangeType").value,
            state = features.api.q("mmoChangeState").value;
        const rows = [...features.api.page.querySelectorAll<HTMLElement>("[data-change-type]")];
        const matches = rows.filter(
            (row) =>
                (!type || row.dataset.changeType === type) &&
                (!state || row.dataset.changeState === state || (state === "active" && row.dataset.changeState === "pending")),
        );
        if (changeStart >= matches.length)
            changeStart = Math.max(0, Math.floor((matches.length - 1) / features.table.tablePageSize) * features.table.tablePageSize);
        const visible = new Set(matches.slice(changeStart, changeStart + features.table.tablePageSize));
        rows.forEach((row) => (row.hidden = !visible.has(row)));
        features.api.q("mmoChangesEmpty").hidden = matches.length !== 0;
        features.table.tablePagination(changeStart, matches.length, {
            count: "mmoChangeCount",
            previous: "mmoChangePrev",
            next: "mmoChangeNext",
            noun: "rules",
        });
        features.bulk.bulkMatches = matches;
        features.bulk.renderBulkSelection();
    }
    // Preserve the mature form serializers, validation, and rule API behavior.
    const originalEdit = features.rules.edit;
    const originalEditIdentity = features.identities.editIdentity;
    // Editing folder defaults must retain extended field decisions, artwork, and bindings.
    const originalFormRule = features.rules.formRule;
    return {
        initialize() {
            features.identities.renderIdentities = function () {
                const active = features.api.doc.identities || [],
                    drafts = features.api.doc.identityDrafts || [];
                features.api.q("mmoIdentities").innerHTML = active
                    .concat(drafts.filter((d) => !active.some((a) => a.id === d.id)))
                    .map((i) => {
                        const live = active.some((a) => a.id === i.id),
                            pending = live && drafts.some((d) => d.id === i.id);
                        const edit = features.rules.button(live ? "identityEditActive" : "identityEditDraft", i.id, "Edit");
                        const actions =
                            (pending
                                ? features.rules.button("identityEditDraft", i.id, "Resume pending changes") +
                                  features.rules.button("identityDeleteDraft", i.id, "Discard pending changes")
                                : "") +
                            (live
                                ? features.rules.button("identityDisable", i.id, "Review disable") +
                                  features.rules.button("identityDelete", i.id, "Review delete")
                                : features.rules.button("identityActivate", i.id, "Review & apply") +
                                  features.rules.button("identityDeleteDraft", i.id, "Delete draft"));
                        return changeRow(i.preferredName, "identity", live, pending, edit, actions, "identity", i.id);
                    })
                    .join("");
            };
            features.rules.load = async function () {
                try {
                    features.api.doc = await features.api.api("rules");
                } catch (caughtError) {
                    const error = operationError(caughtError);
                    if (!features.api.doc) {
                        features.api.q("mmoManagerPolicies").innerHTML = features.table.tableMessage(
                            "Could not load rules. Use Refresh status in Tools to retry.",
                            true,
                        );
                        features.api.q("mmoChangeCount").textContent = "";
                    }
                    if (!features.api.doc) error.noticeHandled = true;
                    throw error;
                }
                if (
                    features.navigation.ui.screen === "review" &&
                    typeof features.navigation.ui.previewRevision === "number" &&
                    features.navigation.ui.previewRevision < features.api.doc.revision
                )
                    features.rules.invalidateReview();
                renderChanges();
                features.navigation.updateLocalCount();
                await features.rules.status();
            };
            features.rules.status = async function () {
                const s = await features.api.api("status");
                features.api.q("mmoStatus").textContent =
                    s.active +
                    " active corrections · " +
                    s.drafts +
                    " drafts · " +
                    s.managedItems +
                    " managed items · " +
                    s.pending +
                    " queued · " +
                    s.refreshPending +
                    " refreshes pending";
                features.managerUi.renderIssueStatus(s);
            };
            features.rules.edit = function (rule, nested = false) {
                features.navigation.captureEditor();
                const previous = features.navigation.ui.editor
                    ? { ...features.navigation.ui.editor, tab: features.navigation.ui.itemTab, scroll: window.scrollY }
                    : null;
                const id = rule?.id || crypto.randomUUID().replaceAll("-", "");
                const key = "rule:" + id;
                const local = features.navigation.ui.locals.get(key);
                rule = (local?.data as Rule | undefined) || rule;
                const displayRule = rule ? structuredClone(rule) : rule;
                if (displayRule)
                    for (const group of ["fields", "trackDefaults"] as const)
                        for (const [field, decision] of Object.entries(displayRule[group]?.decisions || {}))
                            if (features.rules.keys.some((key) => key === field) && decision.mode === "approved")
                                Object.assign(displayRule[group]!, { [field]: decision.value });
                originalEdit(displayRule);
                features.api.editingId = id;
                if (nested && previous) features.navigation.ui.stack.push(previous);
                features.navigation.openWorkspace(
                    "rule",
                    key,
                    rule?.label || rule?.credit || rule?.path || "New correction",
                    features.api.q("mmoEditorState").textContent,
                    null,
                );
                features.navigation.ui.editor!.dirty = !!local;
                features.navigation.ui.editor!.sequence = local?.sequence || 0;
                features.navigation.normalizeControls(features.api.q("mmoForm"));
                features.nativeLinks.updateWorkspaceNativeLinks();
            };
            features.identities.editIdentity = async function (identity, nested = false) {
                const message = features.notifications.notifications.scope();
                features.navigation.captureEditor();
                const previous = features.navigation.ui.editor
                    ? { ...features.navigation.ui.editor, tab: features.navigation.ui.itemTab, scroll: window.scrollY }
                    : null;
                const id = identity?.id || crypto.randomUUID().replaceAll("-", "");
                const key = "identity:" + id;
                const local = features.navigation.ui.locals.get(key);
                identity = (local?.data as ArtistIdentity | undefined) || identity;
                const serial = ++features.navigation.ui.request;
                await originalEditIdentity(identity);
                if (serial !== features.navigation.ui.request) return;
                features.api.identityEditingId = id;
                if (nested && previous) features.navigation.ui.stack.push(previous);
                features.navigation.openWorkspace(
                    "identity",
                    key,
                    identity?.preferredName || "New artist identity",
                    features.api.q("mmoIdentityEditorState").textContent,
                    identity?.artistId,
                );
                features.navigation.ui.editor!.dirty = !!local;
                features.navigation.ui.editor!.sequence = local?.sequence || 0;
                features.navigation.normalizeControls(features.api.q("mmoIdentityForm"));
                features.nativeLinks.updateWorkspaceNativeLinks();
                if (
                    (identity?.artistId && !features.api.identityRecords!.artists.some((r) => r.id === identity.artistId)) ||
                    (identity?.personId && !features.api.identityRecords!.persons.some((r) => r.id === identity.personId))
                )
                    message("A selected representative is missing. Choose an existing endpoint-compatible record before applying.", "warning");
            };
            features.api.q("mmoChangeType").onchange = () => filterChanges(true);
            features.api.q("mmoChangeState").onchange = () => filterChanges(true);
            features.api.q("mmoChangePrev").onclick = () => {
                changeStart = Math.max(0, changeStart - features.table.tablePageSize);
                filterChanges();
            };
            features.api.q("mmoChangeNext").onclick = () => {
                changeStart += features.table.tablePageSize;
                filterChanges();
            };
            features.api.q("mmoLocalEdits").onclick = (e) =>
                features.api.perform(async (operation) => {
                    features.notifications.notifications.scope(operation);
                    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
                    if (!b) return;
                    if (b.dataset.localResume) await features.navigation.resumeEntry(features.navigation.ui.locals.get(b.dataset.localResume)!);
                    if (b.dataset.localDiscard) {
                        features.navigation.ui.locals.delete(b.dataset.localDiscard);
                        features.navigation.updateLocalCount();
                    }
                });
            features.api.q("mmoBatchRows").onclick = (e) => {
                const id = (e.target as HTMLElement).closest<HTMLElement>("[data-batch-remove]")?.dataset.batchRemove;
                if (id) {
                    features.managerUi.managerBatch = features.managerUi.managerBatch.filter((p) => p.id !== id);
                    features.navigation.renderBatch();
                }
            };
            for (const [save, type] of [
                ["mmoSaveDraft", "rule"],
                ["mmoSaveIdentity", "identity"],
            ] as [string, string][]) {
                features.api.q(save).onclick = () =>
                    features.api.perform(() =>
                        features.navigation.saveLocalDraft(
                            type === "rule" ? "drafts" : "identities/drafts",
                            type === "rule" ? features.rules.formRule() : features.identities.identityForm(),
                            features.api.q(save),
                        ),
                    );
            }
            for (const id of ["mmoCancel", "mmoCancelIdentity"])
                features.api.q(id).onclick = () =>
                    features.api.perform(async (operation) => {
                        const message = features.notifications.notifications.scope(operation);
                        const saving = features.navigation.ui.pendingSaves.has(features.navigation.ui.editor?.key ?? "");
                        features.navigation.clearLocal();
                        features.navigation.ui.editor = null;
                        await features.navigation.workspaceBack();
                        message(
                            saving
                                ? "Local edit discarded. The pending save continues; active versions are unchanged."
                                : "Local edit discarded. Saved and active versions are unchanged.",
                        );
                    });
            features.rules.formRule = function () {
                const result = originalFormRule();
                const original =
                    (features.navigation.ui.locals.get("rule:" + result.id)?.data as Rule | undefined) ||
                    features.api.doc.drafts.find((r) => r.id === result.id) ||
                    features.api.doc.active.find((r) => r.id === result.id);
                if (!original) return result;
                if (original.metadata) result.metadata = structuredClone(original.metadata);
                for (const group of ["fields", "trackDefaults"] as const)
                    if (original[group]?.decisions) {
                        result[group].decisions = structuredClone(original[group].decisions);
                        for (const key of features.rules.keys)
                            if (key in result[group].decisions!) {
                                if (key in result[group])
                                    result[group].decisions![key] = {
                                        mode: "approved",
                                        value: result[group][key],
                                        provenance: "known",
                                    };
                                else delete result[group].decisions![key];
                            }
                    }
                return result;
            };
        },
        get changeRow() {
            return changeRow;
        },
        get renderChanges() {
            return renderChanges;
        },
        get changeStart() {
            return changeStart;
        },
        set changeStart(value: typeof changeStart) {
            changeStart = value;
        },
        get filterChanges() {
            return filterChanges;
        },
        get originalEdit() {
            return originalEdit;
        },
        get originalEditIdentity() {
            return originalEditIdentity;
        },
        get originalFormRule() {
            return originalFormRule;
        },
    };
}
