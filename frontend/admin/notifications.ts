import type { Command, CommandContext } from "./state.ts";
import type { Features } from "./features.ts";
type FeedbackKind = "success" | "warning" | "error" | "loading";
interface OperationRecord {
    id: number;
    command: Command | null;
    context: CommandContext;
    generation: number;
    navigation: number;
    cancelled: boolean;
    dismissed: boolean | FeedbackKind;
    finished?: boolean;
}
interface Notice {
    id: number;
    text: string;
    kind: FeedbackKind;
    node: HTMLDivElement;
    remaining: number;
    timer: ReturnType<typeof setTimeout> | null;
    hover: boolean;
    started?: number;
}
export function createNotifications(features: Features) {
    // Each operation owns feedback; presentation may move without re-announcing it.
    const notifications = (() => {
        let operation = 0,
            active = true,
            generation = 0,
            navigation = 0;
        let frame: number | null = null;
        const records = new Map<number, OperationRecord>(),
            notices = new Map<number, Notice>();
        const context = () => ({
            screen: features.navigation.ui.screen,
            view: features.navigation.ui.view,
            item: features.navigation.ui.editor?.key || null,
        });
        const sameContext = (r: OperationRecord | undefined) => !!r && JSON.stringify(r.context) === JSON.stringify(context());
        function valid(id: number) {
            const r = records.get(id);
            return (
                active &&
                features.api.page.isConnected &&
                !!r &&
                r.generation === generation &&
                !r.cancelled &&
                r.navigation === navigation &&
                sameContext(r)
            );
        }
        function remove(id: number) {
            const n = notices.get(id);
            if (!n) return;
            if (n.timer !== null) clearTimeout(n.timer);
            const host = n.node.parentElement,
                anchor = records.get(id)?.command?.anchor;
            n.node.remove();
            for (const slot of [host, anchor]) if (slot?.classList.contains("mmo-feedback-slot") && !slot.children.length) slot.remove();
            notices.delete(id);
        }
        function clear(all = false) {
            navigation++;
            for (const [id, n] of notices) {
                const r = records.get(id);
                if (all || n.kind !== "loading" || !r?.command?.write || r.finished) remove(id);
            }
            for (const r of records.values()) if (!r.command?.write) r.cancelled = true;
            features.api.q("mmoAnnouncements").textContent = "";
            features.api.q("mmoAlertAnnouncements").textContent = "";
            render();
            schedule();
        }
        function pause(n: Notice) {
            if (n.timer) {
                if (n.timer !== null) clearTimeout(n.timer);
                n.timer = null;
                n.remaining -= performance.now() - (n.started ?? performance.now());
            }
        }
        function expire(n: Notice) {
            if (n.kind !== "success" || n.timer || n.hover || n.node.contains(document.activeElement as HTMLElement | null) || document.hidden)
                return;
            n.started = performance.now();
            n.timer = setTimeout(
                () => {
                    if (notices.get(n.id) === n) {
                        remove(n.id);
                        render();
                    }
                },
                Math.max(0, n.remaining),
            );
        }
        function dismiss(id: number) {
            const n = notices.get(id),
                r = records.get(id);
            if (r) r.dismissed = n?.kind || true;
            const button = r?.command?.button;
            remove(id);
            render();
            const nearby = sameContext(r)
                ? button
                      ?.closest<HTMLElement>(".mmo-actions, .mmo-editor-actions")
                      ?.querySelector<HTMLButtonElement>("button:not(:disabled):not([data-notice-dismiss]):not([data-notice-return])")
                : null;
            const fallback =
                features.navigation.ui.screen === "review"
                    ? features.api.q("mmoReviewBack")
                    : features.navigation.ui.screen === "workspace"
                      ? features.api.q("mmoWorkspaceBack")
                      : features.navigation.ui.screen === "issue"
                        ? features.api.q("mmoIssuePanelBack")
                        : features.api.q("mmoNavigation").querySelector<HTMLElement>("[aria-current=page]");
            const target =
                sameContext(r) && button?.isConnected && !button.disabled && !button.closest<HTMLElement>("[hidden]") ? button : nearby || fallback;
            target?.focus({ preventScroll: true });
        }
        function createNode(id: number, text: string, kind: FeedbackKind, r: OperationRecord) {
            const node = document.createElement("div");
            node.className = "mmo-feedback";
            node.dataset.kind = kind;
            node.dataset.operation = String(id);
            const label = r.command?.item ? r.command.item + " · " : "";
            node.innerHTML =
                '<span class="mmo-feedback-text">' +
                features.api.esc(label + text) +
                "</span>" +
                '<div class="mmo-feedback-actions">' +
                (r.command?.origin ? features.navigation.nativeButton("Return", "data-notice-return") : "") +
                features.navigation.nativeButton("Dismiss", 'data-notice-dismiss aria-label="Dismiss notification"') +
                "</div>";
            node.querySelector<HTMLElement>("[data-notice-dismiss]")!.onclick = () => dismiss(id);
            node.querySelector<HTMLElement>("[data-notice-return]")?.addEventListener("click", () => {
                const origin = r.command!.origin;
                features.api.perform(async () => {
                    if (origin.issueKey && features.issues.issueItems.some((i) => i.key === origin.issueKey))
                        await features.issueGuidance.openIssuePanel(features.issues.issueItems.find((i) => i.key === origin.issueKey));
                    else if (origin.key && features.navigation.ui.locals.has(origin.key))
                        await features.navigation.resumeEntry(features.navigation.ui.locals.get(origin.key)!);
                    else if (origin.key?.startsWith("metadata:") && r.command!.itemId) await features.managerUi.managerOpen(r.command!.itemId);
                    else await features.navigation.showDestination(origin.view, true, true);
                });
            });
            return node;
        }
        function feedbackAnchor(button: HTMLButtonElement) {
            const group =
                button.closest<HTMLElement>(".mmo-row")?.querySelector<HTMLElement>(".mmo-row-main") ||
                button.closest<HTMLElement>(".mmo-editor-actions, .mmo-actions");
            if (group) return group;
            const slot = document.createElement("div");
            slot.className = "mmo-feedback-slot";
            button.after(slot);
            return slot;
        }
        function show(text: string, kind: FeedbackKind = "success", id = operation) {
            const r = records.get(id);
            if (
                !active ||
                !features.api.page.isConnected ||
                !r ||
                r.generation !== generation ||
                (r.dismissed && (r.dismissed !== "loading" || kind === "loading")) ||
                (!r.command?.write && !(r.command?.navigation && id === operation) && !valid(id))
            )
                return;
            if (r.dismissed === "loading" && kind !== "loading") r.dismissed = false;
            remove(id);
            if (!text) {
                render();
                return;
            }
            if (sameContext(r) && r.command?.button?.isConnected) r.command.anchor = feedbackAnchor(r.command.button);
            const node = createNode(id, text, kind, r),
                n: Notice = { id, text, kind, node, remaining: 5000, timer: null, hover: false };
            node.onmouseenter = () => {
                n.hover = true;
                pause(n);
            };
            node.onmouseleave = () => {
                n.hover = false;
                expire(n);
                schedule();
            };
            node.addEventListener("focusin", () => pause(n));
            node.addEventListener("focusout", () =>
                queueMicrotask(() => {
                    expire(n);
                    schedule();
                }),
            );
            notices.set(id, n);
            const announcer = features.api.q(kind === "error" || kind === "warning" ? "mmoAlertAnnouncements" : "mmoAnnouncements");
            announcer.textContent = (r.command?.item ? r.command.item + ": " : "") + text;
            render();
        }
        function render() {
            frame = null;
            if (!active) return;
            const fallback: Notice[] = [];
            for (const n of notices.values()) {
                const r = records.get(n.id),
                    command = r!.command;
                let anchor = command?.anchor;
                if (command && !anchor?.isConnected && sameContext(r)) {
                    const button = command.button?.id
                        ? features.api.q<HTMLButtonElement>(command.button.id)
                        : [...features.api.page.querySelectorAll<HTMLButtonElement>("button")].find(
                              (b) => features.actions.actions.describe(b).key === command.key,
                          );
                    if (button) {
                        command.button = button;
                        anchor = feedbackAnchor(button);
                        command.anchor = anchor;
                    }
                }
                const local = sameContext(r) && anchor?.isConnected && !anchor.closest<HTMLElement>("[hidden]");
                const anchorBounds = local ? anchor!.getBoundingClientRect() : null;
                const floating = n.node.classList.contains("mmo-feedback-floating");
                const interacting = n.hover || n.node.contains(document.activeElement as HTMLElement | null);
                const room =
                    local &&
                    anchorBounds!.top >= 0 &&
                    anchorBounds!.top < innerHeight &&
                    (getComputedStyle(anchor!).position === "sticky" || anchorBounds!.bottom + n.node.getBoundingClientRect().height <= innerHeight);
                if (local && (!floating || (room && !interacting))) {
                    n.node.hidden = false;
                    if (n.node.parentNode !== anchor) anchor!.append(n.node);
                    n.node.classList.remove("mmo-feedback-floating");
                    n.node.querySelector<HTMLElement>("[data-notice-return]")?.setAttribute("hidden", "");
                    const rect = n.node.getBoundingClientRect();
                    if (rect.top >= 0 && rect.bottom <= innerHeight) {
                        expire(n);
                        continue;
                    }
                }
                n.node.classList.add("mmo-feedback-floating");
                n.node.querySelector<HTMLElement>("[data-notice-return]")?.removeAttribute("hidden");
                fallback.push(n);
            }
            const container = features.api.q("mmoMessage"),
                body = features.api.q("mmoNoticeList");
            const floatingNodes = fallback.map((n) => n.node);
            for (const child of [...body.children]) if (!floatingNodes.includes(child as HTMLDivElement)) child.remove();
            floatingNodes.forEach((node, index) => {
                if (body.children[index] !== node) body.insertBefore(node, body.children[index] || null);
            });
            container.hidden = !fallback.length;
            if (fallback.length) {
                const surface = [features.api.page, document.body, document.documentElement]
                    .map((el) => getComputedStyle(el).backgroundColor)
                    .find((c) => c !== "rgba(0, 0, 0, 0)" && c !== "transparent");
                if (surface) container.style.backgroundColor = surface;
            }
            features.api.q("mmoNoticeMore").hidden = fallback.length <= 1;
            features.api.q("mmoNoticeMore").textContent = fallback.length + " operations";
            fallback.forEach((n, index) => {
                n.node.hidden = index > 0 && container.dataset.expanded !== "true";
                const bounds = n.node.getBoundingClientRect(),
                    dock = container.getBoundingClientRect();
                if (n.node.hidden || bounds.top >= dock.bottom || bounds.bottom <= dock.top) pause(n);
                else expire(n);
            });
            const footer = [...features.api.page.querySelectorAll<HTMLElement>(".mmo-editor-actions")].find(
                (el) => !el.closest<HTMLElement>("[hidden]"),
            );
            const rect = footer?.getBoundingClientRect();
            container.style.bottom = rect && rect.bottom >= innerHeight - 2 && rect.top < innerHeight ? innerHeight - rect.top + 8 + "px" : "";
        }
        function schedule() {
            if (!frame) frame = requestAnimationFrame(render);
        }
        function scope(id = operation) {
            return (text: string, kind?: FeedbackKind) => show(text, kind, id);
        }
        function begin(command: Command | null) {
            const id = ++operation;
            for (const [old, r] of records)
                if (command?.key && r.command?.key === command.key) {
                    remove(old);
                    r.cancelled = true;
                }
            records.set(id, { id, command, context: context(), generation, navigation, cancelled: false, dismissed: false });
            return id;
        }
        function finish(id: number) {
            const r = records.get(id);
            if (r) r.finished = true;
            if (notices.get(id)?.kind === "loading") remove(id);
            render();
        }
        function leave() {
            clear(true);
            active = false;
            generation++;
            if (frame) cancelAnimationFrame(frame);
            frame = null;
        }
        function enter() {
            active = true;
            render();
        }
        features.api.q("mmoNoticeMore").onclick = () => {
            const el = features.api.q("mmoMessage");
            el.dataset.expanded = el.dataset.expanded === "true" ? "false" : "true";
            features.api.q("mmoNoticeMore").setAttribute("aria-expanded", el.dataset.expanded);
            render();
        };
        window.addEventListener("scroll", schedule, true);
        window.addEventListener("resize", schedule);
        const visibilityChanged = () => {
            for (const n of notices.values()) {
                if (document.hidden) pause(n);
                else expire(n);
            }
        };
        document.addEventListener("visibilitychange", visibilityChanged);
        const routeChanged = () => (location.hash.toLowerCase().includes("configurationpage?name=musicmetadatamanager") ? enter() : leave());
        window.addEventListener("hashchange", routeChanged);
        window.addEventListener("popstate", routeChanged);
        for (const event of ["pagehide", "viewhide", "viewbeforehide"]) features.api.page.addEventListener(event, leave);
        for (const event of ["pageshow", "viewshow"]) features.api.page.addEventListener(event, enter);
        const detached = new MutationObserver(() => {
            if (!features.api.page.isConnected) {
                leave();
                detached.disconnect();
                document.removeEventListener("visibilitychange", visibilityChanged);
                window.removeEventListener("scroll", schedule, true);
                window.removeEventListener("resize", schedule);
                window.removeEventListener("hashchange", routeChanged);
                window.removeEventListener("popstate", routeChanged);
            }
        });
        detached.observe(document.body, { childList: true, subtree: true });
        return { begin, scope, finish, clear, show, valid };
    })();
    function message(text: string, kind: FeedbackKind = "success") {
        notifications.show(text, kind);
    }
    return {
        get notifications() {
            return notifications;
        },
        get message() {
            return message;
        },
    };
}
