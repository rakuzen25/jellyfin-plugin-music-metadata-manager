import { createInventoryView } from "./inventoryView.ts";
import { createMetadataFields } from "./metadataFields.ts";
import { createArtworkView } from "./artworkView.ts";
import { createSourceComparison } from "./sourceComparison.ts";
import { operationError } from "./errors.ts";
import type { Status } from "./responses.ts";
import type { MetadataPolicy } from "./contracts.ts";
import type { ControllerContracts } from "./controllerContracts.ts";
import type { DashboardState } from "./dashboardState.ts";
export interface ManagerUiDependencies {
    navigation: Pick<
        ControllerContracts["navigation"],
        | "captureEditor"
        | "clearLocal"
        | "formatValue"
        | "human"
        | "hydratePins"
        | "markDirty"
        | "nativeButton"
        | "nativeImage"
        | "normalizeControls"
        | "openWorkspace"
        | "renderBatch"
        | "saveLocalDraft"
        | "syncBatchButton"
        | "workspaceBack"
    >;
    api: Pick<ControllerContracts["api"], "api" | "esc" | "perform" | "q">;
    rowMenu: Pick<ControllerContracts["rowMenu"], "closeRowMenu">;
    table: Pick<ControllerContracts["table"], "libraryTableColumns" | "tableMessage" | "tablePageSize" | "tablePagination" | "tableRow">;
    nativeLinks: Pick<ControllerContracts["nativeLinks"], "nativeLink">;
    notifications: Pick<ControllerContracts["notifications"], "notifications">;
    rules: Pick<ControllerContracts["rules"], "edit" | "invalidateReview" | "load" | "preview">;
    issueGuidance: Pick<ControllerContracts["issueGuidance"], "applyIssueFieldFocus">;
    changes: Pick<ControllerContracts["changes"], "changeRow">;
    identities: Pick<ControllerContracts["identities"], "editIdentity">;
    issues: Pick<ControllerContracts["issues"], "refreshIssues">;
}
export function createManagerUi(ports: ManagerUiDependencies, session: DashboardState) {
    const { managerInventory, loadAlbumTracks } = createInventoryView(ports, session);
    const {
        fieldRow,
        renderManagerFields,
        setFieldState,
        readManagerFields,
        managerFields,
        arrayFields,
        numberFields,
        advancedFields,
        requiredFields,
    } = createMetadataFields(ports, session);
    const { renderManagerImages } = createArtworkView(ports, session);
    const { managerSourceChanged, renderComparison } = createSourceComparison(ports, session);

    // Item inventory and metadata editor. Policies remain visit-local until Save or Apply.

    // Opening an item initializes these before any editor controls are rendered.

    function managerDisplay(v: unknown) {
        return ports.navigation.formatValue(v);
    }

    async function managerOpen(id: string | null | undefined, draft?: MetadataPolicy | null, nested = false) {
        const message = ports.notifications.notifications.scope();
        ports.navigation.captureEditor();
        const previous = session.navigation.ui.editor
            ? { ...session.navigation.ui.editor, tab: session.navigation.ui.itemTab, scroll: window.scrollY }
            : null;
        const serial = ++session.navigation.ui.request;
        message("Loading item…", "loading");
        const details = await ports.api.api(`manager/items/${id}`);
        if (serial !== session.navigation.ui.request) return;
        ports.rules.invalidateReview();
        const identity = session.api.doc.identities.find((i) => i.id === details.policy.identityId);
        const linkedOnly = !!identity && ![identity.artistId, identity.personId].includes(details.id);
        const key = linkedOnly ? "inspect:" + details.id : "metadata:" + (details.policy.identityId || details.id);
        const local = session.navigation.ui.locals.get(key);
        session.managerUi.managerDetails = details;
        session.managerUi.managerDetails.linkedOnly = linkedOnly;
        session.managerUi.managerPolicy = structuredClone((local?.data as MetadataPolicy | undefined) || draft || details.policy);
        session.managerUi.managerComparison = local?.comparison || null;
        if (nested && previous) session.navigation.ui.stack.push(previous);
        ports.navigation.openWorkspace(
            "metadata",
            key,
            details.policy.identityId
                ? session.api.doc.identities.find((x) => x.id === details.policy.identityId)?.preferredName || details.name
                : details.name,
            details.policy.fields && Object.keys(details.policy.fields).length
                ? "Managed metadata · only approved fields are reasserted on refresh"
                : "Jellyfin metadata · edits are local until applied",
            details.id,
        );
        ports.api.q("mmoManagerTitle").textContent = details.name + " · " + details.kind;
        ports.api.q("mmoManagerDependencies").textContent =
            details.dependencies.classification +
            " · " +
            details.dependencies.music.length +
            " music uses · " +
            details.dependencies.nonMusic.length +
            " non-music uses. " +
            details.refreshBehavior;
        ports.api.q("mmoManagerLibraries").innerHTML = ports.api.q("mmoLibraries").innerHTML;
        for (const o of ports.api.q("mmoManagerLibraries").options) o.selected = session.managerUi.managerPolicy.libraries.includes(o.value);
        ports.api.q("mmoManagerReadOnly").hidden = details.dependencies.canEdit && !session.managerUi.managerDetails.linkedOnly;
        ports.api.q("mmoManagerReadOnly").textContent = session.managerUi.managerDetails.linkedOnly
            ? "This record is an alias link. Open a selected representative in Identity to edit shared artist metadata. The alias points to the selected representative."
            : "This record is shared outside the selected music scope and is read-only. Cover all music uses; non-music references prevent editing.";
        ports.api.q("mmoManagerSourceProvider").innerHTML = details.providers
            .map(
                (p) =>
                    '<option value="' +
                    ports.api.esc(p.name) +
                    '" data-key="' +
                    ports.api.esc(p.key || "") +
                    '">' +
                    ports.api.esc(p.name) +
                    "</option>",
            )
            .join("");
        ports.api.q("mmoManagerCompare").disabled = !details.providers.length;
        managerSourceChanged();
        if (session.managerUi.managerComparison) {
            const binding = session.managerUi.managerComparison.snapshot.binding;
            ports.api.q("mmoManagerSourceProvider").value = binding.provider;
            ports.api.q("mmoManagerSourceKey").value = binding.key;
            ports.api.q("mmoManagerSourceId").value = binding.recordId;
            ports.api.q("mmoManagerSourceConfirm").checked = true;
        }
        renderManagerFields();
        renderManagerImages();
        renderComparison();
        renderArtistLinks();
        ports.api.q("mmoManagerHistory").innerHTML =
            details.history
                .slice()
                .reverse()
                .map(
                    (h) =>
                        "<p>" +
                        ports.api.esc(new Date(h.time).toLocaleString()) +
                        " · " +
                        ports.api.esc(h.operation) +
                        ports.nativeLinks.nativeLink(h.itemId, details.name) +
                        " · " +
                        ports.api.esc(h.fields.map(ports.navigation.human).join(", ")) +
                        "</p>",
                )
                .join("") || "<p>No recorded applications.</p>";
        ports.api.q("mmoDependencyDetails").innerHTML =
            details.dependencies.music
                .map(
                    (u) =>
                        "<p>" +
                        ports.navigation.nativeButton(u.name + " · " + u.roles.join(", "), 'data-dependency-item="' + ports.api.esc(u.id) + '"') +
                        ports.nativeLinks.nativeLink(u.id, u.name) +
                        "</p>",
                )
                .join("") || "<p>No music references.</p>";
        const tabs = [
            ["metadata", "Metadata"],
            ...(details.providers.length ? [["sources", "Sources"]] : []),
            ["artwork", "Artwork"],
            ...(details.kind === "MusicAlbum" ? [["tracks", "Tracks"]] : []),
            ...(["MusicArtist", "Person"].includes(details.kind) ? [["identity", "Identity"]] : []),
        ];
        ports.api.q("mmoWorkspaceTabs").innerHTML = tabs
            .map(([tab, label]) =>
                ports.navigation.nativeButton(
                    label,
                    'data-item-tab="' + tab + '" aria-selected="false" role="tab" id="mmoTab_' + tab + '" aria-controls="mmoPanel_' + tab + '"',
                ),
            )
            .join("");
        if (local?.raw)
            for (const r of local.raw) {
                const row = ports.api.q("mmoManagerFields").querySelector<HTMLElement>('[data-field="' + r.field + '"]');
                if (row) {
                    row.querySelector<HTMLInputElement>("[data-value]")!.value = r.value;
                    row.querySelector<HTMLSelectElement>("[data-mode]")!.value = r.mode;
                    setFieldState(row!);
                }
            }
        session.navigation.ui.editor!.dirty = !!local;
        session.navigation.ui.editor!.sequence = local?.sequence || 0;
        if (local) ports.api.q("mmoWorkspaceState").textContent = "Unfinished local edit · save a draft to keep it after reloading";
        else if (draft && (session.api.doc.policyDrafts.some((p) => p.id === draft.id) || session.api.doc.drafts.some((r) => r.id === draft.id)))
            ports.api.q("mmoWorkspaceState").textContent = "Saved draft · the active version remains unchanged";
        setEditorWritable();
        await selectItemTab(local?.tab || "metadata");
        message("");
    }

    async function selectItemTab(tab: string) {
        if (tab !== session.navigation.ui.itemTab) ports.notifications.notifications.clear();
        if (!ports.api.q("mmoWorkspaceTabs").querySelector<HTMLElement>('[data-item-tab="' + tab + '"]')) tab = "metadata";
        session.navigation.ui.itemTab = tab;
        ports.api
            .q("mmoWorkspaceTabs")
            .querySelectorAll<HTMLElement>("[data-item-tab]")
            .forEach((b) => (b.setAttribute("aria-selected", String(b.dataset.itemTab === tab)), (b.tabIndex = b.dataset.itemTab === tab ? 0 : -1)));
        ports.api
            .q("mmoManagerEditor")
            .querySelectorAll<HTMLElement>("[data-item-panel]")
            .forEach((el) => (el.hidden = el.dataset.itemPanel !== tab));
        if (tab === "tracks") await loadAlbumTracks();
        if (tab === "artwork") ports.navigation.hydratePins(ports.api.q("mmoManagerImages"));
    }

    function renderArtistLinks() {
        const identity = session.api.doc.identities.find(
            (i) =>
                i.id === session.managerUi.managerPolicy.identityId ||
                i.artistId === session.managerUi.managerDetails.id ||
                i.personId === session.managerUi.managerDetails.id ||
                (i.artistIds || []).includes(session.managerUi.managerDetails.id) ||
                (i.personIds || []).includes(session.managerUi.managerDetails.id),
        );
        ports.api.q("mmoEditLinkedIdentity").textContent = identity ? "Edit aliases and bindings" : "Create an identity for this artist";
        ports.api.q("mmoEditLinkedIdentity").dataset.identity = identity?.id || "";
        ports.api.q("mmoArtistLinks").innerHTML = identity
            ? "<p>Canonical artist: <strong>" +
              ports.api.esc(identity.preferredName) +
              "</strong></p><p>Recognized aliases: " +
              ports.api.esc(identity.aliases.join(", ")) +
              "</p><p>Track and album credits retain their original labels. Credit mappings are separate corrections.</p><details><summary>Native bindings</summary><p>" +
              ports.navigation.nativeButton("MusicArtist representative", 'data-linked-record="' + ports.api.esc(identity.artistId) + '"') +
              ports.nativeLinks.nativeLink(identity.artistId, "MusicArtist representative") +
              "</p><p>" +
              ports.navigation.nativeButton("Person representative", 'data-linked-record="' + ports.api.esc(identity.personId) + '"') +
              ports.nativeLinks.nativeLink(identity.personId, "Person representative") +
              "</p>" +
              [...(identity.artistIds || []), ...(identity.personIds || [])]
                  .map(
                      (id) =>
                          "<p>" +
                          ports.navigation.nativeButton(id, 'data-linked-record="' + ports.api.esc(id) + '"') +
                          ports.nativeLinks.nativeLink(id, "linked artist record") +
                          "</p>",
                  )
                  .join("") +
              "</details>"
            : "<p>This native artist record has no approved canonical identity. Its metadata can be managed independently.</p>";
    }
    function renderIssueStatus(s: Status) {
        ports.api.q("mmoIssueStatus").innerHTML =
            (s.reports.length
                ? s.reports.map((r) => "<p>" + ports.api.esc(r.message) + ports.nativeLinks.nativeLink(r.itemId, "reported item") + "</p>").join("")
                : "") +
                s.unmatchedRules
                    .map((x) => "Unmatched correction: " + x)
                    .map((x) => "<p>" + ports.api.esc(x) + "</p>")
                    .join("") || "<p>No application failures or unmatched rules reported.</p>";
    }
    function renderMetadataDrafts() {
        const active = session.api.doc.policies,
            drafts = session.api.doc.policyDrafts;
        ports.api.q("mmoManagerPolicies").innerHTML = active
            .concat(drafts.filter((d) => !active.some((p) => p.id === d.id)))
            .map((p) => {
                const live = active.some((x) => x.id === p.id),
                    pending = live && drafts.some((x) => x.id === p.id);
                const edit = ports.navigation.nativeButton("Edit", 'data-policy-edit="' + p.id + '"');
                const actions =
                    (pending ? ports.navigation.nativeButton("Resume pending changes", 'data-policy-resume="' + p.id + '"') : "") +
                    (live
                        ? ports.navigation.nativeButton("Review disable", 'data-policy-disable="' + p.id + '"') +
                          ports.navigation.nativeButton("Review delete", 'data-policy-delete-active="' + p.id + '"')
                        : ports.navigation.nativeButton("Review & apply", 'data-policy-preview="' + p.id + '"')) +
                    (drafts.some((d) => d.id === p.id)
                        ? ports.navigation.nativeButton(live ? "Discard pending changes" : "Delete draft", 'data-policy-delete="' + p.id + '"')
                        : "");
                return ports.changes.changeRow(p.label || p.identityId || p.itemId, "metadata", live, pending, edit, actions, "policy", p.id);
            })
            .join("");
    }
    function setEditorWritable() {
        const writable = session.managerUi.managerDetails.dependencies.canEdit && !session.managerUi.managerDetails.linkedOnly;
        for (const id of [
            "mmoManagerPreview",
            "mmoManagerSave",
            "mmoManagerUploadCache",
            "mmoManagerBatchAdd",
            "mmoManagerStop",
            "mmoManagerRestore",
        ])
            ports.api.q<HTMLButtonElement>(id).disabled =
                !writable || (id === "mmoManagerSave" && session.navigation.ui.pendingSaves.has(session.navigation.ui.editor?.key ?? ""));
        ports.navigation.syncBatchButton();
        ports.api.q("mmoManagerLibraries").disabled =
            !!session.managerUi.managerDetails.linkedOnly || session.managerUi.managerDetails.dependencies.nonMusic.length > 0;
        for (const row of ports.api.q("mmoManagerFields").querySelectorAll<HTMLElement>("[data-field]")) {
            setFieldState(row!);
            if (!writable) {
                row.querySelector<HTMLInputElement>("[data-value]")!.disabled = true;
                row.querySelectorAll<HTMLButtonElement>("[data-field-action]").forEach((button) => (button.disabled = true));
            }
        }
        ports.api
            .q("mmoManagerImages")
            .querySelectorAll<HTMLButtonElement>("button")
            .forEach((button) => (button.disabled = !writable));
        ports.api
            .q("mmoManagerSourceResult")
            .querySelectorAll<HTMLButtonElement>("button")
            .forEach((button) => (button.disabled = !writable));
    }
    return {
        initialize() {
            ports.api.q("mmoInventoryForm").onsubmit = (e) => {
                e.preventDefault();
                session.managerUi.managerStart = 0;
                ports.api.perform(managerInventory);
            };
            ports.api.q("mmoInventoryFind").onclick = null;
            ports.api.q("mmoInventoryPrev").onclick = () =>
                ports.api.perform(async (operation) => {
                    ports.notifications.notifications.scope(operation);
                    session.managerUi.managerStart = Math.max(0, session.managerUi.managerStart - ports.table.tablePageSize);
                    await managerInventory();
                });
            ports.api.q("mmoInventoryNext").onclick = () =>
                ports.api.perform(async (operation) => {
                    ports.notifications.notifications.scope(operation);
                    session.managerUi.managerStart += ports.table.tablePageSize;
                    await managerInventory();
                });
            for (const id of ["mmoInventoryLibrary", "mmoInventoryKind", "mmoInventoryView"])
                ports.api.q(id).onchange = () =>
                    ports.api.perform(async (operation) => {
                        ports.notifications.notifications.scope(operation);
                        session.managerUi.managerStart = 0;
                        await managerInventory();
                    });
            ports.api.q("mmoInventoryRows").onclick = (e) =>
                ports.api.perform(async (operation) => {
                    const message = ports.notifications.notifications.scope(operation);
                    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
                    if (!b) return;
                    if (b.dataset.inventoryIdentity) {
                        const identity = session.api.doc.identities.find((i) => i.id === b.dataset.inventoryIdentity);
                        try {
                            await managerOpen(identity!.artistId);
                        } catch (caughtError) {
                            const err = operationError(caughtError);
                            await ports.identities.editIdentity(identity);
                            message("Representative unavailable: " + err.message, "warning");
                        }
                    } else if (b.dataset.managerItem) await managerOpen(b.dataset.managerItem);
                });
            ports.api.q("mmoManagerFields").oninput = (e) => {
                const row = (e.target as HTMLElement).closest<HTMLElement>("[data-field]");
                if (!row) return;
                row.querySelector<HTMLSelectElement>("[data-mode]")!.value = "approved";
                const d = session.managerUi.managerPolicy.fields[row.dataset.field!];
                if (d) {
                    delete d.snapshotId;
                    delete d.sourceField;
                    d.provenance = "known";
                }
                row.querySelector<HTMLElement>("[data-source]")!.textContent = "Source: Known · manual edit";
                setFieldState(row!);
                ports.rules.invalidateReview();
                ports.navigation.markDirty();
            };
            ports.api.q("mmoManagerFields").onclick = (e) => {
                const action = (e.target as HTMLElement).closest<HTMLElement>("[data-field-action]");
                if (!action) return;
                const row = action.closest<HTMLElement>("[data-field]");
                row!.querySelector<HTMLSelectElement>("[data-mode]")!.value =
                    action.dataset.fieldAction === "approve" ? "approved" : action.dataset.fieldAction!;
                setFieldState(row!);
                ports.rules.invalidateReview();
                ports.navigation.markDirty();
            };
            ports.api.q("mmoManagerLibraries").onchange = () =>
                ports.api.perform(async (operation) => {
                    ports.notifications.notifications.scope(operation);
                    readManagerFields();
                    ports.rules.invalidateReview();
                    ports.navigation.markDirty();
                    const serial = session.navigation.ui.request;
                    const p = new URLSearchParams();
                    session.managerUi.managerPolicy.libraries.forEach((x) => p.append("libraries", x));
                    const d = await ports.api.api(`manager/items/${session.managerUi.managerDetails.id}/dependencies?${p}`);
                    if (serial !== session.navigation.ui.request) return;
                    session.managerUi.managerDetails.dependencies = d;
                    ports.api.q("mmoManagerReadOnly").hidden = d.canEdit;
                    setEditorWritable();
                });
            ports.api.q("mmoManagerSourceProvider").onchange = managerSourceChanged;
            ports.api.q("mmoManagerCompare").onclick = () =>
                ports.api.perform(async (operation) => {
                    const message = ports.notifications.notifications.scope(operation);
                    readManagerFields();
                    if (!ports.api.q("mmoManagerSourceConfirm").checked) throw Error("Confirm the intended source record before fetching.");
                    const serial = session.navigation.ui.request,
                        compareSerial = ++session.navigation.ui.comparisonRequest,
                        id = session.managerUi.managerDetails.id;
                    message("Fetching comparison…", "loading");
                    const sourceSelection = () =>
                        JSON.stringify([
                            ports.api.q("mmoManagerSourceProvider").value,
                            ports.api.q("mmoManagerSourceKey").value,
                            ports.api.q("mmoManagerSourceId").value,
                            ports.api.q("mmoManagerSourceConfirm").checked,
                        ]);
                    const selectedSource = sourceSelection();
                    const comparison = await ports.api.api("manager/compare", "POST", {
                        itemId: id,
                        provider: ports.api.q("mmoManagerSourceProvider").value,
                        key: ports.api.q("mmoManagerSourceKey").value,
                        recordId: ports.api.q("mmoManagerSourceId").value,
                        confirm: true,
                    });
                    if (
                        serial !== session.navigation.ui.request ||
                        session.managerUi.managerDetails.id !== id ||
                        compareSerial !== session.navigation.ui.comparisonRequest
                    )
                        return;
                    if (selectedSource !== sourceSelection()) {
                        message("Source selection changed. Fetch comparison again for the current selection.", "warning");
                        return;
                    }
                    session.managerUi.managerComparison = comparison;
                    const s = comparison.snapshot;
                    if (session.managerUi.managerDetails.dependencies.canEdit && !session.managerUi.managerDetails.linkedOnly) {
                        session.managerUi.managerPolicy.bindings.push(s.binding);
                        session.managerUi.managerPolicy.snapshots.push(s);
                        ports.rules.invalidateReview();
                        ports.navigation.markDirty();
                        session.navigation.ui.locals.get(session.navigation.ui.editor!.key)!.comparison = comparison;
                    }
                    renderComparison();
                    setEditorWritable();
                    message("Comparison fetched. Active metadata is unchanged.");
                });
            ports.api.q("mmoManagerSourceResult").onclick = (e) =>
                ports.api.perform(async (operation) => {
                    const message = ports.notifications.notifications.scope(operation);
                    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
                    if (!b) return;
                    const field = b.dataset.sourceField!,
                        index = b.dataset.sourceImage;
                    if (field) {
                        readManagerFields();
                        const s = session.managerUi.managerComparison!.snapshot;
                        session.managerUi.managerPolicy.fields[field] = {
                            mode: "approved",
                            value: s.offered[field],
                            provenance: "known",
                            snapshotId: s.id,
                            sourceField: field,
                        };
                        renderManagerFields();
                        ports.rules.invalidateReview();
                        ports.navigation.markDirty();
                        message(ports.navigation.human(field) + " selected for the local edit.");
                    }
                    if (index !== undefined) {
                        const offered = session.managerUi.managerComparison!.images[Number(index)],
                            serial = session.navigation.ui.request;
                        const imageBefore = JSON.stringify(session.managerUi.managerPolicy.images[offered!.type]);
                        const snapshotId = session.managerUi.managerComparison!.snapshot.id;
                        message("Caching artwork…", "loading");
                        const image = await ports.api.api("manager/images/cache", "POST", {
                            itemId: session.managerUi.managerDetails.id,
                            snapshotId: session.managerUi.managerComparison!.snapshot.id,
                            url: offered!.url,
                            type: offered!.type,
                        });
                        if (serial !== session.navigation.ui.request) return;
                        if (
                            JSON.stringify(session.managerUi.managerPolicy.images[offered!.type]) !== imageBefore ||
                            session.managerUi.managerComparison?.snapshot.id !== snapshotId
                        ) {
                            message("Artwork cached, but your selection changed. Cache again to stage the intended image.", "warning");
                            return;
                        }
                        session.managerUi.managerPolicy.images[offered!.type] = image;
                        renderManagerImages();
                        ports.rules.invalidateReview();
                        ports.navigation.markDirty();
                        message("Artwork cached for review.");
                    }
                });
            ports.api.q("mmoManagerImages").onclick = (e) =>
                ports.api.perform(async (operation) => {
                    const message = ports.notifications.notifications.scope(operation);
                    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
                    if (!b) return;
                    const serial = session.navigation.ui.request;
                    if (b.dataset.imageCurrent) {
                        const imageBefore = JSON.stringify(session.managerUi.managerPolicy.images[b.dataset.imageCurrent]);
                        message("Caching artwork…", "loading");
                        const image = await ports.api.api(
                            `manager/items/${session.managerUi.managerDetails.id}/images/${b.dataset.imageCurrent}/pin-current`,
                            "POST",
                        );
                        if (serial !== session.navigation.ui.request) return;
                        if (JSON.stringify(session.managerUi.managerPolicy.images[b.dataset.imageCurrent]) !== imageBefore) {
                            message("Artwork selection changed while caching. Keep the current selection or cache again.", "warning");
                            return;
                        }
                        session.managerUi.managerPolicy.images[b.dataset.imageCurrent] = image;
                    } else if (b.dataset.imageEmpty) session.managerUi.managerPolicy.images[b.dataset.imageEmpty] = { mode: "empty" };
                    else if (b.dataset.imageUnmanage) session.managerUi.managerPolicy.images[b.dataset.imageUnmanage] = { mode: "unmanaged" };
                    else return;
                    renderManagerImages();
                    ports.rules.invalidateReview();
                    ports.navigation.markDirty();
                });
            ports.api.q("mmoManagerPreview").onclick = () =>
                ports.api.perform(async (operation) => {
                    ports.notifications.notifications.scope(operation);
                    const policy = readManagerFields();
                    await ports.rules.preview({ metadataEdits: [policy] });
                });
            ports.api.q("mmoManagerSave").onclick = () =>
                ports.api.perform(() => ports.navigation.saveLocalDraft("manager/drafts", readManagerFields(), ports.api.q("mmoManagerSave")));
            ports.api.q("mmoManagerCancel").onclick = () =>
                ports.api.perform(async (operation) => {
                    const message = ports.notifications.notifications.scope(operation);
                    const saving = session.navigation.ui.pendingSaves.has(session.navigation.ui.editor?.key ?? "");
                    ports.navigation.clearLocal();
                    session.navigation.ui.editor = null;
                    await ports.navigation.workspaceBack();
                    message(
                        saving
                            ? "Local edit discarded. The pending save continues; active values are unchanged."
                            : "Local edit discarded. Saved and active values are unchanged.",
                    );
                });
            ports.api.q("mmoManagerBatchAdd").onclick = () =>
                ports.api.perform(async (operation) => {
                    const message = ports.notifications.notifications.scope(operation);
                    const p = readManagerFields();
                    if (session.managerUi.managerBatch.some((x) => x.id === p.id && JSON.stringify(x) === JSON.stringify(p))) {
                        message("This edit is already added to batch.");
                        return;
                    }
                    session.managerUi.managerBatch = session.managerUi.managerBatch.filter((x) => x.id !== p.id).concat([p]);
                    ports.navigation.renderBatch();
                    message("Edit added to the optional batch review.");
                });
            ports.api.q("mmoManagerBatchPreview").onclick = () =>
                ports.api.perform(async (operation) => {
                    ports.notifications.notifications.scope(operation);
                    if (!session.managerUi.managerBatch.length) throw Error("Add edits to the batch first.");
                    await ports.rules.preview({ metadataEdits: session.managerUi.managerBatch });
                });
            ports.api.q("mmoManagerStop").onclick = () =>
                ports.api.perform(() =>
                    ports.rules.preview({
                        relinquish: [
                            {
                                itemId: session.managerUi.managerDetails.id,
                                fields: Object.keys(session.managerUi.managerDetails.policy.fields).filter(
                                    (f) => session.managerUi.managerDetails.policy.fields[f]!.mode !== "unmanaged",
                                ),
                                images: Object.keys(session.managerUi.managerDetails.policy.images).filter(
                                    (t) => session.managerUi.managerDetails.policy.images[t]!.mode !== "unmanaged",
                                ),
                                restoreOriginal: false,
                            },
                        ],
                    }),
                );
            ports.api.q("mmoManagerRestore").onclick = () =>
                ports.api.perform(() =>
                    ports.rules.preview({
                        relinquish: [
                            {
                                itemId: session.managerUi.managerDetails.id,
                                fields: [
                                    ...new Set([
                                        ...Object.keys(session.managerUi.managerDetails.policy.fields).filter(
                                            (f) => session.managerUi.managerDetails.policy.fields[f]!.mode !== "unmanaged",
                                        ),
                                        ...Object.keys(session.managerUi.managerDetails.original?.original || {}),
                                        ...Object.keys(session.managerUi.managerDetails.correctionOriginal?.original || {}),
                                    ]),
                                ],
                                images: [
                                    ...new Set([
                                        ...Object.keys(session.managerUi.managerDetails.policy.images).filter(
                                            (t) => session.managerUi.managerDetails.policy.images[t]!.mode !== "unmanaged",
                                        ),
                                        ...Object.keys(session.managerUi.managerDetails.original?.originalImages || {}),
                                    ]),
                                ],
                                restoreOriginal: true,
                            },
                        ],
                    }),
                );
            ports.api.q("mmoArtworkChoose").onclick = () => ports.api.q("mmoManagerUpload").click();
            ports.api.q("mmoManagerUpload").addEventListener("change", () => {
                ports.api.q("mmoArtworkFilename").textContent = ports.api.q("mmoManagerUpload").files![0]?.name || "No artwork selected";
            });
            ports.api.q("mmoManagerUploadCache").onclick = () =>
                ports.api.perform(async (operation) => {
                    const message = ports.notifications.notifications.scope(operation);
                    const file = ports.api.q("mmoManagerUpload").files![0];
                    if (!file) throw Error("Select an image first.");
                    const serial = session.navigation.ui.request,
                        type = ports.api.q("mmoManagerUploadType").value;
                    const imageBefore = JSON.stringify(session.managerUi.managerPolicy.images[type]);
                    message("Caching artwork…", "loading");
                    const data = new FormData();
                    data.append("file", file);
                    const headers = {};
                    ApiClient.setRequestHeaders(headers);
                    const response = await fetch(ApiClient.getUrl("MusicMetadataManager/manager/images/upload"), {
                        method: "POST",
                        headers,
                        body: data,
                        credentials: "same-origin",
                    });
                    const image = await response.json();
                    if (!response.ok) throw Error(image.error || image.title || "Artwork upload failed.");
                    if (serial !== session.navigation.ui.request) return;
                    if (
                        ports.api.q("mmoManagerUpload").files![0] !== file ||
                        ports.api.q("mmoManagerUploadType").value !== type ||
                        JSON.stringify(session.managerUi.managerPolicy.images[type]) !== imageBefore
                    ) {
                        message("Artwork cached, but your selection changed. Cache again to stage the intended image.", "warning");
                        return;
                    }
                    session.managerUi.managerPolicy.images[type] = image;
                    renderManagerImages();
                    ports.rules.invalidateReview();
                    ports.navigation.markDirty();
                    message("Artwork cached. Preview and apply to activate it.");
                });
            ports.api.q("mmoManagerIssueRefresh").onclick = () => ports.api.perform(ports.issues.refreshIssues);
            ports.api.q("mmoManagerPolicies").onclick = (e) =>
                ports.api.perform(async (operation) => {
                    ports.notifications.notifications.scope(operation);
                    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
                    if (!b) return;
                    if (b.dataset.policyDisable) return ports.rules.preview({ disablePolicies: [b.dataset.policyDisable] });
                    if (b.dataset.policyDeleteActive) return ports.rules.preview({ deletePolicies: [b.dataset.policyDeleteActive] });
                    if (b.dataset.policyPreview) return ports.rules.preview({ activatePolicies: [b.dataset.policyPreview] });
                    if (b.dataset.policyDelete) {
                        await ports.api.api(`manager/drafts/${b.dataset.policyDelete}`, "DELETE");
                        ports.rules.invalidateReview();
                        await ports.rules.load();
                        return;
                    }
                    const id = b.dataset.policyEdit || b.dataset.policyResume;
                    if (!id) return;
                    const p = (
                        b.dataset.policyResume ? session.api.doc.policyDrafts : session.api.doc.policies.concat(session.api.doc.policyDrafts)
                    ).find((x) => x.id === id);
                    const item = p!.identityId ? session.api.doc.identities.find((x) => x.id === p!.identityId)?.artistId : p!.itemId;
                    if (!item) throw Error("Rebind the missing canonical identity first.");
                    await managerOpen(item, p);
                });
            ports.api.q("mmoWorkspaceTabs").onclick = (e) => {
                const b = (e.target as HTMLElement).closest<HTMLElement>("[data-item-tab]");
                if (b) ports.api.perform(() => selectItemTab(b.dataset.itemTab!));
            };
            ports.api.q("mmoAlbumTracks").onclick = (e) => {
                const id = (e.target as HTMLElement).closest<HTMLElement>("[data-track-item]")?.dataset.trackItem;
                if (id) ports.api.perform(() => managerOpen(id, undefined, true));
            };
            ports.api.q("mmoAlbumDefaults").onclick = () => {
                const existing = session.api.doc.active.find((r) => r.kind === "album" && r.path === session.managerUi.managerDetails.path);
                ports.rules.edit(
                    existing || {
                        id: crypto.randomUUID().replaceAll("-", ""),
                        label: session.managerUi.managerDetails.name + " folder defaults",
                        kind: "album",
                        path: session.managerUi.managerDetails.path,
                        libraries: session.managerUi.managerPolicy.libraries,
                        fields: {},
                        trackDefaults: {},
                    },
                    true,
                );
            };
            ports.api.q("mmoEditLinkedIdentity").onclick = () => {
                const identity = session.api.doc.identities.find((i) => i.id === ports.api.q("mmoEditLinkedIdentity").dataset.identity);
                ports.api.perform(() =>
                    ports.identities.editIdentity(
                        identity || {
                            preferredName: session.managerUi.managerDetails.name,
                            aliases: [session.managerUi.managerDetails.name],
                            libraries: session.managerUi.managerPolicy.libraries,
                            ...(session.managerUi.managerDetails.kind === "MusicArtist"
                                ? { artistId: session.managerUi.managerDetails.id }
                                : { personId: session.managerUi.managerDetails.id }),
                        },
                        true,
                    ),
                );
            };
            for (const id of ["mmoArtistLinks", "mmoDependencyDetails"])
                ports.api.q(id).onclick = (e) => {
                    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
                    const item = b?.dataset.linkedRecord || b?.dataset.dependencyItem;
                    if (item) ports.api.perform(() => managerOpen(item, undefined, true));
                };
            for (const id of ["mmoManagerSourceKey", "mmoManagerSourceId"])
                ports.api.q(id).addEventListener("input", () => {
                    session.navigation.ui.comparisonRequest++;
                    ports.api.q("mmoManagerSourceConfirm").checked = false;
                });
        },

        get managerFields() {
            return managerFields();
        },
        get arrayFields() {
            return arrayFields();
        },
        get numberFields() {
            return numberFields();
        },
        get advancedFields() {
            return advancedFields();
        },
        get requiredFields() {
            return requiredFields();
        },
        get managerDisplay() {
            return managerDisplay;
        },
        get managerInventory() {
            return managerInventory;
        },
        get managerOpen() {
            return managerOpen;
        },
        get fieldRow() {
            return fieldRow;
        },
        get renderManagerFields() {
            return renderManagerFields;
        },
        get setFieldState() {
            return setFieldState;
        },
        get readManagerFields() {
            return readManagerFields;
        },
        get renderManagerImages() {
            return renderManagerImages;
        },
        get managerSourceChanged() {
            return managerSourceChanged;
        },
        get renderComparison() {
            return renderComparison;
        },
        get selectItemTab() {
            return selectItemTab;
        },
        get loadAlbumTracks() {
            return loadAlbumTracks;
        },
        get renderArtistLinks() {
            return renderArtistLinks;
        },
        get renderIssueStatus() {
            return renderIssueStatus;
        },
        get renderMetadataDrafts() {
            return renderMetadataDrafts;
        },
        get setEditorWritable() {
            return setEditorWritable;
        },
    };
}
