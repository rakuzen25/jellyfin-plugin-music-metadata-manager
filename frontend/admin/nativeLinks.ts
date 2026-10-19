import type { Rule } from "./contracts.ts";
import type { Issue } from "./responses.ts";
import type { Features } from "./features.ts";
export function createNativeLinks(features: Features) {
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
            features.api.esc(id || "") +
            '"' +
            (ruleId ? ' data-native-rule="' + features.api.esc(ruleId) + '"' : "") +
            ' data-native-label="' +
            features.api.esc(label) +
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
        const identity = issue.guidance?.evidence?.identity || features.api.doc?.identities?.find((i) => i.id === issue.identityId);
        if (identity) return nativeLink(identity.artistId, identity.preferredName, compact);
        if (issue.type === "unmatched") return nativeRuleLink(issue.context, compact);
        const item = issue.guidance?.evidence?.items?.[0];
        return nativeLink(item?.id, item?.name, compact);
    }
    function nativePathLink(path: unknown, kind: string, name: string | undefined, compact = false) {
        if (!path || !["track", "album"].includes(kind)) return "";
        return nativeLink(null, name, compact, "path").replace(
            ' data-native-rule="path"',
            ' data-native-path="' + features.api.esc(path) + '" data-native-kind="' + kind + '"',
        );
    }
    function updateWorkspaceNativeLinks() {
        if (features.navigation.ui.screen !== "workspace") return;
        if (features.navigation.ui.editor?.type === "identity") {
            features.api.q("mmoWorkspaceNative").innerHTML = nativeLink(
                features.api.q("mmoIdentityArtist").value,
                features.api.q("mmoIdentityName").value,
                false,
            );
            for (const suffix of ["Artist", "Person", "Artists", "Persons"]) {
                const select = features.api.q<HTMLSelectElement>("mmoIdentity" + suffix);
                let holder = features.api.page.querySelector<HTMLElement>("#mmoNativeIdentity" + suffix);
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
        } else if (features.navigation.ui.editor?.type === "rule") {
            features.api.q("mmoWorkspaceNative").innerHTML = nativePathLink(
                features.api.q("mmoPath").value,
                features.api.q("mmoKind").value,
                features.navigation.ui.editor.name,
            );
        }
    }
    let nativeLinkScheduled = false,
        nativeLinkRunning = false,
        nativeLinkEpoch = 0,
        nativeLinksActive = true;
    async function resolveNativeLinks() {
        if (nativeLinkRunning || !features.api.page.isConnected || !nativeLinksActive) return;
        const epoch = nativeLinkEpoch;
        nativeLinkRunning = true;
        try {
            const slots = [...features.api.page.querySelectorAll<HTMLElement>(".mmo-native-slot:not([data-native-resolved])")].slice(0, 20);
            if (!slots.length) return;
            slots.forEach((slot) => (slot.dataset.nativeResolved = "pending"));
            const ids = [...new Set(slots.map((s) => s.dataset.nativeId).filter(Boolean))];
            const rules = [...new Set(slots.map((s) => s.dataset.nativeRule).filter(Boolean))];
            const paths = slots
                .filter((s) => s.dataset.nativePath)
                .map((s) => ({ key: s.dataset.nativeKind + ":" + s.dataset.nativePath, path: s.dataset.nativePath, kind: s.dataset.nativeKind }));
            const data = await features.api.api(
                `manager/navigation?${new URLSearchParams({ ids: ids.join(","), rules: rules.join(","), paths: JSON.stringify(paths) })}`,
            );
            if (!features.api.page.isConnected || epoch !== nativeLinkEpoch || !nativeLinksActive) return;
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
                        features.api.esc(href) +
                        '" target="_blank" rel="noopener" aria-label="' +
                        features.api.esc(slot.dataset.nativeLabel) +
                        '" title="' +
                        features.api.esc(slot.dataset.nativeLabel) +
                        '">' +
                        (slot.dataset.nativeCompact === "true"
                            ? '<span aria-hidden="true">↗</span>'
                            : 'Open in Jellyfin <span aria-hidden="true">↗</span>') +
                        "</a>";
                } else if (slot.dataset.nativeCompact !== "true")
                    slot.innerHTML = '<span class="secondaryText">Jellyfin page unavailable — record missing or target ambiguous.</span>';
            }
        } catch {
            if (epoch !== nativeLinkEpoch || !nativeLinksActive) return;
            // Navigation availability must never interfere with editors or mutations.
            features.api.page.querySelectorAll<HTMLElement>('.mmo-native-slot[data-native-resolved="pending"]').forEach((slot) => {
                if (slot.dataset.nativeCompact !== "true") slot.textContent = "Jellyfin link unavailable. Reopen this view to retry.";
            });
        } finally {
            nativeLinkRunning = false;
            if (
                nativeLinksActive &&
                features.api.page.isConnected &&
                features.api.page.querySelector<HTMLElement>(".mmo-native-slot:not([data-native-resolved])")
            )
                scheduleNativeLinks();
        }
    }
    function scheduleNativeLinks() {
        if (nativeLinkScheduled) return;
        nativeLinkScheduled = true;
        queueMicrotask(() => {
            nativeLinkScheduled = false;
            resolveNativeLinks();
        });
    }
    const nativeLinkObserver = new MutationObserver(scheduleNativeLinks);
    function nativeLinksRouteChanged() {
        if (!/configurationpage\?[^#]*name=musicmetadatamanager(?:&|$)/i.test(window.location.hash)) {
            nativeLinksActive = false;
            nativeLinkEpoch++;
            nativeLinkObserver.disconnect();
        }
    }
    const nativeLinksDetached = new MutationObserver(() => {
        if (!features.api.page.isConnected) {
            nativeLinksActive = false;
            nativeLinkEpoch++;
            nativeLinkObserver.disconnect();
            nativeLinksDetached.disconnect();
            window.removeEventListener("hashchange", nativeLinksRouteChanged);
        }
    });
    return {
        initialize() {
            nativeLinkObserver.observe(features.api.page, { childList: true, subtree: true });
            features.api.page.addEventListener("change", (e) => {
                if (
                    ["mmoIdentityArtist", "mmoIdentityPerson", "mmoIdentityArtists", "mmoIdentityPersons", "mmoKind"].includes(
                        (e.target as HTMLElement).id,
                    )
                )
                    updateWorkspaceNativeLinks();
            });
            features.api.page.addEventListener("input", (e) => {
                if ((e.target as HTMLElement).id === "mmoPath") updateWorkspaceNativeLinks();
            });
            for (const event of ["pagehide", "viewhide", "viewbeforehide"])
                features.api.page.addEventListener(event, () => {
                    nativeLinksActive = false;
                    nativeLinkEpoch++;
                    nativeLinkObserver.disconnect();
                });
            features.api.page.addEventListener("pageshow", () => {
                nativeLinksActive = true;
                nativeLinkObserver.observe(features.api.page, { childList: true, subtree: true });
                features.api.page.querySelectorAll<HTMLElement>(".mmo-native-slot").forEach((s) => {
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
        get nativeLinkScheduled() {
            return nativeLinkScheduled;
        },
        set nativeLinkScheduled(value: typeof nativeLinkScheduled) {
            nativeLinkScheduled = value;
        },
        get nativeLinkRunning() {
            return nativeLinkRunning;
        },
        set nativeLinkRunning(value: typeof nativeLinkRunning) {
            nativeLinkRunning = value;
        },
        get nativeLinkEpoch() {
            return nativeLinkEpoch;
        },
        set nativeLinkEpoch(value: typeof nativeLinkEpoch) {
            nativeLinkEpoch = value;
        },
        get nativeLinksActive() {
            return nativeLinksActive;
        },
        set nativeLinksActive(value: typeof nativeLinksActive) {
            nativeLinksActive = value;
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
