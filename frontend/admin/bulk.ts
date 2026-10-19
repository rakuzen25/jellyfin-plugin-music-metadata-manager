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
import type { Features } from "./features.ts";
export function createBulk(features: Features) {
    // Selection refers to saved backing records, independent of presentation type.
    const bulkSelection = new Set<string>();
    let bulkMatches: HTMLElement[] = [],
        bulkBusy = false;
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
            ["rule", features.api.doc.active, features.api.doc.drafts],
            ["identity", features.api.doc.identities, features.api.doc.identityDrafts],
            ["policy", features.api.doc.policies, features.api.doc.policyDrafts],
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
        const selected = bulkEntries().filter((e) => bulkSelection.has(e.key));
        const eligible = selected.filter((e) => (action === "apply" || action === "discard" ? e.draft : e.live));
        return { eligible, skipped: selected.filter((e) => !eligible.includes(e)) };
    }
    function renderBulkSelection() {
        if (!features.api.doc) return;
        const entries = bulkEntries(),
            keys = new Set(entries.map((e) => e.key));
        for (const key of bulkSelection) if (!keys.has(key)) bulkSelection.delete(key);
        for (const input of features.api.page.querySelectorAll<HTMLInputElement>("[data-change-select]"))
            input.checked = bulkSelection.has(input.dataset.changeSelect!);
        features.api.q("mmoSelectedCount").textContent = bulkSelection.size + " selected";
        features.api.q("mmoBulkToolbar").hidden = !bulkSelection.size;
        for (const button of features.api.page.querySelectorAll<HTMLButtonElement>("[data-bulk-action]")) {
            const { eligible, skipped } = bulkTargets(button.dataset.bulkAction!);
            button.textContent = bulkLabels[button.dataset.bulkAction!] + " (" + eligible.length + " eligible, " + skipped.length + " skipped)";
            button.disabled = bulkBusy || !eligible.length;
        }
        features.api.q("mmoClearSelection").disabled = bulkBusy || !bulkSelection.size;
        features.api.q("mmoSelectPage").disabled = bulkBusy || !bulkMatches.some((r) => !r.hidden);
        features.api.q("mmoSelectFiltered").disabled = bulkBusy || !bulkMatches.length;
        for (const input of features.api.page.querySelectorAll<HTMLInputElement>("[data-change-select]")) input.disabled = bulkBusy;
    }
    async function bulkAction(action: string) {
        const message = features.notifications.notifications.scope();
        if (bulkBusy) return;
        const context = { action, ...bulkTargets(action) };
        if (!context.eligible.length) throw Error("No selected saved versions can receive this action.");
        bulkBusy = true;
        renderBulkSelection();
        try {
            if (action === "discard") {
                await features.api.api("drafts/discard", "POST", {
                    expectedRevision: features.api.doc.revision,
                    targets: context.eligible.map(({ kind, id }) => ({ kind, id })),
                });
                context.eligible.forEach((e) => bulkSelection.delete(e.key));
                features.rules.invalidateReview();
                await features.rules.load();
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
            await features.rules.preview(change, context);
        } catch (caughtError) {
            const error = operationError(caughtError);
            if (action === "discard") await features.rules.load();
            throw error;
        } finally {
            bulkBusy = false;
            renderBulkSelection();
        }
    }
    function renderBulkReview(context: BulkContext | null | undefined) {
        features.api.q("mmoBulkReview").hidden = !context;
        if (!context) {
            features.api.q("mmoBulkReview").innerHTML = "";
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
                    features.api.esc(e.name) +
                    "</strong> · " +
                    features.api.esc(e.kind) +
                    (effect ? "<p>" + features.api.esc(effect) + "</p>" : "") +
                    "</li>"
                );
            })
            .join("");
        features.api.q("mmoBulkReview").innerHTML =
            "<h3>" +
            features.api.esc(bulkLabels[context.action]) +
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
                              features.api.esc(e.name) +
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
            bulkSelection.delete(e.key);
            for (const entry of features.navigation.ui.locals.values())
                if (
                    entry.data.id === e.id &&
                    ((e.kind === "identity" && entry.type === "identity") || (e.kind !== "identity" && entry.type !== "identity"))
                )
                    entry.baselineChanged = true;
        }
    }
    return {
        initialize() {
            features.api.page.addEventListener("change", (event) => {
                const key = (event.target as HTMLElement).dataset.changeSelect;
                if (!key) return;
                if ((event.target as HTMLInputElement).checked) bulkSelection.add(key);
                else bulkSelection.delete(key);
                features.rules.invalidateReview();
                renderBulkSelection();
            });
            features.api.q("mmoSelectPage").onclick = () => {
                bulkMatches.filter((r) => !r.hidden).forEach((r) => bulkSelection.add(r.dataset.changeKey!));
                renderBulkSelection();
            };
            features.api.q("mmoSelectFiltered").onclick = () => {
                bulkMatches.forEach((r) => bulkSelection.add(r.dataset.changeKey!));
                renderBulkSelection();
            };
            features.api.q("mmoClearSelection").onclick = () => {
                bulkSelection.clear();
                renderBulkSelection();
            };
            for (const button of features.api.page.querySelectorAll<HTMLButtonElement>("[data-bulk-action]"))
                button.onclick = () => features.api.perform(() => bulkAction(button.dataset.bulkAction!));
        },
        get bulkSelection() {
            return bulkSelection;
        },
        get bulkMatches() {
            return bulkMatches;
        },
        set bulkMatches(value: typeof bulkMatches) {
            bulkMatches = value;
        },
        get bulkBusy() {
            return bulkBusy;
        },
        set bulkBusy(value: typeof bulkBusy) {
            bulkBusy = value;
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
