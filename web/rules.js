let load, status, preview;
const keys = [
  "title",
  "album",
  "artists",
  "albumArtists",
  "discNumber",
  "trackNumber",
];
const labels = {
  title: "Title",
  album: "Album name",
  artists: "Performers",
  albumArtists: "Album artists",
  discNumber: "Disc number",
  trackNumber: "Track number",
};
for (const group of ["Fields", "Defaults"])
  q("mmo" + group).innerHTML = keys
    .map(
      (k) =>
        '<label data-field="' +
        k +
        '">' +
        labels[k] +
        (k.endsWith("Artists") || k === "artists"
          ? '<textarea id="mmo' +
            group +
            k +
            '" rows="2" style="display:block;width:100%"></textarea>'
          : '<input is="emby-input" id="mmo' +
            group +
            k +
            '" ' +
            (k.endsWith("Number") ? 'type="number" min="1"' : "") +
            " />") +
        "</label>",
    )
    .join("");
function typeChanged() {
  const kind = q("mmoKind").value;
  q("mmoPathArea").hidden = kind === "alias";
  q("mmoAliasArea").hidden = kind !== "alias";
  q("mmoFieldsArea").hidden = kind === "alias";
  q("mmoDefaultsArea").hidden = kind !== "album";
  for (const k of keys)
    q("mmoFields").querySelector('[data-field="' + k + '"]').hidden =
      kind === "album" && ["album", "discNumber", "trackNumber"].includes(k);
}
function fill(group, fields = {}) {
  for (const k of keys)
    q("mmo" + group + k).value = Array.isArray(fields[k])
      ? fields[k].join("\n")
      : (fields[k] ?? "");
}
function fields(group, albumOnly = false) {
  const result = {};
  for (const k of keys) {
    if (albumOnly && ["album", "discNumber", "trackNumber"].includes(k))
      continue;
    const value = q("mmo" + group + k).value;
    if (!value.trim()) continue;
    result[k] = k.endsWith("Number")
      ? Number(value)
      : k === "artists" || k === "albumArtists"
        ? value
            .split("\n")
            .map((x) => x.trim())
            .filter(Boolean)
        : value;
  }
  return result;
}
function invalidateReview() {
  reviewEpoch++;
  reviewToken = null;
  actions.setDisabled(q("mmoActivate"), true);
  if (ui.screen === "review") {
    q("mmoPreviewSummary").textContent = "This review is outdated. Return to edit and preview the current changes before applying.";
  } else q("mmoPreviewArea").hidden = true;
}
function edit(r) {
  invalidateReview();
  q("mmoEditorState").textContent = r
    ? doc.active.some((x) => x.id === r.id)
      ? "Editing an active rule. Its current version stays active until you apply reviewed changes."
      : "Editing an inactive draft."
    : "New rule. Preview and apply to activate, or save a draft for later.";
  editingId = r?.id ?? null;
  q("mmoLabel").value = r?.label ?? "";
  q("mmoKind").value = r?.kind ?? "track";
  q("mmoPath").value = r?.path ?? "";
  q("mmoCredit").value = r?.credit ?? "";
  q("mmoNames").value = (r?.names ?? []).join("\n");
  q("mmoRole").value = r?.role ?? "artists";
  for (const o of q("mmoLibraries").options)
    o.selected = (r?.libraries ?? []).includes(o.value);
  fill("Fields", r?.fields);
  fill("Defaults", r?.trackDefaults);
  typeChanged();
}
function button(action, id, label) {
  return (
    '<button is="emby-button" class="button-flat emby-button" type="button" data-action="' +
    action +
    '" data-id="' +
    esc(id) +
    '">' +
    label +
    "</button>"
  );
}
function formRule() {
  const kind = q("mmoKind").value;
  return {
    id: editingId || crypto.randomUUID().replaceAll("-", ""),
    label: q("mmoLabel").value,
    kind,
    path: kind === "alias" ? "" : q("mmoPath").value,
    credit: kind === "alias" ? q("mmoCredit").value : "",
    names:
      kind === "alias"
        ? q("mmoNames")
            .value.split("\n")
            .map((x) => x.trim())
            .filter(Boolean)
        : [],
    role: q("mmoRole").value,
    libraries: Array.from(q("mmoLibraries").selectedOptions).map(
      (x) => x.value,
    ),
    fields: kind === "alias" ? {} : fields("Fields", kind === "album"),
    trackDefaults: kind === "album" ? fields("Defaults") : {},
  };
}
q("mmoForm").addEventListener("submit", (e) => {
  e.preventDefault();
  perform(async (operation) => {
    const message = notifications.scope(operation);
    const r = formRule();
    editingId = r.id;
    await preview({ edits: [r] });
  });
});
q("mmoForm").addEventListener("input", invalidateReview);
q("mmoForm").addEventListener("change", invalidateReview);
q("mmoRules").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-action]");
  if (!b) return;
  perform(async (operation) => {
    const message = notifications.scope(operation);
    const id = b.dataset.id,
      action = b.dataset.action;
    if (action === "editActive" || action === "editDraft") {
      const rule = (action === "editActive" ? doc.active : doc.drafts).find(
        (x) => x.id === id,
      );
      if (rule.metadata) {
        await managerOpen(rule.metadata.itemId, {
          ...rule.metadata,
          fields: rule.fields.decisions || {},
        });
      } else {
        edit(rule);
        q("mmoForm").scrollIntoView();
      }
    } else if (action === "deleteDraft") {
      await api("drafts/" + encodeURIComponent(id), "DELETE");
      invalidateReview();
      if (ui.screen === "workspace" && editingId === id) {
        clearLocal();
        await workspaceBack();
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
q("mmoKind").addEventListener("change", typeChanged);
q("mmoNew").onclick = () => edit(null);
q("mmoFind").onclick = () =>
  perform(async (operation) => {
    const message = notifications.scope(operation);
    const lib = q("mmoLibraries").selectedOptions[0]?.value,
      search = q("mmoSearch").value,
      serial = ui.request,
      key = ui.editor?.key;
    message("Finding matching items…", "loading");
    const matches = await api(
      "items?search=" +
        encodeURIComponent(search) +
        (lib ? "&library=" + encodeURIComponent(lib) : ""),
    );
    if (serial !== ui.request || key !== ui.editor?.key) return;
    if (q("mmoSearch").value !== search || q("mmoLibraries").selectedOptions[0]?.value !== lib) {
      message("Search changed. Find items again for the current selection.", "warning");
      return;
    }
    found = matches;
    message(found.length + " matching items found.");
    q("mmoItems").innerHTML = found
      .map(
        (x, i) =>
          '<option value="' +
          i +
          '">' +
          esc(x.kind + " · " + x.path) +
          "</option>",
      )
      .join("");
  });
q("mmoChoose").onclick = () => {
  const item = found[Number(q("mmoItems").value)];
  if (!item) return;
  q("mmoPath").value = item.path;
  q("mmoKind").value = item.kind;
  for (const o of q("mmoLibraries").options)
    o.selected = o.value === item.library;
  typeChanged();
};
q("mmoPreviewAll").onclick = () =>
  perform(() =>
    preview({
      activateIds: doc.drafts.map((x) => x.id),
      activateIdentities: (doc.identityDrafts || []).map((x) => x.id),
      activatePolicies: (doc.policyDrafts || []).map((x) => x.id),
    }),
  );
q("mmoApply").onclick = () =>
  perform(async (operation) => {
    const message = notifications.scope(operation);
    message("Queuing active corrections…", "loading");
    const r = await api("apply", "POST");
    await status();
    message(r.queued + " items queued for correction.");
  });
q("mmoReload").onclick = () => perform(load);
q("mmoExport").onclick = () =>
  perform(async (operation) => {
    const message = notifications.scope(operation);
    const original = q("mmoJson").value;
    message("Loading export…", "loading");
    const result = await api("export");
    if (!notifications.valid(operation)) return;
    if (q("mmoJson").value !== original) {
      message("The JSON editor changed while loading. Load export again to replace it.", "warning");
      return;
    }
    q("mmoJson").value = JSON.stringify(result, null, 2);
    message("Export loaded into the editor.");
  });
q("mmoDownload").onclick = () =>
  perform(async (operation) => {
    const message = notifications.scope(operation);
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(await api("export"), null, 2)], {
        type: "application/json",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "music-metadata-manager.json";
    a.click();
    URL.revokeObjectURL(url);
  });
q("mmoImport").onclick = () =>
  perform(async (operation) => {
    const message = notifications.scope(operation);
    await api("import", "POST", JSON.parse(q("mmoJson").value));
    reviewToken = null;
    q("mmoPreviewArea").hidden = true;
    await load();
    message("Imported as drafts. Active rules were not changed.");
  });
