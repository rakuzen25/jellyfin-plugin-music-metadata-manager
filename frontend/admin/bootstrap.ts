import { operationError } from "./errors.ts";
import type { ControllerContracts } from "./controllerContracts.ts";
import type { DashboardState } from "./dashboardState.ts";
export interface BootstrapDependencies {
    rules: Pick<ControllerContracts["rules"], "edit" | "invalidateReview" | "load">;
    actions: Pick<ControllerContracts["actions"], "actions">;
    api: Pick<ControllerContracts["api"], "api" | "esc" | "page" | "perform" | "q">;
    navigation: Pick<ControllerContracts["navigation"], "captureEditor" | "markDirty" | "normalizeControls" | "showDestination" | "workspaceBack">;
    nativeLinks: Pick<ControllerContracts["nativeLinks"], "updateWorkspaceNativeLinks">;
    notifications: Pick<ControllerContracts["notifications"], "notifications">;
    identities: Pick<ControllerContracts["identities"], "editIdentity">;
    managerUi: Pick<ControllerContracts["managerUi"], "managerInventory" | "selectItemTab">;
}
export function createBootstrap(ports: BootstrapDependencies, session: DashboardState) {
    // Navigation wiring and lifecycle. No audit or provider lookup runs on landing.
    const oldInvalidate = ports.rules.invalidateReview;
    return {
        initialize() {
            ports.rules.invalidateReview = function () {
                oldInvalidate();
                if (session.navigation.ui.screen === "review") ports.actions.actions.setDisabled(ports.api.q("mmoActivate"), true);
            };
            ports.api.q("mmoNavigation").onclick = (e) => {
                const view = (e.target as HTMLElement).closest<HTMLElement>("[data-view]")?.dataset.view;
                if (view) ports.api.perform(() => ports.navigation.showDestination(view));
            };
            ports.api.q("mmoWorkspaceBack").onclick = () => ports.api.perform(ports.navigation.workspaceBack);
            ports.api.q("mmoItemThumbnail").onerror = () => {
                ports.api.q("mmoItemThumbnail").hidden = true;
            };
            for (const id of ["mmoForm", "mmoIdentityForm"]) {
                ports.api.q(id).addEventListener("input", () => ports.navigation.markDirty());
                ports.api.q(id).addEventListener("change", () => ports.navigation.markDirty());
            }
            // Existing suggestion handlers mutate the form without firing input.
            ports.api.q("mmoIdentitySuggestions").addEventListener("click", (e) => {
                if ((e.target as HTMLElement).closest<HTMLElement>("#mmoAcceptSuggestions")) ports.navigation.markDirty();
            });
            ports.api.q("mmoChoose").addEventListener("click", () => {
                ports.navigation.markDirty();
                ports.nativeLinks.updateWorkspaceNativeLinks();
            });
            ports.api.q("mmoReload").onclick = () =>
                ports.api.perform(async (operation) => {
                    const message = ports.notifications.notifications.scope(operation);
                    await ports.rules.load();
                    message("Status refreshed.");
                });
            ports.api.q("mmoNew").onclick = () => ports.api.perform(() => ports.rules.edit(null));
            ports.api.q("mmoNewIdentity").onclick = () => ports.api.perform(() => ports.identities.editIdentity(null));
            window.addEventListener("beforeunload", (e) => {
                if (!ports.api.page.isConnected) return;
                ports.navigation.captureEditor();
                if (session.navigation.ui.locals.size || session.managerUi.managerBatch.length || session.issues.repairQueue?.staged.size) {
                    e.preventDefault();
                    e.returnValue = "";
                }
            });
            ports.api.page.addEventListener("pageshow", () =>
                ports.api.perform(async (operation) => {
                    ports.notifications.notifications.scope(operation);
                    if (ports.api.page.dataset.mmoInitialized) return;
                    ports.api.page.dataset.mmoInitialized = "true";
                    try {
                        ports.navigation.normalizeControls();
                        const libs = await ports.api.api("libraries");
                        session.api.fieldDefinitions = await ports.api.api("manager/fields");
                        ports.api.q("mmoLibraries").innerHTML = libs
                            .map((x) => '<option value="' + ports.api.esc(x.id) + '">' + ports.api.esc(x.name) + "</option>")
                            .join("");
                        ports.api.q("mmoIdentityLibraries").innerHTML = ports.api.q("mmoLibraries").innerHTML;
                        ports.api.q("mmoInventoryLibrary").innerHTML =
                            '<option value="">All music libraries</option>' + ports.api.q("mmoLibraries").innerHTML;
                        await ports.rules.load();
                        await ports.managerUi.managerInventory();
                        await ports.navigation.showDestination("library", false);
                    } catch (caughtError) {
                        const e = operationError(caughtError);
                        delete ports.api.page.dataset.mmoInitialized;
                        throw e;
                    }
                }),
            );
            ports.api.q("mmoWorkspaceTabs").addEventListener("keydown", (e) => {
                const tabs = [...ports.api.q("mmoWorkspaceTabs").querySelectorAll<HTMLElement>("[data-item-tab]")];
                const current = tabs.indexOf(document.activeElement as HTMLElement);
                let next;
                if (e.key === "ArrowRight") next = (current + 1) % tabs.length;
                else if (e.key === "ArrowLeft") next = (current + tabs.length - 1) % tabs.length;
                else if (e.key === "Home") next = 0;
                else if (e.key === "End") next = tabs.length - 1;
                else return;
                e.preventDefault();
                tabs[next]!.focus();
                ports.api.perform(() => ports.managerUi.selectItemTab(tabs[next]!.dataset.itemTab!));
            });
        },
        get oldInvalidate() {
            return oldInvalidate;
        },
    };
}
