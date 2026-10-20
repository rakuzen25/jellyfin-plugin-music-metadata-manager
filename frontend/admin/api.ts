import { createTransport } from "./transport.ts";
import { isWriteRequest } from "./requestPolicy.ts";
import { operationError } from "./errors.ts";
import type { ApiResult } from "./responses.ts";
import { requiredPage, lookup, optionalLookup } from "./dom.ts";

import type { ControllerContracts } from "./controllerContracts.ts";
import type { DashboardState } from "./dashboardState.ts";
export interface ApiDependencies {
    actions: Pick<ControllerContracts["actions"], "actions">;
    notifications: Pick<ControllerContracts["notifications"], "notifications">;
}
export function createApi(ports: ApiDependencies, session: DashboardState) {
    const page = requiredPage();
    const { request: requestApi } = createTransport(
        (options) => ApiClient.ajax(options),
        (path) => ApiClient.getUrl(path),
        () => session.api.doc,
    );

    const q = lookup(page);
    const find = optionalLookup(page);
    const esc = (value: unknown) =>
        String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

    async function api<P extends string>(path: P, method = "GET", body?: unknown): Promise<ApiResult<P>> {
        const write = isWriteRequest(path, method);
        if (!write) return requestApi(path, method, body);
        const owner = ports.actions.actions.current();
        const result = await ports.actions.actions.serializeWrite(() => requestApi(path, method, body));
        if (owner) owner.confirmed = true;
        return result;
    }
    async function perform(action: (operation: number) => unknown | Promise<unknown>) {
        const command = ports.actions.actions.acquire();
        if (!command) return;
        const operation = ports.notifications.notifications.begin(command);
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
            if (!error.noticeHandled) ports.notifications.notifications.scope(operation)(error.message, command.confirmed ? "warning" : "error");
        } finally {
            ports.notifications.notifications.finish(operation);
            ports.actions.actions.release(command);
        }
    }
    return {
        get page() {
            return page;
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
