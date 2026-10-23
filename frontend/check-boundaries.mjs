import { createRequire } from "node:module";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const directory = fileURLToPath(new URL("./", import.meta.url));
const ts = createRequire(import.meta.url)("typescript");
let count = 0;
const graph = new Map();
async function inspect(root) {
    for (const item of await readdir(root, { withFileTypes: true })) {
        if (item.name === "node_modules") continue;
        const filename = path.join(root, item.name);
        if (item.isDirectory()) {
            await inspect(filename);
            continue;
        }
        if (!item.name.endsWith(".ts")) continue;
        const text = await readFile(filename, "utf8");
        const source = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
        if (source.parseDiagnostics.length) throw Error("Invalid TypeScript module: " + filename);
        const edges = [];
        for (const statement of source.statements) {
            if (!ts.isImportDeclaration(statement)) continue;
            const specifier = statement.moduleSpecifier.text;
            if (item.name.endsWith(".test.ts") && ["node:test", "node:assert/strict"].includes(specifier)) continue;
            if (!item.name.endsWith(".test.ts") && specifier.endsWith(".test.ts")) throw Error("Production module imports a test: " + specifier);
            const target = path.resolve(path.dirname(filename), specifier);
            if (!statement.importClause?.isTypeOnly && specifier.startsWith(".")) edges.push(target);
            const toolkit = path.resolve(directory, "../.build/jpt/ui");
            if (!specifier.startsWith(".") || !(target.startsWith(directory) || target.startsWith(toolkit + path.sep)))
                throw Error("Frontend dependency escapes its declared boundary: " + specifier);
        }
        graph.set(filename, edges);
        if (/\b(?:eval|require)\s*\(/.test(text)) throw Error("Runtime module loading is not supported: " + filename);
        const factory = source.statements.find(ts.isFunctionDeclaration);
        if (
            factory?.parameters.some(
                (parameter) => parameter.type?.getText(source) === "ControllerContracts" || parameter.type?.getText(source) === "Features",
            )
        )
            throw Error("Controller requires narrow dependencies: " + filename);
        count++;
    }
}
await inspect(directory);
const visiting = new Set(),
    complete = new Set();
function visit(filename) {
    if (visiting.has(filename)) throw Error("Runtime frontend import cycle: " + filename);
    if (complete.has(filename)) return;
    visiting.add(filename);
    for (const dependency of graph.get(filename) || []) if (graph.has(dependency)) visit(dependency);
    visiting.delete(filename);
    complete.add(filename);
}
for (const filename of graph.keys()) visit(filename);
console.log("PASS: " + count + " maintained TypeScript modules have explicit browser-safe imports");
