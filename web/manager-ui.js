// Item inventory and metadata editor. Policies remain visit-local until Save or Apply.
let managerStart = 0,
  managerDetails = null,
  managerPolicy = null,
  managerComparison = null,
  managerBatch = [];
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
const arrayFields = [
  "artists",
  "albumArtists",
  "genres",
  "tags",
  "country",
  "lockedFields",
];
const numberFields = ["discNumber", "trackNumber", "productionYear"];
const advancedFields = ["providerIds", "lockedFields", "isLocked"];
const requiredFields = [
  "title",
  "album",
  "artists",
  "albumArtists",
  "discNumber",
  "trackNumber",
  "isLocked",
];
function managerDisplay(v) {
  return formatValue(v);
}
async function managerInventory() {
  const serial = ++ui.inventoryRequest;
  q("mmoInventoryCount").textContent = "";
  closeRowMenu();
  q("mmoInventoryRows").innerHTML = tableMessage("Loading music…");
  const params = new URLSearchParams({
    search: q("mmoInventorySearch").value,
    start: managerStart,
    limit: tablePageSize,
    view: q("mmoInventoryView").value,
  });
  if (q("mmoInventoryLibrary").value)
    params.set("library", q("mmoInventoryLibrary").value);
  const kind = q("mmoInventoryKind").value;
  // Native mode still permits the combined Artists filter.
  if (kind) params.set("kind", kind);
  try {
    const result = await api("manager/inventory?" + params);
    if (serial !== ui.inventoryRequest) return;
    tablePagination(managerStart, result.total, {
      count: "mmoInventoryCount",
      previous: "mmoInventoryPrev",
      next: "mmoInventoryNext",
      note:
        result.view === "grouped"
          ? "grouped artist identities"
          : "native records",
    });
    let items = result.items;
    q("mmoInventoryRows").innerHTML =
      items
        .map((x) => {
          const identity = x.kind === "identity";
          const open = identity
            ? 'data-inventory-identity="' + esc(x.identityId) + '"'
            : 'data-manager-item="' + esc(x.id) + '"';
          const state = x.managed || identity ? "Managed" : "Unmanaged";
          const links = identity
            ? "<details><summary>" +
              x.records.length +
              " linked native records</summary>" +
              x.records
                .map(
                  (r) =>
                    "<p>" +
                    nativeButton(
                      r.name +
                        " · " +
                        r.kind +
                        (r.representative ? " · representative" : ""),
                      'data-manager-item="' + esc(r.id) + '"',
                    ) + nativeLink(r.id, r.name) +
                    "</p>",
                )
                .join("") +
              "</details>"
            : "";
          return tableRow({
            name: x.name,
            columns: libraryTableColumns,
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
              (identity
                ? "<p>Aliases: " + esc((x.aliases || []).join(", ")) + "</p>"
                : "") +
              (x.missingBinding
                ? '<p class="mmo-warning">A representative is missing. Rebind the identity before applying changes.</p>'
                : "") +
              links,
            primary: nativeButton(identity ? "Edit" : "Open", open),
            native: nativeLink(x.id, x.name),
          });
        })
        .join("") || tableMessage("No music matches these filters.");
  } catch (e) {
    if (serial !== ui.inventoryRequest) return;
    q("mmoInventoryCount").textContent = "";
    q("mmoInventoryRows").innerHTML = tableMessage(
      "Could not load music. Use Find to retry.",
    );
    e.noticeHandled = true;
    throw e;
  }
}
async function managerOpen(id, draft, nested = false) {
  const message = notifications.scope();
  captureEditor();
  const previous = ui.editor
    ? { ...ui.editor, tab: ui.itemTab, scroll: window.scrollY }
    : null;
  const serial = ++ui.request;
  message("Loading item…", "loading");
  const details = await api("manager/items/" + id);
  if (serial !== ui.request) return;
  invalidateReview();
  const identity = doc.identities.find(
    (i) => i.id === details.policy.identityId,
  );
  const linkedOnly =
    !!identity && ![identity.artistId, identity.personId].includes(details.id);
  const key = linkedOnly
    ? "inspect:" + details.id
    : "metadata:" + (details.policy.identityId || details.id);
  const local = ui.locals.get(key);
  managerDetails = details;
  managerDetails.linkedOnly = linkedOnly;
  managerPolicy = structuredClone(local?.data || draft || details.policy);
  managerComparison = local?.comparison || null;
  if (nested && previous) ui.stack.push(previous);
  openWorkspace(
    "metadata",
    key,
    details.policy.identityId
      ? doc.identities.find((x) => x.id === details.policy.identityId)
          ?.preferredName || details.name
      : details.name,
    details.policy.fields && Object.keys(details.policy.fields).length
      ? "Managed metadata · only approved fields are reasserted on refresh"
      : "Jellyfin metadata · edits are local until applied",
    details.id,
  );
  q("mmoManagerTitle").textContent = details.name + " · " + details.kind;
  q("mmoManagerDependencies").textContent =
    details.dependencies.classification +
    " · " +
    details.dependencies.music.length +
    " music uses · " +
    details.dependencies.nonMusic.length +
    " non-music uses. " +
    details.refreshBehavior;
  q("mmoManagerLibraries").innerHTML = q("mmoLibraries").innerHTML;
  for (const o of q("mmoManagerLibraries").options)
    o.selected = managerPolicy.libraries.includes(o.value);
  q("mmoManagerReadOnly").hidden =
    details.dependencies.canEdit && !managerDetails.linkedOnly;
  q("mmoManagerReadOnly").textContent = managerDetails.linkedOnly
    ? "This record is an alias link. Open a selected representative in Identity to edit shared artist metadata. This linked record remains stored for compatibility."
    : "This record is shared outside the selected music scope and is read-only. Cover all music uses; non-music references prevent editing.";
  q("mmoManagerSourceProvider").innerHTML = details.providers
    .map(
      (p) =>
        '<option value="' +
        esc(p.name) +
        '" data-key="' +
        esc(p.key || "") +
        '">' +
        esc(p.name) +
        "</option>",
    )
    .join("");
  q("mmoManagerCompare").disabled = !details.providers.length;
  managerSourceChanged();
  if (managerComparison) {
    const binding = managerComparison.snapshot.binding;
    q("mmoManagerSourceProvider").value = binding.provider;
    q("mmoManagerSourceKey").value = binding.key;
    q("mmoManagerSourceId").value = binding.recordId;
    q("mmoManagerSourceConfirm").checked = true;
  }
  renderManagerFields();
  renderManagerImages();
  renderComparison();
  renderArtistLinks();
  q("mmoManagerHistory").innerHTML =
    details.history
      .slice()
      .reverse()
      .map(
        (h) =>
          "<p>" +
          esc(new Date(h.time).toLocaleString()) +
          " · " +
          esc(h.operation) + nativeLink(h.itemId, details.name) +
          " · " +
          esc(h.fields.map(human).join(", ")) +
          "</p>",
      )
      .join("") || "<p>No recorded applications.</p>";
  q("mmoDependencyDetails").innerHTML =
    details.dependencies.music
      .map(
        (u) =>
          "<p>" +
          nativeButton(
            u.name + " · " + u.roles.join(", "),
            'data-dependency-item="' + esc(u.id) + '"',
          ) + nativeLink(u.id, u.name) +
          "</p>",
      )
      .join("") || "<p>No music references.</p>";
  const tabs = [
    ["metadata", "Metadata"],
    ...(details.providers.length ? [["sources", "Sources"]] : []),
    ["artwork", "Artwork"],
    ...(details.kind === "MusicAlbum" ? [["tracks", "Tracks"]] : []),
    ...(["MusicArtist", "Person"].includes(details.kind)
      ? [["identity", "Identity"]]
      : []),
  ];
  q("mmoWorkspaceTabs").innerHTML = tabs
    .map(([tab, label]) =>
      nativeButton(
        label,
        'data-item-tab="' +
          tab +
          '" aria-selected="false" role="tab" id="mmoTab_' +
          tab +
          '" aria-controls="mmoPanel_' +
          tab +
          '"',
      ),
    )
    .join("");
  if (local?.raw)
    for (const r of local.raw) {
      const row = q("mmoManagerFields").querySelector(
        '[data-field="' + r.field + '"]',
      );
      if (row) {
        row.querySelector("[data-value]").value = r.value;
        row.querySelector("[data-mode]").value = r.mode;
        setFieldState(row);
      }
    }
  ui.editor.dirty = !!local;
  ui.editor.sequence = local?.sequence || 0;
  if (local)
    q("mmoWorkspaceState").textContent =
      "Unfinished local edit · save a draft to keep it after reloading";
  else if (
    draft &&
    (doc.policyDrafts.some((p) => p.id === draft.id) ||
      doc.drafts.some((r) => r.id === draft.id))
  )
    q("mmoWorkspaceState").textContent =
      "Saved draft · the active version remains unchanged";
  setEditorWritable();
  await selectItemTab(local?.tab || "metadata");
  message("");
}
function fieldRow(field) {
  const d = managerPolicy.fields[field] || { mode: "unmanaged" };
  const value = d.mode === "approved" ? d.value : managerDetails.stored[field];
  const text = arrayFields.includes(field)
    ? (value || []).join("\n")
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
  else if (
    arrayFields.includes(field) ||
    ["overview", "providerIds"].includes(field)
  )
    input =
      '<textarea is="emby-textarea" id="' +
      id +
      '" data-value rows="' +
      (field === "overview" ? 5 : field === "providerIds" ? 4 : 2) +
      '">' +
      esc(text) +
      "</textarea>";
  else
    input =
      '<input is="emby-input" id="' +
      id +
      '" data-value value="' +
      esc(text) +
      '" ' +
      (numberFields.includes(field) ? 'type="number" min="1"' : 'type="text"') +
      " />";
  const info = d.snapshotId
    ? managerPolicy.snapshots.find((s) => s.id === d.snapshotId)
    : null;
  const source = info
    ? info.binding.provider +
      " · " +
      info.binding.recordId +
      " · retrieved " +
      new Date(info.retrievedAt).toLocaleString()
    : d.provenance === "known"
      ? "Known · manual approval"
      : d.provenance === "inferred"
        ? "Inferred"
        : "Unknown";
  return (
    '<div class="mmo-field" data-field="' +
    field +
    '"><input data-mode type="hidden" value="' +
    esc(d.mode) +
    '" /><div class="inputContainer"><label class="inputLabel" for="' +
    id +
    '">' +
    esc(human(field)) +
    "</label>" +
    input +
    (arrayFields.includes(field)
      ? '<div class="fieldDescription">One name or value per line. Credit punctuation is preserved.</div>'
      : "") +
    '</div><p data-field-status class="secondaryText mmo-field-status"></p><details><summary>Management and source details</summary><div class="mmo-field-actions">' +
    nativeButton("Keep this value", 'data-field-action="approve"') +
    (!requiredFields.includes(field)
      ? nativeButton("Keep empty", 'data-field-action="empty"')
      : "") +
    nativeButton("Stop managing", 'data-field-action="unmanaged"') +
    "</div><p>Stored: " +
    esc(formatValue(managerDetails.stored[field])) +
    "</p><p>Displayed: " +
    esc(formatValue(managerDetails.effective[field])) +
    "</p><p>Approved: " +
    esc(
      d.mode === "approved"
        ? formatValue(d.value)
        : d.mode === "empty"
          ? "Explicitly empty"
          : "Unmanaged",
    ) +
    "</p><p data-source>Source: " +
    esc(source) +
    "</p><p>Locks: " +
    esc(
      managerDetails.IsLocked || managerDetails.isLocked
        ? "All metadata locked"
        : managerDetails.locks.join(", ") || "None",
    ) +
    "</p><p>Approved values and explicit emptiness are reasserted after refresh. Stop managing retains the current value and returns future handling to Jellyfin.</p></details></div>"
  );
}
function renderManagerFields() {
  const fields = managerFields.filter((f) => f in managerDetails.stored);
  const common =
    managerDetails.kind === "Audio"
      ? [
          "title",
          "album",
          "artists",
          "albumArtists",
          "discNumber",
          "trackNumber",
        ]
      : managerDetails.kind === "MusicAlbum"
        ? [
            "title",
            "artists",
            "albumArtists",
            "overview",
            "genres",
            "productionYear",
          ]
        : ["title", "sortName", "overview", "genres"];
  q("mmoManagerFields").innerHTML =
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
  for (const row of q("mmoManagerFields").querySelectorAll("[data-field]"))
    setFieldState(row);
  normalizeControls(q("mmoManagerFields"));
  applyIssueFieldFocus();
}
function setFieldState(row) {
  const mode = row.querySelector("[data-mode]").value;
  const active = managerDetails.policy.fields[row.dataset.field] || {
    mode: "unmanaged",
  };
  const activeText = arrayFields.includes(row.dataset.field)
    ? (active.value || []).join("\n")
    : row.dataset.field === "providerIds"
      ? JSON.stringify(active.value || {}, null, 2)
      : String(active.value ?? "");
  const changed =
    mode !== active.mode ||
    (mode === "approved" &&
      row.querySelector("[data-value]").value !== activeText);
  row.querySelector("[data-field-status]").textContent =
    (changed ? "Pending · " : "") +
    (mode === "approved"
      ? "Approved value · reasserted after refresh"
      : mode === "empty"
        ? "Explicitly empty · kept empty after refresh"
        : "Unmanaged · Jellyfin controls future refreshes");
  row.querySelector("[data-value]").disabled = mode === "empty";
  for (const b of row.querySelectorAll("[data-field-action]"))
    b.disabled =
      b.dataset.fieldAction === mode ||
      (b.dataset.fieldAction === "approve" && mode === "approved");
}
function readManagerFields() {
  for (const row of q("mmoManagerFields").querySelectorAll("[data-field]")) {
    const field = row.dataset.field,
      mode = row.querySelector("[data-mode]").value,
      text = row.querySelector("[data-value]").value;
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
          throw Error(
            "Provider IDs must be a JSON object. Your unfinished edit is retained.",
          );
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
  managerPolicy.libraries = [...q("mmoManagerLibraries").selectedOptions].map(
    (o) => o.value,
  );
  return structuredClone(managerPolicy);
}
function renderManagerImages() {
  const types = [
    ...new Set([
      "Primary",
      ...managerDetails.images.map((i) => i.type),
      ...Object.keys(managerPolicy.images),
    ]),
  ];
  q("mmoManagerImages").innerHTML = types
    .map((type) => {
      const d = managerPolicy.images[type],
        current = managerDetails.images.some((i) => i.type === type);
      const approved = d?.mode === "approved",
        status = approved
          ? "Approved replacement"
          : d?.mode === "empty"
            ? "Explicitly empty"
            : "Unmanaged";
      return (
        '<div class="mmo-image-card"><h4>' +
        esc(type) +
        "</h4><p>" +
        status +
        '</p><div class="mmo-image-pair"><figure><figcaption>Current</figcaption>' +
        (current
          ? '<img class="mmo-artwork" src="' +
            esc(nativeImage(managerDetails.id, type)) +
            '" alt="Current ' +
            esc(type) +
            '" />'
          : "<p>No image</p>") +
        "</figure>" +
        (d
          ? "<figure><figcaption>Proposed / approved</figcaption>" +
            (approved
              ? '<img class="mmo-artwork" data-pin-image="' +
                esc(d.hash) +
                '" alt="Selected ' +
                esc(type) +
                '" />'
              : "<p>" +
                esc(
                  d.mode === "empty"
                    ? "Kept empty"
                    : "Jellyfin controls images",
                ) +
                "</p>") +
            "</figure>"
          : "") +
        '</div><div class="mmo-actions">' +
        (current
          ? nativeButton("Keep current", 'data-image-current="' + type + '"')
          : "") +
        nativeButton("Keep empty", 'data-image-empty="' + type + '"') +
        nativeButton("Stop managing", 'data-image-unmanage="' + type + '"') +
        "</div>" +
        (approved
          ? "<details><summary>Approval details</summary><p>SHA256 " +
            esc(d.hash) +
            "</p><p>" +
            esc(d.sourceUrl || "Locally selected image") +
            "</p></details>"
          : "") +
        "</div>"
      );
    })
    .join("");
  hydratePins(q("mmoManagerImages"));
}
function managerSourceChanged() {
  ui.comparisonRequest++;
  const o = q("mmoManagerSourceProvider").selectedOptions[0];
  q("mmoManagerSourceKey").value = o?.dataset.key || "";
  q("mmoManagerSourceId").value =
    managerDetails?.providerCandidates.find((x) => x.key === o?.dataset.key)
      ?.recordId || "";
  q("mmoManagerSourceConfirm").checked = false;
}
function renderComparison() {
  if (!managerComparison) {
    q("mmoManagerSourceResult").innerHTML = managerDetails.providers.length
      ? ""
      : "<p>No installed remote metadata source supports this record type.</p>";
    return;
  }
  const s = managerComparison.snapshot;
  q("mmoManagerSourceResult").innerHTML =
    "<p>" +
    esc(s.binding.provider) +
    " · " +
    esc(s.binding.recordId) +
    " · retrieved " +
    esc(new Date(s.retrievedAt).toLocaleString()) +
    "</p>" +
    managerComparison.notes
      .map((n) => '<p class="secondaryText">' + esc(n) + "</p>")
      .join("") +
    Object.entries(s.offered)
      .filter(([field]) => field in managerDetails.stored)
      .map(([field, value]) => {
        const incompleteDate =
          ["premiereDate", "endDate"].includes(field) &&
          typeof value === "string" &&
          !/^\d{4}-\d{2}-\d{2}(T.*)?$/.test(value);
        const unavailable =
          value == null ||
          value === "" ||
          (Array.isArray(value) && !value.length);
        return (
          '<section class="mmo-field"><h4>' +
          esc(human(field)) +
          "</h4><p>Current: " +
          esc(formatValue(managerDetails.stored[field])) +
          '</p><div class="mmo-diff"><div><strong>Source offers</strong><p>' +
          esc(formatValue(value)) +
          "</p></div><div><strong>Configured provider offers</strong><p>" +
          esc(formatValue(s.configured[field])) +
          "</p></div></div>" +
          (incompleteDate
            ? '<p class="secondaryText">This source date is incomplete. Use the known year, when offered, or enter a complete date manually.</p>'
            : unavailable
              ? '<p class="secondaryText">Unavailable from this source</p>'
              : nativeButton(
                  "Use in local edit",
                  'data-source-field="' + field + '"',
                )) +
          "</section>"
        );
      })
      .join("") +
    managerComparison.images
      .map(
        (image, index) =>
          '<div class="mmo-image-card"><h4>' +
          esc(image.type) +
          " · " +
          esc(image.providerName || s.binding.provider) +
          '</h4><img class="mmo-artwork" loading="lazy" src="' +
          esc(image.url) +
          '" alt="Source artwork candidate" />' +
          nativeButton(
            "Cache for review",
            'data-source-image="' + index + '"',
          ) +
          "</div>",
      )
      .join("");
}
async function selectItemTab(tab) {
  if (tab !== ui.itemTab) notifications.clear();
  if (!q("mmoWorkspaceTabs").querySelector('[data-item-tab="' + tab + '"]'))
    tab = "metadata";
  ui.itemTab = tab;
  q("mmoWorkspaceTabs")
    .querySelectorAll("[data-item-tab]")
    .forEach(
      (b) => (
        b.setAttribute("aria-selected", String(b.dataset.itemTab === tab)),
        (b.tabIndex = b.dataset.itemTab === tab ? 0 : -1)
      ),
    );
  q("mmoManagerEditor")
    .querySelectorAll("[data-item-panel]")
    .forEach((el) => (el.hidden = el.dataset.itemPanel !== tab));
  if (tab === "tracks") await loadAlbumTracks();
  if (tab === "artwork") hydratePins(q("mmoManagerImages"));
}
async function loadAlbumTracks() {
  const id = managerDetails.id,
    serial = ui.request;
  q("mmoAlbumTracks").textContent = "Loading tracks…";
  const result = await api("manager/items/" + id + "/tracks");
  if (serial !== ui.request || managerDetails.id !== id) return;
  q("mmoAlbumTracks").innerHTML =
    result.items
      .map(
        (t) =>
          '<div class="mmo-row"><div class="mmo-track-number">Disc ' +
          esc(t.discNumber ?? "—") +
          " · " +
          esc(t.trackNumber ?? "—") +
          '</div><div class="mmo-row-main">' +
          nativeButton(t.name, 'data-track-item="' + t.id + '"') + nativeLink(t.id, t.name) +
          '<p class="secondaryText">' +
          esc(t.artists.join(", ")) +
          (t.managed ? " · Managed" : "") +
          "</p></div></div>",
      )
      .join("") || "<p>No child tracks.</p>";
}
function renderArtistLinks() {
  const identity = doc.identities.find(
    (i) =>
      i.id === managerPolicy.identityId ||
      i.artistId === managerDetails.id ||
      i.personId === managerDetails.id ||
      (i.artistIds || []).includes(managerDetails.id) ||
      (i.personIds || []).includes(managerDetails.id),
  );
  q("mmoEditLinkedIdentity").textContent = identity
    ? "Edit aliases and bindings"
    : "Create an identity for this artist";
  q("mmoEditLinkedIdentity").dataset.identity = identity?.id || "";
  q("mmoArtistLinks").innerHTML = identity
    ? "<p>Canonical artist: <strong>" +
      esc(identity.preferredName) +
      "</strong></p><p>Recognized aliases: " +
      esc(identity.aliases.join(", ")) +
      "</p><p>Track and album credits retain their original labels. Credit mappings are separate corrections.</p><details><summary>Native bindings</summary><p>" +
      nativeButton(
        "MusicArtist representative",
        'data-linked-record="' + esc(identity.artistId) + '"',
      ) + nativeLink(identity.artistId, 'MusicArtist representative') +
      "</p><p>" +
      nativeButton(
        "Person representative",
        'data-linked-record="' + esc(identity.personId) + '"',
      ) + nativeLink(identity.personId, 'Person representative') +
      "</p>" +
      [...(identity.artistIds || []), ...(identity.personIds || [])]
        .map(
          (id) =>
            "<p>" +
            nativeButton(id, 'data-linked-record="' + esc(id) + '"') + nativeLink(id, 'linked artist record') +
            "</p>",
        )
        .join("") +
      "</details>"
    : "<p>This native artist record has no approved canonical identity. Its metadata can be managed independently.</p>";
}
function renderIssueStatus(s) {
  q("mmoIssueStatus").innerHTML =
    (s.reports?.length ? s.reports.map(r => "<p>" + esc(r.message) + nativeLink(r.itemId, "reported item") + "</p>").join("") : "") + [
      ...(!s.reports?.length ? s.errors || [] : []),
      ...(s.unmatchedRules || []).map((x) => "Unmatched correction: " + x),
    ]
      .map((x) => "<p>" + esc(x) + "</p>")
      .join("") ||
    "<p>No application failures or unmatched rules reported.</p>";
}
function renderMetadataDrafts() {
  const active = doc.policies || [],
    drafts = doc.policyDrafts || [];
  q("mmoManagerPolicies").innerHTML = active
    .concat(drafts.filter((d) => !active.some((p) => p.id === d.id)))
    .map((p) => {
      const live = active.some((x) => x.id === p.id),
        pending = live && drafts.some((x) => x.id === p.id);
      const edit = nativeButton("Edit", 'data-policy-edit="' + p.id + '"');
      const actions =
        (pending
          ? nativeButton(
              "Resume pending changes",
              'data-policy-resume="' + p.id + '"',
            )
          : "") +
        (live
          ? nativeButton(
              "Review disable",
              'data-policy-disable="' + p.id + '"',
            ) +
            nativeButton(
              "Review delete",
              'data-policy-delete-active="' + p.id + '"',
            )
          : nativeButton(
              "Review & apply",
              'data-policy-preview="' + p.id + '"',
            )) +
        (drafts.some((d) => d.id === p.id)
          ? nativeButton(
              live ? "Discard pending changes" : "Delete draft",
              'data-policy-delete="' + p.id + '"',
            )
          : "");
      return changeRow(
        p.label || p.identityId || p.itemId,
        "metadata",
        live,
        pending,
        edit,
        actions,
        "policy",
        p.id,
      );
    })
    .join("");
}
q("mmoInventoryForm").onsubmit = (e) => {
  e.preventDefault();
  managerStart = 0;
  perform(managerInventory);
};
q("mmoInventoryFind").onclick = null;
q("mmoInventoryPrev").onclick = () =>
  perform(async (operation) => {
    const message = notifications.scope(operation);
    managerStart = Math.max(0, managerStart - tablePageSize);
    await managerInventory();
  });
q("mmoInventoryNext").onclick = () =>
  perform(async (operation) => {
    const message = notifications.scope(operation);
    managerStart += tablePageSize;
    await managerInventory();
  });
for (const id of [
  "mmoInventoryLibrary",
  "mmoInventoryKind",
  "mmoInventoryView",
])
  q(id).onchange = () =>
    perform(async (operation) => {
      const message = notifications.scope(operation);
      managerStart = 0;
      await managerInventory();
    });
q("mmoInventoryRows").onclick = (e) =>
  perform(async (operation) => {
    const message = notifications.scope(operation);
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.inventoryIdentity) {
      const identity = doc.identities.find(
        (i) => i.id === b.dataset.inventoryIdentity,
      );
      try {
        await managerOpen(identity.artistId);
      } catch (err) {
        await editIdentity(identity);
        message("Representative unavailable: " + err.message, "warning");
      }
    } else if (b.dataset.managerItem) await managerOpen(b.dataset.managerItem);
  });
q("mmoManagerFields").oninput = (e) => {
  const row = e.target.closest("[data-field]");
  if (!row) return;
  row.querySelector("[data-mode]").value = "approved";
  const d = managerPolicy.fields[row.dataset.field];
  if (d) {
    delete d.snapshotId;
    delete d.sourceField;
    d.provenance = "known";
  }
  row.querySelector("[data-source]").textContent =
    "Source: Known · manual edit";
  setFieldState(row);
  invalidateReview();
  markDirty();
};
q("mmoManagerFields").onclick = (e) => {
  const action = e.target.closest("[data-field-action]");
  if (!action) return;
  const row = action.closest("[data-field]");
  row.querySelector("[data-mode]").value =
    action.dataset.fieldAction === "approve"
      ? "approved"
      : action.dataset.fieldAction;
  setFieldState(row);
  invalidateReview();
  markDirty();
};
q("mmoManagerLibraries").onchange = () =>
  perform(async (operation) => {
    const message = notifications.scope(operation);
    readManagerFields();
    invalidateReview();
    markDirty();
    const serial = ui.request;
    const p = new URLSearchParams();
    managerPolicy.libraries.forEach((x) => p.append("libraries", x));
    const d = await api(
      "manager/items/" + managerDetails.id + "/dependencies?" + p,
    );
    if (serial !== ui.request) return;
    managerDetails.dependencies = d;
    q("mmoManagerReadOnly").hidden = d.canEdit;
    setEditorWritable();
  });
q("mmoManagerSourceProvider").onchange = managerSourceChanged;
q("mmoManagerCompare").onclick = () =>
  perform(async (operation) => {
    const message = notifications.scope(operation);
    readManagerFields();
    if (!q("mmoManagerSourceConfirm").checked)
      throw Error("Confirm the intended source record before fetching.");
    const serial = ui.request,
      compareSerial = ++ui.comparisonRequest,
      id = managerDetails.id;
    message("Fetching comparison…", "loading");
    const sourceSelection = () => JSON.stringify([q("mmoManagerSourceProvider").value, q("mmoManagerSourceKey").value, q("mmoManagerSourceId").value, q("mmoManagerSourceConfirm").checked]);
    const selectedSource = sourceSelection();
    const comparison = await api("manager/compare", "POST", {
      itemId: id,
      provider: q("mmoManagerSourceProvider").value,
      key: q("mmoManagerSourceKey").value,
      recordId: q("mmoManagerSourceId").value,
      confirm: true,
    });
    if (
      serial !== ui.request ||
      managerDetails.id !== id ||
      compareSerial !== ui.comparisonRequest
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
      invalidateReview();
      markDirty();
      ui.locals.get(ui.editor.key).comparison = comparison;
    }
    renderComparison();
    setEditorWritable();
    message("Comparison fetched. Active metadata is unchanged.");
  });
q("mmoManagerSourceResult").onclick = (e) =>
  perform(async (operation) => {
    const message = notifications.scope(operation);
    const b = e.target.closest("button");
    if (!b) return;
    const field = b.dataset.sourceField,
      index = b.dataset.sourceImage;
    if (field) {
      readManagerFields();
      const s = managerComparison.snapshot;
      managerPolicy.fields[field] = {
        mode: "approved",
        value: s.offered[field],
        provenance: "known",
        snapshotId: s.id,
        sourceField: field,
      };
      renderManagerFields();
      invalidateReview();
      markDirty();
      message(human(field) + " selected for the local edit.");
    }
    if (index !== undefined) {
      const offered = managerComparison.images[Number(index)],
        serial = ui.request;
      const imageBefore = JSON.stringify(managerPolicy.images[offered.type]);
      const snapshotId = managerComparison.snapshot.id;
      message("Caching artwork…", "loading");
      const image = await api("manager/images/cache", "POST", {
        itemId: managerDetails.id,
        snapshotId: managerComparison.snapshot.id,
        url: offered.url,
        type: offered.type,
      });
      if (serial !== ui.request) return;
      if (JSON.stringify(managerPolicy.images[offered.type]) !== imageBefore || managerComparison?.snapshot.id !== snapshotId) {
        message("Artwork cached, but your selection changed. Cache again to stage the intended image.", "warning");
        return;
      }
      managerPolicy.images[offered.type] = image;
      renderManagerImages();
      invalidateReview();
      markDirty();
      message("Artwork cached for review.");
    }
  });
q("mmoManagerImages").onclick = (e) =>
  perform(async (operation) => {
    const message = notifications.scope(operation);
    const b = e.target.closest("button");
    if (!b) return;
    const serial = ui.request;
    if (b.dataset.imageCurrent) {
      const imageBefore = JSON.stringify(managerPolicy.images[b.dataset.imageCurrent]);
      message("Caching artwork…", "loading");
      const image = await api(
        "manager/items/" +
          managerDetails.id +
          "/images/" +
          b.dataset.imageCurrent +
          "/pin-current",
        "POST",
      );
      if (serial !== ui.request) return;
      if (JSON.stringify(managerPolicy.images[b.dataset.imageCurrent]) !== imageBefore) {
        message("Artwork selection changed while caching. Keep the current selection or cache again.", "warning");
        return;
      }
      managerPolicy.images[b.dataset.imageCurrent] = image;
    } else if (b.dataset.imageEmpty)
      managerPolicy.images[b.dataset.imageEmpty] = { mode: "empty" };
    else if (b.dataset.imageUnmanage)
      managerPolicy.images[b.dataset.imageUnmanage] = { mode: "unmanaged" };
    else return;
    renderManagerImages();
    invalidateReview();
    markDirty();
  });
q("mmoManagerPreview").onclick = () =>
  perform(async (operation) => {
    const message = notifications.scope(operation);
    const policy = readManagerFields();
    await preview({ metadataEdits: [policy] });
  });
q("mmoManagerSave").onclick = () =>
  perform(() =>
    saveLocalDraft("manager/drafts", readManagerFields(), q("mmoManagerSave")),
  );
q("mmoManagerCancel").onclick = () =>
  perform(async (operation) => {
    const message = notifications.scope(operation);
    const saving = ui.pendingSaves.has(ui.editor?.key);
    clearLocal();
    ui.editor = null;
    await workspaceBack();
    message(saving ? "Local edit discarded. The pending save continues; active values are unchanged." : "Local edit discarded. Saved and active values are unchanged.");
  });
q("mmoManagerBatchAdd").onclick = () =>
  perform(async (operation) => {
    const message = notifications.scope(operation);
    const p = readManagerFields();
    if (managerBatch.some(x => x.id === p.id && JSON.stringify(x) === JSON.stringify(p))) {
      message("This edit is already added to batch.");
      return;
    }
    managerBatch = managerBatch.filter((x) => x.id !== p.id).concat([p]);
    renderBatch();
    message("Edit added to the optional batch review.");
  });
q("mmoManagerBatchPreview").onclick = () =>
  perform(async (operation) => {
    const message = notifications.scope(operation);
    if (!managerBatch.length) throw Error("Add edits to the batch first.");
    await preview({ metadataEdits: managerBatch });
  });
q("mmoManagerStop").onclick = () =>
  perform(() =>
    preview({
      relinquish: [
        {
          itemId: managerDetails.id,
          fields: Object.keys(managerDetails.policy.fields).filter(
            (f) => managerDetails.policy.fields[f].mode !== "unmanaged",
          ),
          images: Object.keys(managerDetails.policy.images).filter(
            (t) => managerDetails.policy.images[t].mode !== "unmanaged",
          ),
          restoreOriginal: false,
        },
      ],
    }),
  );
q("mmoManagerRestore").onclick = () =>
  perform(() =>
    preview({
      relinquish: [
        {
          itemId: managerDetails.id,
          fields: [
            ...new Set([
              ...Object.keys(managerDetails.policy.fields).filter(
                (f) => managerDetails.policy.fields[f].mode !== "unmanaged",
              ),
              ...Object.keys(managerDetails.original?.original || {}),
              ...Object.keys(managerDetails.correctionOriginal?.original || {}),
            ]),
          ],
          images: [
            ...new Set([
              ...Object.keys(managerDetails.policy.images).filter(
                (t) => managerDetails.policy.images[t].mode !== "unmanaged",
              ),
              ...Object.keys(managerDetails.original?.originalImages || {}),
            ]),
          ],
          restoreOriginal: true,
        },
      ],
    }),
  );
q("mmoArtworkChoose").onclick = () => q("mmoManagerUpload").click();
q("mmoManagerUpload").addEventListener("change", () => {
  q("mmoArtworkFilename").textContent =
    q("mmoManagerUpload").files[0]?.name || "No artwork selected";
});
q("mmoManagerUploadCache").onclick = () =>
  perform(async (operation) => {
    const message = notifications.scope(operation);
    const file = q("mmoManagerUpload").files[0];
    if (!file) throw Error("Select an image first.");
    const serial = ui.request,
      type = q("mmoManagerUploadType").value;
    const imageBefore = JSON.stringify(managerPolicy.images[type]);
    message("Caching artwork…", "loading");
    const data = new FormData();
    data.append("file", file);
    const headers = {};
    ApiClient.setRequestHeaders(headers);
    const response = await fetch(
      ApiClient.getUrl("MusicMetadataManager/manager/images/upload"),
      { method: "POST", headers, body: data, credentials: "same-origin" },
    );
    const image = await response.json();
    if (!response.ok)
      throw Error(image.error || image.title || "Artwork upload failed.");
    if (serial !== ui.request) return;
    if (q("mmoManagerUpload").files[0] !== file || q("mmoManagerUploadType").value !== type || JSON.stringify(managerPolicy.images[type]) !== imageBefore) {
      message("Artwork cached, but your selection changed. Cache again to stage the intended image.", "warning");
      return;
    }
    managerPolicy.images[type] = image;
    renderManagerImages();
    invalidateReview();
    markDirty();
    message("Artwork cached. Preview and apply to activate it.");
  });
q("mmoManagerIssueRefresh").onclick = () => perform(refreshIssues);
q("mmoManagerPolicies").onclick = (e) =>
  perform(async (operation) => {
    const message = notifications.scope(operation);
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.policyDisable)
      return preview({ disablePolicies: [b.dataset.policyDisable] });
    if (b.dataset.policyDeleteActive)
      return preview({ deletePolicies: [b.dataset.policyDeleteActive] });
    if (b.dataset.policyPreview)
      return preview({ activatePolicies: [b.dataset.policyPreview] });
    if (b.dataset.policyDelete) {
      await api("manager/drafts/" + b.dataset.policyDelete, "DELETE");
      invalidateReview();
      await load();
      return;
    }
    const id = b.dataset.policyEdit || b.dataset.policyResume;
    if (!id) return;
    const p = (
      b.dataset.policyResume
        ? doc.policyDrafts
        : (doc.policies || []).concat(doc.policyDrafts || [])
    ).find((x) => x.id === id);
    const item = p.identityId
      ? doc.identities.find((x) => x.id === p.identityId)?.artistId
      : p.itemId;
    if (!item) throw Error("Rebind the missing canonical identity first.");
    await managerOpen(item, p);
  });
q("mmoWorkspaceTabs").onclick = (e) => {
  const b = e.target.closest("[data-item-tab]");
  if (b) perform(() => selectItemTab(b.dataset.itemTab));
};
q("mmoAlbumTracks").onclick = (e) => {
  const id = e.target.closest("[data-track-item]")?.dataset.trackItem;
  if (id) perform(() => managerOpen(id, undefined, true));
};
q("mmoAlbumDefaults").onclick = () => {
  const existing = doc.active.find(
    (r) => r.kind === "album" && r.path === managerDetails.path,
  );
  edit(
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
q("mmoEditLinkedIdentity").onclick = () => {
  const identity = doc.identities.find(
    (i) => i.id === q("mmoEditLinkedIdentity").dataset.identity,
  );
  perform(() =>
    editIdentity(
      identity || {
        preferredName: managerDetails.name,
        aliases: [managerDetails.name],
        libraries: managerPolicy.libraries,
        ...(managerDetails.kind === "MusicArtist"
          ? { artistId: managerDetails.id }
          : { personId: managerDetails.id }),
      },
      true,
    ),
  );
};
for (const id of ["mmoArtistLinks", "mmoDependencyDetails"])
  q(id).onclick = (e) => {
    const b = e.target.closest("button");
    const item = b?.dataset.linkedRecord || b?.dataset.dependencyItem;
    if (item) perform(() => managerOpen(item, undefined, true));
  };

function setEditorWritable() {
  const writable =
    managerDetails.dependencies.canEdit && !managerDetails.linkedOnly;
  for (const id of [
    "mmoManagerPreview",
    "mmoManagerSave",
    "mmoManagerUploadCache",
    "mmoManagerBatchAdd",
    "mmoManagerStop",
    "mmoManagerRestore",
  ])
    q(id).disabled =
      !writable ||
      (id === "mmoManagerSave" && ui.pendingSaves.has(ui.editor?.key));
  syncBatchButton();
  q("mmoManagerLibraries").disabled =
    !!managerDetails.linkedOnly ||
    managerDetails.dependencies.nonMusic.length > 0;
  for (const row of q("mmoManagerFields").querySelectorAll("[data-field]")) {
    setFieldState(row);
    if (!writable) {
      row.querySelector("[data-value]").disabled = true;
      row
        .querySelectorAll("[data-field-action]")
        .forEach((button) => (button.disabled = true));
    }
  }
  q("mmoManagerImages")
    .querySelectorAll("button")
    .forEach((button) => (button.disabled = !writable));
  q("mmoManagerSourceResult")
    .querySelectorAll("button")
    .forEach((button) => (button.disabled = !writable));
}

for (const id of ["mmoManagerSourceKey", "mmoManagerSourceId"])
  q(id).addEventListener("input", () => {
    ui.comparisonRequest++;
    q("mmoManagerSourceConfirm").checked = false;
  });
