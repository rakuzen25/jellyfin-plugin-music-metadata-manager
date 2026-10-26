import assert from "node:assert/strict";
import { effectivePolicy } from "../../.build/jpt/node/renovate-api.mjs";

for (const [depName, expected] of [
    ["typescript", ">=7 <8"],
    ["@typescript/typescript6", ">=6 <7"],
]) {
    const actual = await effectivePolicy({ depName, packageName: depName, updateType: "patch" }, "npm", "package.json");
    assert.equal(actual.allowedVersions, expected);
}
const internal = await effectivePolicy({ depName: "@typescript/old", packageName: "typescript", updateType: "patch" }, "npm", "package.json");
assert.equal(internal.allowedVersions, ">=6 <7");
console.log("PASS: Music Metadata Manager compiler version restrictions");
