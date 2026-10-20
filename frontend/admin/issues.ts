import type { Change, Rule, ArtistIdentity, MetadataPolicy } from "./contracts.ts";
import { operationError } from "./errors.ts";
import type { ActivationResult, Issue, IssueContext } from "./responses.ts";

import type { ControllerContracts } from "./controllerContracts.ts";
import type { DashboardState } from "./dashboardState.ts";
export interface IssuesDependencies {
    api: Pick<ControllerContracts["api"], "api" | "esc" | "page" | "perform" | "q">;
    rowMenu: Pick<ControllerContracts["rowMenu"], "closeRowMenu">;
    table: Pick<
        ControllerContracts["table"],
        "issueTableColumns" | "tableCheckbox" | "tableMessage" | "tablePageSize" | "tablePagination" | "tableRow"
    >;
    navigation: Pick<ControllerContracts["navigation"], "captureEditor" | "markDirty" | "nativeButton" | "normalizeControls" | "showDestination">;
    nativeLinks: Pick<ControllerContracts["nativeLinks"], "issueNativeLink">;
    notifications: Pick<ControllerContracts["notifications"], "notifications">;
    rules: Pick<ControllerContracts["rules"], "formRule" | "invalidateReview" | "preview">;
    issueGuidance: Pick<ControllerContracts["issueGuidance"], "beginIssueVerification" | "openIssuePanel">;
    identities: Pick<ControllerContracts["identities"], "identityForm">;
    managerUi: Pick<ControllerContracts["managerUi"], "readManagerFields">;
}
export function createIssues(ports: IssuesDependencies, session: DashboardState) {
    // Issues have stable typed keys. Repairs are explicitly staged, never inferred.

    const issueLabels: Record<string, string> = {
        cleanup: "Review orphan deletion",
        repair: "Review selected repairs",
        acknowledge: "Acknowledge reports",
    };
    function issueMatches() {
        return session.issues.issueItems.filter(
            (i) =>
                (!ports.api.q("mmoIssueGroup").value || i.guidance.group === ports.api.q("mmoIssueGroup").value) &&
                (!ports.api.q("mmoIssueType").value || i.type === ports.api.q("mmoIssueType").value) &&
                (!ports.api.q("mmoIssueState").value || i.status === ports.api.q("mmoIssueState").value),
        );
    }
    function issueEligible(action: string) {
        const selected = session.issues.issueItems.filter((i) => session.issues.issueSelection.has(i.key)),
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
        ports.rowMenu.closeRowMenu();
        const focused = (document.activeElement as HTMLElement | null)?.dataset.issueSelect;
        const keys = new Set(session.issues.issueItems.map((i) => i.key));
        for (const key of session.issues.issueSelection) if (!keys.has(key)) session.issues.issueSelection.delete(key);
        const matches = issueMatches();
        if (session.issues.issueStart >= matches.length)
            session.issues.issueStart = Math.max(0, Math.floor((matches.length - 1) / ports.table.tablePageSize) * ports.table.tablePageSize);
        ports.api.q("mmoIssueRows").innerHTML =
            matches
                .slice(session.issues.issueStart, session.issues.issueStart + ports.table.tablePageSize)
                .map((i) =>
                    ports.table.tableRow({
                        name: i.name,
                        columns: ports.table.issueTableColumns,
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
                        attributes: 'data-issue-key="' + ports.api.esc(i.key) + '"',
                        selection: ports.table.tableCheckbox(i.name, 'data-issue-select="' + ports.api.esc(i.key) + '"', {
                            checked: session.issues.issueSelection.has(i.key),
                            disabled: session.issues.issueBusy,
                        }),
                        description: [i.guidance.summary, i.guidance.path].filter(Boolean).join("\n"),
                        primary: ports.navigation.nativeButton(i.guidance.action, 'data-issue-open="' + ports.api.esc(i.key) + '"'),
                        native: ports.nativeLinks.issueNativeLink(i),
                    }),
                )
                .join("") || ports.table.tableMessage("No findings match this view.", true, 3);
        ports.api.q("mmoIssueSelected").textContent = session.issues.issueSelection.size + " selected";
        ports.api.q("mmoIssueToolbar").hidden = !session.issues.issueSelection.size;
        for (const b of ports.api.page.querySelectorAll<HTMLButtonElement>("[data-issue-action]")) {
            const c = issueEligible(b.dataset.issueAction!);
            b.textContent = issueLabels[b.dataset.issueAction!] + " (" + c.eligible.length + " eligible, " + c.skipped.length + " skipped)";
            b.disabled = session.issues.issueBusy || !c.eligible.length;
        }
        for (const id of ["mmoIssueSelectPage", "mmoIssueSelectAll"])
            ports.api.q<HTMLButtonElement>(id).disabled = session.issues.issueBusy || !matches.length;
        ports.api.q("mmoIssueClear").disabled = session.issues.issueBusy || !session.issues.issueSelection.size;
        ports.table.tablePagination(session.issues.issueStart, matches.length, {
            count: "mmoIssuesCount",
            previous: "mmoIssuesPrev",
            next: "mmoIssuesNext",
            noun: "issues",
        });
        ports.api.q("mmoArchivedReports").innerHTML =
            session.issues.issueArchived
                .map((r) => "<p>" + ports.api.esc(r.message) + " · archived " + ports.api.esc(r.archivedAt) + "</p>")
                .join("") || "<p>No archived reports.</p>";
        renderRepairSummary();
        ports.navigation.normalizeControls(ports.api.q("mmoIssueRows"));
        if (focused)
            ports.api
                .q("mmoIssueRows")
                .querySelector<HTMLElement>('[data-issue-select="' + CSS.escape(focused) + '"]')
                ?.focus({ preventScroll: true });
    }
    async function managerIssues() {
        const serial = ++session.navigation.ui.issueRequest;
        ports.api.q("mmoIssuesMessage").textContent = session.issues.issueItems.length ? "Refreshing issues…" : "";
        if (!session.issues.issueItems.length) ports.api.q("mmoIssueRows").innerHTML = ports.table.tableMessage("Checking issues…", true, 3);
        try {
            const data = await ports.api.api("manager/issues");
            if (serial !== session.navigation.ui.issueRequest) return;
            session.issues.issueItems = data.items;
            session.issues.issueArchived = data.archivedReports;
            renderIssues();
            ports.api.q("mmoIssuesMessage").textContent = session.issues.issueItems.length + " findings across all views.";
            session.navigation.ui.issueLoaded = true;
        } catch (caughtError) {
            const e = operationError(caughtError);
            if (serial !== session.navigation.ui.issueRequest) return;
            ports.api.q("mmoIssuesMessage").textContent = session.issues.issueItems.length
                ? "Could not check issues. Use Refresh issues to retry."
                : "";
            if (!session.issues.issueItems.length)
                ports.api.q("mmoIssueRows").innerHTML = ports.table.tableMessage("Could not check issues. Use Refresh issues to retry.", true, 3);
            e.noticeHandled = true;
            throw e;
        }
    }
    async function refreshIssues() {
        await managerIssues();
    }
    async function issueAction(action: string) {
        const message = ports.notifications.notifications.scope();
        if (session.issues.issueBusy) return;
        const context = { action, ...issueEligible(action) };
        if (!context.eligible.length) throw Error("No eligible selected issues.");
        session.issues.issueBusy = true;
        renderIssues();
        try {
            if (action === "acknowledge") {
                const result = await ports.api.api("manager/errors/acknowledge", "POST", {
                    ids: context.eligible.map((i) => i.context.id),
                });
                result.acknowledged.forEach((id) => session.issues.issueSelection.delete("report:" + id));
                await managerIssues();
                message(
                    result.acknowledged.length +
                        " reports archived; " +
                        context.skipped.length +
                        " selections skipped. No corrections were retried." +
                        (context.skipped.length ? "\nSkipped: " + context.skipped.map((i) => i.name + " — " + i.reason).join("; ") : ""),
                );
            } else if (action === "cleanup") await ports.rules.preview({ cleanupIds: context.eligible.map((i) => i.itemId!) }, null, context);
            else {
                if (session.issues.repairQueue) throw Error("Finish or close the existing repair queue first.");
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
                session.issues.repairQueue = {
                    tasks: [...groups.values()],
                    index: 0,
                    staged: new Map(),
                    skipped: context.skipped,
                };
                await openRepairTask();
            }
        } finally {
            session.issues.issueBusy = false;
            renderIssues();
        }
    }
    async function openIssue(issue: Issue | undefined, guided = false) {
        await ports.issueGuidance.openIssuePanel(issue, guided);
    }
    async function openRepairTask() {
        const message = ports.notifications.notifications.scope();
        if (!session.issues.repairQueue) return;
        if (session.issues.repairQueue.index >= session.issues.repairQueue.tasks.length) {
            ports.api.q("mmoRepairControls").hidden = true;
            renderRepairSummary();
            await ports.navigation.showDestination("issues");
            message("Repair queue reviewed. Staged edits remain local; review them together or explicitly save drafts.");
            return;
        }
        await openIssue(session.issues.repairQueue.tasks[session.issues.repairQueue.index]!.issues[0], true);
    }
    function renderRepairSummary() {
        const container = ports.api.q("mmoRepairQueueSummary");
        container.hidden = !session.issues.repairQueue;
        if (!session.issues.repairQueue) return;
        container.innerHTML =
            "<h3>Guided repairs</h3><p>" +
            session.issues.repairQueue.staged.size +
            " locally staged · " +
            Math.min(session.issues.repairQueue.index, session.issues.repairQueue.tasks.length) +
            " of " +
            session.issues.repairQueue.tasks.length +
            ' tasks visited. Save drafts explicitly to survive reload.</p><div class="mmo-actions">' +
            (session.issues.repairQueue.index < session.issues.repairQueue.tasks.length
                ? ports.navigation.nativeButton("Resume repairs", "data-repair-resume")
                : "") +
            ports.navigation.nativeButton(
                "Review staged repairs",
                "data-repair-review " + (!session.issues.repairQueue.staged.size ? "disabled" : ""),
            ) +
            ports.navigation.nativeButton("Close queue, keep local edits", "data-repair-close") +
            "</div>" +
            "<details><summary>Repair tasks</summary>" +
            session.issues.repairQueue.tasks
                .map(
                    (t, index) =>
                        "<p>" +
                        ports.navigation.nativeButton(
                            t.issues[0]!.name + (session.issues.repairQueue!.staged.has(t.key) ? " · staged" : ""),
                            'data-repair-revisit="' + index + '"',
                        ) +
                        "</p>",
                )
                .join("") +
            "</details>" +
            (session.issues.repairQueue.skipped.length
                ? "<details><summary>" +
                  session.issues.repairQueue.skipped.length +
                  " skipped selections</summary><ul>" +
                  session.issues.repairQueue.skipped.map((i) => "<li>" + ports.api.esc(i.name) + " — " + ports.api.esc(i.reason) + "</li>").join("") +
                  "</ul></details>"
                : "");
    }
    function renderIssueReview(context: IssueContext | null | undefined) {
        ports.api.q("mmoIssueReview").hidden = !context;
        ports.api.q("mmoIssueReview").innerHTML = context
            ? "<h3>" +
              ports.api.esc(issueLabels[context.action]) +
              "</h3><p>" +
              context.eligible.length +
              " targeted · " +
              context.skipped.length +
              " skipped</p><ul>" +
              context.eligible.map((i) => "<li>" + ports.api.esc(i.name) + "</li>").join("") +
              "</ul>" +
              (context.skipped.length
                  ? "<details><summary>Skipped selections</summary><ul>" +
                    context.skipped.map((i) => "<li>" + ports.api.esc(i.name) + " — " + ports.api.esc(i.reason) + "</li>").join("") +
                    "</ul></details>"
                  : "")
            : "";
    }
    function completeIssueOperation(context: IssueContext | null | undefined, result: ActivationResult) {
        if (!context) return null;
        if (context.action === "cleanup") {
            const outcomes = result.cleanupResults || [];
            for (const outcome of outcomes)
                if (outcome.outcome === "deleted") session.issues.issueSelection.delete("record:" + outcome.id.replaceAll("-", ""));
            ports.issueGuidance.beginIssueVerification(context, result);
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
        ports.issueGuidance.beginIssueVerification(context, result);
        // Fresh checks determine whether each original issue resolved.
        session.issues.repairQueue = null;
        ports.api.q("mmoRepairControls").hidden = true;
        return "Changes applied; checking the original issues.";
    }
    return {
        initialize() {
            ports.api.q("mmoManagerIssueRefresh").onclick = () => ports.api.perform(refreshIssues);
            for (const id of ["mmoIssueGroup", "mmoIssueType", "mmoIssueState"])
                ports.api.q(id).onchange = () => {
                    session.issues.issueStart = 0;
                    session.issues.issueSelection.clear();
                    ports.rules.invalidateReview();
                    renderIssues();
                };
            ports.api.q("mmoIssueRows").onchange = (e) => {
                const key = (e.target as HTMLElement).dataset.issueSelect;
                if (!key) return;
                if ((e.target as HTMLInputElement).checked) session.issues.issueSelection.add(key);
                else session.issues.issueSelection.delete(key);
                ports.rules.invalidateReview();
                renderIssues();
            };
            ports.api.q("mmoIssueRows").onclick = (e) => {
                const key = (e.target as HTMLElement).closest<HTMLElement>("[data-issue-open]")?.dataset.issueOpen;
                if (key)
                    ports.api.perform(() =>
                        openIssue(
                            session.issues.issueItems.find((i) => i.key === key),
                            false,
                        ),
                    );
            };
            ports.api.q("mmoIssueSelectPage").onclick = () => {
                issueMatches()
                    .slice(session.issues.issueStart, session.issues.issueStart + ports.table.tablePageSize)
                    .forEach((i) => session.issues.issueSelection.add(i.key));
                renderIssues();
            };
            ports.api.q("mmoIssueSelectAll").onclick = () => {
                issueMatches().forEach((i) => session.issues.issueSelection.add(i.key));
                renderIssues();
            };
            ports.api.q("mmoIssueClear").onclick = () => {
                session.issues.issueSelection.clear();
                renderIssues();
            };
            ports.api.q("mmoIssuesPrev").onclick = () => {
                session.issues.issueStart = Math.max(0, session.issues.issueStart - ports.table.tablePageSize);
                renderIssues();
            };
            ports.api.q("mmoIssuesNext").onclick = () => {
                session.issues.issueStart += ports.table.tablePageSize;
                renderIssues();
            };
            for (const b of ports.api.page.querySelectorAll<HTMLButtonElement>("[data-issue-action]"))
                b.onclick = () => ports.api.perform(() => issueAction(b.dataset.issueAction!));
            ports.api.q("mmoRepairStage").onclick = () =>
                ports.api.perform(async (operation) => {
                    const message = ports.notifications.notifications.scope(operation);
                    const queue = session.issues.repairQueue,
                        index = queue!.index,
                        task = queue!.tasks[index],
                        editor = session.navigation.ui.editor,
                        sequence = editor!.sequence;
                    const data =
                        editor!.type === "identity"
                            ? ports.identities.identityForm()
                            : editor!.type === "metadata"
                              ? ports.managerUi.readManagerFields()
                              : ports.rules.formRule();
                    const field = {
                        identity: "identityEdits",
                        metadata: "metadataEdits",
                        rule: "edits",
                    }[editor!.type];
                    message("Validating repair…", "loading");
                    await ports.api.api("preview", "POST", { [field]: [data] });
                    if (
                        session.issues.repairQueue !== queue ||
                        queue!.index !== index ||
                        session.navigation.ui.screen !== "workspace" ||
                        session.navigation.ui.editor !== editor ||
                        editor!.sequence !== sequence
                    )
                        throw Error("Edit changed during validation. Stage the current values again.");
                    ports.navigation.markDirty();
                    session.issues.repairQueue!.staged.set(task!.key, {
                        field: field as "edits" | "identityEdits" | "metadataEdits",
                        data: structuredClone(data),
                        keys: task!.issues.map((i) => i.key),
                        localKey: editor!.key,
                        sequence: editor!.sequence,
                    });
                    session.issues.repairQueue!.index++;
                    await openRepairTask();
                });
            ports.api.q("mmoRepairSkip").onclick = () =>
                ports.api.perform(async (operation) => {
                    ports.notifications.notifications.scope(operation);
                    ports.navigation.captureEditor();
                    session.issues.repairQueue!.staged.delete(session.issues.repairQueue!.tasks[session.issues.repairQueue!.index]!.key);
                    session.issues.repairQueue!.index++;
                    await openRepairTask();
                });
            ports.api.q("mmoRepairReturn").onclick = () => ports.api.perform(() => ports.navigation.showDestination("issues"));
            ports.api.q("mmoRepairQueueSummary").onclick = (e) =>
                ports.api.perform(async (operation) => {
                    ports.notifications.notifications.scope(operation);
                    const revisit = (e.target as HTMLElement).closest<HTMLElement>("[data-repair-revisit]");
                    if (revisit) {
                        session.issues.repairQueue!.index = Number(revisit.dataset.repairRevisit);
                        await openRepairTask();
                    }
                    if ((e.target as HTMLElement).closest<HTMLElement>("[data-repair-resume]")) await openRepairTask();
                    if ((e.target as HTMLElement).closest<HTMLElement>("[data-repair-close]")) {
                        session.issues.repairQueue = null;
                        renderRepairSummary();
                    }
                    if ((e.target as HTMLElement).closest<HTMLElement>("[data-repair-review]")) {
                        const change: Partial<Change> = {};
                        for (const staged of session.issues.repairQueue!.staged.values()) {
                            if (!session.navigation.ui.locals.has(staged.localKey))
                                throw Error("A staged local edit was discarded or saved. Revisit that repair before batch review.");
                            if (session.navigation.ui.locals.get(staged.localKey)!.sequence !== staged.sequence)
                                throw Error("A staged edit changed. Revisit and stage its current values before review.");
                            if (staged.field === "edits") (change.edits ||= []).push(structuredClone(staged.data) as Rule);
                            else if (staged.field === "identityEdits")
                                (change.identityEdits ||= []).push(structuredClone(staged.data) as ArtistIdentity);
                            else (change.metadataEdits ||= []).push(structuredClone(staged.data) as MetadataPolicy);
                        }
                        await ports.rules.preview(change, null, {
                            action: "repair",
                            eligible: session.issues.issueItems.filter((i) =>
                                [...session.issues.repairQueue!.staged.values()].some((s) => s.keys.includes(i.key)),
                            ),
                            skipped: session.issues.repairQueue!.skipped,
                        });
                    }
                });
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
