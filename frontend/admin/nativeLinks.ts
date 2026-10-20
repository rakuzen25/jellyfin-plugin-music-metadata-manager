import type { Rule } from "./contracts.ts";
import type { Issue } from "./responses.ts";
import type { ControllerContracts } from "./controllerContracts.ts";
import type { DashboardState } from "./dashboardState.ts";
export interface NativeLinksDependencies {
    api: Pick<ControllerContracts["api"], "api" | "esc" | "page" | "q">;
}
export function createNativeLinks(ports: NativeLinksDependencies, session: DashboardState) {
    // Native navigation is read-only and independent of manager/editor actions.
    function nativePageUrl(id: string | null | undefined, locationHref = window.location.href, server = ApiClient.serverId()) {
        if (!/^(?:[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i.test(String(id || ""))) return null;
        const url = new URL(locationHref);
        url.hash = "/details?" + new URLSearchParams({ id: id!, serverId: server });
        return url.href;
    }
    function nativeLink(id: string | null | undefined, name: string | null | undefined = "item", compact = true, ruleId: string | null = null) {
        if (!ruleId && !nativePageUrl(id)) return "";
        const label = "Open " + (name || "item") + " in Jellyfin (new tab)";
        return (
            '<span class="mmo-native-slot" data-native-id="' +
            ports.api.esc(id || "") +
            '"' +
            (ruleId ? ' data-native-rule="' + ports.api.esc(ruleId) + '"' : "") +
            ' data-native-label="' +
            ports.api.esc(label) +
            '" data-native-compact="' +
            compact +
            '"></span>'
        );
    }
    function nativeRuleLink(rule: Partial<Rule> | null | undefined, compact = true) {
        return rule && rule.kind !== "alias" ? nativeLink(null, rule.label || rule.path, compact, rule.id) : "";
    }
    function issueNativeLink(issue: Issue, compact = true) {
        if (issue.itemId) return nativeLink(issue.itemId, issue.name, compact);
        const identity = issue.guidance?.evidence?.identity || session.api.doc?.identities?.find((i) => i.id === issue.identityId);
        if (identity) return nativeLink(identity.artistId, identity.preferredName, compact);
        if (issue.type === "unmatched") return nativeRuleLink(issue.context, compact);
        const item = issue.guidance?.evidence?.items?.[0];
        return nativeLink(item?.id, item?.name, compact);
    }
    function nativePathLink(path: unknown, kind: string, name: string | undefined, compact = false) {
        if (!path || !["track", "album"].includes(kind)) return "";
        return nativeLink(null, name, compact, "path").replace(
            ' data-native-rule="path"',
            ' data-native-path="' + ports.api.esc(path) + '" data-native-kind="' + kind + '"',
        );
    }
    function updateWorkspaceNativeLinks() {
        if (session.navigation.ui.screen !== "workspace") return;
        if (session.navigation.ui.editor?.type === "identity") {
            ports.api.q("mmoWorkspaceNative").innerHTML = nativeLink(
                ports.api.q("mmoIdentityArtist").value,
                ports.api.q("mmoIdentityName").value,
                false,
            );
            for (const suffix of ["Artist", "Person", "Artists", "Persons"]) {
                const select = ports.api.q<HTMLSelectElement>("mmoIdentity" + suffix);
                let holder = ports.api.page.querySelector<HTMLElement>("#mmoNativeIdentity" + suffix);
                if (!holder) {
                    holder = document.createElement("div");
                    holder.id = "mmoNativeIdentity" + suffix;
                    select.closest<HTMLElement>("label")!.after(holder);
                }
                holder.innerHTML = [...select.selectedOptions]
                    .filter((o) => o.value)
                    .map((o) => nativeLink(o.value, o.textContent, false))
                    .join("");
            }
        } else if (session.navigation.ui.editor?.type === "rule") {
            ports.api.q("mmoWorkspaceNative").innerHTML = nativePathLink(
                ports.api.q("mmoPath").value,
                ports.api.q("mmoKind").value,
                session.navigation.ui.editor.name,
            );
        }
    }

    async function resolveNativeLinks() {
        if (session.nativeLinks.nativeLinkRunning || !ports.api.page.isConnected || !session.nativeLinks.nativeLinksActive) return;
        const epoch = session.nativeLinks.nativeLinkEpoch;
        session.nativeLinks.nativeLinkRunning = true;
        try {
            const slots = [...ports.api.page.querySelectorAll<HTMLElement>(".mmo-native-slot:not([data-native-resolved])")].slice(0, 20);
            if (!slots.length) return;
            slots.forEach((slot) => (slot.dataset.nativeResolved = "pending"));
            const ids = [...new Set(slots.map((s) => s.dataset.nativeId).filter(Boolean))];
            const rules = [...new Set(slots.map((s) => s.dataset.nativeRule).filter(Boolean))];
            const paths = slots
                .filter((s) => s.dataset.nativePath)
                .map((s) => ({ key: s.dataset.nativeKind + ":" + s.dataset.nativePath, path: s.dataset.nativePath, kind: s.dataset.nativeKind }));
            const data = await ports.api.api(
                `manager/navigation?${new URLSearchParams({ ids: ids.join(","), rules: rules.join(","), paths: JSON.stringify(paths) })}`,
            );
            if (!ports.api.page.isConnected || epoch !== session.nativeLinks.nativeLinkEpoch || !session.nativeLinks.nativeLinksActive) return;
            for (const slot of slots) {
                if (!slot.isConnected) continue;
                const target = slot.dataset.nativePath
                    ? data.paths[slot.dataset.nativeKind + ":" + slot.dataset.nativePath]
                    : slot.dataset.nativeRule
                      ? data.rules[slot.dataset.nativeRule]
                      : data.items[slot.dataset.nativeId!];
                const href = target && nativePageUrl(target.id);
                if (href) {
                    slot.innerHTML =
                        '<a class="emby-button button-flat mmo-native-link' +
                        (slot.dataset.nativeCompact === "true" ? " mmo-native-icon" : "") +
                        '" href="' +
                        ports.api.esc(href) +
                        '" target="_blank" rel="noopener" aria-label="' +
                        ports.api.esc(slot.dataset.nativeLabel) +
                        '" title="' +
                        ports.api.esc(slot.dataset.nativeLabel) +
                        '">' +
                        (slot.dataset.nativeCompact === "true"
                            ? '<span aria-hidden="true">↗</span>'
                            : 'Open in Jellyfin <span aria-hidden="true">↗</span>') +
                        "</a>";
                } else if (slot.dataset.nativeCompact !== "true")
                    slot.innerHTML = '<span class="secondaryText">Jellyfin page unavailable — record missing or target ambiguous.</span>';
            }
        } catch {
            if (epoch !== session.nativeLinks.nativeLinkEpoch || !session.nativeLinks.nativeLinksActive) return;
            // Navigation availability must never interfere with editors or mutations.
            ports.api.page.querySelectorAll<HTMLElement>('.mmo-native-slot[data-native-resolved="pending"]').forEach((slot) => {
                if (slot.dataset.nativeCompact !== "true") slot.textContent = "Jellyfin link unavailable. Reopen this view to retry.";
            });
        } finally {
            session.nativeLinks.nativeLinkRunning = false;
            if (
                session.nativeLinks.nativeLinksActive &&
                ports.api.page.isConnected &&
                ports.api.page.querySelector<HTMLElement>(".mmo-native-slot:not([data-native-resolved])")
            )
                scheduleNativeLinks();
        }
    }
    function scheduleNativeLinks() {
        if (session.nativeLinks.nativeLinkScheduled) return;
        session.nativeLinks.nativeLinkScheduled = true;
        queueMicrotask(() => {
            session.nativeLinks.nativeLinkScheduled = false;
            resolveNativeLinks();
        });
    }
    const nativeLinkObserver = new MutationObserver(scheduleNativeLinks);
    function nativeLinksRouteChanged() {
        if (!/configurationpage\?[^#]*name=musicmetadatamanager(?:&|$)/i.test(window.location.hash)) {
            session.nativeLinks.nativeLinksActive = false;
            session.nativeLinks.nativeLinkEpoch++;
            nativeLinkObserver.disconnect();
        }
    }
    const nativeLinksDetached = new MutationObserver(() => {
        if (!ports.api.page.isConnected) {
            session.nativeLinks.nativeLinksActive = false;
            session.nativeLinks.nativeLinkEpoch++;
            nativeLinkObserver.disconnect();
            nativeLinksDetached.disconnect();
            window.removeEventListener("hashchange", nativeLinksRouteChanged);
        }
    });
    return {
        initialize() {
            nativeLinkObserver.observe(ports.api.page, { childList: true, subtree: true });
            ports.api.page.addEventListener("change", (e) => {
                if (
                    ["mmoIdentityArtist", "mmoIdentityPerson", "mmoIdentityArtists", "mmoIdentityPersons", "mmoKind"].includes(
                        (e.target as HTMLElement).id,
                    )
                )
                    updateWorkspaceNativeLinks();
            });
            ports.api.page.addEventListener("input", (e) => {
                if ((e.target as HTMLElement).id === "mmoPath") updateWorkspaceNativeLinks();
            });
            for (const event of ["pagehide", "viewhide", "viewbeforehide"])
                ports.api.page.addEventListener(event, () => {
                    session.nativeLinks.nativeLinksActive = false;
                    session.nativeLinks.nativeLinkEpoch++;
                    nativeLinkObserver.disconnect();
                });
            ports.api.page.addEventListener("pageshow", () => {
                session.nativeLinks.nativeLinksActive = true;
                nativeLinkObserver.observe(ports.api.page, { childList: true, subtree: true });
                ports.api.page.querySelectorAll<HTMLElement>(".mmo-native-slot").forEach((s) => {
                    delete s.dataset.nativeResolved;
                    s.replaceChildren();
                });
                scheduleNativeLinks();
            });
            window.addEventListener("hashchange", nativeLinksRouteChanged);
            nativeLinksDetached.observe(document.documentElement, { childList: true, subtree: true });
        },
        get nativePageUrl() {
            return nativePageUrl;
        },
        get nativeLink() {
            return nativeLink;
        },
        get nativeRuleLink() {
            return nativeRuleLink;
        },
        get issueNativeLink() {
            return issueNativeLink;
        },
        get nativePathLink() {
            return nativePathLink;
        },
        get updateWorkspaceNativeLinks() {
            return updateWorkspaceNativeLinks;
        },

        get resolveNativeLinks() {
            return resolveNativeLinks;
        },
        get scheduleNativeLinks() {
            return scheduleNativeLinks;
        },
        get nativeLinkObserver() {
            return nativeLinkObserver;
        },
        get nativeLinksRouteChanged() {
            return nativeLinksRouteChanged;
        },
        get nativeLinksDetached() {
            return nativeLinksDetached;
        },
    };
}
