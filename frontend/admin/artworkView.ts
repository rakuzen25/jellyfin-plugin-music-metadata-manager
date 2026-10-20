import type { ControllerContracts } from "./controllerContracts.ts";
import type { DashboardState } from "./dashboardState.ts";
export interface ArtworkViewDependencies {
    api: Pick<ControllerContracts["api"], "q" | "esc">;
    navigation: Pick<ControllerContracts["navigation"], "nativeImage" | "nativeButton" | "hydratePins">;
}
export function createArtworkView(ports: ArtworkViewDependencies, session: DashboardState) {
    function renderManagerImages() {
        const types = [
            ...new Set([
                "Primary",
                ...session.managerUi.managerDetails.images.map((i) => i.type),
                ...Object.keys(session.managerUi.managerPolicy.images),
            ]),
        ];
        ports.api.q("mmoManagerImages").innerHTML = types
            .map((type) => {
                const d = session.managerUi.managerPolicy.images[type],
                    current = session.managerUi.managerDetails.images.some((i) => i.type === type);
                const approved = d?.mode === "approved",
                    status = approved ? "Approved replacement" : d?.mode === "empty" ? "Explicitly empty" : "Unmanaged";
                return (
                    '<div class="mmo-image-card"><h4>' +
                    ports.api.esc(type) +
                    "</h4><p>" +
                    status +
                    '</p><div class="mmo-image-pair"><figure><figcaption>Current</figcaption>' +
                    (current
                        ? '<img class="mmo-artwork" src="' +
                          ports.api.esc(ports.navigation.nativeImage(session.managerUi.managerDetails.id, type)) +
                          '" alt="Current ' +
                          ports.api.esc(type) +
                          '" />'
                        : "<p>No image</p>") +
                    "</figure>" +
                    (d
                        ? "<figure><figcaption>Proposed / approved</figcaption>" +
                          (approved
                              ? '<img class="mmo-artwork" data-pin-image="' +
                                ports.api.esc(d.hash) +
                                '" alt="Selected ' +
                                ports.api.esc(type) +
                                '" />'
                              : "<p>" + ports.api.esc(d.mode === "empty" ? "Kept empty" : "Jellyfin controls images") + "</p>") +
                          "</figure>"
                        : "") +
                    '</div><div class="mmo-actions">' +
                    (current ? ports.navigation.nativeButton("Keep current", 'data-image-current="' + type + '"') : "") +
                    ports.navigation.nativeButton("Keep empty", 'data-image-empty="' + type + '"') +
                    ports.navigation.nativeButton("Stop managing", 'data-image-unmanage="' + type + '"') +
                    "</div>" +
                    (approved
                        ? "<details><summary>Approval details</summary><p>SHA256 " +
                          ports.api.esc(d.hash) +
                          "</p><p>" +
                          ports.api.esc(d.sourceUrl || "Locally selected image") +
                          "</p></details>"
                        : "") +
                    "</div>"
                );
            })
            .join("");
        ports.navigation.hydratePins(ports.api.q("mmoManagerImages"));
    }
    return { renderManagerImages };
}
