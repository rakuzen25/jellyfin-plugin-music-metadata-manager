import type { JsonValue } from "./contracts.ts";
import type { ControllerContracts } from "./controllerContracts.ts";
import type { DashboardState } from "./dashboardState.ts";
export interface MetadataFieldsDependencies {
    api: Pick<ControllerContracts["api"], "esc" | "q">;
    navigation: Pick<ControllerContracts["navigation"], "human" | "nativeButton" | "formatValue" | "normalizeControls">;
    issueGuidance: Pick<ControllerContracts["issueGuidance"], "applyIssueFieldFocus">;
}
export function createMetadataFields(ports: MetadataFieldsDependencies, session: DashboardState) {
    const managerFields = () => session.api.fieldDefinitions.map((field) => field.name);
    const arrayFields = () => session.api.fieldDefinitions.filter((field) => field.kind === "names").map((field) => field.name);
    const numberFields = () => session.api.fieldDefinitions.filter((field) => field.kind === "number").map((field) => field.name);
    const advancedFields = () => session.api.fieldDefinitions.filter((field) => field.advanced).map((field) => field.name);
    const requiredFields = () => session.api.fieldDefinitions.filter((field) => field.required).map((field) => field.name);
    function fieldRow(field: string) {
        const d = session.managerUi.managerPolicy.fields[field] || { mode: "unmanaged" };
        const value = d.mode === "approved" ? d.value : session.managerUi.managerDetails.stored[field];
        const text = arrayFields().includes(field)
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
        else if (arrayFields().includes(field) || ["overview", "providerIds"].includes(field))
            input =
                '<textarea is="emby-textarea" id="' +
                id +
                '" data-value rows="' +
                (field === "overview" ? 5 : field === "providerIds" ? 4 : 2) +
                '">' +
                ports.api.esc(text) +
                "</textarea>";
        else
            input =
                '<input is="emby-input" id="' +
                id +
                '" data-value value="' +
                ports.api.esc(text) +
                '" ' +
                (numberFields().includes(field) ? 'type="number" min="1"' : 'type="text"') +
                " />";
        const info = d.snapshotId ? session.managerUi.managerPolicy.snapshots.find((s) => s.id === d.snapshotId) : null;
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
            ports.api.esc(d.mode) +
            '" /><div class="inputContainer"><label class="inputLabel" for="' +
            id +
            '">' +
            ports.api.esc(ports.navigation.human(field)) +
            "</label>" +
            input +
            (arrayFields().includes(field)
                ? '<div class="fieldDescription">One name or value per line. Credit punctuation is preserved.</div>'
                : "") +
            '</div><p data-field-status class="secondaryText mmo-field-status"></p><details><summary>Management and source details</summary><div class="mmo-field-actions">' +
            ports.navigation.nativeButton("Keep this value", 'data-field-action="approve"') +
            (!requiredFields().includes(field) ? ports.navigation.nativeButton("Keep empty", 'data-field-action="empty"') : "") +
            ports.navigation.nativeButton("Stop managing", 'data-field-action="unmanaged"') +
            "</div><p>Stored: " +
            ports.api.esc(ports.navigation.formatValue(session.managerUi.managerDetails.stored[field])) +
            "</p><p>Displayed: " +
            ports.api.esc(ports.navigation.formatValue(session.managerUi.managerDetails.effective[field])) +
            "</p><p>Approved: " +
            ports.api.esc(d.mode === "approved" ? ports.navigation.formatValue(d.value) : d.mode === "empty" ? "Explicitly empty" : "Unmanaged") +
            "</p><p data-source>Source: " +
            ports.api.esc(source) +
            "</p><p>Locks: " +
            ports.api.esc(
                session.managerUi.managerDetails.IsLocked || session.managerUi.managerDetails.isLocked
                    ? "All metadata locked"
                    : session.managerUi.managerDetails.locks.join(", ") || "None",
            ) +
            "</p><p>Approved values and explicit emptiness are reasserted after refresh. Stop managing retains the current value and returns future handling to Jellyfin.</p></details></div>"
        );
    }
    function renderManagerFields() {
        const fields = managerFields().filter((f) => f in session.managerUi.managerDetails.stored);
        const common =
            session.managerUi.managerDetails.kind === "Audio"
                ? ["title", "album", "artists", "albumArtists", "discNumber", "trackNumber"]
                : session.managerUi.managerDetails.kind === "MusicAlbum"
                  ? ["title", "artists", "albumArtists", "overview", "genres", "productionYear"]
                  : ["title", "sortName", "overview", "genres"];
        ports.api.q("mmoManagerFields").innerHTML =
            fields
                .filter((f) => common.includes(f))
                .map(fieldRow)
                .join("") +
            '<details class="mmo-advanced"><summary>Additional metadata: dates, tags, and other fields</summary>' +
            fields
                .filter((f) => !common.includes(f) && !advancedFields().includes(f))
                .map(fieldRow)
                .join("") +
            '</details><details class="mmo-advanced"><summary>Provider IDs and native locks</summary>' +
            fields
                .filter((f) => advancedFields().includes(f))
                .map(fieldRow)
                .join("") +
            "</details>";
        for (const row of ports.api.q("mmoManagerFields").querySelectorAll<HTMLElement>("[data-field]")) setFieldState(row!);
        ports.navigation.normalizeControls(ports.api.q("mmoManagerFields"));
        ports.issueGuidance.applyIssueFieldFocus();
    }
    function setFieldState(row: HTMLElement) {
        const mode = row.querySelector<HTMLSelectElement>("[data-mode]")!.value;
        const active = session.managerUi.managerDetails.policy.fields[row.dataset.field!] || {
            mode: "unmanaged",
        };
        const activeText = arrayFields().includes(row.dataset.field!)
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
        for (const row of ports.api.q("mmoManagerFields").querySelectorAll<HTMLElement>("[data-field]")) {
            const field = row.dataset.field!,
                mode = row.querySelector<HTMLSelectElement>("[data-mode]")!.value,
                text = row.querySelector<HTMLInputElement>("[data-value]")!.value;
            const previous = session.managerUi.managerPolicy.fields[field];
            if (mode === "unmanaged") {
                if (previous)
                    session.managerUi.managerPolicy.fields[field] = {
                        mode: "unmanaged",
                        value: null,
                        provenance: "known",
                    };
                continue;
            }
            let value = null;
            if (mode === "approved") {
                if (arrayFields().includes(field))
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
                } else if (numberFields().includes(field)) value = Number(text);
                else if (field === "isLocked") value = text === "true";
                else value = text;
            }
            session.managerUi.managerPolicy.fields[field] = {
                ...previous,
                mode,
                value,
                provenance: previous?.provenance || "known",
            };
        }
        session.managerUi.managerPolicy.libraries = [...ports.api.q("mmoManagerLibraries").selectedOptions].map((o) => o.value);
        return structuredClone(session.managerUi.managerPolicy);
    }
    return {
        fieldRow,
        renderManagerFields,
        setFieldState,
        readManagerFields,
        managerFields,
        arrayFields,
        numberFields,
        advancedFields,
        requiredFields,
    };
}
