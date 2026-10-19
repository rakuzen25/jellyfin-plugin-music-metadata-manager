import { isWriteRequest } from "./requestPolicy.ts";
import { OperationError, transportError } from "./errors.ts";
import type { Document } from "./contracts.ts";
import type { ApiResult } from "./responses.ts";
export interface RequestOptions {
    url: string;
    type: string;
    data?: string;
    contentType: string;
    dataType: string;
}
export function createTransport(
    send: (options: RequestOptions) => Promise<unknown>,
    url: (path: string) => string,
    document: () => Document | undefined,
) {
    async function request<P extends string>(path: P, method: string, body?: unknown): Promise<ApiResult<P>> {
        try {
            return (await send({
                url: url("MusicMetadataManager/" + path),
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
                } catch {
                    // The transport may not expose a readable error body; retain its status.
                }
            }
            let text;
            let code: string | undefined;
            let ruleIds: string[] | undefined;
            if (detail) {
                try {
                    const data = JSON.parse(detail);
                    text = data.error || data.detail || data.title || detail;
                    code = typeof data.code === "string" ? data.code : undefined;
                    ruleIds = Array.isArray(data.ruleIds) && data.ruleIds.every((id: unknown) => typeof id === "string") ? data.ruleIds : undefined;
                } catch {
                    text = detail;
                }
            }
            if (!text)
                text =
                    error?.message ||
                    (error?.status ? "Request failed (HTTP " + error.status + ")." : "Request failed. Check your connection and try again.");
            const current = document();
            if (code === "rule_conflict" && ruleIds?.length === 2 && current) {
                const rules = [...current.active, ...current.drafts];
                const name = (id: string) => {
                    const r = rules.find((x) => x.id === id);
                    return r?.label || r?.credit || r?.path || id;
                };
                text =
                    "Conflicting rules: “" +
                    name(ruleIds[0]!) +
                    "” and “" +
                    name(ruleIds[1]!) +
                    "”. Edit the existing rule, or delete the duplicate draft.";
            }
            const failure = new OperationError(text);
            failure.code = code;
            failure.uncertainWrite = isWriteRequest(path, method) && !error?.status && !detail;
            if (failure.uncertainWrite)
                failure.message =
                    "The server outcome could not be confirmed. Refresh status before repeating this action; applying changes requires a fresh review.";
            throw failure;
        }
    }
    return { request };
}
