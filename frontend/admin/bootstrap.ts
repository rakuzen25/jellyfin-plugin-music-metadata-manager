import { operationError } from "./errors.ts";
import type { Features } from "./features.ts";
export function createBootstrap(features: Features) {
    // Navigation wiring and lifecycle. No audit or provider lookup runs on landing.
    const oldInvalidate = features.rules.invalidateReview;
    return {
        initialize() {
            features.rules.invalidateReview = function () {
                oldInvalidate();
                if (features.navigation.ui.screen === "review") features.actions.actions.setDisabled(features.api.q("mmoActivate"), true);
            };
            features.api.q("mmoNavigation").onclick = (e) => {
                const view = (e.target as HTMLElement).closest<HTMLElement>("[data-view]")?.dataset.view;
                if (view) features.api.perform(() => features.navigation.showDestination(view));
            };
            features.api.q("mmoWorkspaceBack").onclick = () => features.api.perform(features.navigation.workspaceBack);
            features.api.q("mmoItemThumbnail").onerror = () => {
                features.api.q("mmoItemThumbnail").hidden = true;
            };
            for (const id of ["mmoForm", "mmoIdentityForm"]) {
                features.api.q(id).addEventListener("input", () => features.navigation.markDirty());
                features.api.q(id).addEventListener("change", () => features.navigation.markDirty());
            }
            // Existing suggestion handlers mutate the form without firing input.
            features.api.q("mmoIdentitySuggestions").addEventListener("click", (e) => {
                if ((e.target as HTMLElement).closest<HTMLElement>("#mmoAcceptSuggestions")) features.navigation.markDirty();
            });
            features.api.q("mmoChoose").addEventListener("click", () => {
                features.navigation.markDirty();
                features.nativeLinks.updateWorkspaceNativeLinks();
            });
            features.api.q("mmoReload").onclick = () =>
                features.api.perform(async (operation) => {
                    const message = features.notifications.notifications.scope(operation);
                    await features.rules.load();
                    message("Status refreshed.");
                });
            features.api.q("mmoNew").onclick = () => features.api.perform(() => features.rules.edit(null));
            features.api.q("mmoNewIdentity").onclick = () => features.api.perform(() => features.identities.editIdentity(null));
            window.addEventListener("beforeunload", (e) => {
                if (!features.api.page.isConnected) return;
                features.navigation.captureEditor();
                if (features.navigation.ui.locals.size || features.managerUi.managerBatch.length || features.issues.repairQueue?.staged.size) {
                    e.preventDefault();
                    e.returnValue = "";
                }
            });
            features.api.page.addEventListener("pageshow", () =>
                features.api.perform(async (operation) => {
                    features.notifications.notifications.scope(operation);
                    if (features.api.page.dataset.mmoInitialized) return;
                    features.api.page.dataset.mmoInitialized = "true";
                    try {
                        features.navigation.normalizeControls();
                        const libs = await features.api.api("libraries");
                        features.api.q("mmoLibraries").innerHTML = libs
                            .map((x) => '<option value="' + features.api.esc(x.id) + '">' + features.api.esc(x.name) + "</option>")
                            .join("");
                        features.api.q("mmoIdentityLibraries").innerHTML = features.api.q("mmoLibraries").innerHTML;
                        features.api.q("mmoInventoryLibrary").innerHTML =
                            '<option value="">All music libraries</option>' + features.api.q("mmoLibraries").innerHTML;
                        await features.rules.load();
                        await features.managerUi.managerInventory();
                        await features.navigation.showDestination("library", false);
                    } catch (caughtError) {
                        const e = operationError(caughtError);
                        delete features.api.page.dataset.mmoInitialized;
                        throw e;
                    }
                }),
            );
            features.api.q("mmoWorkspaceTabs").addEventListener("keydown", (e) => {
                const tabs = [...features.api.q("mmoWorkspaceTabs").querySelectorAll<HTMLElement>("[data-item-tab]")];
                const current = tabs.indexOf(document.activeElement as HTMLElement);
                let next;
                if (e.key === "ArrowRight") next = (current + 1) % tabs.length;
                else if (e.key === "ArrowLeft") next = (current + tabs.length - 1) % tabs.length;
                else if (e.key === "Home") next = 0;
                else if (e.key === "End") next = tabs.length - 1;
                else return;
                e.preventDefault();
                tabs[next]!.focus();
                features.api.perform(() => features.managerUi.selectItemTab(tabs[next]!.dataset.itemTab!));
            });
        },
        get oldInvalidate() {
            return oldInvalidate;
        },
    };
}
