import type { BulkContext, IssueContext } from "./responses.ts";
import type { Change, Fields, Rule } from "./contracts.ts";
import type { Features } from "./features.ts";
export function createRules(features: Features) {
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
        const kind = features.api.q("mmoKind").value;
        features.api.q("mmoPathArea").hidden = kind === "alias";
        features.api.q("mmoAliasArea").hidden = kind !== "alias";
        features.api.q("mmoFieldsArea").hidden = kind === "alias";
        features.api.q("mmoDefaultsArea").hidden = kind !== "album";
        for (const k of keys)
            features.api.q("mmoFields").querySelector<HTMLElement>('[data-field="' + k + '"]')!.hidden =
                kind === "album" && ["album", "discNumber", "trackNumber"].includes(k);
    }
    function fill(group: string, fields: Fields = {}) {
        for (const k of keys) {
            const value = fields[k];
            features.api.q<HTMLInputElement | HTMLTextAreaElement>("mmo" + group + k).value = Array.isArray(value)
                ? value.join("\n")
                : String(value ?? "");
        }
    }
    function fields(group: string, albumOnly = false): Fields {
        const result: Fields = {};
        for (const k of keys) {
            if (albumOnly && ["album", "discNumber", "trackNumber"].includes(k)) continue;
            const value = features.api.q<HTMLInputElement | HTMLTextAreaElement>("mmo" + group + k).value;
            if (!value.trim()) continue;
            if (k === "discNumber" || k === "trackNumber") result[k] = Number(value);
            else if (k === "artists" || k === "albumArtists")
                result[k] = value
                    .split("\n")
                    .map((x) => x.trim())
                    .filter(Boolean);
            else result[k] = value;
        }
        return result;
    }
    let invalidateReview = function invalidateReview() {
        features.api.reviewEpoch++;
        features.api.reviewToken = null;
        features.actions.actions.setDisabled(features.api.q("mmoActivate"), true);
        if (features.navigation.ui.screen === "review") {
            features.api.q("mmoPreviewSummary").textContent =
                "This review is outdated. Return to edit and preview the current changes before applying.";
        } else features.api.q("mmoPreviewArea").hidden = true;
    };
    let edit = function edit(r: Partial<Rule> | null | undefined, nested = false) {
        invalidateReview();
        features.api.q("mmoEditorState").textContent = r
            ? features.api.doc.active.some((x) => x.id === r.id)
                ? "Editing an active rule. Its current version stays active until you apply reviewed changes."
                : "Editing an inactive draft."
            : "New rule. Preview and apply to activate, or save a draft for later.";
        features.api.editingId = r?.id ?? null;
        features.api.q("mmoLabel").value = r?.label ?? "";
        features.api.q("mmoKind").value = r?.kind ?? "track";
        features.api.q("mmoPath").value = r?.path ?? "";
        features.api.q("mmoCredit").value = r?.credit ?? "";
        features.api.q("mmoNames").value = (r?.names ?? []).join("\n");
        features.api.q("mmoRole").value = r?.role ?? "artists";
        for (const o of features.api.q("mmoLibraries").options) o.selected = (r?.libraries ?? []).includes(o.value);
        fill("Fields", r?.fields);
        fill("Defaults", r?.trackDefaults);
        typeChanged();
    };
    function button(action: string, id: string, label: string) {
        return (
            '<button is="emby-button" class="button-flat emby-button" type="button" data-action="' +
            action +
            '" data-id="' +
            features.api.esc(id) +
            '">' +
            label +
            "</button>"
        );
    }
    let formRule = function formRule(): Rule {
        const kind = features.api.q("mmoKind").value;
        return {
            id: features.api.editingId || crypto.randomUUID().replaceAll("-", ""),
            label: features.api.q("mmoLabel").value,
            kind,
            path: kind === "alias" ? "" : features.api.q("mmoPath").value,
            credit: kind === "alias" ? features.api.q("mmoCredit").value : "",
            names:
                kind === "alias"
                    ? features.api
                          .q("mmoNames")
                          .value.split("\n")
                          .map((x) => x.trim())
                          .filter(Boolean)
                    : [],
            role: features.api.q("mmoRole").value,
            libraries: Array.from(features.api.q("mmoLibraries").selectedOptions).map((x) => x.value),
            fields: kind === "alias" ? {} : fields("Fields", kind === "album"),
            trackDefaults: kind === "album" ? fields("Defaults") : {},
        };
    };
    return {
        initialize() {
            for (const group of ["Fields", "Defaults"])
                features.api.q("mmo" + group).innerHTML = keys
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
            features.api.q("mmoForm").addEventListener("submit", (e) => {
                e.preventDefault();
                features.api.perform(async (operation) => {
                    const message = features.notifications.notifications.scope(operation);
                    const r = formRule();
                    features.api.editingId = r.id;
                    await preview({ edits: [r] });
                });
            });
            features.api.q("mmoForm").addEventListener("input", invalidateReview);
            features.api.q("mmoForm").addEventListener("change", invalidateReview);
            features.api.q("mmoRules").addEventListener("click", (e) => {
                const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-action]");
                if (!b) return;
                features.api.perform(async (operation) => {
                    const message = features.notifications.notifications.scope(operation);
                    const id = b.dataset.id!,
                        action = b.dataset.action;
                    if (action === "editActive" || action === "editDraft") {
                        const rule = (action === "editActive" ? features.api.doc.active : features.api.doc.drafts).find((x) => x.id === id);
                        if (rule!.metadata) {
                            await features.managerUi.managerOpen(rule!.metadata.itemId, {
                                ...rule!.metadata,
                                fields: rule!.fields.decisions || {},
                            });
                        } else {
                            edit(rule);
                            features.api.q("mmoForm").scrollIntoView();
                        }
                    } else if (action === "deleteDraft") {
                        await features.api.api(`drafts/${encodeURIComponent(id)}`, "DELETE");
                        invalidateReview();
                        if (features.navigation.ui.screen === "workspace" && features.api.editingId === id) {
                            features.navigation.clearLocal();
                            await features.navigation.workspaceBack();
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
            features.api.q("mmoKind").addEventListener("change", typeChanged);
            features.api.q("mmoNew").onclick = () => edit(null);
            features.api.q("mmoFind").onclick = () =>
                features.api.perform(async (operation) => {
                    const message = features.notifications.notifications.scope(operation);
                    const lib = features.api.q("mmoLibraries").selectedOptions[0]?.value,
                        search = features.api.q("mmoSearch").value,
                        serial = features.navigation.ui.request,
                        key = features.navigation.ui.editor?.key;
                    message("Finding matching items…", "loading");
                    const matches = await features.api.api(
                        `items?search=${encodeURIComponent(search)}${lib ? "&library=" + encodeURIComponent(lib) : ""}`,
                    );
                    if (serial !== features.navigation.ui.request || key !== features.navigation.ui.editor?.key) return;
                    if (features.api.q("mmoSearch").value !== search || features.api.q("mmoLibraries").selectedOptions[0]?.value !== lib) {
                        message("Search changed. Find items again for the current selection.", "warning");
                        return;
                    }
                    features.api.found = matches;
                    message(features.api.found.length + " matching items found.");
                    features.api.q("mmoItems").innerHTML = features.api.found
                        .map((x, i) => '<option value="' + i + '">' + features.api.esc(x.kind + " · " + x.path) + "</option>")
                        .join("");
                });
            features.api.q("mmoChoose").onclick = () => {
                const item = features.api.found[Number(features.api.q("mmoItems").value)];
                if (!item) return;
                features.api.q("mmoPath").value = item.path;
                features.api.q("mmoKind").value = item.kind;
                for (const o of features.api.q("mmoLibraries").options) o.selected = o.value === item.library;
                typeChanged();
            };
            features.api.q("mmoPreviewAll").onclick = () =>
                features.api.perform(() =>
                    preview({
                        activateIds: features.api.doc.drafts.map((x) => x.id),
                        activateIdentities: (features.api.doc.identityDrafts || []).map((x) => x.id),
                        activatePolicies: (features.api.doc.policyDrafts || []).map((x) => x.id),
                    }),
                );
            features.api.q("mmoApply").onclick = () =>
                features.api.perform(async (operation) => {
                    const message = features.notifications.notifications.scope(operation);
                    message("Queuing active corrections…", "loading");
                    const r = await features.api.api("apply", "POST");
                    await status();
                    message(r.queued + " items queued for correction.");
                });
            features.api.q("mmoReload").onclick = () => features.api.perform(load);
            features.api.q("mmoExport").onclick = () =>
                features.api.perform(async (operation) => {
                    const message = features.notifications.notifications.scope(operation);
                    const original = features.api.q("mmoJson").value;
                    message("Loading export…", "loading");
                    const result = await features.api.api("export");
                    if (!features.notifications.notifications.valid(operation)) return;
                    if (features.api.q("mmoJson").value !== original) {
                        message("The JSON editor changed while loading. Load export again to replace it.", "warning");
                        return;
                    }
                    features.api.q("mmoJson").value = JSON.stringify(result, null, 2);
                    message("Export loaded into the editor.");
                });
            features.api.q("mmoDownload").onclick = () =>
                features.api.perform(async (operation) => {
                    const message = features.notifications.notifications.scope(operation);
                    const url = URL.createObjectURL(
                        new Blob([JSON.stringify(await features.api.api("export"), null, 2)], {
                            type: "application/json",
                        }),
                    );
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = "music-metadata-manager.json";
                    a.click();
                    URL.revokeObjectURL(url);
                });
            features.api.q("mmoImport").onclick = () =>
                features.api.perform(async (operation) => {
                    const message = features.notifications.notifications.scope(operation);
                    await features.api.api("import", "POST", JSON.parse(features.api.q("mmoJson").value));
                    features.api.reviewToken = null;
                    features.api.q("mmoPreviewArea").hidden = true;
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
