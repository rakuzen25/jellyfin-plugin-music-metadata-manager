import { test } from "node:test";
import assert from "node:assert/strict";
import { createTransport } from "./transport.ts";
import { isWriteRequest } from "./requestPolicy.ts";
import type { Document } from "./contracts.ts";
import type { OperationError } from "./errors.ts";
test("structured conflict IDs resolve labels without parsing human error text", async () => {
    const doc = {
        active: [
            { id: "a", label: "First" },
            { id: "b", label: "Second" },
        ],
        drafts: [],
    } as unknown as Document;
    const transport = createTransport(
        async () => {
            throw { status: 400, responseText: JSON.stringify({ code: "rule_conflict", ruleIds: ["a", "b"], error: "Any translated wording" }) };
        },
        (x) => x,
        () => doc,
    );
    await assert.rejects(
        () => transport.request("drafts", "POST", {}),
        (error: OperationError) => error.code === "rule_conflict" && error.message.includes("First") && error.message.includes("Second"),
    );
});
test("connection loss distinguishes an unknown write from a failed preview", async () => {
    const transport = createTransport(
        async () => {
            throw Error("Lost connection");
        },
        (x) => x,
        () => undefined,
    );
    for (const [path, uncertain] of [
        ["drafts", true],
        ["activate", true],
        ["preview", false],
        ["manager/compare", false],
    ] as const)
        await assert.rejects(
            () => transport.request(path, "POST", {}),
            (error: OperationError) => error.uncertainWrite === uncertain,
        );
});
test("route prefix lookalikes never bypass write serialization", () => {
    for (const route of ["preview-delete", "manager/compare-and-activate", "manager/images/cache-rules", "manager/items/id/images/Primary/delete"])
        assert.equal(isWriteRequest(route, "POST"), true);
    assert.equal(isWriteRequest("manager/items/id/images/Primary/pin-current", "POST"), false);
});
