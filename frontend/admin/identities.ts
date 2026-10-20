import type { AliasSuggestion, NativeRecord } from "./responses.ts";
import type { ArtistIdentity } from "./contracts.ts";
import type { ControllerContracts } from "./controllerContracts.ts";
import type { DashboardState } from "./dashboardState.ts";
export interface IdentitiesDependencies {
    rules: Pick<ControllerContracts["rules"], "invalidateReview" | "load" | "preview">;
    api: Pick<ControllerContracts["api"], "api" | "esc" | "perform" | "q">;
    notifications: Pick<ControllerContracts["notifications"], "notifications">;
}
export function createIdentities(ports: IdentitiesDependencies, session: DashboardState) {
    let renderIdentities: () => void;
    let editIdentity = async function editIdentity(identity: Partial<ArtistIdentity> | null | undefined, _nested = false) {
        ports.rules.invalidateReview();
        const request = session.navigation.ui.request;
        const records = await ports.api.api("identities/records");
        if (request !== session.navigation.ui.request) return;
        session.api.identityRecords = records;
        session.api.identityEditingId = identity?.id || null;
        ports.api.q("mmoIdentityForm").hidden = false;
        ports.api.q("mmoIdentityName").value = identity?.preferredName || "";
        ports.api.q("mmoIdentityAliases").value = (identity?.aliases || []).join("\n");
        ports.api.q("mmoIdentityMbid").value = identity?.musicBrainzId || "";
        ports.api.q("mmoIdentityEditorState").textContent = identity?.id
            ? session.api.doc.identities.some((x) => x.id === identity.id)
                ? "Editing an active identity. Its current version remains active."
                : "Editing an inactive identity draft."
            : "New identity. Changes remain local until saved or applied.";
        for (const o of ports.api.q("mmoIdentityLibraries").options) o.selected = (identity?.libraries || []).includes(o.value);
        for (const [key, rows] of [
            ["Artist", session.api.identityRecords.artists],
            ["Person", session.api.identityRecords.persons],
            ["Artists", session.api.identityRecords.artists],
            ["Persons", session.api.identityRecords.persons],
        ] as [string, NativeRecord[]][]) {
            ports.api.q("mmoIdentity" + key).innerHTML =
                (key.endsWith("s") ? "" : '<option value="">Select a record</option>') +
                rows.map((x) => '<option value="' + ports.api.esc(x.id) + '">' + ports.api.esc(x.name) + "</option>").join("");
            const values = key.endsWith("s")
                ? identity?.[key === "Artists" ? "artistIds" : "personIds"] || []
                : [identity?.[key === "Artist" ? "artistId" : "personId"]];
            for (const o of ports.api.q<HTMLSelectElement>("mmoIdentity" + key).options) o.selected = values.includes(o.value);
        }
        ports.api.q("mmoIdentitySuggestions").innerHTML = "";
    };
    function identityForm() {
        const selected = (id: string) => Array.from(ports.api.q<HTMLSelectElement>(id).selectedOptions).map((x) => x.value);
        return {
            id: session.api.identityEditingId || crypto.randomUUID().replaceAll("-", ""),
            preferredName: ports.api.q("mmoIdentityName").value,
            aliases: ports.api
                .q("mmoIdentityAliases")
                .value.split("\n")
                .map((x) => x.trim())
                .filter(Boolean),
            libraries: selected("mmoIdentityLibraries"),
            artistId: ports.api.q("mmoIdentityArtist").value,
            personId: ports.api.q("mmoIdentityPerson").value,
            artistIds: selected("mmoIdentityArtists"),
            personIds: selected("mmoIdentityPersons"),
            musicBrainzId: ports.api.q("mmoIdentityMbid").value.trim() || null,
        };
    }
    function suggestionList(rows: AliasSuggestion[]) {
        ports.api.q("mmoIdentitySuggestions").innerHTML =
            rows
                .map(
                    (x) =>
                        '<label><input type="checkbox" data-alias="' +
                        ports.api.esc(x.name) +
                        '" /> ' +
                        ports.api.esc(x.name) +
                        " — " +
                        ports.api.esc(x.source || "MusicBrainz") +
                        (x.locale ? " (" + ports.api.esc(x.locale) + ")" : "") +
                        "</label>",
                )
                .join("") + '<button is="emby-button" type="button" id="mmoAcceptSuggestions" class="raised">Add selected aliases to form</button>';
        ports.api.q("mmoAcceptSuggestions").onclick = () =>
            ports.api.perform(async (operation) => {
                const message = ports.notifications.notifications.scope(operation);
                const chosen = Array.from(ports.api.q("mmoIdentitySuggestions").querySelectorAll<HTMLInputElement>("input:checked")).map(
                    (x) => x.dataset.alias,
                );
                const current = ports.api.q("mmoIdentityAliases").value.split("\n").filter(Boolean);
                ports.api.q("mmoIdentityAliases").value = Array.from(new Set([...current, ...chosen])).join("\n");
                ports.rules.invalidateReview();
                message("Selected suggestions added to local form. Preview and apply to activate.");
            });
    }
    return {
        initialize() {
            ports.api.q("mmoNewIdentity").onclick = () => ports.api.perform(() => editIdentity(null));
            ports.api.q("mmoIdentityForm").addEventListener("submit", (e) => {
                e.preventDefault();
                ports.api.perform(async (operation) => {
                    ports.notifications.notifications.scope(operation);
                    const identity = identityForm();
                    session.api.identityEditingId = identity.id;
                    await ports.rules.preview({ identityEdits: [identity] });
                });
            });
            ports.api.q("mmoIdentityForm").addEventListener("input", ports.rules.invalidateReview);
            ports.api.q("mmoIdentityForm").addEventListener("change", ports.rules.invalidateReview);
            ports.api.q("mmoIdentities").addEventListener("click", (e) => {
                const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-action]");
                if (!b) return;
                ports.api.perform(async (operation) => {
                    const message = ports.notifications.notifications.scope(operation);
                    const id = b.dataset.id!,
                        action = b.dataset.action;
                    if (action === "identityEditActive" || action === "identityEditDraft")
                        await editIdentity(
                            (action === "identityEditActive" ? session.api.doc.identities : session.api.doc.identityDrafts).find((x) => x.id === id),
                        );
                    else if (action === "identityDeleteDraft") {
                        await ports.api.api(`identities/drafts/${encodeURIComponent(id)}`, "DELETE");
                        ports.rules.invalidateReview();
                        await ports.rules.load();
                        if (session.api.identityEditingId === id) {
                            session.api.identityEditingId = null;
                            ports.api.q("mmoIdentityForm").hidden = true;
                        }
                        message("Identity draft deleted. Active identity unchanged.");
                    } else
                        await ports.rules.preview({
                            activateIdentities: action === "identityActivate" ? [id] : [],
                            disableIdentities: action === "identityDisable" ? [id] : [],
                            deleteIdentities: action === "identityDelete" ? [id] : [],
                        });
                });
            });
            ports.api.q("mmoLocalSuggestions").onclick = () =>
                ports.api.perform(async (operation) => {
                    const message = ports.notifications.notifications.scope(operation);
                    const serial = session.navigation.ui.request,
                        selection = () => JSON.stringify([ports.api.q("mmoIdentityName").value, ports.api.q("mmoIdentityArtist").value]),
                        before = selection();
                    message("Finding local alias suggestions…", "loading");
                    const rows = await ports.api.api("identities/names");
                    if (serial !== session.navigation.ui.request) return;
                    if (before !== selection()) {
                        message("Artist selection changed. Fetch suggestions again.", "warning");
                        return;
                    }
                    const selected = session.api.identityRecords!.artists.find((x) => x.id === ports.api.q("mmoIdentityArtist").value);
                    suggestionList(
                        rows.filter(
                            (x) => x.name.toLowerCase().includes(ports.api.q("mmoIdentityName").value.toLowerCase()) || x.name === selected?.name,
                        ),
                    );
                });
            ports.api.q("mmoBrainzSuggestions").onclick = () =>
                ports.api.perform(async (operation) => {
                    const message = ports.notifications.notifications.scope(operation);
                    if (!ports.api.q("mmoIdentityMbid").value.trim()) throw Error("Enter a confirmed MusicBrainz artist ID first.");
                    const serial = session.navigation.ui.request,
                        mbid = ports.api.q("mmoIdentityMbid").value.trim();
                    message("Fetching MusicBrainz alias suggestions…", "loading");
                    const result = await ports.api.api(`identities/suggestions?mbid=${encodeURIComponent(mbid)}`);
                    if (serial !== session.navigation.ui.request) return;
                    if (mbid !== ports.api.q("mmoIdentityMbid").value.trim()) {
                        message("MusicBrainz ID changed. Fetch suggestions again.", "warning");
                        return;
                    }
                    suggestionList(result.suggestions);
                    message("Suggestions fetched. Review names before adding them.");
                });
        },
        get renderIdentities() {
            return renderIdentities;
        },
        set renderIdentities(value: typeof renderIdentities) {
            renderIdentities = value;
        },
        get editIdentity() {
            return editIdentity;
        },
        set editIdentity(value: typeof editIdentity) {
            editIdentity = value;
        },
        get identityForm() {
            return identityForm;
        },
        get suggestionList() {
            return suggestionList;
        },
    };
}
