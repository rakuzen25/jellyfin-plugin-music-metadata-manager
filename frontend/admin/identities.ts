import type { AliasSuggestion, NativeRecord } from "./responses.ts";
import type { ArtistIdentity } from "./contracts.ts";
import type { Features } from "./features.ts";
export function createIdentities(features: Features) {
    let renderIdentities: () => void;
    let editIdentity = async function editIdentity(identity: Partial<ArtistIdentity> | null | undefined, nested = false) {
        features.rules.invalidateReview();
        const request = features.navigation.ui.request;
        const records = await features.api.api("identities/records");
        if (request !== features.navigation.ui.request) return;
        features.api.identityRecords = records;
        features.api.identityEditingId = identity?.id || null;
        features.api.q("mmoIdentityForm").hidden = false;
        features.api.q("mmoIdentityName").value = identity?.preferredName || "";
        features.api.q("mmoIdentityAliases").value = (identity?.aliases || []).join("\n");
        features.api.q("mmoIdentityMbid").value = identity?.musicBrainzId || "";
        features.api.q("mmoIdentityEditorState").textContent = identity?.id
            ? features.api.doc.identities.some((x) => x.id === identity.id)
                ? "Editing an active identity. Its current version remains active."
                : "Editing an inactive identity draft."
            : "New identity. Changes remain local until saved or applied.";
        for (const o of features.api.q("mmoIdentityLibraries").options) o.selected = (identity?.libraries || []).includes(o.value);
        for (const [key, rows] of [
            ["Artist", features.api.identityRecords.artists],
            ["Person", features.api.identityRecords.persons],
            ["Artists", features.api.identityRecords.artists],
            ["Persons", features.api.identityRecords.persons],
        ] as [string, NativeRecord[]][]) {
            features.api.q("mmoIdentity" + key).innerHTML =
                (key.endsWith("s") ? "" : '<option value="">Select a record</option>') +
                rows.map((x) => '<option value="' + features.api.esc(x.id) + '">' + features.api.esc(x.name) + "</option>").join("");
            const values = key.endsWith("s")
                ? identity?.[key === "Artists" ? "artistIds" : "personIds"] || []
                : [identity?.[key === "Artist" ? "artistId" : "personId"]];
            for (const o of features.api.q<HTMLSelectElement>("mmoIdentity" + key).options) o.selected = values.includes(o.value);
        }
        features.api.q("mmoIdentitySuggestions").innerHTML = "";
    };
    function identityForm() {
        const selected = (id: string) => Array.from(features.api.q<HTMLSelectElement>(id).selectedOptions).map((x) => x.value);
        return {
            id: features.api.identityEditingId || crypto.randomUUID().replaceAll("-", ""),
            preferredName: features.api.q("mmoIdentityName").value,
            aliases: features.api
                .q("mmoIdentityAliases")
                .value.split("\n")
                .map((x) => x.trim())
                .filter(Boolean),
            libraries: selected("mmoIdentityLibraries"),
            artistId: features.api.q("mmoIdentityArtist").value,
            personId: features.api.q("mmoIdentityPerson").value,
            artistIds: selected("mmoIdentityArtists"),
            personIds: selected("mmoIdentityPersons"),
            musicBrainzId: features.api.q("mmoIdentityMbid").value.trim() || null,
        };
    }
    function suggestionList(rows: AliasSuggestion[]) {
        features.api.q("mmoIdentitySuggestions").innerHTML =
            rows
                .map(
                    (x) =>
                        '<label><input type="checkbox" data-alias="' +
                        features.api.esc(x.name) +
                        '" /> ' +
                        features.api.esc(x.name) +
                        " — " +
                        features.api.esc(x.source || "MusicBrainz") +
                        (x.locale ? " (" + features.api.esc(x.locale) + ")" : "") +
                        "</label>",
                )
                .join("") + '<button is="emby-button" type="button" id="mmoAcceptSuggestions" class="raised">Add selected aliases to form</button>';
        features.api.q("mmoAcceptSuggestions").onclick = () =>
            features.api.perform(async (operation) => {
                const message = features.notifications.notifications.scope(operation);
                const chosen = Array.from(features.api.q("mmoIdentitySuggestions").querySelectorAll<HTMLInputElement>("input:checked")).map(
                    (x) => x.dataset.alias,
                );
                const current = features.api.q("mmoIdentityAliases").value.split("\n").filter(Boolean);
                features.api.q("mmoIdentityAliases").value = Array.from(new Set([...current, ...chosen])).join("\n");
                features.rules.invalidateReview();
                message("Selected suggestions added to local form. Preview and apply to activate.");
            });
    }
    return {
        initialize() {
            features.api.q("mmoNewIdentity").onclick = () => features.api.perform(() => editIdentity(null));
            features.api.q("mmoIdentityForm").addEventListener("submit", (e) => {
                e.preventDefault();
                features.api.perform(async (operation) => {
                    const message = features.notifications.notifications.scope(operation);
                    const identity = identityForm();
                    features.api.identityEditingId = identity.id;
                    await features.rules.preview({ identityEdits: [identity] });
                });
            });
            features.api.q("mmoIdentityForm").addEventListener("input", features.rules.invalidateReview);
            features.api.q("mmoIdentityForm").addEventListener("change", features.rules.invalidateReview);
            features.api.q("mmoIdentities").addEventListener("click", (e) => {
                const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-action]");
                if (!b) return;
                features.api.perform(async (operation) => {
                    const message = features.notifications.notifications.scope(operation);
                    const id = b.dataset.id!,
                        action = b.dataset.action;
                    if (action === "identityEditActive" || action === "identityEditDraft")
                        await editIdentity(
                            (action === "identityEditActive" ? features.api.doc.identities : features.api.doc.identityDrafts).find(
                                (x) => x.id === id,
                            ),
                        );
                    else if (action === "identityDeleteDraft") {
                        await features.api.api(`identities/drafts/${encodeURIComponent(id)}`, "DELETE");
                        features.rules.invalidateReview();
                        await features.rules.load();
                        if (features.api.identityEditingId === id) {
                            features.api.identityEditingId = null;
                            features.api.q("mmoIdentityForm").hidden = true;
                        }
                        message("Identity draft deleted. Active identity unchanged.");
                    } else
                        await features.rules.preview({
                            activateIdentities: action === "identityActivate" ? [id] : [],
                            disableIdentities: action === "identityDisable" ? [id] : [],
                            deleteIdentities: action === "identityDelete" ? [id] : [],
                        });
                });
            });
            features.api.q("mmoLocalSuggestions").onclick = () =>
                features.api.perform(async (operation) => {
                    const message = features.notifications.notifications.scope(operation);
                    const serial = features.navigation.ui.request,
                        selection = () => JSON.stringify([features.api.q("mmoIdentityName").value, features.api.q("mmoIdentityArtist").value]),
                        before = selection();
                    message("Finding local alias suggestions…", "loading");
                    const rows = await features.api.api("identities/names");
                    if (serial !== features.navigation.ui.request) return;
                    if (before !== selection()) {
                        message("Artist selection changed. Fetch suggestions again.", "warning");
                        return;
                    }
                    const selected = features.api.identityRecords!.artists.find((x) => x.id === features.api.q("mmoIdentityArtist").value);
                    suggestionList(
                        rows.filter(
                            (x) => x.name.toLowerCase().includes(features.api.q("mmoIdentityName").value.toLowerCase()) || x.name === selected?.name,
                        ),
                    );
                });
            features.api.q("mmoBrainzSuggestions").onclick = () =>
                features.api.perform(async (operation) => {
                    const message = features.notifications.notifications.scope(operation);
                    if (!features.api.q("mmoIdentityMbid").value.trim()) throw Error("Enter a confirmed MusicBrainz artist ID first.");
                    const serial = features.navigation.ui.request,
                        mbid = features.api.q("mmoIdentityMbid").value.trim();
                    message("Fetching MusicBrainz alias suggestions…", "loading");
                    const result = await features.api.api(`identities/suggestions?mbid=${encodeURIComponent(mbid)}`);
                    if (serial !== features.navigation.ui.request) return;
                    if (mbid !== features.api.q("mmoIdentityMbid").value.trim()) {
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
