// Visit-local state. No draft or configuration is written by navigation.
const ui = {
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
const humanLabels = {
  ...labels,
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
function human(field) {
  return humanLabels[field] || field;
}
function nativeButton(text, attributes = "", primary = false) {
  return (
    '<button is="emby-button" type="button" class="' +
    (primary ? "raised " : "button-flat ") +
    'emby-button" ' +
    attributes +
    ">" +
    esc(text) +
    "</button>"
  );
}
function formatValue(value) {
  if (value === null || value === undefined || value === "") return "Empty";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "Empty";
  return typeof value === "object"
    ? JSON.stringify(value, null, 2)
    : String(value);
}
function nativeImage(id, type = "Primary") {
  return ApiClient.getImageUrl(id, { type, maxWidth: 320, quality: 90 });
}
function updateLocalCount() {
  const saved =
    (doc?.drafts?.length || 0) +
    (doc?.identityDrafts?.length || 0) +
    (doc?.policyDrafts?.length || 0);
  q("mmoChangesBadge").textContent = [
    saved ? saved + " saved" : "",
    ui.locals.size ? ui.locals.size + " unfinished" : "",
  ]
    .filter(Boolean)
    .join(" · ");
  q("mmoLocalSection").hidden = !ui.locals.size;
  q("mmoLocalEdits").innerHTML = [...ui.locals]
    .map(
      ([key, entry]) =>
        '<div class="mmo-row"><div class="mmo-row-main"><strong>' +
        esc(entry.name) +
        '</strong><p class="secondaryText">Unfinished ' +
        esc(entry.type) +
        " edit · not saved" +
        (entry.baselineChanged
          ? " · active baseline changed; preview again"
          : "") +
        '</p></div><div class="mmo-row-actions">' +
        nativeButton("Resume", 'data-local-resume="' + esc(key) + '"') +
        nativeButton("Discard", 'data-local-discard="' + esc(key) + '"') +
        "</div></div>",
    )
    .join("");
  renderBatch();
}
function rawFields() {
  return managerDetails
    ? [...q("mmoManagerFields").querySelectorAll("[data-field]")].map(
        (row) => ({
          field: row.dataset.field,
          mode: row.querySelector("[data-mode]").value,
          value: row.querySelector("[data-value]").value,
        }),
      )
    : [];
}
function captureEditor() {
  const e = ui.editor;
  if (!e || ui.screen !== "workspace" || !e.dirty) return;
  let data, raw;
  if (e.type === "metadata") {
    try {
      data = readManagerFields();
    } catch {
      data = structuredClone(managerPolicy);
    }
    raw = rawFields();
  } else if (e.type === "identity") data = identityForm();
  else data = formRule();
  ui.locals.set(e.key, {
    ...e,
    baselineChanged:
      e.baselineChanged || ui.locals.get(e.key)?.baselineChanged || false,
    data: structuredClone(data),
    raw,
    tab: ui.itemTab,
    comparison: e.type === "metadata" ? managerComparison : null,
  });
  updateLocalCount();
}
function markDirty() {
  if (!ui.editor) return;
  invalidateReview();
  ui.editor.dirty = true;
  ui.editor.sequence = (ui.editor.sequence || 0) + 1;
  q("mmoWorkspaceState").textContent =
    "Unfinished local edit · save a draft to keep it after reloading";
  captureEditor();
  syncBatchButton();
}
function clearLocal(key = ui.editor?.key) {
  if (key) ui.locals.delete(key);
  if (ui.editor?.key === key) ui.editor.dirty = false;
  updateLocalCount();
}
function displayScreen(screen) {
  notifications.clear();
  stopIssueVerification();
  ui.screen = screen;
  q("mmoIssuePanel").hidden = screen !== "issue";
  q("mmoMain").hidden = screen !== "list";
  q("mmoNavigation").hidden = screen !== "list";
  q("mmoWorkspace").hidden = screen !== "workspace";
  q("mmoPreviewArea").hidden = screen !== "review";
}
async function showDestination(view, capture = true, restoreFocus = false) {
  notifications.clear();
  closeRowMenu();
  if (capture) captureEditor();
  if (ui.screen === "list") ui.scroll.set(ui.view, window.scrollY);
  invalidateReview();
  ui.view = view;
  ui.editor = null;
  ui.stack = [];
  ui.request++;
  displayScreen("list");
  page
    .querySelectorAll("[data-destination]")
    .forEach((el) => (el.hidden = el.dataset.destination !== view));
  q("mmoNavigation")
    .querySelectorAll("[data-view]")
    .forEach((el) =>
      el.dataset.view === view
        ? el.setAttribute("aria-current", "page")
        : el.removeAttribute("aria-current"),
    );
  if (view === "issues") {
    if (!ui.issueLoaded) await refreshIssues();
    renderIssueResults();
    if (issueVerification) void checkIssueResolution();
  }
  if (view === "tools") await status();
  if (view === "rules") {
    renderChanges();
    updateLocalCount();
  }
  window.scrollTo(0, ui.scroll.get(view) || 0);
  if (restoreFocus && ui.listFocus?.view === view) {
    const ref = ui.listFocus;
    const element = ref.element?.isConnected
      ? ref.element
      : ref.selector
        ? page.querySelector(ref.selector)
        : null;
    element?.focus({ preventScroll: true });
  }
}
function openWorkspace(type, key, name, state, itemId, nested = false) {
  if (ui.screen === "workspace" && nested && ui.editor) {
    captureEditor();
    ui.stack.push({ ...ui.editor, tab: ui.itemTab, scroll: window.scrollY });
  } else if (ui.screen === "list") {
    ui.scroll.set(ui.view, window.scrollY);
    const element = document.activeElement;
    let selector;
    if (element?.id) selector = "#" + CSS.escape(element.id);
    else if (element?.dataset)
      for (const key of [
        "managerItem",
        "inventoryIdentity",
        "localResume",
        "issueItem",
        "policyEdit",
      ]) {
        if (element.dataset[key]) {
          selector =
            "[data-" +
            key.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase()) +
            '="' +
            CSS.escape(element.dataset[key]) +
            '"]';
          break;
        }
      }
    if (element?.dataset.action)
      selector =
        '[data-action="' +
        element.dataset.action +
        '"][data-id="' +
        CSS.escape(element.dataset.id) +
        '"]';
    if (element?.dataset.issueOpen)
      selector =
        '[data-issue-open="' + CSS.escape(element.dataset.issueOpen) + '"]';
    ui.listFocus = { view: ui.view, element, selector };
  }
  displayScreen("workspace");
  resetIssueEditor();
  q("mmoRepairControls").hidden = true;
  ui.editor = { type, key, name, itemId, dirty: false, sequence: 0 };
  q("mmoWorkspaceTitle").textContent = name;
  q("mmoWorkspaceState").textContent = state;
  q("mmoWorkspaceNative").innerHTML = nativeLink(itemId, name, false);
  q("mmoManagerEditor").hidden = type !== "metadata";
  q("mmoForm").hidden = type !== "rule";
  q("mmoIdentityForm").hidden = type !== "identity";
  q("mmoItemThumbnail").hidden = !itemId;
  if (itemId) q("mmoItemThumbnail").src = nativeImage(itemId);
  q("mmoWorkspaceTabs").hidden = type !== "metadata";
  q("mmoWorkspaceBack").textContent =
    "← Back to " +
    (ui.stack.length
      ? ui.stack.at(-1).name
      : ui.view.charAt(0).toUpperCase() + ui.view.slice(1));
  window.scrollTo(0, 0);
  q("mmoWorkspaceTitle").focus({ preventScroll: true });
}
async function resumeEntry(entry, nested = false) {
  if (entry.type === "metadata")
    await managerOpen(entry.itemId, entry.data, nested);
  else if (entry.type === "identity") await editIdentity(entry.data, nested);
  else edit(entry.data, nested);
  if (entry.type === "metadata" && entry.raw)
    for (const value of entry.raw) {
      const row = q("mmoManagerFields").querySelector(
        '[data-field="' + value.field + '"]',
      );
      if (row) {
        row.querySelector("[data-value]").value = value.value;
        row.querySelector("[data-mode]").value = value.mode;
        setFieldState(row);
      }
    }
  if (ui.editor) {
    ui.editor.dirty = !!entry.dirty;
    ui.editor.sequence = entry.sequence || 0;
    ui.editor.baselineChanged = !!entry.baselineChanged;
  }
  if (entry.type === "metadata") await selectItemTab(entry.tab || "metadata");
  if (entry.issueRepair && ui.editor) focusIssueEditor(entry.issueRepair.issue, entry.issueRepair.guided && !!repairQueue, entry.issueRepair.choice, entry.issueRepair.full);
  if (entry.baselineChanged)
    q("mmoWorkspaceState").textContent +=
      " · active baseline changed; preview again";
}
async function workspaceBack() {
  captureEditor();
  invalidateReview();
  ui.request++;
  if (ui.stack.length) {
    const entry = ui.stack.pop();
    await resumeEntry(entry);
    window.scrollTo(0, entry.scroll || 0);
  } else if (issueEditor && ui.editor && issueEditor.key === ui.editor.key) await openIssuePanel(issueEditor.issue, issueEditor.guided);
  else await showDestination(ui.view, false, true);
}
function syncBatchButton() {
  if (ui.editor?.type !== "metadata" || !managerPolicy || !managerDetails) return;
  const staged = managerBatch.some(p => p.id === managerPolicy.id && JSON.stringify(p) === JSON.stringify(managerPolicy));
  const button = q("mmoManagerBatchAdd");
  button.textContent = staged ? "Added to batch" : "Add to batch";
  button.disabled = staged || !managerDetails.dependencies.canEdit || managerDetails.linkedOnly;
}
function renderBatch() {
  syncBatchButton();
  q("mmoBatchSection").hidden = !managerBatch.length;
  q("mmoManagerBatchCount").textContent =
    managerBatch.length + " edits staged for batch review";
  q("mmoBatchRows").innerHTML = managerBatch
    .map(
      (p) =>
        '<div class="mmo-row"><div class="mmo-row-main">' +
        esc(p.label || p.itemId || p.identityId) +
        "</div>" +
        nativeButton("Remove", 'data-batch-remove="' + esc(p.id) + '"') +
        "</div>",
    )
    .join("");
}
async function hydratePins(container = page) {
  for (const img of container.querySelectorAll("img[data-pin-image]")) {
    const hash = img.dataset.pinImage;
    try {
      let pending = ui.pinUrls.get(hash);
      if (!pending) {
        const headers = {};
        ApiClient.setRequestHeaders(headers);
        pending = fetch(
          ApiClient.getUrl(
            "MusicMetadataManager/manager/images/pins/" +
              encodeURIComponent(hash),
          ),
          { headers, credentials: "same-origin" },
        ).then(async (r) => {
          if (!r.ok) throw Error("Cached artwork unavailable");
          return URL.createObjectURL(await r.blob());
        });
        ui.pinUrls.set(hash, pending);
      }
      img.src = await pending;
    } catch {
      img.hidden = true;
      ui.pinUrls.delete(hash);
      if (!img.parentElement.querySelector("[data-pin-error]")) {
        const error = document.createElement("p");
        error.dataset.pinError = "true";
        error.className = "mmo-warning";
        error.textContent =
          "Cached artwork is unavailable. Cache it again before previewing.";
        img.after(error);
      }
    }
  }
}
function normalizeControls(container = page) {
  // Older correction/identity forms now use the same native widgets as the manager.
  for (const control of container.querySelectorAll(
    "button,select,textarea,input",
  )) {
    if (control.tagName === "BUTTON") {
      control.setAttribute("is", "emby-button");
      control.classList.add("emby-button");
      if (!control.classList.contains("raised"))
        control.classList.add("button-flat");
    }
    if (control.tagName === "SELECT") {
      control.setAttribute("is", "emby-select");
      control.classList.add("emby-select");
    }
    if (control.tagName === "TEXTAREA") {
      control.setAttribute("is", "emby-textarea");
      control.classList.add("emby-textarea");
    }
    if (control.tagName === "INPUT" && control.type !== "file")
      control.setAttribute(
        "is",
        control.type === "checkbox" ? "emby-checkbox" : "emby-input",
      );
  }
}

async function saveLocalDraft(route, data, button) {
  const message = notifications.scope();
  const key = ui.editor.key,
    sequence = ui.editor.sequence || 0;
  if (ui.pendingSaves.has(key))
    throw Error("A save for this edit is already pending.");
  message("Saving draft…", "loading");
  ui.pendingSaves.add(key);
  button.disabled = true;
  try {
    await api(route, "POST", data);
    const local = ui.locals.get(key);
    const newerEdits = (local && local.sequence !== sequence) || (ui.editor?.key === key && ui.editor.sequence !== sequence);
    if (!newerEdits) clearLocal(key);
    const wasReview = ui.screen === "review";
    invalidateReview();
    await load();
    message(
      newerEdits
        ? "Draft saved; newer edits remain unsaved. The active version is unchanged."
        : wasReview
        ? "Draft saved. The active version is unchanged. Return to edit and preview again before applying."
        : "Draft saved. The active version remains unchanged. Newer local edits are retained.",
    );
  } finally {
    ui.pendingSaves.delete(key);
    if (ui.editor?.type === "metadata") setEditorWritable();
  }
}
