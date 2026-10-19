// A single top-layer action menu keeps expanded actions out of list layout.
let rowMenuTrigger = null,
  rowMenuCommands = [];
function closeRowMenu(restoreFocus = false) {
  const menu = q("mmoRowMenu"),
    trigger = rowMenuTrigger;
  if (menu.matches(":popover-open")) menu.hidePopover();
  if (trigger) trigger.setAttribute("aria-expanded", "false");
  rowMenuTrigger = null;
  if (restoreFocus && trigger?.isConnected) trigger.focus();
}
page.addEventListener("click", (event) => {
  const trigger = event.target.closest("[data-actions-open]");
  if (!trigger) return;
  if (rowMenuTrigger === trigger) {
    closeRowMenu(true);
    return;
  }
  closeRowMenu();
  const row = trigger.closest(".mmo-row, .mmo-editor-actions"),
    menu = q("mmoRowMenu");
  rowMenuTrigger = trigger;
  rowMenuCommands = [...row.querySelectorAll("[data-row-actions] button")];
  q("mmoRowMenuTitle").textContent =
    row.querySelector("strong")?.textContent || "Actions";
  q("mmoRowMenuButtons").innerHTML = rowMenuCommands
    .map((button, index) =>
      nativeButton(
        button.textContent,
        'data-menu-command="' +
          index +
          '"' +
          (button.disabled ? " disabled" : ""),
      ),
    )
    .join("");
  // Derive the opaque surface from the native theme, including older theme builds.
  const surface = [page, document.body, document.documentElement]
    .map((node) => getComputedStyle(node).backgroundColor)
    .find((color) => color !== "rgba(0, 0, 0, 0)" && color !== "transparent");
  if (surface) menu.style.backgroundColor = surface;
  menu.style.color = getComputedStyle(page).color;
  menu.showPopover();
  const rect = trigger.getBoundingClientRect(),
    bounds = menu.getBoundingClientRect();
  menu.style.left =
    Math.max(
      8,
      Math.min(innerWidth - bounds.width - 8, rect.right - bounds.width),
    ) + "px";
  menu.style.top =
    Math.max(8, Math.min(innerHeight - bounds.height - 8, rect.bottom + 4)) +
    "px";
  trigger.setAttribute("aria-expanded", "true");
  menu.querySelector("button:not(:disabled)")?.focus();
});
q("mmoRowMenu").addEventListener("click", (event) => {
  const command = event.target.closest("[data-menu-command]");
  if (!command) return;
  const original = rowMenuCommands[Number(command.dataset.menuCommand)];
  closeRowMenu(true);
  if (original?.isConnected && !original.disabled) original.click();
});
q("mmoRowMenu").addEventListener("toggle", (event) => {
  if (event.newState === "closed" && rowMenuTrigger) closeRowMenu(true);
});
q("mmoRowMenu").addEventListener("keydown", (event) => {
  const buttons = [
    ...q("mmoRowMenu").querySelectorAll("button:not(:disabled)"),
  ];
  let index = buttons.indexOf(document.activeElement);
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
        : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) %
          buttons.length;
  buttons[index]?.focus();
});
