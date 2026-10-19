import { isWriteRequest } from "./requestPolicy.ts";
import { OperationError, operationError, transportError } from "./errors.ts";
import type { ApiResult } from "./responses.ts";
import { requiredPage, lookup, optionalLookup } from "./dom.ts";
import type { Document, View, ArtistIdentity } from "./contracts.ts";
import type { Features } from "./features.ts";
export function createApi(features: Features) {
    const page = requiredPage();
    let doc: Document;
    let editingId: string | null = null,
        reviewToken: string | null = null,
        reviewEpoch = 0;
    let found: View[] = [],
        identityEditingId: string | null = null;
    let identityRecords: {
        artists: {
            id: string;
            name: string;
        }[];
        persons: {
            id: string;
            name: string;
        }[];
    } | null = null;
    let unresolvedRows: {
        credit: string;
        role: string;
        items: {
            id: string;
            name: string;
            path: string;
        }[];
    }[] = [];
    const q = lookup(page);
    const find = optionalLookup(page);
    const esc = (value: unknown) =>
        String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

    async function api<P extends string>(path: P, method = "GET", body?: unknown): Promise<ApiResult<P>> {
        const write = isWriteRequest(path, method);
        if (!write) return requestApi(path, method, body);
        const owner = features.actions.actions.current();
        const result = await features.actions.actions.serializeWrite(() => requestApi(path, method, body));
        if (owner) owner.confirmed = true;
        return result;
    }
    async function requestApi<P extends string>(path: P, method: string, body?: unknown): Promise<ApiResult<P>> {
        try {
            return (await ApiClient.ajax({
                url: ApiClient.getUrl("MusicMetadataManager/" + path),
                type: method,
                data: body === undefined ? undefined : JSON.stringify(body),
                contentType: "application/json",
                dataType: "json",
            })) as ApiResult<P>;
        } catch (cause) {
            const error = transportError(cause);
            let detail = error?.responseText;
            if (!detail && typeof error?.text === "function") {
                try {
                    detail = await (typeof error.clone === "function" ? error.clone() : error).text!();
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
                    (error?.status ? "Request failed (HTTP " + error.status + ")." : "Request failed. Check your connection and try again.");
            const conflict = /^Conflicting rules: ([^. ]+) and ([^. ]+)\.$/.exec(text);
            if (conflict && doc) {
                const rules = [...doc.active, ...doc.drafts];
                const name = (id: string) => {
                    const r = rules.find((x) => x.id === id);
                    return r?.label || r?.credit || r?.path || id;
                };
                text =
                    "Conflicting rules: “" +
                    name(conflict[1]!) +
                    "” and “" +
                    name(conflict[2]!) +
                    "”. Edit the existing rule, or delete the duplicate draft.";
            }
            const failure = new OperationError(text);
            failure.uncertainWrite = isWriteRequest(path, method) && !error?.status && !detail;
            if (failure.uncertainWrite)
                failure.message =
                    "The server outcome could not be confirmed. Refresh status before repeating this action; applying changes requires a fresh review.";
            throw failure;
        }
    }
    async function perform(action: (operation: number) => unknown | Promise<unknown>) {
        const command = features.actions.actions.acquire();
        if (!command) return;
        const operation = features.notifications.notifications.begin(command);
        try {
            await action(operation);
        } catch (cause) {
            const error = operationError(cause);
            if (command.confirmed) {
                error.message = "The action succeeded, but refreshing its results failed. Refresh status before continuing. " + error.message;
                error.noticeHandled = false;
            }
            if (error.uncertainWrite) {
                const checks = await Promise.allSettled([api("rules"), api("status")]);
                if (checks.every((r) => r.status === "fulfilled"))
                    error.message += " Current configuration and worker status are available; check Rules and Issues before continuing.";
            }
            if (!error.noticeHandled) features.notifications.notifications.scope(operation)(error.message, command.confirmed ? "warning" : "error");
        } finally {
            features.notifications.notifications.finish(operation);
            features.actions.actions.release(command);
        }
    }
    return {
        get page() {
            return page;
        },
        get doc() {
            return doc;
        },
        set doc(value: typeof doc) {
            doc = value;
        },
        get editingId() {
            return editingId;
        },
        set editingId(value: typeof editingId) {
            editingId = value;
        },
        get reviewToken() {
            return reviewToken;
        },
        set reviewToken(value: typeof reviewToken) {
            reviewToken = value;
        },
        get reviewEpoch() {
            return reviewEpoch;
        },
        set reviewEpoch(value: typeof reviewEpoch) {
            reviewEpoch = value;
        },
        get found() {
            return found;
        },
        set found(value: typeof found) {
            found = value;
        },
        get identityEditingId() {
            return identityEditingId;
        },
        set identityEditingId(value: typeof identityEditingId) {
            identityEditingId = value;
        },
        get identityRecords() {
            return identityRecords;
        },
        set identityRecords(value: typeof identityRecords) {
            identityRecords = value;
        },
        get unresolvedRows() {
            return unresolvedRows;
        },
        set unresolvedRows(value: typeof unresolvedRows) {
            unresolvedRows = value;
        },
        get q() {
            return q;
        },
        get find() {
            return find;
        },
        get esc() {
            return esc;
        },
        get isWriteRequest() {
            return isWriteRequest;
        },
        get api() {
            return api;
        },
        get requestApi() {
            return requestApi;
        },
        get perform() {
            return perform;
        },
    };
}
