import type { ControllerContracts } from "./controllerContracts.ts";
import type { DashboardState } from "./dashboardState.ts";
export interface SourceComparisonDependencies {
    api: Pick<ControllerContracts["api"], "q" | "esc">;
    navigation: Pick<ControllerContracts["navigation"], "human" | "formatValue" | "nativeButton">;
}
export function createSourceComparison(ports: SourceComparisonDependencies, session: DashboardState) {
    function managerSourceChanged() {
        session.navigation.ui.comparisonRequest++;
        const o = ports.api.q("mmoManagerSourceProvider").selectedOptions[0];
        ports.api.q("mmoManagerSourceKey").value = o?.dataset.key || "";
        ports.api.q("mmoManagerSourceId").value =
            session.managerUi.managerDetails?.providerCandidates.find((x) => x.key === o?.dataset.key)?.recordId || "";
        ports.api.q("mmoManagerSourceConfirm").checked = false;
    }
    function renderComparison() {
        if (!session.managerUi.managerComparison) {
            ports.api.q("mmoManagerSourceResult").innerHTML = session.managerUi.managerDetails.providers.length
                ? ""
                : "<p>No installed remote metadata source supports this record type.</p>";
            return;
        }
        const s = session.managerUi.managerComparison.snapshot;
        ports.api.q("mmoManagerSourceResult").innerHTML =
            "<p>" +
            ports.api.esc(s.binding.provider) +
            " · " +
            ports.api.esc(s.binding.recordId) +
            " · retrieved " +
            ports.api.esc(new Date(s.retrievedAt).toLocaleString()) +
            "</p>" +
            session.managerUi.managerComparison.notes.map((n) => '<p class="secondaryText">' + ports.api.esc(n) + "</p>").join("") +
            Object.entries(s.offered)
                .filter(([field]) => field in session.managerUi.managerDetails.stored)
                .map(([field, value]) => {
                    const incompleteDate =
                        ["premiereDate", "endDate"].includes(field) && typeof value === "string" && !/^\d{4}-\d{2}-\d{2}(T.*)?$/.test(value);
                    const unavailable = value == null || value === "" || (Array.isArray(value) && !value.length);
                    return (
                        '<section class="mmo-field"><h4>' +
                        ports.api.esc(ports.navigation.human(field)) +
                        "</h4><p>Current: " +
                        ports.api.esc(ports.navigation.formatValue(session.managerUi.managerDetails.stored[field])) +
                        '</p><div class="mmo-diff"><div><strong>Source offers</strong><p>' +
                        ports.api.esc(ports.navigation.formatValue(value)) +
                        "</p></div><div><strong>Configured provider offers</strong><p>" +
                        ports.api.esc(ports.navigation.formatValue(s.configured[field])) +
                        "</p></div></div>" +
                        (incompleteDate
                            ? '<p class="secondaryText">This source date is incomplete. Use the known year, when offered, or enter a complete date manually.</p>'
                            : unavailable
                              ? '<p class="secondaryText">Unavailable from this source</p>'
                              : ports.navigation.nativeButton("Use in local edit", 'data-source-field="' + field + '"')) +
                        "</section>"
                    );
                })
                .join("") +
            session.managerUi.managerComparison.images
                .map(
                    (image, index) =>
                        '<div class="mmo-image-card"><h4>' +
                        ports.api.esc(image.type) +
                        " · " +
                        ports.api.esc(image.providerName || s.binding.provider) +
                        '</h4><img class="mmo-artwork" loading="lazy" src="' +
                        ports.api.esc(image.url) +
                        '" alt="Source artwork candidate" />' +
                        ports.navigation.nativeButton("Cache for review", 'data-source-image="' + index + '"') +
                        "</div>",
                )
                .join("");
    }
    return { managerSourceChanged, renderComparison };
}
