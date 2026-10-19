// Issues have stable typed keys. Repairs are explicitly staged, never inferred.
let issueItems = [],
  issueArchived = [],
  issueStart = 0,
  issueBusy = false,
  repairQueue = null;
const issueSelection = new Set();
const issueLabels = {
  cleanup: "Review orphan deletion",
  repair: "Review selected repairs",
  acknowledge: "Acknowledge reports",
};
function issueMatches() {
  return issueItems.filter(
    (i) =>
      (!q("mmoIssueGroup").value || i.guidance.group === q("mmoIssueGroup").value) &&
      (!q("mmoIssueType").value || i.type === q("mmoIssueType").value) &&
      (!q("mmoIssueState").value || i.status === q("mmoIssueState").value),
  );
}
function issueEligible(action) {
  const selected = issueItems.filter((i) => issueSelection.has(i.key)),
    field = {
      cleanup: "canDelete",
      repair: "canRepair",
      acknowledge: "canAcknowledge",
    }[action];
  return {
    eligible: selected.filter((i) => i[field]),
    skipped: selected.filter((i) => !i[field]),
  };
}
function renderIssues() {
  closeRowMenu();
  const focused = document.activeElement?.dataset.issueSelect;
  const keys = new Set(issueItems.map((i) => i.key));
  for (const key of issueSelection)
    if (!keys.has(key)) issueSelection.delete(key);
  const matches = issueMatches();
  if (issueStart >= matches.length)
    issueStart = Math.max(
      0,
      Math.floor((matches.length - 1) / tablePageSize) * tablePageSize,
    );
  q("mmoIssueRows").innerHTML =
    matches
      .slice(issueStart, issueStart + tablePageSize)
      .map((i) =>
        tableRow({
          name: i.name,
          columns: issueTableColumns,
          type:
            {
              credit: "Unresolved credit",
              binding: "Broken binding",
              repair: "Repair candidate",
              orphan: "Verified orphan",
              blocked: "Blocked record",
              report: "Application report",
              unmatched: "Unmatched correction",
              recreated: "Recreated record",
              audit: "Audit failure",
            }[i.type] || i.type,
          attributes: 'data-issue-key="' + esc(i.key) + '"',
          selection: tableCheckbox(
            i.name,
            'data-issue-select="' + esc(i.key) + '"',
            { checked: issueSelection.has(i.key), disabled: issueBusy },
          ),
          description: [i.guidance.summary, i.guidance.path].filter(Boolean).join("\n"),
          primary: nativeButton(i.guidance.action, 'data-issue-open="' + esc(i.key) + '"'),
          native: issueNativeLink(i),
        }),
      )
      .join("") || tableMessage("No findings match this view.", true, 3);
  q("mmoIssueSelected").textContent = issueSelection.size + " selected";
  q("mmoIssueToolbar").hidden = !issueSelection.size;
  for (const b of page.querySelectorAll("[data-issue-action]")) {
    const c = issueEligible(b.dataset.issueAction);
    b.textContent =
      issueLabels[b.dataset.issueAction] +
      " (" +
      c.eligible.length +
      " eligible, " +
      c.skipped.length +
      " skipped)";
    b.disabled = issueBusy || !c.eligible.length;
  }
  for (const id of ["mmoIssueSelectPage", "mmoIssueSelectAll"])
    q(id).disabled = issueBusy || !matches.length;
  q("mmoIssueClear").disabled = issueBusy || !issueSelection.size;
  tablePagination(issueStart, matches.length, {
    count: "mmoIssuesCount",
    previous: "mmoIssuesPrev",
    next: "mmoIssuesNext",
    noun: "issues",
  });
  q("mmoArchivedReports").innerHTML =
    issueArchived
      .map(
        (r) =>
          "<p>" + esc(r.message) + " · archived " + esc(r.archivedAt) + "</p>",
      )
      .join("") || "<p>No archived reports.</p>";
  renderRepairSummary();
  normalizeControls(q("mmoIssueRows"));
  if (focused)
    q("mmoIssueRows")
      .querySelector('[data-issue-select="' + CSS.escape(focused) + '"]')
      ?.focus({ preventScroll: true });
}
async function managerIssues() {
  const serial = ++ui.issueRequest;
  q("mmoIssuesMessage").textContent = issueItems.length
    ? "Refreshing issues…"
    : "";
  if (!issueItems.length)
    q("mmoIssueRows").innerHTML = tableMessage("Checking issues…", true, 3);
  try {
    const data = await api("manager/issues");
    if (serial !== ui.issueRequest) return;
    issueItems = data.items;
    issueArchived = data.archivedReports;
    renderIssues();
    q("mmoIssuesMessage").textContent =
      issueItems.length +
      " findings across all views.";
    ui.issueLoaded = true;
  } catch (e) {
    if (serial !== ui.issueRequest) return;
    q("mmoIssuesMessage").textContent = issueItems.length
      ? "Could not check issues. Use Refresh issues to retry."
      : "";
    if (!issueItems.length)
      q("mmoIssueRows").innerHTML = tableMessage(
        "Could not check issues. Use Refresh issues to retry.",
        true, 3,
      );
    e.noticeHandled = true;
    throw e;
  }
}
async function refreshIssues() {
  await managerIssues();
}
q("mmoManagerIssueRefresh").onclick = () => perform(refreshIssues);
for (const id of ["mmoIssueGroup", "mmoIssueType", "mmoIssueState"])
  q(id).onchange = () => {
    issueStart = 0;
    issueSelection.clear();
    invalidateReview();
    renderIssues();
  };
q("mmoIssueRows").onchange = (e) => {
  const key = e.target.dataset.issueSelect;
  if (!key) return;
  if (e.target.checked) issueSelection.add(key);
  else issueSelection.delete(key);
  invalidateReview();
  renderIssues();
};
q("mmoIssueRows").onclick = (e) => {
  const key = e.target.closest("[data-issue-open]")?.dataset.issueOpen;
  if (key)
    perform(() =>
      openIssue(
        issueItems.find((i) => i.key === key),
        false,
      ),
    );
};
q("mmoIssueSelectPage").onclick = () => {
  issueMatches()
    .slice(issueStart, issueStart + tablePageSize)
    .forEach((i) => issueSelection.add(i.key));
  renderIssues();
};
q("mmoIssueSelectAll").onclick = () => {
  issueMatches().forEach((i) => issueSelection.add(i.key));
  renderIssues();
};
q("mmoIssueClear").onclick = () => {
  issueSelection.clear();
  renderIssues();
};
q("mmoIssuesPrev").onclick = () => {
  issueStart = Math.max(0, issueStart - tablePageSize);
  renderIssues();
};
q("mmoIssuesNext").onclick = () => {
  issueStart += tablePageSize;
  renderIssues();
};
for (const b of page.querySelectorAll("[data-issue-action]"))
  b.onclick = () => perform(() => issueAction(b.dataset.issueAction));
async function issueAction(action) {
  const message = notifications.scope();
  if (issueBusy) return;
  const context = { action, ...issueEligible(action) };
  if (!context.eligible.length) throw Error("No eligible selected issues.");
  issueBusy = true;
  renderIssues();
  try {
    if (action === "acknowledge") {
      const result = await api("manager/errors/acknowledge", "POST", {
        ids: context.eligible.map((i) => i.context.id),
      });
      result.acknowledged.forEach((id) =>
        issueSelection.delete("report:" + id),
      );
      await managerIssues();
      message(
        result.acknowledged.length +
          " reports archived; " +
          context.skipped.length +
          " selections skipped. No corrections were retried." +
          (context.skipped.length
            ? "\nSkipped: " +
              context.skipped.map((i) => i.name + " — " + i.reason).join("; ")
            : ""),
      );
    } else if (action === "cleanup")
      await preview(
        { cleanupIds: context.eligible.map((i) => i.itemId) },
        null,
        context,
      );
    else {
      if (repairQueue)
        throw Error("Finish or close the existing repair queue first.");
      const groups = new Map();
      for (const i of context.eligible) {
        const key = i.identityId
          ? "identity:" + i.identityId
          : i.type === "unmatched"
            ? "rule:" + i.context.id
            : i.itemId
              ? "record:" + i.itemId
              : i.key;
        if (!groups.has(key)) groups.set(key, { key, issues: [] });
        groups.get(key).issues.push(i);
      }
      repairQueue = {
        tasks: [...groups.values()],
        index: 0,
        staged: new Map(),
        skipped: context.skipped,
      };
      await openRepairTask();
    }
  } finally {
    issueBusy = false;
    renderIssues();
  }
}
async function openIssue(issue, guided) {
  await openIssuePanel(issue, guided);
}
async function openRepairTask() {
  const message = notifications.scope();
  if (!repairQueue) return;
  if (repairQueue.index >= repairQueue.tasks.length) {
    q("mmoRepairControls").hidden = true;
    renderRepairSummary();
    await showDestination("issues");
    message(
      "Repair queue reviewed. Staged edits remain local; review them together or explicitly save drafts.",
    );
    return;
  }
  await openIssue(repairQueue.tasks[repairQueue.index].issues[0], true);
}
q("mmoRepairStage").onclick = () =>
  perform(async (operation) => {
    const message = notifications.scope(operation);
    const queue = repairQueue,
      index = queue.index,
      task = queue.tasks[index],
      editor = ui.editor,
      sequence = editor.sequence;
    const data =
      editor.type === "identity"
        ? identityForm()
        : editor.type === "metadata"
          ? readManagerFields()
          : formRule();
    const field = {
      identity: "identityEdits",
      metadata: "metadataEdits",
      rule: "edits",
    }[editor.type];
    message("Validating repair…", "loading");
    await api("preview", "POST", { [field]: [data] });
    if (
      repairQueue !== queue ||
      queue.index !== index ||
      ui.screen !== "workspace" ||
      ui.editor !== editor ||
      editor.sequence !== sequence
    )
      throw Error(
        "Edit changed during validation. Stage the current values again.",
      );
    markDirty();
    repairQueue.staged.set(task.key, {
      field,
      data: structuredClone(data),
      keys: task.issues.map((i) => i.key),
      localKey: editor.key,
      sequence: editor.sequence,
    });
    repairQueue.index++;
    await openRepairTask();
  });
q("mmoRepairSkip").onclick = () =>
  perform(async (operation) => {
    const message = notifications.scope(operation);
    captureEditor();
    repairQueue.staged.delete(repairQueue.tasks[repairQueue.index].key);
    repairQueue.index++;
    await openRepairTask();
  });
q("mmoRepairReturn").onclick = () => perform(() => showDestination("issues"));
function renderRepairSummary() {
  const container = q("mmoRepairQueueSummary");
  container.hidden = !repairQueue;
  if (!repairQueue) return;
  container.innerHTML =
    "<h3>Guided repairs</h3><p>" +
    repairQueue.staged.size +
    " locally staged · " +
    Math.min(repairQueue.index, repairQueue.tasks.length) +
    " of " +
    repairQueue.tasks.length +
    ' tasks visited. Save drafts explicitly to survive reload.</p><div class="mmo-actions">' +
    (repairQueue.index < repairQueue.tasks.length
      ? nativeButton("Resume repairs", "data-repair-resume")
      : "") +
    nativeButton(
      "Review staged repairs",
      "data-repair-review " + (!repairQueue.staged.size ? "disabled" : ""),
    ) +
    nativeButton("Close queue, keep local edits", "data-repair-close") +
    "</div>" +
    "<details><summary>Repair tasks</summary>" +
    repairQueue.tasks
      .map(
        (t, index) =>
          "<p>" +
          nativeButton(
            t.issues[0].name +
              (repairQueue.staged.has(t.key) ? " · staged" : ""),
            'data-repair-revisit="' + index + '"',
          ) +
          "</p>",
      )
      .join("") +
    "</details>" +
    (repairQueue.skipped.length
      ? "<details><summary>" +
        repairQueue.skipped.length +
        " skipped selections</summary><ul>" +
        repairQueue.skipped
          .map((i) => "<li>" + esc(i.name) + " — " + esc(i.reason) + "</li>")
          .join("") +
        "</ul></details>"
      : "");
}
q("mmoRepairQueueSummary").onclick = (e) =>
  perform(async (operation) => {
    const message = notifications.scope(operation);
    const revisit = e.target.closest("[data-repair-revisit]");
    if (revisit) {
      repairQueue.index = Number(revisit.dataset.repairRevisit);
      await openRepairTask();
    }
    if (e.target.closest("[data-repair-resume]")) await openRepairTask();
    if (e.target.closest("[data-repair-close]")) {
      repairQueue = null;
      renderRepairSummary();
    }
    if (e.target.closest("[data-repair-review]")) {
      const change = {};
      for (const staged of repairQueue.staged.values()) {
        if (!ui.locals.has(staged.localKey))
          throw Error(
            "A staged local edit was discarded or saved. Revisit that repair before batch review.",
          );
        if (ui.locals.get(staged.localKey).sequence !== staged.sequence)
          throw Error(
            "A staged edit changed. Revisit and stage its current values before review.",
          );
        (change[staged.field] ||= []).push(structuredClone(staged.data));
      }
      await preview(change, null, {
        action: "repair",
        eligible: issueItems.filter((i) =>
          [...repairQueue.staged.values()].some((s) => s.keys.includes(i.key)),
        ),
        skipped: repairQueue.skipped,
      });
    }
  });
function renderIssueReview(context) {
  q("mmoIssueReview").hidden = !context;
  q("mmoIssueReview").innerHTML = context
    ? "<h3>" +
      esc(issueLabels[context.action]) +
      "</h3><p>" +
      context.eligible.length +
      " targeted · " +
      context.skipped.length +
      " skipped</p><ul>" +
      context.eligible.map((i) => "<li>" + esc(i.name) + "</li>").join("") +
      "</ul>" +
      (context.skipped.length
        ? "<details><summary>Skipped selections</summary><ul>" +
          context.skipped
            .map((i) => "<li>" + esc(i.name) + " — " + esc(i.reason) + "</li>")
            .join("") +
          "</ul></details>"
        : "")
    : "";
}
function completeIssueOperation(context, result) {
  if (!context) return null;
  if (context.action === "cleanup") {
    const outcomes = result.cleanupResults || [];
    for (const outcome of outcomes)
      if (outcome.outcome === "deleted")
        issueSelection.delete("record:" + outcome.id.replaceAll("-", ""));
    beginIssueVerification(context, result);
    if (!outcomes.length) return "No cleanup results returned. Check status before retrying.";
    const counts = name => outcomes.filter(o => o.outcome === name).length;
    return "Cleanup finished: " + counts("deleted") + " deleted, " + counts("blocked") + " blocked, " + counts("failed") + " failed. See repair results for details and recovery material.";
  }
  beginIssueVerification(context, result);
  // Fresh checks determine whether each original issue resolved.
  repairQueue = null;
  q("mmoRepairControls").hidden = true;
  return "Changes applied; checking the original issues.";
}
