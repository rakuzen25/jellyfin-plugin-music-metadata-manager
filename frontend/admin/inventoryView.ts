import { operationError } from "./errors.ts";

import type { ControllerContracts } from "./controllerContracts.ts";
import type { DashboardState } from "./dashboardState.ts";
export interface InventoryViewDependencies {
    api: Pick<ControllerContracts["api"], "q" | "api" | "esc">;
    rowMenu: Pick<ControllerContracts["rowMenu"], "closeRowMenu">;
    table: Pick<ControllerContracts["table"], "tableMessage" | "tablePageSize" | "tablePagination" | "tableRow" | "libraryTableColumns">;
    navigation: Pick<ControllerContracts["navigation"], "nativeButton">;
    nativeLinks: Pick<ControllerContracts["nativeLinks"], "nativeLink">;
}
export function createInventoryView(ports: InventoryViewDependencies, session: DashboardState) {
    async function managerInventory() {
        const serial = ++session.navigation.ui.inventoryRequest;
        ports.api.q("mmoInventoryCount").textContent = "";
        ports.rowMenu.closeRowMenu();
        ports.api.q("mmoInventoryRows").innerHTML = ports.table.tableMessage("Loading music…");
        const params = new URLSearchParams({
            search: ports.api.q("mmoInventorySearch").value,
            start: String(session.managerUi.managerStart),
            limit: String(ports.table.tablePageSize),
            view: ports.api.q("mmoInventoryView").value,
        });
        if (ports.api.q("mmoInventoryLibrary").value) params.set("library", ports.api.q("mmoInventoryLibrary").value);
        const kind = ports.api.q("mmoInventoryKind").value;
        // Native mode still permits the combined Artists filter.
        if (kind) params.set("kind", kind);
        try {
            const result = await ports.api.api(`manager/inventory?${params}`);
            if (serial !== session.navigation.ui.inventoryRequest) return;
            ports.table.tablePagination(session.managerUi.managerStart, result.total, {
                count: "mmoInventoryCount",
                previous: "mmoInventoryPrev",
                next: "mmoInventoryNext",
                note: result.view === "grouped" ? "grouped artist identities" : "native records",
            });
            const items = result.items;
            ports.api.q("mmoInventoryRows").innerHTML =
                items
                    .map((x) => {
                        const identity = x.kind === "identity";
                        const open = identity
                            ? 'data-inventory-identity="' + ports.api.esc(x.identityId) + '"'
                            : 'data-manager-item="' + ports.api.esc(x.id) + '"';
                        const state = x.managed || identity ? "Managed" : "Unmanaged";
                        const links = identity
                            ? "<details><summary>" +
                              x.records.length +
                              " linked native records</summary>" +
                              x.records
                                  .map(
                                      (r) =>
                                          "<p>" +
                                          ports.navigation.nativeButton(
                                              r.name + " · " + r.kind + (r.representative ? " · representative" : ""),
                                              'data-manager-item="' + ports.api.esc(r.id) + '"',
                                          ) +
                                          ports.nativeLinks.nativeLink(r.id, r.name) +
                                          "</p>",
                                  )
                                  .join("") +
                              "</details>"
                            : "";
                        return ports.table.tableRow({
                            name: x.name,
                            columns: ports.table.libraryTableColumns,
                            description: x.path || "",
                            type: identity
                                ? "Artist identity"
                                : {
                                      album: "Album",
                                      track: "Track",
                                      MusicArtist: "MusicArtist record",
                                      Person: "Person record",
                                  }[x.kind] || x.kind,
                            status: x.missingBinding ? "Missing binding" : state,
                            details:
                                (identity ? "<p>Aliases: " + ports.api.esc((x.aliases || []).join(", ")) + "</p>" : "") +
                                (x.missingBinding
                                    ? '<p class="mmo-warning">A representative is missing. Rebind the identity before applying changes.</p>'
                                    : "") +
                                links,
                            primary: ports.navigation.nativeButton(identity ? "Edit" : "Open", open),
                            native: ports.nativeLinks.nativeLink(x.id, x.name),
                        });
                    })
                    .join("") || ports.table.tableMessage("No music matches these filters.");
        } catch (caughtError) {
            const e = operationError(caughtError);
            if (serial !== session.navigation.ui.inventoryRequest) return;
            ports.api.q("mmoInventoryCount").textContent = "";
            ports.api.q("mmoInventoryRows").innerHTML = ports.table.tableMessage("Could not load music. Use Find to retry.");
            e.noticeHandled = true;
            throw e;
        }
    }
    async function loadAlbumTracks() {
        const id = session.managerUi.managerDetails.id,
            serial = session.navigation.ui.request;
        ports.api.q("mmoAlbumTracks").textContent = "Loading tracks…";
        const result = await ports.api.api(`manager/items/${id}/tracks`);
        if (serial !== session.navigation.ui.request || session.managerUi.managerDetails.id !== id) return;
        ports.api.q("mmoAlbumTracks").innerHTML =
            result.items
                .map(
                    (t) =>
                        '<div class="mmo-row"><div class="mmo-track-number">Disc ' +
                        ports.api.esc(t.discNumber ?? "—") +
                        " · " +
                        ports.api.esc(t.trackNumber ?? "—") +
                        '</div><div class="mmo-row-main">' +
                        ports.navigation.nativeButton(t.name, 'data-track-item="' + t.id + '"') +
                        ports.nativeLinks.nativeLink(t.id, t.name) +
                        '<p class="secondaryText">' +
                        ports.api.esc(t.artists.join(", ")) +
                        (t.managed ? " · Managed" : "") +
                        "</p></div></div>",
                )
                .join("") || "<p>No child tracks.</p>";
    }
    return { managerInventory, loadAlbumTracks };
}
