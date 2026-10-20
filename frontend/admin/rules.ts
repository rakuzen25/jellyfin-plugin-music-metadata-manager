import type { BulkContext, IssueContext } from "./responses.ts";
import type { Change, Fields, Rule } from "./contracts.ts";
import type { ControllerContracts } from "./controllerContracts.ts";
import type { DashboardState } from "./dashboardState.ts";
export interface RulesDependencies {
    api: Pick<ControllerContracts["api"], "api" | "esc" | "perform" | "q">;
    actions: Pick<ControllerContracts["actions"], "actions">;
    notifications: Pick<ControllerContracts["notifications"], "notifications">;
    managerUi: Pick<ControllerContracts["managerUi"], "managerOpen">;
    navigation: Pick<ControllerContracts["navigation"], "clearLocal" | "workspaceBack">;
}
export function createRules(ports: RulesDependencies, session: DashboardState) {
    let load: () => Promise<void>, status: () => Promise<void>;
    let preview: (change: Partial<Change>, bulk?: BulkContext | null, issues?: IssueContext | null) => Promise<void>;
    const keys = ["title", "album", "artists", "albumArtists", "discNumber", "trackNumber"] as const;
    const labels: Record<string, string> = {
        title: "Title",
        album: "Album name",
        artists: "Performers",
        albumArtists: "Album artists",
        discNumber: "Disc number",
        trackNumber: "Track number",
    };
    function typeChanged() {
        const kind = ports.api.q("mmoKind").value;
        ports.api.q("mmoPathArea").hidden = kind === "alias";
        ports.api.q("mmoAliasArea").hidden = kind !== "alias";
        ports.api.q("mmoFieldsArea").hidden = kind === "alias";
        ports.api.q("mmoDefaultsArea").hidden = kind !== "album";
        for (const k of keys)
            ports.api.q("mmoFields").querySelector<HTMLElement>('[data-field="' + k + '"]')!.hidden =
                kind === "album" && ["album", "discNumber", "trackNumber"].includes(k);
    }
    function fill(group: string, fields: Fields = {}) {
        for (const k of keys) {
            const decision = fields.decisions?.[k];
            const value = decision?.mode === "approved" ? decision.value : null;
            ports.api.q<HTMLInputElement | HTMLTextAreaElement>("mmo" + group + k).value = Array.isArray(value)
                ? value.join("\n")
                : String(value ?? "");
        }
    }
    function fields(group: string, albumOnly = false): Fields {
        const result: Fields = { decisions: {} };
        for (const k of keys) {
            if (albumOnly && ["album", "discNumber", "trackNumber"].includes(k)) continue;
            const value = ports.api.q<HTMLInputElement | HTMLTextAreaElement>("mmo" + group + k).value;
            if (!value.trim()) continue;
            if (k === "discNumber" || k === "trackNumber") result.decisions![k] = { mode: "approved", value: Number(value), provenance: "known" };
            else if (k === "artists" || k === "albumArtists")
                result.decisions![k] = {
                    mode: "approved",
                    value: value
                        .split("\n")
                        .map((x) => x.trim())
                        .filter(Boolean),
                    provenance: "known",
                };
            else result.decisions![k] = { mode: "approved", value, provenance: "known" };
        }
        return result;
    }
    let invalidateReview = function invalidateReview() {
        session.api.reviewEpoch++;
        session.api.reviewToken = null;
        ports.actions.actions.setDisabled(ports.api.q("mmoActivate"), true);
        if (session.navigation.ui.screen === "review") {
            ports.api.q("mmoPreviewSummary").textContent = "This review is outdated. Return to edit and preview the current changes before applying.";
        } else ports.api.q("mmoPreviewArea").hidden = true;
    };
    let edit = function edit(r: Partial<Rule> | null | undefined, _nested = false) {
        invalidateReview();
        ports.api.q("mmoEditorState").textContent = r
            ? session.api.doc.active.some((x) => x.id === r.id)
                ? "Editing an active rule. Its current version stays active until you apply reviewed changes."
                : "Editing an inactive draft."
            : "New rule. Preview and apply to activate, or save a draft for later.";
        session.api.editingId = r?.id ?? null;
        ports.api.q("mmoLabel").value = r?.label ?? "";
        ports.api.q("mmoKind").value = r?.kind ?? "track";
        ports.api.q("mmoPath").value = r?.path ?? "";
        ports.api.q("mmoCredit").value = r?.credit ?? "";
        ports.api.q("mmoNames").value = (r?.names ?? []).join("\n");
        ports.api.q("mmoRole").value = r?.role ?? "artists";
        for (const o of ports.api.q("mmoLibraries").options) o.selected = (r?.libraries ?? []).includes(o.value);
        fill("Fields", r?.fields);
        fill("Defaults", r?.trackDefaults);
        typeChanged();
    };
    function button(action: string, id: string, label: string) {
        return (
            '<button is="emby-button" class="button-flat emby-button" type="button" data-action="' +
            action +
            '" data-id="' +
            ports.api.esc(id) +
            '">' +
            label +
            "</button>"
        );
    }
    let formRule = function formRule(): Rule {
        const kind = ports.api.q("mmoKind").value;
        return {
            id: session.api.editingId || crypto.randomUUID().replaceAll("-", ""),
            label: ports.api.q("mmoLabel").value,
            kind,
            path: kind === "alias" ? "" : ports.api.q("mmoPath").value,
            credit: kind === "alias" ? ports.api.q("mmoCredit").value : "",
            names:
                kind === "alias"
                    ? ports.api
                          .q("mmoNames")
                          .value.split("\n")
                          .map((x) => x.trim())
                          .filter(Boolean)
                    : [],
            role: ports.api.q("mmoRole").value,
            libraries: Array.from(ports.api.q("mmoLibraries").selectedOptions).map((x) => x.value),
            fields: kind === "alias" ? {} : fields("Fields", kind === "album"),
            trackDefaults: kind === "album" ? fields("Defaults") : {},
        };
    };
    return {
        initialize() {
            for (const group of ["Fields", "Defaults"])
                ports.api.q("mmo" + group).innerHTML = keys
                    .map(
                        (k) =>
                            '<label data-field="' +
                            k +
                            '">' +
                            labels[k] +
                            (k.endsWith("Artists") || k === "artists"
                                ? '<textarea id="mmo' + group + k + '" rows="2" style="display:block;width:100%"></textarea>'
                                : '<input is="emby-input" id="mmo' +
                                  group +
                                  k +
                                  '" ' +
                                  (k.endsWith("Number") ? 'type="number" min="1"' : "") +
                                  " />") +
                            "</label>",
                    )
                    .join("");
            ports.api.q("mmoForm").addEventListener("submit", (e) => {
                e.preventDefault();
                ports.api.perform(async (operation) => {
                    ports.notifications.notifications.scope(operation);
                    const r = formRule();
                    session.api.editingId = r.id;
                    await preview({ edits: [r] });
                });
            });
            ports.api.q("mmoForm").addEventListener("input", invalidateReview);
            ports.api.q("mmoForm").addEventListener("change", invalidateReview);
            ports.api.q("mmoRules").addEventListener("click", (e) => {
                const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-action]");
                if (!b) return;
                ports.api.perform(async (operation) => {
                    const message = ports.notifications.notifications.scope(operation);
                    const id = b.dataset.id!,
                        action = b.dataset.action;
                    if (action === "editActive" || action === "editDraft") {
                        const rule = (action === "editActive" ? session.api.doc.active : session.api.doc.drafts).find((x) => x.id === id);
                        if (rule!.metadata) {
                            await ports.managerUi.managerOpen(rule!.metadata.itemId, {
                                ...rule!.metadata,
                                fields: rule!.fields.decisions || {},
                            });
                        } else {
                            edit(rule);
                            ports.api.q("mmoForm").scrollIntoView();
                        }
                    } else if (action === "deleteDraft") {
                        await ports.api.api(`drafts/${encodeURIComponent(id)}`, "DELETE");
                        invalidateReview();
                        if (session.navigation.ui.screen === "workspace" && session.api.editingId === id) {
                            ports.navigation.clearLocal();
                            await ports.navigation.workspaceBack();
                        }
                        await load();
                        message("Draft deleted. Active rules are unchanged.");
                    } else
                        await preview({
                            activateIds: action === "activate" ? [id] : [],
                            disableIds: action === "disable" ? [id] : [],
                            deleteIds: action === "delete" ? [id] : [],
                        });
                });
            });
            ports.api.q("mmoKind").addEventListener("change", typeChanged);
            ports.api.q("mmoNew").onclick = () => edit(null);
            ports.api.q("mmoFind").onclick = () =>
                ports.api.perform(async (operation) => {
                    const message = ports.notifications.notifications.scope(operation);
                    const lib = ports.api.q("mmoLibraries").selectedOptions[0]?.value,
                        search = ports.api.q("mmoSearch").value,
                        serial = session.navigation.ui.request,
                        key = session.navigation.ui.editor?.key;
                    message("Finding matching items…", "loading");
                    const matches = await ports.api.api(
                        `items?search=${encodeURIComponent(search)}${lib ? "&library=" + encodeURIComponent(lib) : ""}`,
                    );
                    if (serial !== session.navigation.ui.request || key !== session.navigation.ui.editor?.key) return;
                    if (ports.api.q("mmoSearch").value !== search || ports.api.q("mmoLibraries").selectedOptions[0]?.value !== lib) {
                        message("Search changed. Find items again for the current selection.", "warning");
                        return;
                    }
                    session.api.found = matches;
                    message(session.api.found.length + " matching items found.");
                    ports.api.q("mmoItems").innerHTML = session.api.found
                        .map((x, i) => '<option value="' + i + '">' + ports.api.esc(x.kind + " · " + x.path) + "</option>")
                        .join("");
                });
            ports.api.q("mmoChoose").onclick = () => {
                const item = session.api.found[Number(ports.api.q("mmoItems").value)];
                if (!item) return;
                ports.api.q("mmoPath").value = item.path;
                ports.api.q("mmoKind").value = item.kind;
                for (const o of ports.api.q("mmoLibraries").options) o.selected = o.value === item.library;
                typeChanged();
            };
            ports.api.q("mmoPreviewAll").onclick = () =>
                ports.api.perform(() =>
                    preview({
                        activateIds: session.api.doc.drafts.map((x) => x.id),
                        activateIdentities: session.api.doc.identityDrafts.map((x) => x.id),
                        activatePolicies: session.api.doc.policyDrafts.map((x) => x.id),
                    }),
                );
            ports.api.q("mmoApply").onclick = () =>
                ports.api.perform(async (operation) => {
                    const message = ports.notifications.notifications.scope(operation);
                    message("Queuing active corrections…", "loading");
                    const r = await ports.api.api("apply", "POST");
                    await status();
                    message(r.queued + " items queued for correction.");
                });
            ports.api.q("mmoReload").onclick = () => ports.api.perform(load);
            ports.api.q("mmoExport").onclick = () =>
                ports.api.perform(async (operation) => {
                    const message = ports.notifications.notifications.scope(operation);
                    const original = ports.api.q("mmoJson").value;
                    message("Loading export…", "loading");
                    const result = await ports.api.api("export");
                    if (!ports.notifications.notifications.valid(operation)) return;
                    if (ports.api.q("mmoJson").value !== original) {
                        message("The JSON editor changed while loading. Load export again to replace it.", "warning");
                        return;
                    }
                    ports.api.q("mmoJson").value = JSON.stringify(result, null, 2);
                    message("Export loaded into the editor.");
                });
            ports.api.q("mmoDownload").onclick = () =>
                ports.api.perform(async (operation) => {
                    ports.notifications.notifications.scope(operation);
                    const url = URL.createObjectURL(
                        new Blob([JSON.stringify(await ports.api.api("export"), null, 2)], {
                            type: "application/json",
                        }),
                    );
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = "music-metadata-manager.json";
                    a.click();
                    URL.revokeObjectURL(url);
                });
            ports.api.q("mmoImport").onclick = () =>
                ports.api.perform(async (operation) => {
                    const message = ports.notifications.notifications.scope(operation);
                    await ports.api.api("import", "POST", JSON.parse(ports.api.q("mmoJson").value));
                    session.api.reviewToken = null;
                    ports.api.q("mmoPreviewArea").hidden = true;
                    await load();
                    message("Imported as drafts. Active rules were not changed.");
                });
        },
        get load() {
            return load;
        },
        set load(value: typeof load) {
            load = value;
        },
        get status() {
            return status;
        },
        set status(value: typeof status) {
            status = value;
        },
        get preview() {
            return preview;
        },
        set preview(value: typeof preview) {
            preview = value;
        },
        get keys() {
            return keys;
        },
        get labels() {
            return labels;
        },
        get typeChanged() {
            return typeChanged;
        },
        get fill() {
            return fill;
        },
        get fields() {
            return fields;
        },
        get invalidateReview() {
            return invalidateReview;
        },
        set invalidateReview(value: typeof invalidateReview) {
            invalidateReview = value;
        },
        get edit() {
            return edit;
        },
        set edit(value: typeof edit) {
            edit = value;
        },
        get button() {
            return button;
        },
        get formRule() {
            return formRule;
        },
        set formRule(value: typeof formRule) {
            formRule = value;
        },
    };
}
