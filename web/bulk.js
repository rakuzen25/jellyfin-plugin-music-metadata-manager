// Selection refers to saved backing records, independent of presentation type.
const bulkSelection = new Set();
let bulkMatches = [],
  bulkBusy = false;
const bulkLabels = {
  apply: "Review & apply saved drafts",
  disable: "Review disable",
  delete: "Review delete active versions",
  discard: "Discard saved drafts",
};
function bulkEntries() {
  const groups = [
    ["rule", doc.active, doc.drafts],
    ["identity", doc.identities, doc.identityDrafts],
    ["policy", doc.policies, doc.policyDrafts],
  ];
  return groups.flatMap(([kind, active, drafts]) =>
    [...new Set([...active, ...drafts].map((x) => x.id))].map((id) => {
      const live = active.find((x) => x.id === id),
        draft = drafts.find((x) => x.id === id),
        item = live || draft;
      return {
        key: kind + ":" + id,
        kind,
        id,
        live: !!live,
        draft: !!draft,
        name:
          item.label ||
          item.preferredName ||
          item.path ||
          item.credit ||
          item.identityId ||
          item.itemId ||
          id,
      };
    }),
  );
}
function bulkTargets(action) {
  const selected = bulkEntries().filter((e) => bulkSelection.has(e.key));
  const eligible = selected.filter((e) =>
    action === "apply" || action === "discard" ? e.draft : e.live,
  );
  return { eligible, skipped: selected.filter((e) => !eligible.includes(e)) };
}
function renderBulkSelection() {
  if (!doc) return;
  const entries = bulkEntries(),
    keys = new Set(entries.map((e) => e.key));
  for (const key of bulkSelection)
    if (!keys.has(key)) bulkSelection.delete(key);
  for (const input of page.querySelectorAll("[data-change-select]"))
    input.checked = bulkSelection.has(input.dataset.changeSelect);
  q("mmoSelectedCount").textContent = bulkSelection.size + " selected";
  q("mmoBulkToolbar").hidden = !bulkSelection.size;
  for (const button of page.querySelectorAll("[data-bulk-action]")) {
    const { eligible, skipped } = bulkTargets(button.dataset.bulkAction);
    button.textContent =
      bulkLabels[button.dataset.bulkAction] +
      " (" +
      eligible.length +
      " eligible, " +
      skipped.length +
      " skipped)";
    button.disabled = bulkBusy || !eligible.length;
  }
  q("mmoClearSelection").disabled = bulkBusy || !bulkSelection.size;
  q("mmoSelectPage").disabled = bulkBusy || !bulkMatches.some((r) => !r.hidden);
  q("mmoSelectFiltered").disabled = bulkBusy || !bulkMatches.length;
  for (const input of page.querySelectorAll("[data-change-select]"))
    input.disabled = bulkBusy;
}
page.addEventListener("change", (event) => {
  const key = event.target.dataset.changeSelect;
  if (!key) return;
  if (event.target.checked) bulkSelection.add(key);
  else bulkSelection.delete(key);
  invalidateReview();
  renderBulkSelection();
});
q("mmoSelectPage").onclick = () => {
  bulkMatches
    .filter((r) => !r.hidden)
    .forEach((r) => bulkSelection.add(r.dataset.changeKey));
  renderBulkSelection();
};
q("mmoSelectFiltered").onclick = () => {
  bulkMatches.forEach((r) => bulkSelection.add(r.dataset.changeKey));
  renderBulkSelection();
};
q("mmoClearSelection").onclick = () => {
  bulkSelection.clear();
  renderBulkSelection();
};
for (const button of page.querySelectorAll("[data-bulk-action]"))
  button.onclick = () => perform(() => bulkAction(button.dataset.bulkAction));
async function bulkAction(action) {
  const message = notifications.scope();
  if (bulkBusy) return;
  const context = { action, ...bulkTargets(action) };
  if (!context.eligible.length)
    throw Error("No selected saved versions can receive this action.");
  bulkBusy = true;
  renderBulkSelection();
  try {
    if (action === "discard") {
      await api("drafts/discard", "POST", {
        expectedRevision: doc.revision,
        targets: context.eligible.map(({ kind, id }) => ({ kind, id })),
      });
      context.eligible.forEach((e) => bulkSelection.delete(e.key));
      invalidateReview();
      await load();
      message(
        context.eligible.length +
          " saved drafts discarded; " +
          context.skipped.length +
          " selected rows skipped. Active versions and unfinished local edits are unchanged.",
      );
      return;
    }
    const fields = {
      rule: {
        apply: "activateIds",
        disable: "disableIds",
        delete: "deleteIds",
      },
      identity: {
        apply: "activateIdentities",
        disable: "disableIdentities",
        delete: "deleteIdentities",
      },
      policy: {
        apply: "activatePolicies",
        disable: "disablePolicies",
        delete: "deletePolicies",
      },
    };
    const change = {};
    for (const e of context.eligible)
      (change[fields[e.kind][action]] ||= []).push(e.id);
    await preview(change, context);
  } catch (error) {
    if (action === "discard") await load();
    throw error;
  } finally {
    bulkBusy = false;
    renderBulkSelection();
  }
}
function renderBulkReview(context) {
  q("mmoBulkReview").hidden = !context;
  if (!context) {
    q("mmoBulkReview").innerHTML = "";
    return;
  }
  const rows = context.eligible
    .map((e) => {
      let effect = "";
      if (e.draft && e.live && context.action === "apply")
        effect = "Saved pending revision replaces the active version.";
      if (e.draft && context.action === "delete")
        effect = "The active version and its saved draft are deleted.";
      if (e.draft && context.action === "disable")
        effect =
          e.kind === "policy"
            ? "The saved pending revision is replaced by a draft of the active policy."
            : "The saved pending revision is retained.";
      return (
        "<li><strong>" +
        esc(e.name) +
        "</strong> · " +
        esc(e.kind) +
        (effect ? "<p>" + esc(effect) + "</p>" : "") +
        "</li>"
      );
    })
    .join("");
  q("mmoBulkReview").innerHTML =
    "<h3>" +
    esc(bulkLabels[context.action]) +
    "</h3><p>" +
    context.eligible.length +
    " targeted · " +
    context.skipped.length +
    " skipped. Unfinished local edits are excluded.</p><ul>" +
    rows +
    "</ul>" +
    (context.skipped.length
      ? "<details><summary>Skipped selections</summary><ul>" +
        context.skipped
          .map(
            (e) =>
              "<li>" +
              esc(e.name) +
              " — " +
              (context.action === "apply"
                ? "No saved draft"
                : "No active version") +
              "</li>",
          )
          .join("") +
        "</ul></details>"
      : "");
}
function completeBulk(context) {
  if (!context) return;
  for (const e of context.eligible) {
    bulkSelection.delete(e.key);
    for (const entry of ui.locals.values())
      if (
        entry.data.id === e.id &&
        ((e.kind === "identity" && entry.type === "identity") ||
          (e.kind !== "identity" && entry.type !== "identity"))
      )
        entry.baselineChanged = true;
  }
}
