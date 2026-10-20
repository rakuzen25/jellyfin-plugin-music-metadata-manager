import type { ControllerContracts } from "./controllerContracts.ts";
import type { DashboardState } from "./dashboardState.ts";
export interface RowMenuDependencies {
    api: Pick<ControllerContracts["api"], "page" | "q">;
    navigation: Pick<ControllerContracts["navigation"], "nativeButton">;
}
export function createRowMenu(ports: RowMenuDependencies, session: DashboardState) {
    // A single top-layer action menu keeps expanded actions out of list layout.

    function closeRowMenu(restoreFocus = false) {
        const menu = ports.api.q("mmoRowMenu"),
            trigger = session.rowMenu.rowMenuTrigger;
        if (menu.matches(":popover-open")) menu.hidePopover();
        if (trigger) trigger.setAttribute("aria-expanded", "false");
        session.rowMenu.rowMenuTrigger = null;
        if (restoreFocus && trigger?.isConnected) trigger.focus();
    }
    return {
        initialize() {
            ports.api.page.addEventListener("click", (event) => {
                const trigger = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-actions-open]");
                if (!trigger) return;
                if (session.rowMenu.rowMenuTrigger === trigger) {
                    closeRowMenu(true);
                    return;
                }
                closeRowMenu();
                const row = trigger.closest<HTMLElement>(".mmo-row, .mmo-editor-actions"),
                    menu = ports.api.q("mmoRowMenu");
                session.rowMenu.rowMenuTrigger = trigger;
                session.rowMenu.rowMenuCommands = [...row!.querySelectorAll<HTMLButtonElement>("[data-row-actions] button")];
                ports.api.q("mmoRowMenuTitle").textContent = row!.querySelector<HTMLElement>("strong")?.textContent || "Actions";
                ports.api.q("mmoRowMenuButtons").innerHTML = session.rowMenu.rowMenuCommands
                    .map((button, index) =>
                        ports.navigation.nativeButton(button.textContent, 'data-menu-command="' + index + '"' + (button.disabled ? " disabled" : "")),
                    )
                    .join("");
                // Derive the opaque surface from the native theme, including older theme builds.
                const surface = [ports.api.page, document.body, document.documentElement]
                    .map((node) => getComputedStyle(node).backgroundColor)
                    .find((color) => color !== "rgba(0, 0, 0, 0)" && color !== "transparent");
                if (surface) menu.style.backgroundColor = surface;
                menu.style.color = getComputedStyle(ports.api.page).color;
                menu.showPopover();
                const rect = trigger.getBoundingClientRect(),
                    bounds = menu.getBoundingClientRect();
                menu.style.left = Math.max(8, Math.min(innerWidth - bounds.width - 8, rect.right - bounds.width)) + "px";
                menu.style.top = Math.max(8, Math.min(innerHeight - bounds.height - 8, rect.bottom + 4)) + "px";
                trigger.setAttribute("aria-expanded", "true");
                menu.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
            });
            ports.api.q("mmoRowMenu").addEventListener("click", (event) => {
                const command = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-menu-command]");
                if (!command) return;
                const original = session.rowMenu.rowMenuCommands[Number(command.dataset.menuCommand)];
                closeRowMenu(true);
                if (original?.isConnected && !original.disabled) original.click();
            });
            ports.api.q("mmoRowMenu").addEventListener("toggle", (event) => {
                if (event.newState === "closed" && session.rowMenu.rowMenuTrigger) closeRowMenu(true);
            });
            ports.api.q("mmoRowMenu").addEventListener("keydown", (event) => {
                const buttons = [...ports.api.q("mmoRowMenu").querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
                let index = buttons.indexOf(document.activeElement as HTMLButtonElement);
                if (event.key === "Escape") {
                    event.preventDefault();
                    closeRowMenu(true);
                    return;
                }
                if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
                event.preventDefault();
                index =
                    event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? buttons.length - 1
                          : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
                buttons[index]?.focus();
            });
        },

        get closeRowMenu() {
            return closeRowMenu;
        },
    };
}
