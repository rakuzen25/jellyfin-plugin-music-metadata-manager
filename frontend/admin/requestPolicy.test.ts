import { test } from "node:test";
import assert from "node:assert/strict";
import { isWriteRequest } from "./requestPolicy.ts";
import { OperationError, operationError } from "./errors.ts";
test("read-only POST workflows do not acquire the configuration write queue", () => {
    for (const route of ["preview", "manager/compare", "manager/images/cache", "manager/items/fixture/images/current"])
        assert.equal(isWriteRequest(route, "POST"), false);
});
test("draft, activation, import and removal requests retain serialized write ownership", () => {
    for (const [route, method] of [
        ["drafts", "POST"],
        ["activate", "POST"],
        ["import", "POST"],
        ["drafts/fixture", "DELETE"],
        ["manager/errors/acknowledge", "POST"],
    ])
        assert.equal(isWriteRequest(route!, method!), true);
    assert.equal(isWriteRequest("rules", "GET"), false);
});
test("a confirmed or uncertain operation preserves its error ownership through refresh failures", () => {
    const failure = new OperationError("Connection closed");
    failure.uncertainWrite = true;
    failure.noticeHandled = true;
    assert.equal(operationError(failure), failure);
    assert.equal(operationError(failure).uncertainWrite, true);
    assert.equal(operationError(failure).noticeHandled, true);
    assert.equal(operationError("Unavailable").message, "Unavailable");
});
