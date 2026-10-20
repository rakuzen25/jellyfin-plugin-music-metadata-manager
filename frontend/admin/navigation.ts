import type { MetadataPolicy, ArtistIdentity, Rule } from "./contracts.ts";
import type { Editor, LocalEdit } from "./state.ts";
import type { ControllerContracts } from "./controllerContracts.ts";
import type { DashboardState } from "./dashboardState.ts";
export interface NavigationDependencies {
    rules: Pick<ControllerContracts["rules"], "edit" | "formRule" | "invalidateReview" | "labels" | "load" | "status">;
    api: Pick<ControllerContracts["api"], "api" | "esc" | "page" | "q">;
    managerUi: Pick<ControllerContracts["managerUi"], "managerOpen" | "readManagerFields" | "selectItemTab" | "setEditorWritable" | "setFieldState">;
    identities: Pick<ControllerContracts["identities"], "editIdentity" | "identityForm">;
    notifications: Pick<ControllerContracts["notifications"], "notifications">;
    issueGuidance: Pick<
        ControllerContracts["issueGuidance"],
        "checkIssueResolution" | "focusIssueEditor" | "openIssuePanel" | "renderIssueResults" | "resetIssueEditor" | "stopIssueVerification"
    >;
    rowMenu: Pick<ControllerContracts["rowMenu"], "closeRowMenu">;
    issues: Pick<ControllerContracts["issues"], "refreshIssues">;
    changes: Pick<ControllerContracts["changes"], "renderChanges">;
    nativeLinks: Pick<ControllerContracts["nativeLinks"], "nativeLink">;
}
export function createNavigation(ports: NavigationDependencies, session: DashboardState) {
    // Visit-local state. No draft or configuration is written by navigation.

    const humanLabels: Record<string, string> = {
        ...ports.rules.labels,
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
            ports.api.esc(text) +
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
            (session.api.doc?.drafts?.length || 0) + (session.api.doc?.identityDrafts?.length || 0) + (session.api.doc?.policyDrafts?.length || 0);
        ports.api.q("mmoChangesBadge").textContent = [
            saved ? saved + " saved" : "",
            session.navigation.ui.locals.size ? session.navigation.ui.locals.size + " unfinished" : "",
        ]
            .filter(Boolean)
            .join(" · ");
        ports.api.q("mmoLocalSection").hidden = !session.navigation.ui.locals.size;
        ports.api.q("mmoLocalEdits").innerHTML = [...session.navigation.ui.locals]
            .map(
                ([key, entry]) =>
                    '<div class="mmo-row"><div class="mmo-row-main"><strong>' +
                    ports.api.esc(entry.name) +
                    '</strong><p class="secondaryText">Unfinished ' +
                    ports.api.esc(entry.type) +
                    " edit · not saved" +
                    (entry.baselineChanged ? " · active baseline changed; preview again" : "") +
                    '</p></div><div class="mmo-row-actions">' +
                    nativeButton("Resume", 'data-local-resume="' + ports.api.esc(key) + '"') +
                    nativeButton("Discard", 'data-local-discard="' + ports.api.esc(key) + '"') +
                    "</div></div>",
            )
            .join("");
        renderBatch();
    }
    function rawFields() {
        return session.managerUi.managerDetails
            ? [...ports.api.q("mmoManagerFields").querySelectorAll<HTMLElement>("[data-field]")].map((row) => ({
                  field: row.dataset.field!,
                  mode: row.querySelector<HTMLSelectElement>("[data-mode]")!.value,
                  value: row.querySelector<HTMLInputElement>("[data-value]")!.value,
              }))
            : [];
    }
    function captureEditor() {
        const e = session.navigation.ui.editor;
        if (!e || session.navigation.ui.screen !== "workspace" || !e.dirty) return;
        let data, raw;
        if (e.type === "metadata") {
            try {
                data = ports.managerUi.readManagerFields();
            } catch {
                data = structuredClone(session.managerUi.managerPolicy);
            }
            raw = rawFields();
        } else if (e.type === "identity") data = ports.identities.identityForm();
        else data = ports.rules.formRule();
        session.navigation.ui.locals.set(e.key, {
            ...e,
            baselineChanged: e.baselineChanged || session.navigation.ui.locals.get(e.key)?.baselineChanged || false,
            data: structuredClone(data),
            raw,
            tab: session.navigation.ui.itemTab,
            comparison: e.type === "metadata" ? session.managerUi.managerComparison : null,
        });
        updateLocalCount();
    }
    function markDirty() {
        if (!session.navigation.ui.editor) return;
        ports.rules.invalidateReview();
        session.navigation.ui.editor.dirty = true;
        session.navigation.ui.editor.sequence = (session.navigation.ui.editor.sequence || 0) + 1;
        ports.api.q("mmoWorkspaceState").textContent = "Unfinished local edit · save a draft to keep it after reloading";
        captureEditor();
        syncBatchButton();
    }
    function clearLocal(key = session.navigation.ui.editor?.key) {
        if (key) session.navigation.ui.locals.delete(key);
        if (session.navigation.ui.editor?.key === key) session.navigation.ui.editor!.dirty = false;
        updateLocalCount();
    }
    function displayScreen(screen: string) {
        ports.notifications.notifications.clear();
        ports.issueGuidance.stopIssueVerification();
        session.navigation.ui.screen = screen;
        ports.api.q("mmoIssuePanel").hidden = screen !== "issue";
        ports.api.q("mmoMain").hidden = screen !== "list";
        ports.api.q("mmoNavigation").hidden = screen !== "list";
        ports.api.q("mmoWorkspace").hidden = screen !== "workspace";
        ports.api.q("mmoPreviewArea").hidden = screen !== "review";
    }
    async function showDestination(view: string, capture = true, restoreFocus = false) {
        ports.notifications.notifications.clear();
        ports.rowMenu.closeRowMenu();
        if (capture) captureEditor();
        if (session.navigation.ui.screen === "list") session.navigation.ui.scroll.set(session.navigation.ui.view, window.scrollY);
        ports.rules.invalidateReview();
        session.navigation.ui.view = view;
        session.navigation.ui.editor = null;
        session.navigation.ui.stack = [];
        session.navigation.ui.request++;
        displayScreen("list");
        ports.api.page.querySelectorAll<HTMLElement>("[data-destination]").forEach((el) => (el.hidden = el.dataset.destination !== view));
        ports.api
            .q("mmoNavigation")
            .querySelectorAll<HTMLElement>("[data-view]")
            .forEach((el) => (el.dataset.view === view ? el.setAttribute("aria-current", "page") : el.removeAttribute("aria-current")));
        if (view === "issues") {
            if (!session.navigation.ui.issueLoaded) await ports.issues.refreshIssues();
            ports.issueGuidance.renderIssueResults();
            if (session.issueGuidance.issueVerification) void ports.issueGuidance.checkIssueResolution();
        }
        if (view === "tools") await ports.rules.status();
        if (view === "rules") {
            ports.changes.renderChanges();
            updateLocalCount();
        }
        window.scrollTo(0, session.navigation.ui.scroll.get(view) || 0);
        if (restoreFocus && session.navigation.ui.listFocus?.view === view) {
            const ref = session.navigation.ui.listFocus;
            const element = ref.element?.isConnected ? ref.element : ref.selector ? ports.api.page.querySelector<HTMLElement>(ref.selector) : null;
            element?.focus({ preventScroll: true });
        }
    }
    function openWorkspace(type: Editor["type"], key: string, name: string, state: string | null, itemId: string | null | undefined, nested = false) {
        if (session.navigation.ui.screen === "workspace" && nested && session.navigation.ui.editor) {
            captureEditor();
            session.navigation.ui.stack.push({ ...session.navigation.ui.editor, tab: session.navigation.ui.itemTab, scroll: window.scrollY });
        } else if (session.navigation.ui.screen === "list") {
            session.navigation.ui.scroll.set(session.navigation.ui.view, window.scrollY);
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
            session.navigation.ui.listFocus = { view: session.navigation.ui.view, element, selector };
        }
        displayScreen("workspace");
        ports.issueGuidance.resetIssueEditor();
        ports.api.q("mmoRepairControls").hidden = true;
        session.navigation.ui.editor = { type, key, name, itemId, dirty: false, sequence: 0 };
        ports.api.q("mmoWorkspaceTitle").textContent = name;
        ports.api.q("mmoWorkspaceState").textContent = state;
        ports.api.q("mmoWorkspaceNative").innerHTML = ports.nativeLinks.nativeLink(itemId, name, false);
        ports.api.q("mmoManagerEditor").hidden = type !== "metadata";
        ports.api.q("mmoForm").hidden = type !== "rule";
        ports.api.q("mmoIdentityForm").hidden = type !== "identity";
        ports.api.q("mmoItemThumbnail").hidden = !itemId;
        if (itemId) ports.api.q("mmoItemThumbnail").src = nativeImage(itemId);
        ports.api.q("mmoWorkspaceTabs").hidden = type !== "metadata";
        ports.api.q("mmoWorkspaceBack").textContent =
            "← Back to " +
            (session.navigation.ui.stack.length
                ? session.navigation.ui.stack.at(-1)!.name
                : session.navigation.ui.view.charAt(0).toUpperCase() + session.navigation.ui.view.slice(1));
        window.scrollTo(0, 0);
        ports.api.q("mmoWorkspaceTitle").focus({ preventScroll: true });
    }
    async function resumeEntry(entry: Editor & Partial<LocalEdit>, nested = false) {
        if (entry.type === "metadata") await ports.managerUi.managerOpen(entry.itemId!, entry.data as MetadataPolicy | undefined, nested);
        else if (entry.type === "identity") await ports.identities.editIdentity(entry.data as ArtistIdentity | undefined, nested);
        else ports.rules.edit(entry.data as Rule | undefined, nested);
        if (entry.type === "metadata" && entry.raw)
            for (const value of entry.raw) {
                const row = ports.api.q("mmoManagerFields").querySelector<HTMLElement>('[data-field="' + value.field + '"]');
                if (row) {
                    row.querySelector<HTMLInputElement>("[data-value]")!.value = value.value;
                    row.querySelector<HTMLSelectElement>("[data-mode]")!.value = value.mode;
                    ports.managerUi.setFieldState(row);
                }
            }
        if (session.navigation.ui.editor) {
            session.navigation.ui.editor.dirty = !!entry.dirty;
            session.navigation.ui.editor.sequence = entry.sequence || 0;
            session.navigation.ui.editor.baselineChanged = !!entry.baselineChanged;
        }
        if (entry.type === "metadata") await ports.managerUi.selectItemTab(entry.tab || "metadata");
        if (entry.issueRepair && session.navigation.ui.editor)
            ports.issueGuidance.focusIssueEditor(
                entry.issueRepair.issue,
                entry.issueRepair.guided && !!session.issues.repairQueue,
                entry.issueRepair.choice,
                entry.issueRepair.full,
            );
        if (entry.baselineChanged) ports.api.q("mmoWorkspaceState").textContent += " · active baseline changed; preview again";
    }
    async function workspaceBack() {
        captureEditor();
        ports.rules.invalidateReview();
        session.navigation.ui.request++;
        if (session.navigation.ui.stack.length) {
            const entry = session.navigation.ui.stack.pop();
            await resumeEntry(entry!);
            window.scrollTo(0, entry!.scroll || 0);
        } else if (
            session.issueGuidance.issueEditor &&
            session.navigation.ui.editor &&
            session.issueGuidance.issueEditor.key === session.navigation.ui.editor.key
        )
            await ports.issueGuidance.openIssuePanel(session.issueGuidance.issueEditor.issue, session.issueGuidance.issueEditor.guided);
        else await showDestination(session.navigation.ui.view, false, true);
    }
    function syncBatchButton() {
        if (session.navigation.ui.editor?.type !== "metadata" || !session.managerUi.managerPolicy || !session.managerUi.managerDetails) return;
        const staged = session.managerUi.managerBatch.some(
            (p) => p.id === session.managerUi.managerPolicy.id && JSON.stringify(p) === JSON.stringify(session.managerUi.managerPolicy),
        );
        const button = ports.api.q("mmoManagerBatchAdd");
        button.textContent = staged ? "Added to batch" : "Add to batch";
        button.disabled = staged || !session.managerUi.managerDetails.dependencies.canEdit || !!session.managerUi.managerDetails.linkedOnly;
    }
    function renderBatch() {
        syncBatchButton();
        ports.api.q("mmoBatchSection").hidden = !session.managerUi.managerBatch.length;
        ports.api.q("mmoManagerBatchCount").textContent = session.managerUi.managerBatch.length + " edits staged for batch review";
        ports.api.q("mmoBatchRows").innerHTML = session.managerUi.managerBatch
            .map(
                (p) =>
                    '<div class="mmo-row"><div class="mmo-row-main">' +
                    ports.api.esc(p.label || p.itemId || p.identityId) +
                    "</div>" +
                    nativeButton("Remove", 'data-batch-remove="' + ports.api.esc(p.id) + '"') +
                    "</div>",
            )
            .join("");
    }
    async function hydratePins(container = ports.api.page) {
        for (const img of container.querySelectorAll<HTMLImageElement>("img[data-pin-image]")) {
            const hash = img.dataset.pinImage!;
            try {
                let pending = session.navigation.ui.pinUrls.get(hash);
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
                    session.navigation.ui.pinUrls.set(hash, pending);
                }
                img.src = await pending;
            } catch {
                img.hidden = true;
                session.navigation.ui.pinUrls.delete(hash);
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
    function normalizeControls(container = ports.api.page) {
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
        const message = ports.notifications.notifications.scope();
        const key = session.navigation.ui.editor!.key,
            sequence = session.navigation.ui.editor!.sequence || 0;
        if (session.navigation.ui.pendingSaves.has(key)) throw Error("A save for this edit is already pending.");
        message("Saving draft…", "loading");
        session.navigation.ui.pendingSaves.add(key);
        button.disabled = true;
        try {
            await ports.api.api(route, "POST", data);
            const local = session.navigation.ui.locals.get(key);
            const newerEdits =
                (local && local.sequence !== sequence) ||
                (session.navigation.ui.editor?.key === key && session.navigation.ui.editor.sequence !== sequence);
            if (!newerEdits) clearLocal(key);
            const wasReview = session.navigation.ui.screen === "review";
            ports.rules.invalidateReview();
            await ports.rules.load();
            message(
                newerEdits
                    ? "Draft saved; newer edits remain unsaved. The active version is unchanged."
                    : wasReview
                      ? "Draft saved. The active version is unchanged. Return to edit and preview again before applying."
                      : "Draft saved. The active version remains unchanged. Newer local edits are retained.",
            );
        } finally {
            session.navigation.ui.pendingSaves.delete(key);
            if (session.navigation.ui.editor?.type === "metadata") ports.managerUi.setEditorWritable();
        }
    }
    return {
        initialize() {},

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
