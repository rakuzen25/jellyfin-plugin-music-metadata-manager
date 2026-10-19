import type { Change } from "./contracts.ts";
type BulkField = keyof Pick<
    Change,
    | "activateIds"
    | "disableIds"
    | "deleteIds"
    | "activateIdentities"
    | "disableIdentities"
    | "deleteIdentities"
    | "activatePolicies"
    | "disablePolicies"
    | "deletePolicies"
>;
import { operationError } from "./errors.ts";
import type { BulkEntry, BulkContext } from "./responses.ts";
import type { ControllerContracts } from "./controllerContracts.ts";
import type { DashboardState } from "./dashboardState.ts";
export interface BulkDependencies {
    api: Pick<ControllerContracts["api"], "api" | "esc" | "page" | "perform" | "q">;
    notifications: Pick<ControllerContracts["notifications"], "notifications">;
    rules: Pick<ControllerContracts["rules"], "invalidateReview" | "load" | "preview">;
}
export function createBulk(ports: BulkDependencies, session: DashboardState) {
    // Selection refers to saved backing records, independent of presentation type.

    const bulkLabels: Record<string, string> = {
        apply: "Review & apply saved drafts",
        disable: "Review disable",
        delete: "Review delete active versions",
        discard: "Discard saved drafts",
    };
    function bulkEntries(): BulkEntry[] {
        const groups: [
            string,
            {
                id: string;
                label?: string;
                preferredName?: string;
                path?: string;
                credit?: string;
                identityId?: string | null;
                itemId?: string;
            }[],
            {
                id: string;
                label?: string;
                preferredName?: string;
                path?: string;
                credit?: string;
                identityId?: string | null;
                itemId?: string;
            }[],
        ][] = [
            ["rule", session.api.doc.active, session.api.doc.drafts],
            ["identity", session.api.doc.identities, session.api.doc.identityDrafts],
            ["policy", session.api.doc.policies, session.api.doc.policyDrafts],
        ];
        return groups.flatMap(([kind, active, drafts]) =>
            [...new Set([...active, ...drafts].map((x) => x.id))].map((id) => {
                const live = active.find((x) => x.id === id),
                    draft = drafts.find((x) => x.id === id),
                    item = (live || draft)!;
                return {
                    key: kind + ":" + id,
                    kind,
                    id,
                    live: !!live,
                    draft: !!draft,
                    name: item.label || item.preferredName || item.path || item.credit || item.identityId || item.itemId || id,
                };
            }),
        );
    }
    function bulkTargets(action: string) {
        const selected = bulkEntries().filter((e) => session.bulk.bulkSelection.has(e.key));
        const eligible = selected.filter((e) => (action === "apply" || action === "discard" ? e.draft : e.live));
        return { eligible, skipped: selected.filter((e) => !eligible.includes(e)) };
    }
    function renderBulkSelection() {
        if (!session.api.doc) return;
        const entries = bulkEntries(),
            keys = new Set(entries.map((e) => e.key));
        for (const key of session.bulk.bulkSelection) if (!keys.has(key)) session.bulk.bulkSelection.delete(key);
        for (const input of ports.api.page.querySelectorAll<HTMLInputElement>("[data-change-select]"))
            input.checked = session.bulk.bulkSelection.has(input.dataset.changeSelect!);
        ports.api.q("mmoSelectedCount").textContent = session.bulk.bulkSelection.size + " selected";
        ports.api.q("mmoBulkToolbar").hidden = !session.bulk.bulkSelection.size;
        for (const button of ports.api.page.querySelectorAll<HTMLButtonElement>("[data-bulk-action]")) {
            const { eligible, skipped } = bulkTargets(button.dataset.bulkAction!);
            button.textContent = bulkLabels[button.dataset.bulkAction!] + " (" + eligible.length + " eligible, " + skipped.length + " skipped)";
            button.disabled = session.bulk.bulkBusy || !eligible.length;
        }
        ports.api.q("mmoClearSelection").disabled = session.bulk.bulkBusy || !session.bulk.bulkSelection.size;
        ports.api.q("mmoSelectPage").disabled = session.bulk.bulkBusy || !session.bulk.bulkMatches.some((r) => !r.hidden);
        ports.api.q("mmoSelectFiltered").disabled = session.bulk.bulkBusy || !session.bulk.bulkMatches.length;
        for (const input of ports.api.page.querySelectorAll<HTMLInputElement>("[data-change-select]")) input.disabled = session.bulk.bulkBusy;
    }
    async function bulkAction(action: string) {
        const message = ports.notifications.notifications.scope();
        if (session.bulk.bulkBusy) return;
        const context = { action, ...bulkTargets(action) };
        if (!context.eligible.length) throw Error("No selected saved versions can receive this action.");
        session.bulk.bulkBusy = true;
        renderBulkSelection();
        try {
            if (action === "discard") {
                await ports.api.api("drafts/discard", "POST", {
                    expectedRevision: session.api.doc.revision,
                    targets: context.eligible.map(({ kind, id }) => ({ kind, id })),
                });
                context.eligible.forEach((e) => session.bulk.bulkSelection.delete(e.key));
                ports.rules.invalidateReview();
                await ports.rules.load();
                message(
                    context.eligible.length +
                        " saved drafts discarded; " +
                        context.skipped.length +
                        " selected rows skipped. Active versions and unfinished local edits are unchanged.",
                );
                return;
            }
            const fields: Record<string, Record<string, BulkField>> = {
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
            const change: Partial<Record<BulkField, string[]>> = {};
            for (const e of context.eligible) (change[fields[e.kind]![action]!] ||= []).push(e.id);
            await ports.rules.preview(change, context);
        } catch (caughtError) {
            const error = operationError(caughtError);
            if (action === "discard") await ports.rules.load();
            throw error;
        } finally {
            session.bulk.bulkBusy = false;
            renderBulkSelection();
        }
    }
    function renderBulkReview(context: BulkContext | null | undefined) {
        ports.api.q("mmoBulkReview").hidden = !context;
        if (!context) {
            ports.api.q("mmoBulkReview").innerHTML = "";
            return;
        }
        const rows = context.eligible
            .map((e) => {
                let effect = "";
                if (e.draft && e.live && context.action === "apply") effect = "Saved pending revision replaces the active version.";
                if (e.draft && context.action === "delete") effect = "The active version and its saved draft are deleted.";
                if (e.draft && context.action === "disable")
                    effect =
                        e.kind === "policy"
                            ? "The saved pending revision is replaced by a draft of the active policy."
                            : "The saved pending revision is retained.";
                return (
                    "<li><strong>" +
                    ports.api.esc(e.name) +
                    "</strong> · " +
                    ports.api.esc(e.kind) +
                    (effect ? "<p>" + ports.api.esc(effect) + "</p>" : "") +
                    "</li>"
                );
            })
            .join("");
        ports.api.q("mmoBulkReview").innerHTML =
            "<h3>" +
            ports.api.esc(bulkLabels[context.action]) +
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
                              ports.api.esc(e.name) +
                              " — " +
                              (context.action === "apply" ? "No saved draft" : "No active version") +
                              "</li>",
                      )
                      .join("") +
                  "</ul></details>"
                : "");
    }
    function completeBulk(context: BulkContext | null | undefined) {
        if (!context) return;
        for (const e of context.eligible) {
            session.bulk.bulkSelection.delete(e.key);
            for (const entry of session.navigation.ui.locals.values())
                if (
                    entry.data.id === e.id &&
                    ((e.kind === "identity" && entry.type === "identity") || (e.kind !== "identity" && entry.type !== "identity"))
                )
                    entry.baselineChanged = true;
        }
    }
    return {
        initialize() {
            ports.api.page.addEventListener("change", (event) => {
                const key = (event.target as HTMLElement).dataset.changeSelect;
                if (!key) return;
                if ((event.target as HTMLInputElement).checked) session.bulk.bulkSelection.add(key);
                else session.bulk.bulkSelection.delete(key);
                ports.rules.invalidateReview();
                renderBulkSelection();
            });
            ports.api.q("mmoSelectPage").onclick = () => {
                session.bulk.bulkMatches.filter((r) => !r.hidden).forEach((r) => session.bulk.bulkSelection.add(r.dataset.changeKey!));
                renderBulkSelection();
            };
            ports.api.q("mmoSelectFiltered").onclick = () => {
                session.bulk.bulkMatches.forEach((r) => session.bulk.bulkSelection.add(r.dataset.changeKey!));
                renderBulkSelection();
            };
            ports.api.q("mmoClearSelection").onclick = () => {
                session.bulk.bulkSelection.clear();
                renderBulkSelection();
            };
            for (const button of ports.api.page.querySelectorAll<HTMLButtonElement>("[data-bulk-action]"))
                button.onclick = () => ports.api.perform(() => bulkAction(button.dataset.bulkAction!));
        },

        get bulkLabels() {
            return bulkLabels;
        },
        get bulkEntries() {
            return bulkEntries;
        },
        get bulkTargets() {
            return bulkTargets;
        },
        get renderBulkSelection() {
            return renderBulkSelection;
        },
        get bulkAction() {
            return bulkAction;
        },
        get renderBulkReview() {
            return renderBulkReview;
        },
        get completeBulk() {
            return completeBulk;
        },
    };
}
