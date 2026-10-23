import assert from "node:assert/strict";
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const source = join(root, "packages/immo-mcp/src");
const evidence = join(root, "tmp/artefacts-mcp-a2/mutations");
mkdirSync(evidence, { recursive: true });
function digest(directory) {
  const hash = createHash("sha256");
  function visit(folder, prefix = "") {
    for (const entry of readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(folder, entry.name);
      const relative = `${prefix}${entry.name}`;
      if (entry.isDirectory()) visit(path, `${relative}/`);
      else { hash.update(relative); hash.update(readFileSync(path)); }
    }
  }
  visit(directory);
  return hash.digest("hex");
}
const before = digest(source);
const cases = [
  { name: "original-bearer", file: "authorized-egress.ts", scope: "exchange-authorized-egress.test.ts",
    from: 'if (!deps) throw new Error("exchange_not_configured");', to: 'if (!deps) return { accessToken: input.subjectToken };' },
  { name: "actor-validation", file: "exchange-token.ts", scope: "exchange-token.test.ts",
    from: 'if (actSub !== config.workloadSub) throw new Error("exchange_invalid_actor");', to: 'void actSub;' },
  { name: "subject-expiry", file: "exchange-token.ts", scope: "exchange-token-profile.test.ts",
    from: 'if (Math.floor(exp) > Math.floor(subject.exp)) throw new Error("exchange_invalid_lifetime");', to: 'void subject.exp;' },
  { name: "audience-validation", file: "exchange-token.ts", scope: "exchange-token.test.ts",
    transform: (text) => text.replace('audience: config.apiAudience,', '').replace('audiences.length !== 1 || audiences[0] !== config.apiAudience', 'false') },
  ...["subjectIdentity", "client", "effectiveScopes"].map((part) => ({
    name: `cache-${part}`, file: "exchange-cache.ts", scope: "exchange-cache.test.ts",
    from: `    parts.${part},`, to: "",
  })),
  { name: "cache-deadline", file: "exchange-cache.ts", scope: "exchange-cache.test.ts",
    from: 'if (now >= entry.deadlineMs)', to: 'if (false)' },
  { name: "mutable-authority", file: "invocation-context.ts", scope: "invocation-context.test.ts",
    transform: (text) => text.replace('const storage = new AsyncLocalStorage<InvocationContext>();', 'let current: InvocationContext | undefined;')
      .replace('return storage.run(ctx, fn);', 'current = ctx; return fn();').replace('return storage.getStore();', 'return current;') },
  ...["getZonesGeojsonHandler", "searchLotsHandler"].map((handler) => ({
    name: `exchange-${handler}`, file: "tool-handlers.ts", scope: "exchange-public-boundary.test.ts",
    from: `async function ${handler}(\n  rawArgs: Record<string, unknown>,\n  ctx: InvocationContext,\n): Promise<ToolTextResult> {`,
    to: `async function ${handler}(\n  rawArgs: Record<string, unknown>,\n  ctx: InvocationContext,\n): Promise<ToolTextResult> {\n  await resolveExchangedCallContext(ctx, "search_signals");`,
  })),
];
const scopes = [...new Set(cases.map((c) => `src/${c.scope}`))];
function run(directory, name, selected) {
  const result = spawnSync(process.execPath, [resolve("node_modules/vitest/vitest.mjs"), "run", "--root", directory, ...selected], {
    cwd: root, encoding: "utf8", timeout: 90_000, maxBuffer: 4 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  writeFileSync(join(evidence, `${name}.log`), output);
  assert(!result.error, `${name}: runner error`);
  return { status: result.status, output };
}
const directory = join(evidence, "isolated-copy");
function restore() {
  rmSync(directory, { recursive: true, force: true });
  cpSync(source, join(directory, "src"), { recursive: true });
  cpSync("packages/immo-mcp/package.json", join(directory, "package.json"));
  symlinkSync(resolve("packages/immo-mcp/node_modules"), join(directory, "node_modules"), "dir");
  const copyJose = createRequire(join(directory, "package.json")).resolve("jose");
  assert.equal(copyJose, createRequire(resolve("packages/immo-mcp/package.json")).resolve("jose"), "copy changed crypto dependency");
  assert.equal(digest(join(directory, "src")), before, "copy restoration differs");
}
try {
  restore();
  assert.equal(run(directory, "control-before", scopes).status, 0, "initial control failed");
  for (const mutation of cases) {
    restore();
    const file = join(directory, "src", mutation.file);
    const original = readFileSync(file, "utf8");
    const changed = mutation.transform ? mutation.transform(original) : original.replace(mutation.from, mutation.to);
    assert.notEqual(changed, original, `${mutation.name}: mutation did not apply`);
    writeFileSync(file, changed);
    const result = run(directory, mutation.name, [`src/${mutation.scope}`]);
    assert.notEqual(result.status, 0, `${mutation.name}: mutation survived`);
    assert.match(result.output, /AssertionError/, `${mutation.name}: no behavioral assertion failed`);
    restore();
    assert.equal(run(directory, `${mutation.name}-restored`, [`src/${mutation.scope}`]).status, 0, "restored control failed");
    console.log(`[mutation] KILLED ${mutation.name}; bytes restored; control PASS`);
  }
  assert.equal(run(directory, "control-after", scopes).status, 0, "final control failed");
} finally {
  assert.equal(digest(source), before, "original source changed");
  rmSync(directory, { recursive: true, force: true });
  writeFileSync(join(evidence, "source.sha256"), `${before}\n`);
}
