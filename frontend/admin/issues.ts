import type { Change, Rule, ArtistIdentity, MetadataPolicy } from "./contracts.ts";
import { operationError } from "./errors.ts";
import type { ActivationResult, Issue, IssueContext, RepairQueue } from "./responses.ts";
import type { ApplicationReport } from "./contracts.ts";
import type { Features } from "./features.ts";
export function createIssues(features: Features) {
    // Issues have stable typed keys. Repairs are explicitly staged, never inferred.
    let issueItems: Issue[] = [],
        issueArchived: ApplicationReport[] = [],
        issueStart = 0,
        issueBusy = false;
    let repairQueue: RepairQueue | null = null;
    const issueSelection = new Set<string>();
    const issueLabels: Record<string, string> = {
        cleanup: "Review orphan deletion",
        repair: "Review selected repairs",
        acknowledge: "Acknowledge reports",
    };
    function issueMatches() {
        return issueItems.filter(
            (i) =>
                (!features.api.q("mmoIssueGroup").value || i.guidance.group === features.api.q("mmoIssueGroup").value) &&
                (!features.api.q("mmoIssueType").value || i.type === features.api.q("mmoIssueType").value) &&
                (!features.api.q("mmoIssueState").value || i.status === features.api.q("mmoIssueState").value),
        );
    }
    function issueEligible(action: string) {
        const selected = issueItems.filter((i) => issueSelection.has(i.key)),
            field = {
                cleanup: "canDelete",
                repair: "canRepair",
                acknowledge: "canAcknowledge",
            }[action] as "canDelete" | "canRepair" | "canAcknowledge";
        return {
            eligible: selected.filter((i) => i[field]),
            skipped: selected.filter((i) => !i[field]),
        };
    }
    function renderIssues() {
        features.rowMenu.closeRowMenu();
        const focused = (document.activeElement as HTMLElement | null)?.dataset.issueSelect;
        const keys = new Set(issueItems.map((i) => i.key));
        for (const key of issueSelection) if (!keys.has(key)) issueSelection.delete(key);
        const matches = issueMatches();
        if (issueStart >= matches.length)
            issueStart = Math.max(0, Math.floor((matches.length - 1) / features.table.tablePageSize) * features.table.tablePageSize);
        features.api.q("mmoIssueRows").innerHTML =
            matches
                .slice(issueStart, issueStart + features.table.tablePageSize)
                .map((i) =>
                    features.table.tableRow({
                        name: i.name,
                        columns: features.table.issueTableColumns,
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
                        attributes: 'data-issue-key="' + features.api.esc(i.key) + '"',
                        selection: features.table.tableCheckbox(i.name, 'data-issue-select="' + features.api.esc(i.key) + '"', {
                            checked: issueSelection.has(i.key),
                            disabled: issueBusy,
                        }),
                        description: [i.guidance.summary, i.guidance.path].filter(Boolean).join("\n"),
                        primary: features.navigation.nativeButton(i.guidance.action, 'data-issue-open="' + features.api.esc(i.key) + '"'),
                        native: features.nativeLinks.issueNativeLink(i),
                    }),
                )
                .join("") || features.table.tableMessage("No findings match this view.", true, 3);
        features.api.q("mmoIssueSelected").textContent = issueSelection.size + " selected";
        features.api.q("mmoIssueToolbar").hidden = !issueSelection.size;
        for (const b of features.api.page.querySelectorAll<HTMLButtonElement>("[data-issue-action]")) {
            const c = issueEligible(b.dataset.issueAction!);
            b.textContent = issueLabels[b.dataset.issueAction!] + " (" + c.eligible.length + " eligible, " + c.skipped.length + " skipped)";
            b.disabled = issueBusy || !c.eligible.length;
        }
        for (const id of ["mmoIssueSelectPage", "mmoIssueSelectAll"]) features.api.q<HTMLButtonElement>(id).disabled = issueBusy || !matches.length;
        features.api.q("mmoIssueClear").disabled = issueBusy || !issueSelection.size;
        features.table.tablePagination(issueStart, matches.length, {
            count: "mmoIssuesCount",
            previous: "mmoIssuesPrev",
            next: "mmoIssuesNext",
            noun: "issues",
        });
        features.api.q("mmoArchivedReports").innerHTML =
            issueArchived.map((r) => "<p>" + features.api.esc(r.message) + " · archived " + features.api.esc(r.archivedAt) + "</p>").join("") ||
            "<p>No archived reports.</p>";
        renderRepairSummary();
        features.navigation.normalizeControls(features.api.q("mmoIssueRows"));
        if (focused)
            features.api
                .q("mmoIssueRows")
                .querySelector<HTMLElement>('[data-issue-select="' + CSS.escape(focused) + '"]')
                ?.focus({ preventScroll: true });
    }
    async function managerIssues() {
        const serial = ++features.navigation.ui.issueRequest;
        features.api.q("mmoIssuesMessage").textContent = issueItems.length ? "Refreshing issues…" : "";
        if (!issueItems.length) features.api.q("mmoIssueRows").innerHTML = features.table.tableMessage("Checking issues…", true, 3);
        try {
            const data = await features.api.api("manager/issues");
            if (serial !== features.navigation.ui.issueRequest) return;
            issueItems = data.items;
            issueArchived = data.archivedReports;
            renderIssues();
            features.api.q("mmoIssuesMessage").textContent = issueItems.length + " findings across all views.";
            features.navigation.ui.issueLoaded = true;
        } catch (caughtError) {
            const e = operationError(caughtError);
            if (serial !== features.navigation.ui.issueRequest) return;
            features.api.q("mmoIssuesMessage").textContent = issueItems.length ? "Could not check issues. Use Refresh issues to retry." : "";
            if (!issueItems.length)
                features.api.q("mmoIssueRows").innerHTML = features.table.tableMessage(
                    "Could not check issues. Use Refresh issues to retry.",
                    true,
                    3,
                );
            e.noticeHandled = true;
            throw e;
        }
    }
    async function refreshIssues() {
        await managerIssues();
    }
    async function issueAction(action: string) {
        const message = features.notifications.notifications.scope();
        if (issueBusy) return;
        const context = { action, ...issueEligible(action) };
        if (!context.eligible.length) throw Error("No eligible selected issues.");
        issueBusy = true;
        renderIssues();
        try {
            if (action === "acknowledge") {
                const result = await features.api.api("manager/errors/acknowledge", "POST", {
                    ids: context.eligible.map((i) => i.context.id),
                });
                result.acknowledged.forEach((id) => issueSelection.delete("report:" + id));
                await managerIssues();
                message(
                    result.acknowledged.length +
                        " reports archived; " +
                        context.skipped.length +
                        " selections skipped. No corrections were retried." +
                        (context.skipped.length ? "\nSkipped: " + context.skipped.map((i) => i.name + " — " + i.reason).join("; ") : ""),
                );
            } else if (action === "cleanup") await features.rules.preview({ cleanupIds: context.eligible.map((i) => i.itemId!) }, null, context);
            else {
                if (repairQueue) throw Error("Finish or close the existing repair queue first.");
                const groups = new Map<
                    string,
                    {
                        key: string;
                        issues: Issue[];
                    }
                >();
                for (const i of context.eligible) {
                    const key = i.identityId
                        ? "identity:" + i.identityId
                        : i.type === "unmatched"
                          ? "rule:" + i.context.id
                          : i.itemId
                            ? "record:" + i.itemId
                            : i.key;
                    if (!groups.has(key)) groups.set(key, { key, issues: [] });
                    groups.get(key)!.issues.push(i);
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
    async function openIssue(issue: Issue | undefined, guided = false) {
        await features.issueGuidance.openIssuePanel(issue, guided);
    }
    async function openRepairTask() {
        const message = features.notifications.notifications.scope();
        if (!repairQueue) return;
        if (repairQueue.index >= repairQueue.tasks.length) {
            features.api.q("mmoRepairControls").hidden = true;
            renderRepairSummary();
            await features.navigation.showDestination("issues");
            message("Repair queue reviewed. Staged edits remain local; review them together or explicitly save drafts.");
            return;
        }
        await openIssue(repairQueue.tasks[repairQueue.index]!.issues[0], true);
    }
    function renderRepairSummary() {
        const container = features.api.q("mmoRepairQueueSummary");
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
            (repairQueue.index < repairQueue.tasks.length ? features.navigation.nativeButton("Resume repairs", "data-repair-resume") : "") +
            features.navigation.nativeButton("Review staged repairs", "data-repair-review " + (!repairQueue.staged.size ? "disabled" : "")) +
            features.navigation.nativeButton("Close queue, keep local edits", "data-repair-close") +
            "</div>" +
            "<details><summary>Repair tasks</summary>" +
            repairQueue.tasks
                .map(
                    (t, index) =>
                        "<p>" +
                        features.navigation.nativeButton(
                            t.issues[0]!.name + (repairQueue!.staged.has(t.key) ? " · staged" : ""),
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
                  repairQueue.skipped.map((i) => "<li>" + features.api.esc(i.name) + " — " + features.api.esc(i.reason) + "</li>").join("") +
                  "</ul></details>"
                : "");
    }
    function renderIssueReview(context: IssueContext | null | undefined) {
        features.api.q("mmoIssueReview").hidden = !context;
        features.api.q("mmoIssueReview").innerHTML = context
            ? "<h3>" +
              features.api.esc(issueLabels[context.action]) +
              "</h3><p>" +
              context.eligible.length +
              " targeted · " +
              context.skipped.length +
              " skipped</p><ul>" +
              context.eligible.map((i) => "<li>" + features.api.esc(i.name) + "</li>").join("") +
              "</ul>" +
              (context.skipped.length
                  ? "<details><summary>Skipped selections</summary><ul>" +
                    context.skipped.map((i) => "<li>" + features.api.esc(i.name) + " — " + features.api.esc(i.reason) + "</li>").join("") +
                    "</ul></details>"
                  : "")
            : "";
    }
    function completeIssueOperation(context: IssueContext | null | undefined, result: ActivationResult) {
        if (!context) return null;
        if (context.action === "cleanup") {
            const outcomes = result.cleanupResults || [];
            for (const outcome of outcomes) if (outcome.outcome === "deleted") issueSelection.delete("record:" + outcome.id.replaceAll("-", ""));
            features.issueGuidance.beginIssueVerification(context, result);
            if (!outcomes.length) return "No cleanup results returned. Check status before retrying.";
            const counts = (name: string) => outcomes.filter((o) => o.outcome === name).length;
            return (
                "Cleanup finished: " +
                counts("deleted") +
                " deleted, " +
                counts("blocked") +
                " blocked, " +
                counts("failed") +
                " failed. See repair results for details and recovery material."
            );
        }
        features.issueGuidance.beginIssueVerification(context, result);
        // Fresh checks determine whether each original issue resolved.
        repairQueue = null;
        features.api.q("mmoRepairControls").hidden = true;
        return "Changes applied; checking the original issues.";
    }
    return {
        initialize() {
            features.api.q("mmoManagerIssueRefresh").onclick = () => features.api.perform(refreshIssues);
            for (const id of ["mmoIssueGroup", "mmoIssueType", "mmoIssueState"])
                features.api.q(id).onchange = () => {
                    issueStart = 0;
                    issueSelection.clear();
                    features.rules.invalidateReview();
                    renderIssues();
                };
            features.api.q("mmoIssueRows").onchange = (e) => {
                const key = (e.target as HTMLElement).dataset.issueSelect;
                if (!key) return;
                if ((e.target as HTMLInputElement).checked) issueSelection.add(key);
                else issueSelection.delete(key);
                features.rules.invalidateReview();
                renderIssues();
            };
            features.api.q("mmoIssueRows").onclick = (e) => {
                const key = (e.target as HTMLElement).closest<HTMLElement>("[data-issue-open]")?.dataset.issueOpen;
                if (key)
                    features.api.perform(() =>
                        openIssue(
                            issueItems.find((i) => i.key === key),
                            false,
                        ),
                    );
            };
            features.api.q("mmoIssueSelectPage").onclick = () => {
                issueMatches()
                    .slice(issueStart, issueStart + features.table.tablePageSize)
                    .forEach((i) => issueSelection.add(i.key));
                renderIssues();
            };
            features.api.q("mmoIssueSelectAll").onclick = () => {
                issueMatches().forEach((i) => issueSelection.add(i.key));
                renderIssues();
            };
            features.api.q("mmoIssueClear").onclick = () => {
                issueSelection.clear();
                renderIssues();
            };
            features.api.q("mmoIssuesPrev").onclick = () => {
                issueStart = Math.max(0, issueStart - features.table.tablePageSize);
                renderIssues();
            };
            features.api.q("mmoIssuesNext").onclick = () => {
                issueStart += features.table.tablePageSize;
                renderIssues();
            };
            for (const b of features.api.page.querySelectorAll<HTMLButtonElement>("[data-issue-action]"))
                b.onclick = () => features.api.perform(() => issueAction(b.dataset.issueAction!));
            features.api.q("mmoRepairStage").onclick = () =>
                features.api.perform(async (operation) => {
                    const message = features.notifications.notifications.scope(operation);
                    const queue = repairQueue,
                        index = queue!.index,
                        task = queue!.tasks[index],
                        editor = features.navigation.ui.editor,
                        sequence = editor!.sequence;
                    const data =
                        editor!.type === "identity"
                            ? features.identities.identityForm()
                            : editor!.type === "metadata"
                              ? features.managerUi.readManagerFields()
                              : features.rules.formRule();
                    const field = {
                        identity: "identityEdits",
                        metadata: "metadataEdits",
                        rule: "edits",
                    }[editor!.type];
                    message("Validating repair…", "loading");
                    await features.api.api("preview", "POST", { [field]: [data] });
                    if (
                        repairQueue !== queue ||
                        queue!.index !== index ||
                        features.navigation.ui.screen !== "workspace" ||
                        features.navigation.ui.editor !== editor ||
                        editor!.sequence !== sequence
                    )
                        throw Error("Edit changed during validation. Stage the current values again.");
                    features.navigation.markDirty();
                    repairQueue!.staged.set(task!.key, {
                        field: field as "edits" | "identityEdits" | "metadataEdits",
                        data: structuredClone(data),
                        keys: task!.issues.map((i) => i.key),
                        localKey: editor!.key,
                        sequence: editor!.sequence,
                    });
                    repairQueue!.index++;
                    await openRepairTask();
                });
            features.api.q("mmoRepairSkip").onclick = () =>
                features.api.perform(async (operation) => {
                    features.notifications.notifications.scope(operation);
                    features.navigation.captureEditor();
                    repairQueue!.staged.delete(repairQueue!.tasks[repairQueue!.index]!.key);
                    repairQueue!.index++;
                    await openRepairTask();
                });
            features.api.q("mmoRepairReturn").onclick = () => features.api.perform(() => features.navigation.showDestination("issues"));
            features.api.q("mmoRepairQueueSummary").onclick = (e) =>
                features.api.perform(async (operation) => {
                    features.notifications.notifications.scope(operation);
                    const revisit = (e.target as HTMLElement).closest<HTMLElement>("[data-repair-revisit]");
                    if (revisit) {
                        repairQueue!.index = Number(revisit.dataset.repairRevisit);
                        await openRepairTask();
                    }
                    if ((e.target as HTMLElement).closest<HTMLElement>("[data-repair-resume]")) await openRepairTask();
                    if ((e.target as HTMLElement).closest<HTMLElement>("[data-repair-close]")) {
                        repairQueue = null;
                        renderRepairSummary();
                    }
                    if ((e.target as HTMLElement).closest<HTMLElement>("[data-repair-review]")) {
                        const change: Partial<Change> = {};
                        for (const staged of repairQueue!.staged.values()) {
                            if (!features.navigation.ui.locals.has(staged.localKey))
                                throw Error("A staged local edit was discarded or saved. Revisit that repair before batch review.");
                            if (features.navigation.ui.locals.get(staged.localKey)!.sequence !== staged.sequence)
                                throw Error("A staged edit changed. Revisit and stage its current values before review.");
                            if (staged.field === "edits") (change.edits ||= []).push(structuredClone(staged.data) as Rule);
                            else if (staged.field === "identityEdits")
                                (change.identityEdits ||= []).push(structuredClone(staged.data) as ArtistIdentity);
                            else (change.metadataEdits ||= []).push(structuredClone(staged.data) as MetadataPolicy);
                        }
                        await features.rules.preview(change, null, {
                            action: "repair",
                            eligible: issueItems.filter((i) => [...repairQueue!.staged.values()].some((s) => s.keys.includes(i.key))),
                            skipped: repairQueue!.skipped,
                        });
                    }
                });
        },
        get issueItems() {
            return issueItems;
        },
        set issueItems(value: typeof issueItems) {
            issueItems = value;
        },
        get issueArchived() {
            return issueArchived;
        },
        set issueArchived(value: typeof issueArchived) {
            issueArchived = value;
        },
        get issueStart() {
            return issueStart;
        },
        set issueStart(value: typeof issueStart) {
            issueStart = value;
        },
        get issueBusy() {
            return issueBusy;
        },
        set issueBusy(value: typeof issueBusy) {
            issueBusy = value;
        },
        get repairQueue() {
            return repairQueue;
        },
        set repairQueue(value: typeof repairQueue) {
            repairQueue = value;
        },
        get issueSelection() {
            return issueSelection;
        },
        get issueLabels() {
            return issueLabels;
        },
        get issueMatches() {
            return issueMatches;
        },
        get issueEligible() {
            return issueEligible;
        },
        get renderIssues() {
            return renderIssues;
        },
        get managerIssues() {
            return managerIssues;
        },
        get refreshIssues() {
            return refreshIssues;
        },
        get issueAction() {
            return issueAction;
        },
        get openIssue() {
            return openIssue;
        },
        get openRepairTask() {
            return openRepairTask;
        },
        get renderRepairSummary() {
            return renderRepairSummary;
        },
        get renderIssueReview() {
            return renderIssueReview;
        },
        get completeIssueOperation() {
            return completeIssueOperation;
        },
    };
}
