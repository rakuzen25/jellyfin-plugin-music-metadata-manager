import { operationError } from "./errors.ts";
import type { ManagerDetails, Comparison, Status } from "./responses.ts";
import type { MetadataPolicy, JsonValue } from "./contracts.ts";
import type { Features } from "./features.ts";
export function createManagerUi(features: Features) {
    // Item inventory and metadata editor. Policies remain visit-local until Save or Apply.
    let managerStart = 0;
    // Opening an item initializes these before any editor controls are rendered.
    let managerDetails: ManagerDetails, managerPolicy: MetadataPolicy;
    let managerComparison: Comparison | null = null,
        managerBatch: MetadataPolicy[] = [];
    const managerFields = [
        "title",
        "album",
        "artists",
        "albumArtists",
        "discNumber",
        "trackNumber",
        "sortName",
        "overview",
        "genres",
        "tags",
        "premiereDate",
        "endDate",
        "productionYear",
        "country",
        "providerIds",
        "lockedFields",
        "isLocked",
    ];
    const arrayFields = ["artists", "albumArtists", "genres", "tags", "country", "lockedFields"];
    const numberFields = ["discNumber", "trackNumber", "productionYear"];
    const advancedFields = ["providerIds", "lockedFields", "isLocked"];
    const requiredFields = ["title", "album", "artists", "albumArtists", "discNumber", "trackNumber", "isLocked"];
    function managerDisplay(v: unknown) {
        return features.navigation.formatValue(v);
    }
    async function managerInventory() {
        const serial = ++features.navigation.ui.inventoryRequest;
        features.api.q("mmoInventoryCount").textContent = "";
        features.rowMenu.closeRowMenu();
        features.api.q("mmoInventoryRows").innerHTML = features.table.tableMessage("Loading music…");
        const params = new URLSearchParams({
            search: features.api.q("mmoInventorySearch").value,
            start: String(managerStart),
            limit: String(features.table.tablePageSize),
            view: features.api.q("mmoInventoryView").value,
        });
        if (features.api.q("mmoInventoryLibrary").value) params.set("library", features.api.q("mmoInventoryLibrary").value);
        const kind = features.api.q("mmoInventoryKind").value;
        // Native mode still permits the combined Artists filter.
        if (kind) params.set("kind", kind);
        try {
            const result = await features.api.api(`manager/inventory?${params}`);
            if (serial !== features.navigation.ui.inventoryRequest) return;
            features.table.tablePagination(managerStart, result.total, {
                count: "mmoInventoryCount",
                previous: "mmoInventoryPrev",
                next: "mmoInventoryNext",
                note: result.view === "grouped" ? "grouped artist identities" : "native records",
            });
            const items = result.items;
            features.api.q("mmoInventoryRows").innerHTML =
                items
                    .map((x) => {
                        const identity = x.kind === "identity";
                        const open = identity
                            ? 'data-inventory-identity="' + features.api.esc(x.identityId) + '"'
                            : 'data-manager-item="' + features.api.esc(x.id) + '"';
                        const state = x.managed || identity ? "Managed" : "Unmanaged";
                        const links = identity
                            ? "<details><summary>" +
                              x.records.length +
                              " linked native records</summary>" +
                              x.records
                                  .map(
                                      (r) =>
                                          "<p>" +
                                          features.navigation.nativeButton(
                                              r.name + " · " + r.kind + (r.representative ? " · representative" : ""),
                                              'data-manager-item="' + features.api.esc(r.id) + '"',
                                          ) +
                                          features.nativeLinks.nativeLink(r.id, r.name) +
                                          "</p>",
                                  )
                                  .join("") +
                              "</details>"
                            : "";
                        return features.table.tableRow({
                            name: x.name,
                            columns: features.table.libraryTableColumns,
                            description: x.path || "",
                            type: identity
                                ? "Artist identity"
                                : {
                                      album: "Album",
                                      track: "Track",
                                      MusicArtist: "MusicArtist record",
                                      Person: "Person record",
                                  }[x.kind] || x.kind,
                            status: x.missingBinding ? "Missing binding" : state,
                            details:
                                (identity ? "<p>Aliases: " + features.api.esc((x.aliases || []).join(", ")) + "</p>" : "") +
                                (x.missingBinding
                                    ? '<p class="mmo-warning">A representative is missing. Rebind the identity before applying changes.</p>'
                                    : "") +
                                links,
                            primary: features.navigation.nativeButton(identity ? "Edit" : "Open", open),
                            native: features.nativeLinks.nativeLink(x.id, x.name),
                        });
                    })
                    .join("") || features.table.tableMessage("No music matches these filters.");
        } catch (caughtError) {
            const e = operationError(caughtError);
            if (serial !== features.navigation.ui.inventoryRequest) return;
            features.api.q("mmoInventoryCount").textContent = "";
            features.api.q("mmoInventoryRows").innerHTML = features.table.tableMessage("Could not load music. Use Find to retry.");
            e.noticeHandled = true;
            throw e;
        }
    }
    async function managerOpen(id: string | null | undefined, draft?: MetadataPolicy | null, nested = false) {
        const message = features.notifications.notifications.scope();
        features.navigation.captureEditor();
        const previous = features.navigation.ui.editor
            ? { ...features.navigation.ui.editor, tab: features.navigation.ui.itemTab, scroll: window.scrollY }
            : null;
        const serial = ++features.navigation.ui.request;
        message("Loading item…", "loading");
        const details = await features.api.api(`manager/items/${id}`);
        if (serial !== features.navigation.ui.request) return;
        features.rules.invalidateReview();
        const identity = features.api.doc.identities.find((i) => i.id === details.policy.identityId);
        const linkedOnly = !!identity && ![identity.artistId, identity.personId].includes(details.id);
        const key = linkedOnly ? "inspect:" + details.id : "metadata:" + (details.policy.identityId || details.id);
        const local = features.navigation.ui.locals.get(key);
        managerDetails = details;
        managerDetails.linkedOnly = linkedOnly;
        managerPolicy = structuredClone((local?.data as MetadataPolicy | undefined) || draft || details.policy);
        managerComparison = local?.comparison || null;
        if (nested && previous) features.navigation.ui.stack.push(previous);
        features.navigation.openWorkspace(
            "metadata",
            key,
            details.policy.identityId
                ? features.api.doc.identities.find((x) => x.id === details.policy.identityId)?.preferredName || details.name
                : details.name,
            details.policy.fields && Object.keys(details.policy.fields).length
                ? "Managed metadata · only approved fields are reasserted on refresh"
                : "Jellyfin metadata · edits are local until applied",
            details.id,
        );
        features.api.q("mmoManagerTitle").textContent = details.name + " · " + details.kind;
        features.api.q("mmoManagerDependencies").textContent =
            details.dependencies.classification +
            " · " +
            details.dependencies.music.length +
            " music uses · " +
            details.dependencies.nonMusic.length +
            " non-music uses. " +
            details.refreshBehavior;
        features.api.q("mmoManagerLibraries").innerHTML = features.api.q("mmoLibraries").innerHTML;
        for (const o of features.api.q("mmoManagerLibraries").options) o.selected = managerPolicy.libraries.includes(o.value);
        features.api.q("mmoManagerReadOnly").hidden = details.dependencies.canEdit && !managerDetails.linkedOnly;
        features.api.q("mmoManagerReadOnly").textContent = managerDetails.linkedOnly
            ? "This record is an alias link. Open a selected representative in Identity to edit shared artist metadata. This linked record remains stored for compatibility."
            : "This record is shared outside the selected music scope and is read-only. Cover all music uses; non-music references prevent editing.";
        features.api.q("mmoManagerSourceProvider").innerHTML = details.providers
            .map(
                (p) =>
                    '<option value="' +
                    features.api.esc(p.name) +
                    '" data-key="' +
                    features.api.esc(p.key || "") +
                    '">' +
                    features.api.esc(p.name) +
                    "</option>",
            )
            .join("");
        features.api.q("mmoManagerCompare").disabled = !details.providers.length;
        managerSourceChanged();
        if (managerComparison) {
            const binding = managerComparison.snapshot.binding;
            features.api.q("mmoManagerSourceProvider").value = binding.provider;
            features.api.q("mmoManagerSourceKey").value = binding.key;
            features.api.q("mmoManagerSourceId").value = binding.recordId;
            features.api.q("mmoManagerSourceConfirm").checked = true;
        }
        renderManagerFields();
        renderManagerImages();
        renderComparison();
        renderArtistLinks();
        features.api.q("mmoManagerHistory").innerHTML =
            details.history
                .slice()
                .reverse()
                .map(
                    (h) =>
                        "<p>" +
                        features.api.esc(new Date(h.time).toLocaleString()) +
                        " · " +
                        features.api.esc(h.operation) +
                        features.nativeLinks.nativeLink(h.itemId, details.name) +
                        " · " +
                        features.api.esc(h.fields.map(features.navigation.human).join(", ")) +
                        "</p>",
                )
                .join("") || "<p>No recorded applications.</p>";
        features.api.q("mmoDependencyDetails").innerHTML =
            details.dependencies.music
                .map(
                    (u) =>
                        "<p>" +
                        features.navigation.nativeButton(
                            u.name + " · " + u.roles.join(", "),
                            'data-dependency-item="' + features.api.esc(u.id) + '"',
                        ) +
                        features.nativeLinks.nativeLink(u.id, u.name) +
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
        features.api.q("mmoWorkspaceTabs").innerHTML = tabs
            .map(([tab, label]) =>
                features.navigation.nativeButton(
                    label,
                    'data-item-tab="' + tab + '" aria-selected="false" role="tab" id="mmoTab_' + tab + '" aria-controls="mmoPanel_' + tab + '"',
                ),
            )
            .join("");
        if (local?.raw)
            for (const r of local.raw) {
                const row = features.api.q("mmoManagerFields").querySelector<HTMLElement>('[data-field="' + r.field + '"]');
                if (row) {
                    row.querySelector<HTMLInputElement>("[data-value]")!.value = r.value;
                    row.querySelector<HTMLSelectElement>("[data-mode]")!.value = r.mode;
                    setFieldState(row!);
                }
            }
        features.navigation.ui.editor!.dirty = !!local;
        features.navigation.ui.editor!.sequence = local?.sequence || 0;
        if (local) features.api.q("mmoWorkspaceState").textContent = "Unfinished local edit · save a draft to keep it after reloading";
        else if (draft && (features.api.doc.policyDrafts.some((p) => p.id === draft.id) || features.api.doc.drafts.some((r) => r.id === draft.id)))
            features.api.q("mmoWorkspaceState").textContent = "Saved draft · the active version remains unchanged";
        setEditorWritable();
        await selectItemTab(local?.tab || "metadata");
        message("");
    }
    function fieldRow(field: string) {
        const d = managerPolicy.fields[field] || { mode: "unmanaged" };
        const value = d.mode === "approved" ? d.value : managerDetails.stored[field];
        const text = arrayFields.includes(field)
            ? ((value || []) as JsonValue[]).join("\n")
            : field === "providerIds"
              ? JSON.stringify(value || {}, null, 2)
              : (value ?? "");
        const id = "mmoValue_" + field;
        let input;
        if (field === "isLocked")
            input =
                '<select is="emby-select" id="' +
                id +
                '" data-value><option value="false" ' +
                (!value ? "selected" : "") +
                '>Unlocked</option><option value="true" ' +
                (value ? "selected" : "") +
                ">Locked</option></select>";
        else if (arrayFields.includes(field) || ["overview", "providerIds"].includes(field))
            input =
                '<textarea is="emby-textarea" id="' +
                id +
                '" data-value rows="' +
                (field === "overview" ? 5 : field === "providerIds" ? 4 : 2) +
                '">' +
                features.api.esc(text) +
                "</textarea>";
        else
            input =
                '<input is="emby-input" id="' +
                id +
                '" data-value value="' +
                features.api.esc(text) +
                '" ' +
                (numberFields.includes(field) ? 'type="number" min="1"' : 'type="text"') +
                " />";
        const info = d.snapshotId ? managerPolicy.snapshots.find((s) => s.id === d.snapshotId) : null;
        const source = info
            ? info.binding.provider + " · " + info.binding.recordId + " · retrieved " + new Date(info.retrievedAt).toLocaleString()
            : d.provenance === "known"
              ? "Known · manual approval"
              : d.provenance === "inferred"
                ? "Inferred"
                : "Unknown";
        return (
            '<div class="mmo-field" data-field="' +
            field +
            '"><input data-mode type="hidden" value="' +
            features.api.esc(d.mode) +
            '" /><div class="inputContainer"><label class="inputLabel" for="' +
            id +
            '">' +
            features.api.esc(features.navigation.human(field)) +
            "</label>" +
            input +
            (arrayFields.includes(field) ? '<div class="fieldDescription">One name or value per line. Credit punctuation is preserved.</div>' : "") +
            '</div><p data-field-status class="secondaryText mmo-field-status"></p><details><summary>Management and source details</summary><div class="mmo-field-actions">' +
            features.navigation.nativeButton("Keep this value", 'data-field-action="approve"') +
            (!requiredFields.includes(field) ? features.navigation.nativeButton("Keep empty", 'data-field-action="empty"') : "") +
            features.navigation.nativeButton("Stop managing", 'data-field-action="unmanaged"') +
            "</div><p>Stored: " +
            features.api.esc(features.navigation.formatValue(managerDetails.stored[field])) +
            "</p><p>Displayed: " +
            features.api.esc(features.navigation.formatValue(managerDetails.effective[field])) +
            "</p><p>Approved: " +
            features.api.esc(
                d.mode === "approved" ? features.navigation.formatValue(d.value) : d.mode === "empty" ? "Explicitly empty" : "Unmanaged",
            ) +
            "</p><p data-source>Source: " +
            features.api.esc(source) +
            "</p><p>Locks: " +
            features.api.esc(managerDetails.IsLocked || managerDetails.isLocked ? "All metadata locked" : managerDetails.locks.join(", ") || "None") +
            "</p><p>Approved values and explicit emptiness are reasserted after refresh. Stop managing retains the current value and returns future handling to Jellyfin.</p></details></div>"
        );
    }
    function renderManagerFields() {
        const fields = managerFields.filter((f) => f in managerDetails.stored);
        const common =
            managerDetails.kind === "Audio"
                ? ["title", "album", "artists", "albumArtists", "discNumber", "trackNumber"]
                : managerDetails.kind === "MusicAlbum"
                  ? ["title", "artists", "albumArtists", "overview", "genres", "productionYear"]
                  : ["title", "sortName", "overview", "genres"];
        features.api.q("mmoManagerFields").innerHTML =
            fields
                .filter((f) => common.includes(f))
                .map(fieldRow)
                .join("") +
            '<details class="mmo-advanced"><summary>Additional metadata: dates, tags, and other fields</summary>' +
            fields
                .filter((f) => !common.includes(f) && !advancedFields.includes(f))
                .map(fieldRow)
                .join("") +
            '</details><details class="mmo-advanced"><summary>Provider IDs and native locks</summary>' +
            fields
                .filter((f) => advancedFields.includes(f))
                .map(fieldRow)
                .join("") +
            "</details>";
        for (const row of features.api.q("mmoManagerFields").querySelectorAll<HTMLElement>("[data-field]")) setFieldState(row!);
        features.navigation.normalizeControls(features.api.q("mmoManagerFields"));
        features.issueGuidance.applyIssueFieldFocus();
    }
    function setFieldState(row: HTMLElement) {
        const mode = row.querySelector<HTMLSelectElement>("[data-mode]")!.value;
        const active = managerDetails.policy.fields[row.dataset.field!] || {
            mode: "unmanaged",
        };
        const activeText = arrayFields.includes(row.dataset.field!)
            ? ((active.value || []) as JsonValue[]).join("\n")
            : row.dataset.field === "providerIds"
              ? JSON.stringify(active.value || {}, null, 2)
              : String(active.value ?? "");
        const changed = mode !== active.mode || (mode === "approved" && row.querySelector<HTMLInputElement>("[data-value]")!.value !== activeText);
        row.querySelector<HTMLElement>("[data-field-status]")!.textContent =
            (changed ? "Pending · " : "") +
            (mode === "approved"
                ? "Approved value · reasserted after refresh"
                : mode === "empty"
                  ? "Explicitly empty · kept empty after refresh"
                  : "Unmanaged · Jellyfin controls future refreshes");
        row.querySelector<HTMLInputElement>("[data-value]")!.disabled = mode === "empty";
        for (const b of row.querySelectorAll<HTMLButtonElement>("[data-field-action]"))
            b.disabled = b.dataset.fieldAction === mode || (b.dataset.fieldAction === "approve" && mode === "approved");
    }
    function readManagerFields() {
        for (const row of features.api.q("mmoManagerFields").querySelectorAll<HTMLElement>("[data-field]")) {
            const field = row.dataset.field!,
                mode = row.querySelector<HTMLSelectElement>("[data-mode]")!.value,
                text = row.querySelector<HTMLInputElement>("[data-value]")!.value;
            const previous = managerPolicy.fields[field];
            if (mode === "unmanaged") {
                if (previous)
                    managerPolicy.fields[field] = {
                        mode: "unmanaged",
                        value: null,
                        provenance: "known",
                    };
                continue;
            }
            let value = null;
            if (mode === "approved") {
                if (arrayFields.includes(field))
                    value = text
                        .split("\n")
                        .map((x) => x.trim())
                        .filter(Boolean);
                else if (field === "providerIds") {
                    try {
                        value = JSON.parse(text);
                    } catch {
                        throw Error("Provider IDs must be a JSON object. Your unfinished edit is retained.");
                    }
                } else if (numberFields.includes(field)) value = Number(text);
                else if (field === "isLocked") value = text === "true";
                else value = text;
            }
            managerPolicy.fields[field] = {
                ...previous,
                mode,
                value,
                provenance: previous?.provenance || "known",
            };
        }
        managerPolicy.libraries = [...features.api.q("mmoManagerLibraries").selectedOptions].map((o) => o.value);
        return structuredClone(managerPolicy);
    }
    function renderManagerImages() {
        const types = [...new Set(["Primary", ...managerDetails.images.map((i) => i.type), ...Object.keys(managerPolicy.images)])];
        features.api.q("mmoManagerImages").innerHTML = types
            .map((type) => {
                const d = managerPolicy.images[type],
                    current = managerDetails.images.some((i) => i.type === type);
                const approved = d?.mode === "approved",
                    status = approved ? "Approved replacement" : d?.mode === "empty" ? "Explicitly empty" : "Unmanaged";
                return (
                    '<div class="mmo-image-card"><h4>' +
                    features.api.esc(type) +
                    "</h4><p>" +
                    status +
                    '</p><div class="mmo-image-pair"><figure><figcaption>Current</figcaption>' +
                    (current
                        ? '<img class="mmo-artwork" src="' +
                          features.api.esc(features.navigation.nativeImage(managerDetails.id, type)) +
                          '" alt="Current ' +
                          features.api.esc(type) +
                          '" />'
                        : "<p>No image</p>") +
                    "</figure>" +
                    (d
                        ? "<figure><figcaption>Proposed / approved</figcaption>" +
                          (approved
                              ? '<img class="mmo-artwork" data-pin-image="' +
                                features.api.esc(d.hash) +
                                '" alt="Selected ' +
                                features.api.esc(type) +
                                '" />'
                              : "<p>" + features.api.esc(d.mode === "empty" ? "Kept empty" : "Jellyfin controls images") + "</p>") +
                          "</figure>"
                        : "") +
                    '</div><div class="mmo-actions">' +
                    (current ? features.navigation.nativeButton("Keep current", 'data-image-current="' + type + '"') : "") +
                    features.navigation.nativeButton("Keep empty", 'data-image-empty="' + type + '"') +
                    features.navigation.nativeButton("Stop managing", 'data-image-unmanage="' + type + '"') +
                    "</div>" +
                    (approved
                        ? "<details><summary>Approval details</summary><p>SHA256 " +
                          features.api.esc(d.hash) +
                          "</p><p>" +
                          features.api.esc(d.sourceUrl || "Locally selected image") +
                          "</p></details>"
                        : "") +
                    "</div>"
                );
            })
            .join("");
        features.navigation.hydratePins(features.api.q("mmoManagerImages"));
    }
    function managerSourceChanged() {
        features.navigation.ui.comparisonRequest++;
        const o = features.api.q("mmoManagerSourceProvider").selectedOptions[0];
        features.api.q("mmoManagerSourceKey").value = o?.dataset.key || "";
        features.api.q("mmoManagerSourceId").value = managerDetails?.providerCandidates.find((x) => x.key === o?.dataset.key)?.recordId || "";
        features.api.q("mmoManagerSourceConfirm").checked = false;
    }
    function renderComparison() {
        if (!managerComparison) {
            features.api.q("mmoManagerSourceResult").innerHTML = managerDetails.providers.length
                ? ""
                : "<p>No installed remote metadata source supports this record type.</p>";
            return;
        }
        const s = managerComparison.snapshot;
        features.api.q("mmoManagerSourceResult").innerHTML =
            "<p>" +
            features.api.esc(s.binding.provider) +
            " · " +
            features.api.esc(s.binding.recordId) +
            " · retrieved " +
            features.api.esc(new Date(s.retrievedAt).toLocaleString()) +
            "</p>" +
            managerComparison.notes.map((n) => '<p class="secondaryText">' + features.api.esc(n) + "</p>").join("") +
            Object.entries(s.offered)
                .filter(([field]) => field in managerDetails.stored)
                .map(([field, value]) => {
                    const incompleteDate =
                        ["premiereDate", "endDate"].includes(field) && typeof value === "string" && !/^\d{4}-\d{2}-\d{2}(T.*)?$/.test(value);
                    const unavailable = value == null || value === "" || (Array.isArray(value) && !value.length);
                    return (
                        '<section class="mmo-field"><h4>' +
                        features.api.esc(features.navigation.human(field)) +
                        "</h4><p>Current: " +
                        features.api.esc(features.navigation.formatValue(managerDetails.stored[field])) +
                        '</p><div class="mmo-diff"><div><strong>Source offers</strong><p>' +
                        features.api.esc(features.navigation.formatValue(value)) +
                        "</p></div><div><strong>Configured provider offers</strong><p>" +
                        features.api.esc(features.navigation.formatValue(s.configured[field])) +
                        "</p></div></div>" +
                        (incompleteDate
                            ? '<p class="secondaryText">This source date is incomplete. Use the known year, when offered, or enter a complete date manually.</p>'
                            : unavailable
                              ? '<p class="secondaryText">Unavailable from this source</p>'
                              : features.navigation.nativeButton("Use in local edit", 'data-source-field="' + field + '"')) +
                        "</section>"
                    );
                })
                .join("") +
            managerComparison.images
                .map(
                    (image, index) =>
                        '<div class="mmo-image-card"><h4>' +
                        features.api.esc(image.type) +
                        " · " +
                        features.api.esc(image.providerName || s.binding.provider) +
                        '</h4><img class="mmo-artwork" loading="lazy" src="' +
                        features.api.esc(image.url) +
                        '" alt="Source artwork candidate" />' +
                        features.navigation.nativeButton("Cache for review", 'data-source-image="' + index + '"') +
                        "</div>",
                )
                .join("");
    }
    async function selectItemTab(tab: string) {
        if (tab !== features.navigation.ui.itemTab) features.notifications.notifications.clear();
        if (!features.api.q("mmoWorkspaceTabs").querySelector<HTMLElement>('[data-item-tab="' + tab + '"]')) tab = "metadata";
        features.navigation.ui.itemTab = tab;
        features.api
            .q("mmoWorkspaceTabs")
            .querySelectorAll<HTMLElement>("[data-item-tab]")
            .forEach((b) => (b.setAttribute("aria-selected", String(b.dataset.itemTab === tab)), (b.tabIndex = b.dataset.itemTab === tab ? 0 : -1)));
        features.api
            .q("mmoManagerEditor")
            .querySelectorAll<HTMLElement>("[data-item-panel]")
            .forEach((el) => (el.hidden = el.dataset.itemPanel !== tab));
        if (tab === "tracks") await loadAlbumTracks();
        if (tab === "artwork") features.navigation.hydratePins(features.api.q("mmoManagerImages"));
    }
    async function loadAlbumTracks() {
        const id = managerDetails.id,
            serial = features.navigation.ui.request;
        features.api.q("mmoAlbumTracks").textContent = "Loading tracks…";
        const result = await features.api.api(`manager/items/${id}/tracks`);
        if (serial !== features.navigation.ui.request || managerDetails.id !== id) return;
        features.api.q("mmoAlbumTracks").innerHTML =
            result.items
                .map(
                    (t) =>
                        '<div class="mmo-row"><div class="mmo-track-number">Disc ' +
                        features.api.esc(t.discNumber ?? "—") +
                        " · " +
                        features.api.esc(t.trackNumber ?? "—") +
                        '</div><div class="mmo-row-main">' +
                        features.navigation.nativeButton(t.name, 'data-track-item="' + t.id + '"') +
                        features.nativeLinks.nativeLink(t.id, t.name) +
                        '<p class="secondaryText">' +
                        features.api.esc(t.artists.join(", ")) +
                        (t.managed ? " · Managed" : "") +
                        "</p></div></div>",
                )
                .join("") || "<p>No child tracks.</p>";
    }
    function renderArtistLinks() {
        const identity = features.api.doc.identities.find(
            (i) =>
                i.id === managerPolicy.identityId ||
                i.artistId === managerDetails.id ||
                i.personId === managerDetails.id ||
                (i.artistIds || []).includes(managerDetails.id) ||
                (i.personIds || []).includes(managerDetails.id),
        );
        features.api.q("mmoEditLinkedIdentity").textContent = identity ? "Edit aliases and bindings" : "Create an identity for this artist";
        features.api.q("mmoEditLinkedIdentity").dataset.identity = identity?.id || "";
        features.api.q("mmoArtistLinks").innerHTML = identity
            ? "<p>Canonical artist: <strong>" +
              features.api.esc(identity.preferredName) +
              "</strong></p><p>Recognized aliases: " +
              features.api.esc(identity.aliases.join(", ")) +
              "</p><p>Track and album credits retain their original labels. Credit mappings are separate corrections.</p><details><summary>Native bindings</summary><p>" +
              features.navigation.nativeButton("MusicArtist representative", 'data-linked-record="' + features.api.esc(identity.artistId) + '"') +
              features.nativeLinks.nativeLink(identity.artistId, "MusicArtist representative") +
              "</p><p>" +
              features.navigation.nativeButton("Person representative", 'data-linked-record="' + features.api.esc(identity.personId) + '"') +
              features.nativeLinks.nativeLink(identity.personId, "Person representative") +
              "</p>" +
              [...(identity.artistIds || []), ...(identity.personIds || [])]
                  .map(
                      (id) =>
                          "<p>" +
                          features.navigation.nativeButton(id, 'data-linked-record="' + features.api.esc(id) + '"') +
                          features.nativeLinks.nativeLink(id, "linked artist record") +
                          "</p>",
                  )
                  .join("") +
              "</details>"
            : "<p>This native artist record has no approved canonical identity. Its metadata can be managed independently.</p>";
    }
    function renderIssueStatus(s: Status) {
        features.api.q("mmoIssueStatus").innerHTML =
            (s.reports?.length
                ? s.reports
                      .map((r) => "<p>" + features.api.esc(r.message) + features.nativeLinks.nativeLink(r.itemId, "reported item") + "</p>")
                      .join("")
                : "") +
                [...(!s.reports?.length ? s.errors || [] : []), ...(s.unmatchedRules || []).map((x) => "Unmatched correction: " + x)]
                    .map((x) => "<p>" + features.api.esc(x) + "</p>")
                    .join("") || "<p>No application failures or unmatched rules reported.</p>";
    }
    function renderMetadataDrafts() {
        const active = features.api.doc.policies || [],
            drafts = features.api.doc.policyDrafts || [];
        features.api.q("mmoManagerPolicies").innerHTML = active
            .concat(drafts.filter((d) => !active.some((p) => p.id === d.id)))
            .map((p) => {
                const live = active.some((x) => x.id === p.id),
                    pending = live && drafts.some((x) => x.id === p.id);
                const edit = features.navigation.nativeButton("Edit", 'data-policy-edit="' + p.id + '"');
                const actions =
                    (pending ? features.navigation.nativeButton("Resume pending changes", 'data-policy-resume="' + p.id + '"') : "") +
                    (live
                        ? features.navigation.nativeButton("Review disable", 'data-policy-disable="' + p.id + '"') +
                          features.navigation.nativeButton("Review delete", 'data-policy-delete-active="' + p.id + '"')
                        : features.navigation.nativeButton("Review & apply", 'data-policy-preview="' + p.id + '"')) +
                    (drafts.some((d) => d.id === p.id)
                        ? features.navigation.nativeButton(live ? "Discard pending changes" : "Delete draft", 'data-policy-delete="' + p.id + '"')
                        : "");
                return features.changes.changeRow(p.label || p.identityId || p.itemId, "metadata", live, pending, edit, actions, "policy", p.id);
            })
            .join("");
    }
    function setEditorWritable() {
        const writable = managerDetails.dependencies.canEdit && !managerDetails.linkedOnly;
        for (const id of [
            "mmoManagerPreview",
            "mmoManagerSave",
            "mmoManagerUploadCache",
            "mmoManagerBatchAdd",
            "mmoManagerStop",
            "mmoManagerRestore",
        ])
            features.api.q<HTMLButtonElement>(id).disabled =
                !writable || (id === "mmoManagerSave" && features.navigation.ui.pendingSaves.has(features.navigation.ui.editor?.key ?? ""));
        features.navigation.syncBatchButton();
        features.api.q("mmoManagerLibraries").disabled = !!managerDetails.linkedOnly || managerDetails.dependencies.nonMusic.length > 0;
        for (const row of features.api.q("mmoManagerFields").querySelectorAll<HTMLElement>("[data-field]")) {
            setFieldState(row!);
            if (!writable) {
                row.querySelector<HTMLInputElement>("[data-value]")!.disabled = true;
                row.querySelectorAll<HTMLButtonElement>("[data-field-action]").forEach((button) => (button.disabled = true));
            }
        }
        features.api
            .q("mmoManagerImages")
            .querySelectorAll<HTMLButtonElement>("button")
            .forEach((button) => (button.disabled = !writable));
        features.api
            .q("mmoManagerSourceResult")
            .querySelectorAll<HTMLButtonElement>("button")
            .forEach((button) => (button.disabled = !writable));
    }
    return {
        initialize() {
            features.api.q("mmoInventoryForm").onsubmit = (e) => {
                e.preventDefault();
                managerStart = 0;
                features.api.perform(managerInventory);
            };
            features.api.q("mmoInventoryFind").onclick = null;
            features.api.q("mmoInventoryPrev").onclick = () =>
                features.api.perform(async (operation) => {
                    features.notifications.notifications.scope(operation);
                    managerStart = Math.max(0, managerStart - features.table.tablePageSize);
                    await managerInventory();
                });
            features.api.q("mmoInventoryNext").onclick = () =>
                features.api.perform(async (operation) => {
                    features.notifications.notifications.scope(operation);
                    managerStart += features.table.tablePageSize;
                    await managerInventory();
                });
            for (const id of ["mmoInventoryLibrary", "mmoInventoryKind", "mmoInventoryView"])
                features.api.q(id).onchange = () =>
                    features.api.perform(async (operation) => {
                        features.notifications.notifications.scope(operation);
                        managerStart = 0;
                        await managerInventory();
                    });
            features.api.q("mmoInventoryRows").onclick = (e) =>
                features.api.perform(async (operation) => {
                    const message = features.notifications.notifications.scope(operation);
                    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
                    if (!b) return;
                    if (b.dataset.inventoryIdentity) {
                        const identity = features.api.doc.identities.find((i) => i.id === b.dataset.inventoryIdentity);
                        try {
                            await managerOpen(identity!.artistId);
                        } catch (caughtError) {
                            const err = operationError(caughtError);
                            await features.identities.editIdentity(identity);
                            message("Representative unavailable: " + err.message, "warning");
                        }
                    } else if (b.dataset.managerItem) await managerOpen(b.dataset.managerItem);
                });
            features.api.q("mmoManagerFields").oninput = (e) => {
                const row = (e.target as HTMLElement).closest<HTMLElement>("[data-field]");
                if (!row) return;
                row.querySelector<HTMLSelectElement>("[data-mode]")!.value = "approved";
                const d = managerPolicy.fields[row.dataset.field!];
                if (d) {
                    delete d.snapshotId;
                    delete d.sourceField;
                    d.provenance = "known";
                }
                row.querySelector<HTMLElement>("[data-source]")!.textContent = "Source: Known · manual edit";
                setFieldState(row!);
                features.rules.invalidateReview();
                features.navigation.markDirty();
            };
            features.api.q("mmoManagerFields").onclick = (e) => {
                const action = (e.target as HTMLElement).closest<HTMLElement>("[data-field-action]");
                if (!action) return;
                const row = action.closest<HTMLElement>("[data-field]");
                row!.querySelector<HTMLSelectElement>("[data-mode]")!.value =
                    action.dataset.fieldAction === "approve" ? "approved" : action.dataset.fieldAction!;
                setFieldState(row!);
                features.rules.invalidateReview();
                features.navigation.markDirty();
            };
            features.api.q("mmoManagerLibraries").onchange = () =>
                features.api.perform(async (operation) => {
                    features.notifications.notifications.scope(operation);
                    readManagerFields();
                    features.rules.invalidateReview();
                    features.navigation.markDirty();
                    const serial = features.navigation.ui.request;
                    const p = new URLSearchParams();
                    managerPolicy.libraries.forEach((x) => p.append("libraries", x));
                    const d = await features.api.api(`manager/items/${managerDetails.id}/dependencies?${p}`);
                    if (serial !== features.navigation.ui.request) return;
                    managerDetails.dependencies = d;
                    features.api.q("mmoManagerReadOnly").hidden = d.canEdit;
                    setEditorWritable();
                });
            features.api.q("mmoManagerSourceProvider").onchange = managerSourceChanged;
            features.api.q("mmoManagerCompare").onclick = () =>
                features.api.perform(async (operation) => {
                    const message = features.notifications.notifications.scope(operation);
                    readManagerFields();
                    if (!features.api.q("mmoManagerSourceConfirm").checked) throw Error("Confirm the intended source record before fetching.");
                    const serial = features.navigation.ui.request,
                        compareSerial = ++features.navigation.ui.comparisonRequest,
                        id = managerDetails.id;
                    message("Fetching comparison…", "loading");
                    const sourceSelection = () =>
                        JSON.stringify([
                            features.api.q("mmoManagerSourceProvider").value,
                            features.api.q("mmoManagerSourceKey").value,
                            features.api.q("mmoManagerSourceId").value,
                            features.api.q("mmoManagerSourceConfirm").checked,
                        ]);
                    const selectedSource = sourceSelection();
                    const comparison = await features.api.api("manager/compare", "POST", {
                        itemId: id,
                        provider: features.api.q("mmoManagerSourceProvider").value,
                        key: features.api.q("mmoManagerSourceKey").value,
                        recordId: features.api.q("mmoManagerSourceId").value,
                        confirm: true,
                    });
                    if (
                        serial !== features.navigation.ui.request ||
                        managerDetails.id !== id ||
                        compareSerial !== features.navigation.ui.comparisonRequest
                    )
                        return;
                    if (selectedSource !== sourceSelection()) {
                        message("Source selection changed. Fetch comparison again for the current selection.", "warning");
                        return;
                    }
                    managerComparison = comparison;
                    const s = comparison.snapshot;
                    if (managerDetails.dependencies.canEdit && !managerDetails.linkedOnly) {
                        managerPolicy.bindings.push(s.binding);
                        managerPolicy.snapshots.push(s);
                        features.rules.invalidateReview();
                        features.navigation.markDirty();
                        features.navigation.ui.locals.get(features.navigation.ui.editor!.key)!.comparison = comparison;
                    }
                    renderComparison();
                    setEditorWritable();
                    message("Comparison fetched. Active metadata is unchanged.");
                });
            features.api.q("mmoManagerSourceResult").onclick = (e) =>
                features.api.perform(async (operation) => {
                    const message = features.notifications.notifications.scope(operation);
                    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
                    if (!b) return;
                    const field = b.dataset.sourceField!,
                        index = b.dataset.sourceImage;
                    if (field) {
                        readManagerFields();
                        const s = managerComparison!.snapshot;
                        managerPolicy.fields[field] = {
                            mode: "approved",
                            value: s.offered[field],
                            provenance: "known",
                            snapshotId: s.id,
                            sourceField: field,
                        };
                        renderManagerFields();
                        features.rules.invalidateReview();
                        features.navigation.markDirty();
                        message(features.navigation.human(field) + " selected for the local edit.");
                    }
                    if (index !== undefined) {
                        const offered = managerComparison!.images[Number(index)],
                            serial = features.navigation.ui.request;
                        const imageBefore = JSON.stringify(managerPolicy.images[offered!.type]);
                        const snapshotId = managerComparison!.snapshot.id;
                        message("Caching artwork…", "loading");
                        const image = await features.api.api("manager/images/cache", "POST", {
                            itemId: managerDetails.id,
                            snapshotId: managerComparison!.snapshot.id,
                            url: offered!.url,
                            type: offered!.type,
                        });
                        if (serial !== features.navigation.ui.request) return;
                        if (JSON.stringify(managerPolicy.images[offered!.type]) !== imageBefore || managerComparison?.snapshot.id !== snapshotId) {
                            message("Artwork cached, but your selection changed. Cache again to stage the intended image.", "warning");
                            return;
                        }
                        managerPolicy.images[offered!.type] = image;
                        renderManagerImages();
                        features.rules.invalidateReview();
                        features.navigation.markDirty();
                        message("Artwork cached for review.");
                    }
                });
            features.api.q("mmoManagerImages").onclick = (e) =>
                features.api.perform(async (operation) => {
                    const message = features.notifications.notifications.scope(operation);
                    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
                    if (!b) return;
                    const serial = features.navigation.ui.request;
                    if (b.dataset.imageCurrent) {
                        const imageBefore = JSON.stringify(managerPolicy.images[b.dataset.imageCurrent]);
                        message("Caching artwork…", "loading");
                        const image = await features.api.api(
                            `manager/items/${managerDetails.id}/images/${b.dataset.imageCurrent}/pin-current`,
                            "POST",
                        );
                        if (serial !== features.navigation.ui.request) return;
                        if (JSON.stringify(managerPolicy.images[b.dataset.imageCurrent]) !== imageBefore) {
                            message("Artwork selection changed while caching. Keep the current selection or cache again.", "warning");
                            return;
                        }
                        managerPolicy.images[b.dataset.imageCurrent] = image;
                    } else if (b.dataset.imageEmpty) managerPolicy.images[b.dataset.imageEmpty] = { mode: "empty" };
                    else if (b.dataset.imageUnmanage) managerPolicy.images[b.dataset.imageUnmanage] = { mode: "unmanaged" };
                    else return;
                    renderManagerImages();
                    features.rules.invalidateReview();
                    features.navigation.markDirty();
                });
            features.api.q("mmoManagerPreview").onclick = () =>
                features.api.perform(async (operation) => {
                    features.notifications.notifications.scope(operation);
                    const policy = readManagerFields();
                    await features.rules.preview({ metadataEdits: [policy] });
                });
            features.api.q("mmoManagerSave").onclick = () =>
                features.api.perform(() =>
                    features.navigation.saveLocalDraft("manager/drafts", readManagerFields(), features.api.q("mmoManagerSave")),
                );
            features.api.q("mmoManagerCancel").onclick = () =>
                features.api.perform(async (operation) => {
                    const message = features.notifications.notifications.scope(operation);
                    const saving = features.navigation.ui.pendingSaves.has(features.navigation.ui.editor?.key ?? "");
                    features.navigation.clearLocal();
                    features.navigation.ui.editor = null;
                    await features.navigation.workspaceBack();
                    message(
                        saving
                            ? "Local edit discarded. The pending save continues; active values are unchanged."
                            : "Local edit discarded. Saved and active values are unchanged.",
                    );
                });
            features.api.q("mmoManagerBatchAdd").onclick = () =>
                features.api.perform(async (operation) => {
                    const message = features.notifications.notifications.scope(operation);
                    const p = readManagerFields();
                    if (managerBatch.some((x) => x.id === p.id && JSON.stringify(x) === JSON.stringify(p))) {
                        message("This edit is already added to batch.");
                        return;
                    }
                    managerBatch = managerBatch.filter((x) => x.id !== p.id).concat([p]);
                    features.navigation.renderBatch();
                    message("Edit added to the optional batch review.");
                });
            features.api.q("mmoManagerBatchPreview").onclick = () =>
                features.api.perform(async (operation) => {
                    features.notifications.notifications.scope(operation);
                    if (!managerBatch.length) throw Error("Add edits to the batch first.");
                    await features.rules.preview({ metadataEdits: managerBatch });
                });
            features.api.q("mmoManagerStop").onclick = () =>
                features.api.perform(() =>
                    features.rules.preview({
                        relinquish: [
                            {
                                itemId: managerDetails.id,
                                fields: Object.keys(managerDetails.policy.fields).filter(
                                    (f) => managerDetails.policy.fields[f]!.mode !== "unmanaged",
                                ),
                                images: Object.keys(managerDetails.policy.images).filter(
                                    (t) => managerDetails.policy.images[t]!.mode !== "unmanaged",
                                ),
                                restoreOriginal: false,
                            },
                        ],
                    }),
                );
            features.api.q("mmoManagerRestore").onclick = () =>
                features.api.perform(() =>
                    features.rules.preview({
                        relinquish: [
                            {
                                itemId: managerDetails.id,
                                fields: [
                                    ...new Set([
                                        ...Object.keys(managerDetails.policy.fields).filter(
                                            (f) => managerDetails.policy.fields[f]!.mode !== "unmanaged",
                                        ),
                                        ...Object.keys(managerDetails.original?.original || {}),
                                        ...Object.keys(managerDetails.correctionOriginal?.original || {}),
                                    ]),
                                ],
                                images: [
                                    ...new Set([
                                        ...Object.keys(managerDetails.policy.images).filter(
                                            (t) => managerDetails.policy.images[t]!.mode !== "unmanaged",
                                        ),
                                        ...Object.keys(managerDetails.original?.originalImages || {}),
                                    ]),
                                ],
                                restoreOriginal: true,
                            },
                        ],
                    }),
                );
            features.api.q("mmoArtworkChoose").onclick = () => features.api.q("mmoManagerUpload").click();
            features.api.q("mmoManagerUpload").addEventListener("change", () => {
                features.api.q("mmoArtworkFilename").textContent = features.api.q("mmoManagerUpload").files![0]?.name || "No artwork selected";
            });
            features.api.q("mmoManagerUploadCache").onclick = () =>
                features.api.perform(async (operation) => {
                    const message = features.notifications.notifications.scope(operation);
                    const file = features.api.q("mmoManagerUpload").files![0];
                    if (!file) throw Error("Select an image first.");
                    const serial = features.navigation.ui.request,
                        type = features.api.q("mmoManagerUploadType").value;
                    const imageBefore = JSON.stringify(managerPolicy.images[type]);
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
                    if (serial !== features.navigation.ui.request) return;
                    if (
                        features.api.q("mmoManagerUpload").files![0] !== file ||
                        features.api.q("mmoManagerUploadType").value !== type ||
                        JSON.stringify(managerPolicy.images[type]) !== imageBefore
                    ) {
                        message("Artwork cached, but your selection changed. Cache again to stage the intended image.", "warning");
                        return;
                    }
                    managerPolicy.images[type] = image;
                    renderManagerImages();
                    features.rules.invalidateReview();
                    features.navigation.markDirty();
                    message("Artwork cached. Preview and apply to activate it.");
                });
            features.api.q("mmoManagerIssueRefresh").onclick = () => features.api.perform(features.issues.refreshIssues);
            features.api.q("mmoManagerPolicies").onclick = (e) =>
                features.api.perform(async (operation) => {
                    features.notifications.notifications.scope(operation);
                    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
                    if (!b) return;
                    if (b.dataset.policyDisable) return features.rules.preview({ disablePolicies: [b.dataset.policyDisable] });
                    if (b.dataset.policyDeleteActive) return features.rules.preview({ deletePolicies: [b.dataset.policyDeleteActive] });
                    if (b.dataset.policyPreview) return features.rules.preview({ activatePolicies: [b.dataset.policyPreview] });
                    if (b.dataset.policyDelete) {
                        await features.api.api(`manager/drafts/${b.dataset.policyDelete}`, "DELETE");
                        features.rules.invalidateReview();
                        await features.rules.load();
                        return;
                    }
                    const id = b.dataset.policyEdit || b.dataset.policyResume;
                    if (!id) return;
                    const p = (
                        b.dataset.policyResume
                            ? features.api.doc.policyDrafts
                            : (features.api.doc.policies || []).concat(features.api.doc.policyDrafts || [])
                    ).find((x) => x.id === id);
                    const item = p!.identityId ? features.api.doc.identities.find((x) => x.id === p!.identityId)?.artistId : p!.itemId;
                    if (!item) throw Error("Rebind the missing canonical identity first.");
                    await managerOpen(item, p);
                });
            features.api.q("mmoWorkspaceTabs").onclick = (e) => {
                const b = (e.target as HTMLElement).closest<HTMLElement>("[data-item-tab]");
                if (b) features.api.perform(() => selectItemTab(b.dataset.itemTab!));
            };
            features.api.q("mmoAlbumTracks").onclick = (e) => {
                const id = (e.target as HTMLElement).closest<HTMLElement>("[data-track-item]")?.dataset.trackItem;
                if (id) features.api.perform(() => managerOpen(id, undefined, true));
            };
            features.api.q("mmoAlbumDefaults").onclick = () => {
                const existing = features.api.doc.active.find((r) => r.kind === "album" && r.path === managerDetails.path);
                features.rules.edit(
                    existing || {
                        id: crypto.randomUUID().replaceAll("-", ""),
                        label: managerDetails.name + " folder defaults",
                        kind: "album",
                        path: managerDetails.path,
                        libraries: managerPolicy.libraries,
                        fields: {},
                        trackDefaults: {},
                    },
                    true,
                );
            };
            features.api.q("mmoEditLinkedIdentity").onclick = () => {
                const identity = features.api.doc.identities.find((i) => i.id === features.api.q("mmoEditLinkedIdentity").dataset.identity);
                features.api.perform(() =>
                    features.identities.editIdentity(
                        identity || {
                            preferredName: managerDetails.name,
                            aliases: [managerDetails.name],
                            libraries: managerPolicy.libraries,
                            ...(managerDetails.kind === "MusicArtist" ? { artistId: managerDetails.id } : { personId: managerDetails.id }),
                        },
                        true,
                    ),
                );
            };
            for (const id of ["mmoArtistLinks", "mmoDependencyDetails"])
                features.api.q(id).onclick = (e) => {
                    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
                    const item = b?.dataset.linkedRecord || b?.dataset.dependencyItem;
                    if (item) features.api.perform(() => managerOpen(item, undefined, true));
                };
            for (const id of ["mmoManagerSourceKey", "mmoManagerSourceId"])
                features.api.q(id).addEventListener("input", () => {
                    features.navigation.ui.comparisonRequest++;
                    features.api.q("mmoManagerSourceConfirm").checked = false;
                });
        },
        get managerStart() {
            return managerStart;
        },
        set managerStart(value: typeof managerStart) {
            managerStart = value;
        },
        get managerDetails() {
            return managerDetails;
        },
        set managerDetails(value: typeof managerDetails) {
            managerDetails = value;
        },
        get managerPolicy() {
            return managerPolicy;
        },
        set managerPolicy(value: typeof managerPolicy) {
            managerPolicy = value;
        },
        get managerComparison() {
            return managerComparison;
        },
        set managerComparison(value: typeof managerComparison) {
            managerComparison = value;
        },
        get managerBatch() {
            return managerBatch;
        },
        set managerBatch(value: typeof managerBatch) {
            managerBatch = value;
        },
        get managerFields() {
            return managerFields;
        },
        get arrayFields() {
            return arrayFields;
        },
        get numberFields() {
            return numberFields;
        },
        get advancedFields() {
            return advancedFields;
        },
        get requiredFields() {
            return requiredFields;
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
