// Shared presentation for the three inventory/management tables. Selection and
// mutation state remain owned by their existing destination controllers.
const tablePageSize = 12;
const defaultTableColumns = [["Name", "name"], ["Type", "type"], ["Status", "status"], ["Actions", "actions"]];
const issueTableColumns = [["Name", "name"], ["Finding", "type"], ["Next step", "actions"]];
const libraryTableColumns = [["Name", "name"], ["Type", "type"], ["Metadata", "status"], ["Actions", "actions"]];
function mountTable(
  id,
  { name, selectable = false, bodies, emptyId, pagination, columns = defaultTableColumns },
) {
  columns = (selectable ? [["Select", "select"]] : []).concat(columns);
  q(id).innerHTML =
    '<table class="mmo-data-table' +
    (selectable ? " mmo-table-selectable" : "") +
    '" role="table" aria-label="' +
    esc(name) +
    '"><colgroup>' +
    columns.map(([, key]) => '<col class="mmo-col-' + key + '" />').join("") +
    '</colgroup><thead role="rowgroup"><tr role="row">' +
    columns
      .map(
        ([label, key]) =>
          '<th scope="col" role="columnheader">' +
          (key === "select"
            ? '<span class="mmo-sr-only">Select</span>'
            : label) +
          "</th>",
      )
      .join("") +
    "</tr></thead>" +
    bodies
      .map(
        (body, index) =>
          '<tbody id="' +
          body +
          '" role="rowgroup">' +
          (index === 0
            ? tableMessage("Loading " + name.toLowerCase() + "…", selectable, columns.length)
            : "") +
          "</tbody>",
      )
      .join("") +
    (emptyId
      ? '<tbody id="' +
        emptyId +
        '" role="rowgroup" hidden>' +
        tableMessage("No rules match these filters.", selectable) +
        "</tbody>"
      : "") +
    '</table><div class="mmo-table-footer"><p id="' +
    pagination.count +
    '" role="status"></p><nav class="mmo-actions mmo-pagination" aria-label="' +
    esc(name) +
    ' pages">' +
    nativeButton("Previous", 'id="' + pagination.previous + '" disabled') +
    nativeButton("Next", 'id="' + pagination.next + '" disabled') +
    "</nav></div>";
}
function tableMessage(text, selectable = false, columnCount = 4) {
  return (
    '<tr class="mmo-table-message" role="row"><td role="cell" colspan="' +
    (columnCount + (selectable ? 1 : 0)) +
    '"><p role="status">' +
    esc(text) +
    "</p></td></tr>"
  );
}
function tableRow({
  name,
  type,
  status,
  attributes = "",
  selection = "",
  description = "",
  details = "",
  detailLabel = "Details",
  primary = "",
  native = "",
  actions = "",
  columns = defaultTableColumns,
}) {
  const menuActions =
    actions +
    (details ? nativeButton("Show details", "data-table-details") : "");
  const cells = {
    name: '<strong>' + esc(name) + '</strong>' +
      (description ? '<p class="secondaryText mmo-row-description">' + esc(description) + '</p>' : '') +
      (details ? '<details data-table-details-panel><summary>' + esc(detailLabel) + '</summary>' + details + '</details>' : ''),
    type: esc(type),
    status: '<span class="mmo-status-badge">' + esc(status) + '</span>',
    actions: '<div class="mmo-row-actions">' + primary + native +
      (menuActions ? nativeButton('⋮', 'data-actions-open aria-label="Actions for ' + esc(name) + '" title="Actions" aria-haspopup="true" aria-expanded="false"') + '<div data-row-actions hidden>' + menuActions + '</div>' : '') + '</div>',
  };
  return '<tr class="mmo-row" role="row" ' + attributes + '>' +
    (selection ? '<td class="mmo-table-select" role="cell">' + selection + '</td>' : '') +
    columns.map(([label, key]) => '<td class="' + (key === 'name' ? 'mmo-row-main' : '') + '" role="cell" data-label="' + esc(label) + '">' + cells[key] + '</td>').join('') + '</tr>';
}

function tableCheckbox(
  name,
  attribute,
  { checked = false, disabled = false } = {},
) {
  return (
    '<label class="emby-checkbox-label mmo-row-select"><input is="emby-checkbox" type="checkbox" ' +
    attribute +
    ' aria-label="Select ' +
    esc(name) +
    '" ' +
    (checked ? "checked " : "") +
    (disabled ? "disabled" : "") +
    " /><span></span></label>"
  );
}
function tablePagination(
  start,
  total,
  { count, previous, next, noun = "results", note = "" },
) {
  q(count).textContent =
    total +
    " " +
    noun +
    (total
      ? " · Showing " +
        (start + 1) +
        "–" +
        Math.min(start + tablePageSize, total)
      : "") +
    (note ? " · " + note : "");
  q(previous).disabled = start === 0;
  q(next).disabled = start + tablePageSize >= total;
}
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
page.addEventListener("click", (event) => {
  const button = event.target.closest("[data-table-details]");
  if (!button) return;
  const details = button
    .closest(".mmo-row")
    .querySelector("[data-table-details-panel]");
  details.open = true;
  details.querySelector("summary").focus();
});
