// One filtered management view, reusing the existing mutation handlers.
function changeRow(name, type, live, pending, edit, actions, family, id) {
  const entry = family === "identity" ? [...doc.identities, ...doc.identityDrafts].find(x => x.id === id) : family === "policy" ? [...doc.policies, ...doc.policyDrafts].find(x => x.id === id) : [...doc.active, ...doc.drafts].find(x => x.id === id);
  const identity = family === "policy" && entry?.identityId ? [...doc.identities, ...doc.identityDrafts].find(x => x.id === entry.identityId) : null;
  const native = family === "rule" ? (entry?.metadata ? nativeLink(entry.metadata.itemId, name) : nativeRuleLink(entry)) : nativeLink(family === "identity" ? entry?.artistId : identity?.artistId || entry?.itemId, name);
  return tableRow({
    name,
    type:
      type === "mapping"
        ? "Credit mapping"
        : type === "identity"
          ? "Artist identity"
          : type === "metadata"
            ? "Item metadata"
            : "Correction",
    status: live
      ? "Active" + (pending ? " · pending changes" : "")
      : "Saved draft",
    attributes:
      'data-change-type="' +
      esc(type) +
      '" data-change-state="' +
      (pending ? "pending" : live ? "active" : "draft") +
      '" data-change-key="' +
      esc(family + ":" + id) +
      '"',
    selection: tableCheckbox(
      name,
      'data-change-select="' + esc(family + ":" + id) + '"',
    ),
    primary: edit,
    native,
    actions,
  });
}
renderIdentities = function () {
  const active = doc.identities || [],
    drafts = doc.identityDrafts || [];
  q("mmoIdentities").innerHTML = active
    .concat(drafts.filter((d) => !active.some((a) => a.id === d.id)))
    .map((i) => {
      const live = active.some((a) => a.id === i.id),
        pending = live && drafts.some((d) => d.id === i.id);
      const edit = button(
        live ? "identityEditActive" : "identityEditDraft",
        i.id,
        "Edit",
      );
      const actions =
        (pending
          ? button("identityEditDraft", i.id, "Resume pending changes") +
            button("identityDeleteDraft", i.id, "Discard pending changes")
          : "") +
        (live
          ? button("identityDisable", i.id, "Review disable") +
            button("identityDelete", i.id, "Review delete")
          : button("identityActivate", i.id, "Review & apply") +
            button("identityDeleteDraft", i.id, "Delete draft"));
      return changeRow(
        i.preferredName,
        "identity",
        live,
        pending,
        edit,
        actions,
        "identity",
        i.id,
      );
    })
    .join("");
};
function renderChanges() {
  if (!doc) return;
  closeRowMenu();
  q("mmoRules").innerHTML = doc.active
    .concat(doc.drafts.filter((d) => !doc.active.some((a) => a.id === d.id)))
    .map((r) => {
      const live = doc.active.some((a) => a.id === r.id),
        pending = live && doc.drafts.some((d) => d.id === r.id);
      const type = r.metadata
        ? "metadata"
        : r.kind === "alias"
          ? "mapping"
          : "correction";
      const edit = button(live ? "editActive" : "editDraft", r.id, "Edit");
      const actions =
        (pending
          ? button("editDraft", r.id, "Resume pending changes") +
            button("deleteDraft", r.id, "Discard pending changes") +
            button("activate", r.id, "Review pending changes")
          : "") +
        (live
          ? button("disable", r.id, "Review disable") +
            button("delete", r.id, "Review delete")
          : button("activate", r.id, "Review & apply") +
            button("deleteDraft", r.id, "Delete draft"));
      return changeRow(
        r.label || r.path || r.credit,
        type,
        live,
        pending,
        edit,
        actions,
        "rule",
        r.id,
      );
    })
    .join("");
  renderIdentities();
  renderMetadataDrafts();
  filterChanges();
}
let changeStart = 0;
function filterChanges(reset = false) {
  if (reset) changeStart = 0;
  if (reset) {
    bulkSelection.clear();
    invalidateReview();
  }
  const type = q("mmoChangeType").value,
    state = q("mmoChangeState").value;
  const rows = [...page.querySelectorAll("[data-change-type]")];
  const matches = rows.filter(
    (row) =>
      (!type || row.dataset.changeType === type) &&
      (!state ||
        row.dataset.changeState === state ||
        (state === "active" && row.dataset.changeState === "pending")),
  );
  if (changeStart >= matches.length)
    changeStart = Math.max(
      0,
      Math.floor((matches.length - 1) / tablePageSize) * tablePageSize,
    );
  const visible = new Set(
    matches.slice(changeStart, changeStart + tablePageSize),
  );
  rows.forEach((row) => (row.hidden = !visible.has(row)));
  q("mmoChangesEmpty").hidden = matches.length !== 0;
  tablePagination(changeStart, matches.length, {
    count: "mmoChangeCount",
    previous: "mmoChangePrev",
    next: "mmoChangeNext",
    noun: "rules",
  });
  bulkMatches = matches;
  renderBulkSelection();
}

load = async function () {
  try {
    doc = await api("rules");
  } catch (error) {
    if (!doc) {
      q("mmoManagerPolicies").innerHTML = tableMessage(
        "Could not load rules. Use Refresh status in Tools to retry.",
        true,
      );
      q("mmoChangeCount").textContent = "";
    }
    if (!doc) error.noticeHandled = true;
    throw error;
  }
  if (ui.screen === "review" && typeof ui.previewRevision === "number" && ui.previewRevision < doc.revision) invalidateReview();
  renderChanges();
  updateLocalCount();
  await status();
};
status = async function () {
  const s = await api("status");
  q("mmoStatus").textContent =
    s.active +
    " active corrections · " +
    s.drafts +
    " drafts · " +
    s.managedItems +
    " managed items · " +
    s.pending +
    " queued · " +
    s.refreshPending +
    " refreshes pending";
  renderIssueStatus(s);
};
// Preserve the mature form serializers, validation, and rule API behavior.
const originalEdit = edit;
edit = function (rule, nested = false) {
  captureEditor();
  const previous = ui.editor
    ? { ...ui.editor, tab: ui.itemTab, scroll: window.scrollY }
    : null;
  const id = rule?.id || crypto.randomUUID().replaceAll("-", "");
  const key = "rule:" + id;
  const local = ui.locals.get(key);
  rule = local?.data || rule;
  const displayRule = rule ? structuredClone(rule) : rule;
  if (displayRule)
    for (const group of ["fields", "trackDefaults"])
      for (const [field, decision] of Object.entries(
        displayRule[group]?.decisions || {},
      ))
        if (keys.includes(field) && decision.mode === "approved")
          displayRule[group][field] = decision.value;
  originalEdit(displayRule);
  editingId = id;
  if (nested && previous) ui.stack.push(previous);
  openWorkspace(
    "rule",
    key,
    rule?.label || rule?.credit || rule?.path || "New correction",
    q("mmoEditorState").textContent,
    null,
  );
  ui.editor.dirty = !!local;
  ui.editor.sequence = local?.sequence || 0;
  normalizeControls(q("mmoForm"));
  updateWorkspaceNativeLinks();
};
const originalEditIdentity = editIdentity;
editIdentity = async function (identity, nested = false) {
  const message = notifications.scope();
  captureEditor();
  const previous = ui.editor
    ? { ...ui.editor, tab: ui.itemTab, scroll: window.scrollY }
    : null;
  const id = identity?.id || crypto.randomUUID().replaceAll("-", "");
  const key = "identity:" + id;
  const local = ui.locals.get(key);
  identity = local?.data || identity;
  const serial = ++ui.request;
  await originalEditIdentity(identity);
  if (serial !== ui.request) return;
  identityEditingId = id;
  if (nested && previous) ui.stack.push(previous);
  openWorkspace(
    "identity",
    key,
    identity?.preferredName || "New artist identity",
    q("mmoIdentityEditorState").textContent,
    identity?.artistId,
  );
  ui.editor.dirty = !!local;
  ui.editor.sequence = local?.sequence || 0;
  normalizeControls(q("mmoIdentityForm"));
  updateWorkspaceNativeLinks();
  if (
    (identity?.artistId &&
      !identityRecords.artists.some((r) => r.id === identity.artistId)) ||
    (identity?.personId &&
      !identityRecords.persons.some((r) => r.id === identity.personId))
  )
    message(
      "A selected representative is missing. Choose an existing endpoint-compatible record before applying.",
      "warning",
    );
};
q("mmoChangeType").onchange = () => filterChanges(true);
q("mmoChangeState").onchange = () => filterChanges(true);
q("mmoChangePrev").onclick = () => {
  changeStart = Math.max(0, changeStart - tablePageSize);
  filterChanges();
};
q("mmoChangeNext").onclick = () => {
  changeStart += tablePageSize;
  filterChanges();
};
q("mmoLocalEdits").onclick = (e) =>
  perform(async (operation) => {
    const message = notifications.scope(operation);
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.localResume)
      await resumeEntry(ui.locals.get(b.dataset.localResume));
    if (b.dataset.localDiscard) {
      ui.locals.delete(b.dataset.localDiscard);
      updateLocalCount();
    }
  });
q("mmoBatchRows").onclick = (e) => {
  const id = e.target.closest("[data-batch-remove]")?.dataset.batchRemove;
  if (id) {
    managerBatch = managerBatch.filter((p) => p.id !== id);
    renderBatch();
  }
};
for (const [save, type] of [
  ["mmoSaveDraft", "rule"],
  ["mmoSaveIdentity", "identity"],
]) {
  q(save).onclick = () =>
    perform(() =>
      saveLocalDraft(
        type === "rule" ? "drafts" : "identities/drafts",
        type === "rule" ? formRule() : identityForm(),
        q(save),
      ),
    );
}
for (const id of ["mmoCancel", "mmoCancelIdentity"])
  q(id).onclick = () =>
    perform(async (operation) => {
      const message = notifications.scope(operation);
      const saving = ui.pendingSaves.has(ui.editor?.key);
      clearLocal();
      ui.editor = null;
      await workspaceBack();
      message(saving ? "Local edit discarded. The pending save continues; active versions are unchanged." : "Local edit discarded. Saved and active versions are unchanged.");
    });
// Editing folder defaults must retain extended field decisions, artwork, and bindings.
const originalFormRule = formRule;
formRule = function () {
  const result = originalFormRule();
  const original =
    ui.locals.get("rule:" + result.id)?.data ||
    doc.drafts.find((r) => r.id === result.id) ||
    doc.active.find((r) => r.id === result.id);
  if (!original) return result;
  if (original.metadata) result.metadata = structuredClone(original.metadata);
  for (const group of ["fields", "trackDefaults"])
    if (original[group]?.decisions) {
      result[group].decisions = structuredClone(original[group].decisions);
      for (const key of keys)
        if (key in result[group].decisions) {
          if (key in result[group])
            result[group].decisions[key] = {
              mode: "approved",
              value: result[group][key],
              provenance: "known",
            };
          else delete result[group].decisions[key];
        }
    }
  return result;
};
