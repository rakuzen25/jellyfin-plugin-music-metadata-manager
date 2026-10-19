import type { Command } from "./state.ts";
import type { Features } from "./features.ts";
export function createActions(features: Features) {
    // Commands own their pending state independently of DOM nodes and notices.
    const actions = (() => {
        const pending = new Map<string, Command>(),
            buttons = new Map<
                HTMLButtonElement,
                {
                    disabled: boolean;
                    label: string | null;
                }
            >();
        let trigger: HTMLButtonElement | null = null,
            current: Command | null = null;
        let writeTail: Promise<void> = Promise.resolve(),
            scheduled = false;
        function describe(button: HTMLButtonElement | null): Command {
            const row = button?.closest<HTMLElement>(".mmo-row");
            const repairCommand = !!button?.matches("#mmoRepairStage, #mmoRepairSkip, [data-issue-choice=skip]");
            const resource = repairCommand
                ? "repairQueue"
                : row?.dataset.changeKey ||
                  row?.dataset.issueKey ||
                  (features.navigation.ui.screen === "issue" ? features.issueGuidance.issuePanelState?.issue.key : null) ||
                  button?.dataset.id ||
                  button?.dataset.managerItem ||
                  (features.navigation.ui.screen === "workspace"
                      ? features.navigation.ui.editor?.key
                      : features.navigation.ui.screen === "review"
                        ? "review"
                        : features.navigation.ui.view);
            const command =
                button?.id ||
                JSON.stringify(Object.fromEntries(Object.entries(button?.dataset || {}).filter(([k]) => k !== "actionLabel"))) ||
                "operation";
            const label = button?.dataset.actionLabel || button?.textContent?.trim() || "Operation";
            const navigation =
                !!button?.matches(
                    "[data-view], [data-item-tab], [data-actions-open], [data-menu-command], #mmoWorkspaceBack, #mmoReviewBack, #mmoReviewCancel, #mmoRepairReturn, #mmoIssuePanelBack, #mmoIssueEditorBack, #mmoIssueFullWorkspace, [data-issue-choice=return], [data-issue-choice=choices]",
                ) || /^(Cancel|← Back|Resume|Inspect|Edit$|New )/.test(label);
            const write =
                !navigation &&
                (/^(Save\b|Discard saved|Discard pending|Delete draft|Import as|Acknowledge|Archive report|Reapply|Apply changes)/i.test(label) ||
                    /DeleteDraft|deleteDraft/.test(button?.dataset.action || ""));
            const local = !!button?.matches("[data-field-action], [data-image-empty], [data-image-unmanage], [data-source-field]");
            const issueEdit = !!button?.matches(
                "[data-issue-choice=link], [data-issue-choice=use-identity], [data-issue-choice=use-records], [data-issue-choice=metadata], [data-issue-choice=binding], [data-issue-choice=split], [data-issue-choice=rule], [data-issue-policy], [data-issue-binding]",
            );
            const editing =
                repairCommand ||
                issueEdit ||
                (!navigation &&
                    !local &&
                    /Preview|Review|Save|Cache|Fetch comparison|Keep current|Keep empty|Stop managing|Restore original|Stage and next/i.test(label));
            return {
                button,
                command,
                resource,
                key: command + ":" + resource,
                label,
                write,
                editing,
                navigation,
                item:
                    row?.querySelector<HTMLElement>("strong")?.textContent ||
                    features.navigation.ui.editor?.name ||
                    (features.navigation.ui.screen === "issue" ? features.issueGuidance.issuePanelState?.issue.name : "") ||
                    "",
                context: {
                    screen: features.navigation.ui.screen,
                    view: features.navigation.ui.view,
                    item: features.navigation.ui.editor?.key || null,
                },
                anchor:
                    row?.querySelector<HTMLElement>(".mmo-row-main") ||
                    button?.closest<HTMLElement>(".mmo-editor-actions, .mmo-actions") ||
                    button?.parentElement,
                itemId: features.navigation.ui.editor?.itemId,
                origin: features.navigation.ui.editor
                    ? { key: features.navigation.ui.editor.key, view: features.navigation.ui.view }
                    : {
                          view: features.navigation.ui.view,
                          issueKey: features.navigation.ui.screen === "issue" ? features.issueGuidance.issuePanelState?.issue.key : null,
                      },
            };
        }
        function conflict(meta: Command) {
            return [...pending.values()].some(
                (p) =>
                    !p.navigation &&
                    !meta.navigation &&
                    (p.key === meta.key || (p.write && meta.write) || (p.resource === meta.resource && p.editing && meta.editing)),
            );
        }
        function capture(event: Event) {
            const target = event.target;
            const button =
                event instanceof SubmitEvent
                    ? event.submitter instanceof HTMLButtonElement
                        ? event.submitter
                        : target instanceof HTMLFormElement
                          ? target.querySelector<HTMLButtonElement>("[type=submit]")
                          : null
                    : target instanceof Element
                      ? target.closest<HTMLButtonElement>("button")
                      : null;
            trigger = button;
            if (button && !button.matches("[data-menu-command]") && conflict(describe(button))) {
                event.preventDefault();
                event.stopImmediatePropagation();
            }
            // Native events may checkpoint microtasks between capture and target listeners.
            // Keep the initiating control through the entire dispatch task.
            setTimeout(() => {
                if (trigger === button) trigger = null;
            }, 0);
        }
        features.api.page.addEventListener("click", capture, true);
        features.api.page.addEventListener("submit", capture, true);
        // A filter change is a new event owner, even before a prior click's reset timer runs.
        features.api.page.addEventListener("change", capture, true);
        function acquire() {
            const meta = describe(trigger);
            if (!trigger) {
                meta.key = "background:" + crypto.randomUUID();
                meta.editing = false;
            }
            if (conflict(meta)) return null;
            pending.set(meta.key, meta);
            current = meta;
            sync();
            return meta;
        }
        function release(meta: Command) {
            pending.delete(meta.key);
            if (current === meta) current = null;
            sync();
            if (typeof features.managerUi.setEditorWritable === "function" && features.navigation.ui.editor?.type === "metadata")
                features.managerUi.setEditorWritable();
            if (typeof features.bulk.renderBulkSelection === "function" && features.api.doc) features.bulk.renderBulkSelection();
            if (typeof features.issues.renderIssues === "function" && features.navigation.ui.issueLoaded && features.navigation.ui.view === "issues")
                features.issues.renderIssues();
            sync();
        }
        function buttonLabel(button: HTMLElement, text: string | null) {
            const node =
                [...button.childNodes].find((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim()) ||
                button.querySelector<HTMLElement>(".buttonText, .button-text");
            if (node && node.textContent !== text) node.textContent = text;
        }
        function sync() {
            for (const button of features.api.page.querySelectorAll<HTMLButtonElement>("button")) {
                if (button.closest<HTMLElement>(".mmo-feedback, #mmoMessage")) continue;
                const meta = describe(button),
                    busy = conflict(meta);
                let state = buttons.get(button);
                if (busy) {
                    if (!state) {
                        state = { disabled: button.disabled, label: button.textContent };
                        buttons.set(button, state);
                    }
                    button.setAttribute("aria-disabled", "true");
                    button.setAttribute("aria-busy", "true");
                    if (!button.disabled) button.disabled = true;
                    const own = pending.get(meta.key);
                    if (own) {
                        const text = own.write
                            ? /Save/.test(own.label)
                                ? "Saving draft…"
                                : /Apply changes/.test(own.label)
                                  ? "Applying changes…"
                                  : "Working…"
                            : /Preview|Review/.test(own.label)
                              ? "Preparing review…"
                              : /Cache|Keep current/.test(own.label)
                                ? "Caching artwork…"
                                : "Loading…";
                        buttonLabel(button, text);
                        button.dataset.actionLabel = own.label;
                    }
                } else if (state) {
                    button.disabled = state.disabled;
                    button.removeAttribute("aria-disabled");
                    button.removeAttribute("aria-busy");
                    if (button.dataset.actionLabel) {
                        buttonLabel(button, state.label);
                        delete button.dataset.actionLabel;
                    }
                    buttons.delete(button);
                }
            }
            for (const button of buttons.keys()) if (!button.isConnected) buttons.delete(button);
            if (features.api.q("mmoReviewCancel"))
                buttonLabel(features.api.q("mmoReviewCancel"), isPending("mmoActivate") ? "Leave review" : "Cancel review");
        }
        const observer = new MutationObserver((records) => {
            if (
                records.every((r) =>
                    (r.target instanceof Element ? r.target : r.target.parentElement)?.closest<HTMLElement>(
                        ".mmo-feedback, #mmoMessage, #mmoAnnouncements",
                    ),
                )
            )
                return;
            for (const r of records)
                if (r.attributeName === "disabled" && r.target instanceof HTMLButtonElement && buttons.has(r.target) && !r.target.disabled)
                    buttons.get(r.target)!.disabled = false;
            if (!scheduled) {
                scheduled = true;
                queueMicrotask(() => {
                    scheduled = false;
                    sync();
                });
            }
        });
        observer.observe(features.api.page, { subtree: true, childList: true, attributes: true, attributeFilter: ["disabled"] });
        function isPending(command: string) {
            return [...pending.values()].some((p) => p.command === command);
        }
        function setDisabled(button: HTMLButtonElement, disabled: boolean) {
            const state = buttons.get(button);
            if (state) state.disabled = !!disabled;
            button.disabled = !!disabled || conflict(describe(button));
        }
        async function serializeWrite<T>(work: () => Promise<T>): Promise<T> {
            const result = writeTail.then(work);
            writeTail = result.then(
                () => {},
                () => {},
            );
            return result;
        }
        return { acquire, release, sync, setDisabled, isPending, describe, serializeWrite, current: () => current };
    })();
    return {
        get actions() {
            return actions;
        },
    };
}
