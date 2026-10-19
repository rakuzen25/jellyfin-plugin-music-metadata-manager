const page = document.querySelector("#musicMetadataManagerPage");
let doc,
  editingId = null,
  reviewToken = null,
  reviewEpoch = 0,
  found = [],
  identityEditingId = null,
  identityRecords = null,
  unresolvedRows = [];
const q = (id) => page.querySelector("#" + id);
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
function isWriteRequest(path, method) {
  return method !== "GET" && !/^(preview|manager\/compare|manager\/images\/|manager\/items\/.+\/images\/)/.test(path);
}
async function api(path, method = "GET", body) {
  const write = isWriteRequest(path, method);
  if (!write) return requestApi(path, method, body);
  const owner = actions.current();
  const result = await actions.serializeWrite(() => requestApi(path, method, body));
  if (owner) owner.confirmed = true;
  return result;
}
async function requestApi(path, method, body) {
  try {
    return await ApiClient.ajax({
      url: ApiClient.getUrl("MusicMetadataManager/" + path),
      type: method,
      data: body === undefined ? undefined : JSON.stringify(body),
      contentType: "application/json",
      dataType: "json",
    });
  } catch (error) {
    let detail = error?.responseText;
    if (!detail && typeof error?.text === "function") {
      try {
        detail = await (
          typeof error.clone === "function" ? error.clone() : error
        ).text();
      } catch {}
    }
    let text;
    if (detail) {
      try {
        const data = JSON.parse(detail);
        text = data.error || data.detail || data.title || detail;
      } catch {
        text = detail;
      }
    }
    if (!text)
      text =
        error?.message ||
        (error?.status
          ? "Request failed (HTTP " + error.status + ")."
          : "Request failed. Check your connection and try again.");
    const conflict = /^Conflicting rules: ([^. ]+) and ([^. ]+)\.$/.exec(text);
    if (conflict && doc) {
      const rules = [...doc.active, ...doc.drafts];
      const name = (id) => {
        const r = rules.find((x) => x.id === id);
        return r?.label || r?.credit || r?.path || id;
      };
      text =
        "Conflicting rules: “" +
        name(conflict[1]) +
        "” and “" +
        name(conflict[2]) +
        "”. Edit the existing rule, or delete the duplicate draft.";
    }
    const failure = Error(text);
    failure.uncertainWrite = isWriteRequest(path, method) && !error?.status && !detail;
    if (failure.uncertainWrite) failure.message = "The server outcome could not be confirmed. Refresh status before repeating this action; applying changes requires a fresh review.";
    throw failure;
  }
}
async function perform(action) {
  const command = actions.acquire();
  if (!command) return;
  const operation = notifications.begin(command);
  try {
    await action(operation);
  } catch (error) {
    if (command.confirmed) {
      error.message = "The action succeeded, but refreshing its results failed. Refresh status before continuing. " + error.message;
      error.noticeHandled = false;
    }
    if (error.uncertainWrite) {
      const checks = await Promise.allSettled([api("rules"),api("status")]);
      if (checks.every(r => r.status === "fulfilled"))
        error.message += " Current configuration and worker status are available; check Rules and Issues before continuing.";
    }
    if (!error.noticeHandled)
      notifications.scope(operation)(error.message, command.confirmed ? "warning" : "error");
  } finally {
    notifications.finish(operation);
    actions.release(command);
  }
}
