import type { ArtistIdentity, Rule, MetadataPolicy } from "./contracts.ts";
import { operationError } from "./errors.ts";
import type { ControllerContracts } from "./controllerContracts.ts";
import type { DashboardState } from "./dashboardState.ts";
export interface ChangesDependencies {
    nativeLinks: Pick<ControllerContracts["nativeLinks"], "nativeLink" | "nativeRuleLink" | "updateWorkspaceNativeLinks">;
    table: Pick<ControllerContracts["table"], "tableCheckbox" | "tableMessage" | "tablePageSize" | "tablePagination" | "tableRow">;
    api: Pick<ControllerContracts["api"], "api" | "esc" | "page" | "perform" | "q">;
    rowMenu: Pick<ControllerContracts["rowMenu"], "closeRowMenu">;
    rules: Pick<ControllerContracts["rules"], "button" | "edit" | "formRule" | "invalidateReview" | "keys" | "load" | "status">;
    identities: Pick<ControllerContracts["identities"], "editIdentity" | "identityForm" | "renderIdentities">;
    managerUi: Pick<ControllerContracts["managerUi"], "renderIssueStatus" | "renderMetadataDrafts">;
    bulk: Pick<ControllerContracts["bulk"], "renderBulkSelection">;
    navigation: Pick<
        ControllerContracts["navigation"],
        | "captureEditor"
        | "clearLocal"
        | "normalizeControls"
        | "openWorkspace"
        | "renderBatch"
        | "resumeEntry"
        | "saveLocalDraft"
        | "updateLocalCount"
        | "workspaceBack"
    >;
    notifications: Pick<ControllerContracts["notifications"], "notifications">;
}
export function createChanges(ports: ChangesDependencies, session: DashboardState) {
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
                ? [...session.api.doc.identities, ...session.api.doc.identityDrafts].find((x) => x.id === id)
                : family === "policy"
                  ? [...session.api.doc.policies, ...session.api.doc.policyDrafts].find((x) => x.id === id)
                  : [...session.api.doc.active, ...session.api.doc.drafts].find((x) => x.id === id);
        const identity =
            family === "policy" && entry?.identityId
                ? [...session.api.doc.identities, ...session.api.doc.identityDrafts].find((x) => x.id === entry.identityId)
                : null;
        const native =
            family === "rule"
                ? entry?.metadata
                    ? ports.nativeLinks.nativeLink(entry.metadata.itemId, name)
                    : ports.nativeLinks.nativeRuleLink(entry)
                : ports.nativeLinks.nativeLink(family === "identity" ? entry?.artistId : identity?.artistId || entry?.itemId, name);
        return ports.table.tableRow({
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
                ports.api.esc(type) +
                '" data-change-state="' +
                (pending ? "pending" : live ? "active" : "draft") +
                '" data-change-key="' +
                ports.api.esc(family + ":" + id) +
                '"',
            selection: ports.table.tableCheckbox(name, 'data-change-select="' + ports.api.esc(family + ":" + id) + '"'),
            primary: edit,
            native,
            actions,
        });
    }
    function renderChanges() {
        if (!session.api.doc) return;
        ports.rowMenu.closeRowMenu();
        ports.api.q("mmoRules").innerHTML = session.api.doc.active
            .concat(session.api.doc.drafts.filter((d) => !session.api.doc.active.some((a) => a.id === d.id)))
            .map((r) => {
                const live = session.api.doc.active.some((a) => a.id === r.id),
                    pending = live && session.api.doc.drafts.some((d) => d.id === r.id);
                const type = r.metadata ? "metadata" : r.kind === "alias" ? "mapping" : "correction";
                const edit = ports.rules.button(live ? "editActive" : "editDraft", r.id, "Edit");
                const actions =
                    (pending
                        ? ports.rules.button("editDraft", r.id, "Resume pending changes") +
                          ports.rules.button("deleteDraft", r.id, "Discard pending changes") +
                          ports.rules.button("activate", r.id, "Review pending changes")
                        : "") +
                    (live
                        ? ports.rules.button("disable", r.id, "Review disable") + ports.rules.button("delete", r.id, "Review delete")
                        : ports.rules.button("activate", r.id, "Review & apply") + ports.rules.button("deleteDraft", r.id, "Delete draft"));
                return changeRow(r.label || r.path || r.credit, type, live, pending, edit, actions, "rule", r.id);
            })
            .join("");
        ports.identities.renderIdentities();
        ports.managerUi.renderMetadataDrafts();
        filterChanges();
    }

    function filterChanges(reset = false) {
        if (reset) session.changes.changeStart = 0;
        if (reset) {
            session.bulk.bulkSelection.clear();
            ports.rules.invalidateReview();
        }
        const type = ports.api.q("mmoChangeType").value,
            state = ports.api.q("mmoChangeState").value;
        const rows = [...ports.api.page.querySelectorAll<HTMLElement>("[data-change-type]")];
        const matches = rows.filter(
            (row) =>
                (!type || row.dataset.changeType === type) &&
                (!state || row.dataset.changeState === state || (state === "active" && row.dataset.changeState === "pending")),
        );
        if (session.changes.changeStart >= matches.length)
            session.changes.changeStart = Math.max(0, Math.floor((matches.length - 1) / ports.table.tablePageSize) * ports.table.tablePageSize);
        const visible = new Set(matches.slice(session.changes.changeStart, session.changes.changeStart + ports.table.tablePageSize));
        rows.forEach((row) => (row.hidden = !visible.has(row)));
        ports.api.q("mmoChangesEmpty").hidden = matches.length !== 0;
        ports.table.tablePagination(session.changes.changeStart, matches.length, {
            count: "mmoChangeCount",
            previous: "mmoChangePrev",
            next: "mmoChangeNext",
            noun: "rules",
        });
        session.bulk.bulkMatches = matches;
        ports.bulk.renderBulkSelection();
    }
    // Preserve the mature form serializers, validation, and rule API behavior.
    const originalEdit = ports.rules.edit;
    const originalEditIdentity = ports.identities.editIdentity;
    // Editing folder defaults must retain extended field decisions, artwork, and bindings.
    const originalFormRule = ports.rules.formRule;
    return {
        initialize() {
            ports.identities.renderIdentities = function () {
                const active = session.api.doc.identities,
                    drafts = session.api.doc.identityDrafts;
                ports.api.q("mmoIdentities").innerHTML = active
                    .concat(drafts.filter((d) => !active.some((a) => a.id === d.id)))
                    .map((i) => {
                        const live = active.some((a) => a.id === i.id),
                            pending = live && drafts.some((d) => d.id === i.id);
                        const edit = ports.rules.button(live ? "identityEditActive" : "identityEditDraft", i.id, "Edit");
                        const actions =
                            (pending
                                ? ports.rules.button("identityEditDraft", i.id, "Resume pending changes") +
                                  ports.rules.button("identityDeleteDraft", i.id, "Discard pending changes")
                                : "") +
                            (live
                                ? ports.rules.button("identityDisable", i.id, "Review disable") +
                                  ports.rules.button("identityDelete", i.id, "Review delete")
                                : ports.rules.button("identityActivate", i.id, "Review & apply") +
                                  ports.rules.button("identityDeleteDraft", i.id, "Delete draft"));
                        return changeRow(i.preferredName, "identity", live, pending, edit, actions, "identity", i.id);
                    })
                    .join("");
            };
            ports.rules.load = async function () {
                try {
                    session.api.doc = await ports.api.api("rules");
                } catch (caughtError) {
                    const error = operationError(caughtError);
                    if (!session.api.doc) {
                        ports.api.q("mmoManagerPolicies").innerHTML = ports.table.tableMessage(
                            "Could not load rules. Use Refresh status in Tools to retry.",
                            true,
                        );
                        ports.api.q("mmoChangeCount").textContent = "";
                    }
                    if (!session.api.doc) error.noticeHandled = true;
                    throw error;
                }
                if (
                    session.navigation.ui.screen === "review" &&
                    typeof session.navigation.ui.previewRevision === "number" &&
                    session.navigation.ui.previewRevision < session.api.doc.revision
                )
                    ports.rules.invalidateReview();
                renderChanges();
                ports.navigation.updateLocalCount();
                await ports.rules.status();
            };
            ports.rules.status = async function () {
                const s = await ports.api.api("status");
                ports.api.q("mmoStatus").textContent =
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
                ports.managerUi.renderIssueStatus(s);
            };
            ports.rules.edit = function (rule, nested = false) {
                ports.navigation.captureEditor();
                const previous = session.navigation.ui.editor
                    ? { ...session.navigation.ui.editor, tab: session.navigation.ui.itemTab, scroll: window.scrollY }
                    : null;
                const id = rule?.id || crypto.randomUUID().replaceAll("-", "");
                const key = "rule:" + id;
                const local = session.navigation.ui.locals.get(key);
                rule = (local?.data as Rule | undefined) || rule;
                const displayRule = rule ? structuredClone(rule) : rule;
                originalEdit(displayRule);
                session.api.editingId = id;
                if (nested && previous) session.navigation.ui.stack.push(previous);
                ports.navigation.openWorkspace(
                    "rule",
                    key,
                    rule?.label || rule?.credit || rule?.path || "New correction",
                    ports.api.q("mmoEditorState").textContent,
                    null,
                );
                session.navigation.ui.editor!.dirty = !!local;
                session.navigation.ui.editor!.sequence = local?.sequence || 0;
                ports.navigation.normalizeControls(ports.api.q("mmoForm"));
                ports.nativeLinks.updateWorkspaceNativeLinks();
            };
            ports.identities.editIdentity = async function (identity, nested = false) {
                const message = ports.notifications.notifications.scope();
                ports.navigation.captureEditor();
                const previous = session.navigation.ui.editor
                    ? { ...session.navigation.ui.editor, tab: session.navigation.ui.itemTab, scroll: window.scrollY }
                    : null;
                const id = identity?.id || crypto.randomUUID().replaceAll("-", "");
                const key = "identity:" + id;
                const local = session.navigation.ui.locals.get(key);
                identity = (local?.data as ArtistIdentity | undefined) || identity;
                const serial = ++session.navigation.ui.request;
                await originalEditIdentity(identity);
                if (serial !== session.navigation.ui.request) return;
                session.api.identityEditingId = id;
                if (nested && previous) session.navigation.ui.stack.push(previous);
                ports.navigation.openWorkspace(
                    "identity",
                    key,
                    identity?.preferredName || "New artist identity",
                    ports.api.q("mmoIdentityEditorState").textContent,
                    identity?.artistId,
                );
                session.navigation.ui.editor!.dirty = !!local;
                session.navigation.ui.editor!.sequence = local?.sequence || 0;
                ports.navigation.normalizeControls(ports.api.q("mmoIdentityForm"));
                ports.nativeLinks.updateWorkspaceNativeLinks();
                if (
                    (identity?.artistId && !session.api.identityRecords!.artists.some((r) => r.id === identity.artistId)) ||
                    (identity?.personId && !session.api.identityRecords!.persons.some((r) => r.id === identity.personId))
                )
                    message("A selected representative is missing. Choose an existing endpoint-compatible record before applying.", "warning");
            };
            ports.api.q("mmoChangeType").onchange = () => filterChanges(true);
            ports.api.q("mmoChangeState").onchange = () => filterChanges(true);
            ports.api.q("mmoChangePrev").onclick = () => {
                session.changes.changeStart = Math.max(0, session.changes.changeStart - ports.table.tablePageSize);
                filterChanges();
            };
            ports.api.q("mmoChangeNext").onclick = () => {
                session.changes.changeStart += ports.table.tablePageSize;
                filterChanges();
            };
            ports.api.q("mmoLocalEdits").onclick = (e) =>
                ports.api.perform(async (operation) => {
                    ports.notifications.notifications.scope(operation);
                    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
                    if (!b) return;
                    if (b.dataset.localResume) await ports.navigation.resumeEntry(session.navigation.ui.locals.get(b.dataset.localResume)!);
                    if (b.dataset.localDiscard) {
                        session.navigation.ui.locals.delete(b.dataset.localDiscard);
                        ports.navigation.updateLocalCount();
                    }
                });
            ports.api.q("mmoBatchRows").onclick = (e) => {
                const id = (e.target as HTMLElement).closest<HTMLElement>("[data-batch-remove]")?.dataset.batchRemove;
                if (id) {
                    session.managerUi.managerBatch = session.managerUi.managerBatch.filter((p) => p.id !== id);
                    ports.navigation.renderBatch();
                }
            };
            for (const [save, type] of [
                ["mmoSaveDraft", "rule"],
                ["mmoSaveIdentity", "identity"],
            ] as [string, string][]) {
                ports.api.q(save).onclick = () =>
                    ports.api.perform(() =>
                        ports.navigation.saveLocalDraft(
                            type === "rule" ? "drafts" : "identities/drafts",
                            type === "rule" ? ports.rules.formRule() : ports.identities.identityForm(),
                            ports.api.q(save),
                        ),
                    );
            }
            for (const id of ["mmoCancel", "mmoCancelIdentity"])
                ports.api.q(id).onclick = () =>
                    ports.api.perform(async (operation) => {
                        const message = ports.notifications.notifications.scope(operation);
                        const saving = session.navigation.ui.pendingSaves.has(session.navigation.ui.editor?.key ?? "");
                        ports.navigation.clearLocal();
                        session.navigation.ui.editor = null;
                        await ports.navigation.workspaceBack();
                        message(
                            saving
                                ? "Local edit discarded. The pending save continues; active versions are unchanged."
                                : "Local edit discarded. Saved and active versions are unchanged.",
                        );
                    });
            ports.rules.formRule = function () {
                const result = originalFormRule();
                const original =
                    (session.navigation.ui.locals.get("rule:" + result.id)?.data as Rule | undefined) ||
                    session.api.doc.drafts.find((r) => r.id === result.id) ||
                    session.api.doc.active.find((r) => r.id === result.id);
                if (!original) return result;
                if (original.metadata) result.metadata = structuredClone(original.metadata);
                for (const group of ["fields", "trackDefaults"] as const) {
                    const edited = result[group].decisions || {};
                    const retained = structuredClone(original[group]?.decisions || {});
                    for (const key of ports.rules.keys) delete retained[key];
                    result[group].decisions = { ...retained, ...edited };
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
