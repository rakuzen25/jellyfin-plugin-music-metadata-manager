import type { MetadataPolicy, ArtistIdentity, Rule } from "./contracts.ts";
import type { Editor, LocalEdit, NavigationState } from "./state.ts";
import type { Features } from "./features.ts";
export function createNavigation(features: Features) {
    // Visit-local state. No draft or configuration is written by navigation.
    const ui: NavigationState = {
        view: "library",
        screen: "list",
        editor: null,
        itemTab: "metadata",
        locals: new Map(),
        stack: [],
        scroll: new Map(),
        request: 0,
        inventoryRequest: 0,
        issueRequest: 0,
        reviewOrigin: null,
        previewChange: null,
        previewRevision: null,
        pinUrls: new Map(),
        issueLoaded: false,
        comparisonRequest: 0,
        listFocus: null,
        pendingSaves: new Set(),
    };
    const humanLabels: Record<string, string> = {
        ...features.rules.labels,
        sortName: "Sort name",
        overview: "Biography / overview",
        genres: "Genres",
        tags: "Tags",
        premiereDate: "Release / start date",
        endDate: "End date",
        productionYear: "Year",
        country: "Countries",
        providerIds: "Provider IDs",
        lockedFields: "Locked fields",
        isLocked: "Lock all metadata",
    };
    function human(field: string) {
        return humanLabels[field] || field;
    }
    function nativeButton(text: string | null | undefined, attributes = "", primary = false) {
        return (
            '<button is="emby-button" type="button" class="' +
            (primary ? "raised " : "button-flat ") +
            'emby-button" ' +
            attributes +
            ">" +
            features.api.esc(text) +
            "</button>"
        );
    }
    function formatValue(value: unknown) {
        if (value === null || value === undefined || value === "") return "Empty";
        if (Array.isArray(value)) return value.length ? value.join(", ") : "Empty";
        return typeof value === "object" ? JSON.stringify(value, null, 2) : String(value);
    }
    function nativeImage(id: string, type = "Primary") {
        return ApiClient.getImageUrl(id, { type, maxWidth: 320, quality: 90 });
    }
    function updateLocalCount() {
        const saved =
            (features.api.doc?.drafts?.length || 0) + (features.api.doc?.identityDrafts?.length || 0) + (features.api.doc?.policyDrafts?.length || 0);
        features.api.q("mmoChangesBadge").textContent = [saved ? saved + " saved" : "", ui.locals.size ? ui.locals.size + " unfinished" : ""]
            .filter(Boolean)
            .join(" · ");
        features.api.q("mmoLocalSection").hidden = !ui.locals.size;
        features.api.q("mmoLocalEdits").innerHTML = [...ui.locals]
            .map(
                ([key, entry]) =>
                    '<div class="mmo-row"><div class="mmo-row-main"><strong>' +
                    features.api.esc(entry.name) +
                    '</strong><p class="secondaryText">Unfinished ' +
                    features.api.esc(entry.type) +
                    " edit · not saved" +
                    (entry.baselineChanged ? " · active baseline changed; preview again" : "") +
                    '</p></div><div class="mmo-row-actions">' +
                    nativeButton("Resume", 'data-local-resume="' + features.api.esc(key) + '"') +
                    nativeButton("Discard", 'data-local-discard="' + features.api.esc(key) + '"') +
                    "</div></div>",
            )
            .join("");
        renderBatch();
    }
    function rawFields() {
        return features.managerUi.managerDetails
            ? [...features.api.q("mmoManagerFields").querySelectorAll<HTMLElement>("[data-field]")].map((row) => ({
                  field: row.dataset.field!,
                  mode: row.querySelector<HTMLSelectElement>("[data-mode]")!.value,
                  value: row.querySelector<HTMLInputElement>("[data-value]")!.value,
              }))
            : [];
    }
    function captureEditor() {
        const e = ui.editor;
        if (!e || ui.screen !== "workspace" || !e.dirty) return;
        let data, raw;
        if (e.type === "metadata") {
            try {
                data = features.managerUi.readManagerFields();
            } catch {
                data = structuredClone(features.managerUi.managerPolicy);
            }
            raw = rawFields();
        } else if (e.type === "identity") data = features.identities.identityForm();
        else data = features.rules.formRule();
        ui.locals.set(e.key, {
            ...e,
            baselineChanged: e.baselineChanged || ui.locals.get(e.key)?.baselineChanged || false,
            data: structuredClone(data),
            raw,
            tab: ui.itemTab,
            comparison: e.type === "metadata" ? features.managerUi.managerComparison : null,
        });
        updateLocalCount();
    }
    function markDirty() {
        if (!ui.editor) return;
        features.rules.invalidateReview();
        ui.editor.dirty = true;
        ui.editor.sequence = (ui.editor.sequence || 0) + 1;
        features.api.q("mmoWorkspaceState").textContent = "Unfinished local edit · save a draft to keep it after reloading";
        captureEditor();
        syncBatchButton();
    }
    function clearLocal(key = ui.editor?.key) {
        if (key) ui.locals.delete(key);
        if (ui.editor?.key === key) ui.editor!.dirty = false;
        updateLocalCount();
    }
    function displayScreen(screen: string) {
        features.notifications.notifications.clear();
        features.issueGuidance.stopIssueVerification();
        ui.screen = screen;
        features.api.q("mmoIssuePanel").hidden = screen !== "issue";
        features.api.q("mmoMain").hidden = screen !== "list";
        features.api.q("mmoNavigation").hidden = screen !== "list";
        features.api.q("mmoWorkspace").hidden = screen !== "workspace";
        features.api.q("mmoPreviewArea").hidden = screen !== "review";
    }
    async function showDestination(view: string, capture = true, restoreFocus = false) {
        features.notifications.notifications.clear();
        features.rowMenu.closeRowMenu();
        if (capture) captureEditor();
        if (ui.screen === "list") ui.scroll.set(ui.view, window.scrollY);
        features.rules.invalidateReview();
        ui.view = view;
        ui.editor = null;
        ui.stack = [];
        ui.request++;
        displayScreen("list");
        features.api.page.querySelectorAll<HTMLElement>("[data-destination]").forEach((el) => (el.hidden = el.dataset.destination !== view));
        features.api
            .q("mmoNavigation")
            .querySelectorAll<HTMLElement>("[data-view]")
            .forEach((el) => (el.dataset.view === view ? el.setAttribute("aria-current", "page") : el.removeAttribute("aria-current")));
        if (view === "issues") {
            if (!ui.issueLoaded) await features.issues.refreshIssues();
            features.issueGuidance.renderIssueResults();
            if (features.issueGuidance.issueVerification) void features.issueGuidance.checkIssueResolution();
        }
        if (view === "tools") await features.rules.status();
        if (view === "rules") {
            features.changes.renderChanges();
            updateLocalCount();
        }
        window.scrollTo(0, ui.scroll.get(view) || 0);
        if (restoreFocus && ui.listFocus?.view === view) {
            const ref = ui.listFocus;
            const element = ref.element?.isConnected ? ref.element : ref.selector ? features.api.page.querySelector<HTMLElement>(ref.selector) : null;
            element?.focus({ preventScroll: true });
        }
    }
    function openWorkspace(type: Editor["type"], key: string, name: string, state: string | null, itemId: string | null | undefined, nested = false) {
        if (ui.screen === "workspace" && nested && ui.editor) {
            captureEditor();
            ui.stack.push({ ...ui.editor, tab: ui.itemTab, scroll: window.scrollY });
        } else if (ui.screen === "list") {
            ui.scroll.set(ui.view, window.scrollY);
            const element = document.activeElement as HTMLElement | null;
            let selector;
            if (element?.id) selector = "#" + CSS.escape(element.id);
            else if (element?.dataset)
                for (const key of ["managerItem", "inventoryIdentity", "localResume", "issueItem", "policyEdit"]) {
                    if (element.dataset[key]) {
                        selector = "[data-" + key.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase()) + '="' + CSS.escape(element.dataset[key]) + '"]';
                        break;
                    }
                }
            if (element?.dataset.action)
                selector = '[data-action="' + element.dataset.action + '"][data-id="' + CSS.escape(element.dataset.id!) + '"]';
            if (element?.dataset.issueOpen) selector = '[data-issue-open="' + CSS.escape(element.dataset.issueOpen) + '"]';
            ui.listFocus = { view: ui.view, element, selector };
        }
        displayScreen("workspace");
        features.issueGuidance.resetIssueEditor();
        features.api.q("mmoRepairControls").hidden = true;
        ui.editor = { type, key, name, itemId, dirty: false, sequence: 0 };
        features.api.q("mmoWorkspaceTitle").textContent = name;
        features.api.q("mmoWorkspaceState").textContent = state;
        features.api.q("mmoWorkspaceNative").innerHTML = features.nativeLinks.nativeLink(itemId, name, false);
        features.api.q("mmoManagerEditor").hidden = type !== "metadata";
        features.api.q("mmoForm").hidden = type !== "rule";
        features.api.q("mmoIdentityForm").hidden = type !== "identity";
        features.api.q("mmoItemThumbnail").hidden = !itemId;
        if (itemId) features.api.q("mmoItemThumbnail").src = nativeImage(itemId);
        features.api.q("mmoWorkspaceTabs").hidden = type !== "metadata";
        features.api.q("mmoWorkspaceBack").textContent =
            "← Back to " + (ui.stack.length ? ui.stack.at(-1)!.name : ui.view.charAt(0).toUpperCase() + ui.view.slice(1));
        window.scrollTo(0, 0);
        features.api.q("mmoWorkspaceTitle").focus({ preventScroll: true });
    }
    async function resumeEntry(entry: Editor & Partial<LocalEdit>, nested = false) {
        if (entry.type === "metadata") await features.managerUi.managerOpen(entry.itemId!, entry.data as MetadataPolicy | undefined, nested);
        else if (entry.type === "identity") await features.identities.editIdentity(entry.data as ArtistIdentity | undefined, nested);
        else features.rules.edit(entry.data as Rule | undefined, nested);
        if (entry.type === "metadata" && entry.raw)
            for (const value of entry.raw) {
                const row = features.api.q("mmoManagerFields").querySelector<HTMLElement>('[data-field="' + value.field + '"]');
                if (row) {
                    row.querySelector<HTMLInputElement>("[data-value]")!.value = value.value;
                    row.querySelector<HTMLSelectElement>("[data-mode]")!.value = value.mode;
                    features.managerUi.setFieldState(row);
                }
            }
        if (ui.editor) {
            ui.editor.dirty = !!entry.dirty;
            ui.editor.sequence = entry.sequence || 0;
            ui.editor.baselineChanged = !!entry.baselineChanged;
        }
        if (entry.type === "metadata") await features.managerUi.selectItemTab(entry.tab || "metadata");
        if (entry.issueRepair && ui.editor)
            features.issueGuidance.focusIssueEditor(
                entry.issueRepair.issue,
                entry.issueRepair.guided && !!features.issues.repairQueue,
                entry.issueRepair.choice,
                entry.issueRepair.full,
            );
        if (entry.baselineChanged) features.api.q("mmoWorkspaceState").textContent += " · active baseline changed; preview again";
    }
    async function workspaceBack() {
        captureEditor();
        features.rules.invalidateReview();
        ui.request++;
        if (ui.stack.length) {
            const entry = ui.stack.pop();
            await resumeEntry(entry!);
            window.scrollTo(0, entry!.scroll || 0);
        } else if (features.issueGuidance.issueEditor && ui.editor && features.issueGuidance.issueEditor.key === ui.editor.key)
            await features.issueGuidance.openIssuePanel(features.issueGuidance.issueEditor.issue, features.issueGuidance.issueEditor.guided);
        else await showDestination(ui.view, false, true);
    }
    function syncBatchButton() {
        if (ui.editor?.type !== "metadata" || !features.managerUi.managerPolicy || !features.managerUi.managerDetails) return;
        const staged = features.managerUi.managerBatch.some(
            (p) => p.id === features.managerUi.managerPolicy.id && JSON.stringify(p) === JSON.stringify(features.managerUi.managerPolicy),
        );
        const button = features.api.q("mmoManagerBatchAdd");
        button.textContent = staged ? "Added to batch" : "Add to batch";
        button.disabled = staged || !features.managerUi.managerDetails.dependencies.canEdit || !!features.managerUi.managerDetails.linkedOnly;
    }
    function renderBatch() {
        syncBatchButton();
        features.api.q("mmoBatchSection").hidden = !features.managerUi.managerBatch.length;
        features.api.q("mmoManagerBatchCount").textContent = features.managerUi.managerBatch.length + " edits staged for batch review";
        features.api.q("mmoBatchRows").innerHTML = features.managerUi.managerBatch
            .map(
                (p) =>
                    '<div class="mmo-row"><div class="mmo-row-main">' +
                    features.api.esc(p.label || p.itemId || p.identityId) +
                    "</div>" +
                    nativeButton("Remove", 'data-batch-remove="' + features.api.esc(p.id) + '"') +
                    "</div>",
            )
            .join("");
    }
    async function hydratePins(container = features.api.page) {
        for (const img of container.querySelectorAll<HTMLImageElement>("img[data-pin-image]")) {
            const hash = img.dataset.pinImage!;
            try {
                let pending = ui.pinUrls.get(hash);
                if (!pending) {
                    const headers = {};
                    ApiClient.setRequestHeaders(headers);
                    pending = fetch(ApiClient.getUrl("MusicMetadataManager/manager/images/pins/" + encodeURIComponent(hash)), {
                        headers,
                        credentials: "same-origin",
                    }).then(async (r) => {
                        if (!r.ok) throw Error("Cached artwork unavailable");
                        return URL.createObjectURL(await r.blob());
                    });
                    ui.pinUrls.set(hash, pending);
                }
                img.src = await pending;
            } catch {
                img.hidden = true;
                ui.pinUrls.delete(hash);
                if (!img.parentElement!.querySelector<HTMLElement>("[data-pin-error]")) {
                    const error = document.createElement("p");
                    error.dataset.pinError = "true";
                    error.className = "mmo-warning";
                    error.textContent = "Cached artwork is unavailable. Cache it again before previewing.";
                    img.after(error);
                }
            }
        }
    }
    function normalizeControls(container = features.api.page) {
        // Older correction/identity forms now use the same native widgets as the manager.
        for (const control of container.querySelectorAll<HTMLElement>("button,select,textarea,input")) {
            if (control.tagName === "BUTTON") {
                control.setAttribute("is", "emby-button");
                control.classList.add("emby-button");
                if (!control.classList.contains("raised")) control.classList.add("button-flat");
            }
            if (control.tagName === "SELECT") {
                control.setAttribute("is", "emby-select");
                control.classList.add("emby-select");
            }
            if (control.tagName === "TEXTAREA") {
                control.setAttribute("is", "emby-textarea");
                control.classList.add("emby-textarea");
            }
            if (control.tagName === "INPUT" && (control as HTMLInputElement).type !== "file")
                control.setAttribute("is", (control as HTMLInputElement).type === "checkbox" ? "emby-checkbox" : "emby-input");
        }
    }
    async function saveLocalDraft(route: string, data: Rule | ArtistIdentity | MetadataPolicy, button: HTMLButtonElement) {
        const message = features.notifications.notifications.scope();
        const key = ui.editor!.key,
            sequence = ui.editor!.sequence || 0;
        if (ui.pendingSaves.has(key)) throw Error("A save for this edit is already pending.");
        message("Saving draft…", "loading");
        ui.pendingSaves.add(key);
        button.disabled = true;
        try {
            await features.api.api(route, "POST", data);
            const local = ui.locals.get(key);
            const newerEdits = (local && local.sequence !== sequence) || (ui.editor?.key === key && ui.editor.sequence !== sequence);
            if (!newerEdits) clearLocal(key);
            const wasReview = ui.screen === "review";
            features.rules.invalidateReview();
            await features.rules.load();
            message(
                newerEdits
                    ? "Draft saved; newer edits remain unsaved. The active version is unchanged."
                    : wasReview
                      ? "Draft saved. The active version is unchanged. Return to edit and preview again before applying."
                      : "Draft saved. The active version remains unchanged. Newer local edits are retained.",
            );
        } finally {
            ui.pendingSaves.delete(key);
            if (ui.editor?.type === "metadata") features.managerUi.setEditorWritable();
        }
    }
    return {
        initialize() {},
        get ui() {
            return ui;
        },
        get humanLabels() {
            return humanLabels;
        },
        get human() {
            return human;
        },
        get nativeButton() {
            return nativeButton;
        },
        get formatValue() {
            return formatValue;
        },
        get nativeImage() {
            return nativeImage;
        },
        get updateLocalCount() {
            return updateLocalCount;
        },
        get rawFields() {
            return rawFields;
        },
        get captureEditor() {
            return captureEditor;
        },
        get markDirty() {
            return markDirty;
        },
        get clearLocal() {
            return clearLocal;
        },
        get displayScreen() {
            return displayScreen;
        },
        get showDestination() {
            return showDestination;
        },
        get openWorkspace() {
            return openWorkspace;
        },
        get resumeEntry() {
            return resumeEntry;
        },
        get workspaceBack() {
            return workspaceBack;
        },
        get syncBatchButton() {
            return syncBatchButton;
        },
        get renderBatch() {
            return renderBatch;
        },
        get hydratePins() {
            return hydratePins;
        },
        get normalizeControls() {
            return normalizeControls;
        },
        get saveLocalDraft() {
            return saveLocalDraft;
        },
    };
}
