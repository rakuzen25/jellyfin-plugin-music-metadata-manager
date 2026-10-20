import type { ControllerContracts } from "./controllerContracts.ts";
export interface TableDependencies {
    api: Pick<ControllerContracts["api"], "esc" | "page" | "q">;
    navigation: Pick<ControllerContracts["navigation"], "nativeButton">;
}
type Column = [label: string, key: "name" | "type" | "status" | "actions"];
interface Pagination {
    count: string;
    previous: string;
    next: string;
    noun?: string;
    note?: string;
}
interface TableOptions {
    name: string;
    selectable?: boolean;
    bodies: string[];
    emptyId?: string;
    pagination: Pagination;
    columns?: Column[];
}
interface TableRowOptions {
    name: string;
    type: string;
    status?: string;
    attributes?: string;
    selection?: string;
    description?: string;
    details?: string;
    detailLabel?: string;
    primary?: string;
    native?: string;
    actions?: string;
    columns?: Column[];
}
export function createTable(ports: TableDependencies) {
    // Shared presentation for the three inventory/management tables. Selection and
    // mutation state remain owned by their existing destination controllers.
    const tablePageSize = 12;
    const defaultTableColumns: Column[] = [
        ["Name", "name"],
        ["Type", "type"],
        ["Status", "status"],
        ["Actions", "actions"],
    ];
    const issueTableColumns: Column[] = [
        ["Name", "name"],
        ["Finding", "type"],
        ["Next step", "actions"],
    ];
    const libraryTableColumns: Column[] = [
        ["Name", "name"],
        ["Type", "type"],
        ["Metadata", "status"],
        ["Actions", "actions"],
    ];
    function mountTable(id: string, { name, selectable = false, bodies, emptyId, pagination, columns = defaultTableColumns }: TableOptions) {
        const visibleColumns: [string, string][] = [...(selectable ? [["Select", "select"] as [string, string]] : []), ...columns];
        ports.api.q(id).innerHTML =
            '<table class="mmo-data-table' +
            (selectable ? " mmo-table-selectable" : "") +
            '" role="table" aria-label="' +
            ports.api.esc(name) +
            '"><colgroup>' +
            visibleColumns.map(([, key]) => '<col class="mmo-col-' + key + '" />').join("") +
            '</colgroup><thead role="rowgroup"><tr role="row">' +
            visibleColumns
                .map(
                    ([label, key]) =>
                        '<th scope="col" role="columnheader">' + (key === "select" ? '<span class="mmo-sr-only">Select</span>' : label) + "</th>",
                )
                .join("") +
            "</tr></thead>" +
            bodies
                .map(
                    (body, index) =>
                        '<tbody id="' +
                        body +
                        '" role="rowgroup">' +
                        (index === 0 ? tableMessage("Loading " + name.toLowerCase() + "…", selectable, visibleColumns.length) : "") +
                        "</tbody>",
                )
                .join("") +
            (emptyId
                ? '<tbody id="' + emptyId + '" role="rowgroup" hidden>' + tableMessage("No rules match these filters.", selectable) + "</tbody>"
                : "") +
            '</table><div class="mmo-table-footer"><p id="' +
            pagination.count +
            '" role="status"></p><nav class="mmo-actions mmo-pagination" aria-label="' +
            ports.api.esc(name) +
            ' pages">' +
            ports.navigation.nativeButton("Previous", 'id="' + pagination.previous + '" disabled') +
            ports.navigation.nativeButton("Next", 'id="' + pagination.next + '" disabled') +
            "</nav></div>";
    }
    function tableMessage(text: string, selectable = false, columnCount = 4) {
        return (
            '<tr class="mmo-table-message" role="row"><td role="cell" colspan="' +
            (columnCount + (selectable ? 1 : 0)) +
            '"><p role="status">' +
            ports.api.esc(text) +
            "</p></td></tr>"
        );
    }
    function tableRow({
        name,
        type,
        status = "",
        attributes = "",
        selection = "",
        description = "",
        details = "",
        detailLabel = "Details",
        primary = "",
        native = "",
        actions = "",
        columns = defaultTableColumns,
    }: TableRowOptions) {
        const menuActions = actions + (details ? ports.navigation.nativeButton("Show details", "data-table-details") : "");
        const cells = {
            name:
                "<strong>" +
                ports.api.esc(name) +
                "</strong>" +
                (description ? '<p class="secondaryText mmo-row-description">' + ports.api.esc(description) + "</p>" : "") +
                (details ? "<details data-table-details-panel><summary>" + ports.api.esc(detailLabel) + "</summary>" + details + "</details>" : ""),
            type: ports.api.esc(type),
            status: '<span class="mmo-status-badge">' + ports.api.esc(status) + "</span>",
            actions:
                '<div class="mmo-row-actions">' +
                primary +
                native +
                (menuActions
                    ? ports.navigation.nativeButton(
                          "⋮",
                          'data-actions-open aria-label="Actions for ' +
                              ports.api.esc(name) +
                              '" title="Actions" aria-haspopup="true" aria-expanded="false"',
                      ) +
                      "<div data-row-actions hidden>" +
                      menuActions +
                      "</div>"
                    : "") +
                "</div>",
        };
        return (
            '<tr class="mmo-row" role="row" ' +
            attributes +
            ">" +
            (selection ? '<td class="mmo-table-select" role="cell">' + selection + "</td>" : "") +
            columns
                .map(
                    ([label, key]) =>
                        '<td class="' +
                        (key === "name" ? "mmo-row-main" : "") +
                        '" role="cell" data-label="' +
                        ports.api.esc(label) +
                        '">' +
                        cells[key] +
                        "</td>",
                )
                .join("") +
            "</tr>"
        );
    }
    function tableCheckbox(name: string, attribute: string, { checked = false, disabled = false } = {}) {
        return (
            '<label class="emby-checkbox-label mmo-row-select"><input is="emby-checkbox" type="checkbox" ' +
            attribute +
            ' aria-label="Select ' +
            ports.api.esc(name) +
            '" ' +
            (checked ? "checked " : "") +
            (disabled ? "disabled" : "") +
            " /><span></span></label>"
        );
    }
    function tablePagination(start: number, total: number, { count, previous, next, noun = "results", note = "" }: Pagination) {
        ports.api.q(count).textContent =
            total +
            " " +
            noun +
            (total ? " · Showing " + (start + 1) + "–" + Math.min(start + tablePageSize, total) : "") +
            (note ? " · " + note : "");
        ports.api.q<HTMLButtonElement>(previous).disabled = start === 0;
        ports.api.q<HTMLButtonElement>(next).disabled = start + tablePageSize >= total;
    }
    return {
        initialize() {
            mountTable("mmoLibraryTable", {
                name: "Library",
                columns: libraryTableColumns,
                bodies: ["mmoInventoryRows"],
                pagination: {
                    count: "mmoInventoryCount",
                    previous: "mmoInventoryPrev",
                    next: "mmoInventoryNext",
                },
            });
            mountTable("mmoRuleTable", {
                name: "Rules",
                selectable: true,
                bodies: ["mmoManagerPolicies", "mmoIdentities", "mmoRules"],
                emptyId: "mmoChangesEmpty",
                pagination: {
                    count: "mmoChangeCount",
                    previous: "mmoChangePrev",
                    next: "mmoChangeNext",
                },
            });
            mountTable("mmoIssuesTable", {
                name: "Issues",
                columns: issueTableColumns,
                selectable: true,
                bodies: ["mmoIssueRows"],
                pagination: {
                    count: "mmoIssuesCount",
                    previous: "mmoIssuesPrev",
                    next: "mmoIssuesNext",
                },
            });
            ports.api.page.addEventListener("click", (event) => {
                const button = (event.target as HTMLElement).closest<HTMLElement>("[data-table-details]");
                if (!button) return;
                const details = button.closest<HTMLElement>(".mmo-row")!.querySelector<HTMLDetailsElement>("[data-table-details-panel]")!;
                details.open = true;
                details.querySelector<HTMLElement>("summary")!.focus();
            });
        },
        get tablePageSize() {
            return tablePageSize;
        },
        get defaultTableColumns() {
            return defaultTableColumns;
        },
        get issueTableColumns() {
            return issueTableColumns;
        },
        get libraryTableColumns() {
            return libraryTableColumns;
        },
        get mountTable() {
            return mountTable;
        },
        get tableMessage() {
            return tableMessage;
        },
        get tableRow() {
            return tableRow;
        },
        get tableCheckbox() {
            return tableCheckbox;
        },
        get tablePagination() {
            return tablePagination;
        },
    };
}
