// Navigation wiring and lifecycle. No audit or provider lookup runs on landing.
const oldInvalidate = invalidateReview;
invalidateReview = function () {
  oldInvalidate();
  if (ui.screen === "review") actions.setDisabled(q("mmoActivate"), true);
};
q("mmoNavigation").onclick = (e) => {
  const view = e.target.closest("[data-view]")?.dataset.view;
  if (view) perform(() => showDestination(view));
};
q("mmoWorkspaceBack").onclick = () => perform(workspaceBack);
q("mmoItemThumbnail").onerror = () => {
  q("mmoItemThumbnail").hidden = true;
};
for (const id of ["mmoForm", "mmoIdentityForm"]) {
  q(id).addEventListener("input", () => markDirty());
  q(id).addEventListener("change", () => markDirty());
}
// Existing suggestion handlers mutate the form without firing input.
q("mmoIdentitySuggestions").addEventListener("click", (e) => {
  if (e.target.closest("#mmoAcceptSuggestions")) markDirty();
});
q("mmoChoose").addEventListener("click", () => { markDirty(); updateWorkspaceNativeLinks(); });
q("mmoReload").onclick = () =>
  perform(async (operation) => {
    const message = notifications.scope(operation);
    await load();
    message("Status refreshed.");
  });
q("mmoNew").onclick = () => perform(() => edit(null));
q("mmoNewIdentity").onclick = () => perform(() => editIdentity(null));
window.addEventListener("beforeunload", (e) => {
  if (!page.isConnected) return;
  captureEditor();
  if (ui.locals.size || managerBatch.length || repairQueue?.staged.size) {
    e.preventDefault();
    e.returnValue = "";
  }
});
page.addEventListener("pageshow", () =>
  perform(async (operation) => {
    const message = notifications.scope(operation);
    if (page.dataset.mmoInitialized) return;
    page.dataset.mmoInitialized = "true";
    try {
      normalizeControls();
      const libs = await api("libraries");
      q("mmoLibraries").innerHTML = libs
        .map(
          (x) =>
            '<option value="' + esc(x.id) + '">' + esc(x.name) + "</option>",
        )
        .join("");
      q("mmoIdentityLibraries").innerHTML = q("mmoLibraries").innerHTML;
      q("mmoInventoryLibrary").innerHTML =
        '<option value="">All music libraries</option>' +
        q("mmoLibraries").innerHTML;
      await load();
      await managerInventory();
      await showDestination("library", false);
    } catch (e) {
      delete page.dataset.mmoInitialized;
      throw e;
    }
  }),
);
q("mmoWorkspaceTabs").addEventListener("keydown", (e) => {
  const tabs = [...q("mmoWorkspaceTabs").querySelectorAll("[data-item-tab]")];
  const current = tabs.indexOf(document.activeElement);
  let next;
  if (e.key === "ArrowRight") next = (current + 1) % tabs.length;
  else if (e.key === "ArrowLeft")
    next = (current + tabs.length - 1) % tabs.length;
  else if (e.key === "Home") next = 0;
  else if (e.key === "End") next = tabs.length - 1;
  else return;
  e.preventDefault();
  tabs[next].focus();
  perform(() => selectItemTab(tabs[next].dataset.itemTab));
});
