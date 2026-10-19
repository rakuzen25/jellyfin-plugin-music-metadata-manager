let renderIdentities;
async function editIdentity(identity) {
  invalidateReview();
  const request = ui.request;
  const records = await api("identities/records");
  if (request !== ui.request) return;
  identityRecords = records;
  identityEditingId = identity?.id || null;
  q("mmoIdentityForm").hidden = false;
  q("mmoIdentityName").value = identity?.preferredName || "";
  q("mmoIdentityAliases").value = (identity?.aliases || []).join("\n");
  q("mmoIdentityMbid").value = identity?.musicBrainzId || "";
  q("mmoIdentityEditorState").textContent = identity?.id
    ? doc.identities.some((x) => x.id === identity.id)
      ? "Editing an active identity. Its current version remains active."
      : "Editing an inactive identity draft."
    : "New identity. Changes remain local until saved or applied.";
  for (const o of q("mmoIdentityLibraries").options)
    o.selected = (identity?.libraries || []).includes(o.value);
  for (const [key, rows] of [
    ["Artist", identityRecords.artists],
    ["Person", identityRecords.persons],
    ["Artists", identityRecords.artists],
    ["Persons", identityRecords.persons],
  ]) {
    q("mmoIdentity" + key).innerHTML =
      (key.endsWith("s") ? "" : '<option value="">Select a record</option>') +
      rows
        .map(
          (x) =>
            '<option value="' + esc(x.id) + '">' + esc(x.name) + "</option>",
        )
        .join("");
    const values = key.endsWith("s")
      ? identity?.[key === "Artists" ? "artistIds" : "personIds"] || []
      : [identity?.[key === "Artist" ? "artistId" : "personId"]];
    for (const o of q("mmoIdentity" + key).options)
      o.selected = values.includes(o.value);
  }
  q("mmoIdentitySuggestions").innerHTML = "";
}
function identityForm() {
  const selected = (id) =>
    Array.from(q(id).selectedOptions).map((x) => x.value);
  return {
    id: identityEditingId || crypto.randomUUID().replaceAll("-", ""),
    preferredName: q("mmoIdentityName").value,
    aliases: q("mmoIdentityAliases")
      .value.split("\n")
      .map((x) => x.trim())
      .filter(Boolean),
    libraries: selected("mmoIdentityLibraries"),
    artistId: q("mmoIdentityArtist").value,
    personId: q("mmoIdentityPerson").value,
    artistIds: selected("mmoIdentityArtists"),
    personIds: selected("mmoIdentityPersons"),
    musicBrainzId: q("mmoIdentityMbid").value.trim() || null,
  };
}
q("mmoNewIdentity").onclick = () => perform(() => editIdentity(null));
q("mmoIdentityForm").addEventListener("submit", (e) => {
  e.preventDefault();
  perform(async (operation) => {
    const message = notifications.scope(operation);
    const identity = identityForm();
    identityEditingId = identity.id;
    await preview({ identityEdits: [identity] });
  });
});
q("mmoIdentityForm").addEventListener("input", invalidateReview);
q("mmoIdentityForm").addEventListener("change", invalidateReview);
q("mmoIdentities").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-action]");
  if (!b) return;
  perform(async (operation) => {
    const message = notifications.scope(operation);
    const id = b.dataset.id,
      action = b.dataset.action;
    if (action === "identityEditActive" || action === "identityEditDraft")
      await editIdentity(
        (action === "identityEditActive"
          ? doc.identities
          : doc.identityDrafts
        ).find((x) => x.id === id),
      );
    else if (action === "identityDeleteDraft") {
      await api("identities/drafts/" + encodeURIComponent(id), "DELETE");
      invalidateReview();
      await load();
      if (identityEditingId === id) {
        identityEditingId = null;
        q("mmoIdentityForm").hidden = true;
      }
      message("Identity draft deleted. Active identity unchanged.");
    } else
      await preview({
        activateIdentities: action === "identityActivate" ? [id] : [],
        disableIdentities: action === "identityDisable" ? [id] : [],
        deleteIdentities: action === "identityDelete" ? [id] : [],
      });
  });
});
function suggestionList(rows) {
  q("mmoIdentitySuggestions").innerHTML =
    rows
      .map(
        (x) =>
          '<label><input type="checkbox" data-alias="' +
          esc(x.name) +
          '" /> ' +
          esc(x.name) +
          " — " +
          esc(x.source || "MusicBrainz") +
          (x.locale ? " (" + esc(x.locale) + ")" : "") +
          "</label>",
      )
      .join("") +
    '<button is="emby-button" type="button" id="mmoAcceptSuggestions" class="raised">Add selected aliases to form</button>';
  q("mmoAcceptSuggestions").onclick = () => perform(async (operation) => {
    const message = notifications.scope(operation);
    const chosen = Array.from(
      q("mmoIdentitySuggestions").querySelectorAll("input:checked"),
    ).map((x) => x.dataset.alias);
    const current = q("mmoIdentityAliases").value.split("\n").filter(Boolean);
    q("mmoIdentityAliases").value = Array.from(
      new Set([...current, ...chosen]),
    ).join("\n");
    invalidateReview();
    message(
      "Selected suggestions added to local form. Preview and apply to activate.",
    );
  });
}
q("mmoLocalSuggestions").onclick = () =>
  perform(async (operation) => {
    const message = notifications.scope(operation);
    const serial = ui.request,
      selection = () => JSON.stringify([q("mmoIdentityName").value, q("mmoIdentityArtist").value]),
      before = selection();
    message("Finding local alias suggestions…", "loading");
    const rows = await api("identities/names");
    if (serial !== ui.request) return;
    if (before !== selection()) { message("Artist selection changed. Fetch suggestions again.", "warning"); return; }
    const selected = identityRecords.artists.find(
      (x) => x.id === q("mmoIdentityArtist").value,
    );
    suggestionList(
      rows.filter(
        (x) =>
          x.name
            .toLowerCase()
            .includes(q("mmoIdentityName").value.toLowerCase()) ||
          x.name === selected?.name,
      ),
    );
  });
q("mmoBrainzSuggestions").onclick = () =>
  perform(async (operation) => {
    const message = notifications.scope(operation);
    if (!q("mmoIdentityMbid").value.trim())
      throw Error("Enter a confirmed MusicBrainz artist ID first.");
    const serial = ui.request, mbid = q("mmoIdentityMbid").value.trim();
    message("Fetching MusicBrainz alias suggestions…", "loading");
    const result = await api("identities/suggestions?mbid=" + encodeURIComponent(mbid));
    if (serial !== ui.request) return;
    if (mbid !== q("mmoIdentityMbid").value.trim()) { message("MusicBrainz ID changed. Fetch suggestions again.", "warning"); return; }
    suggestionList(result.suggestions);
    message("Suggestions fetched. Review names before adding them.");
  });
