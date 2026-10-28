import assert from "node:assert/strict";
import { materializeInherited as previous } from "./base-api-pwc-review-legacy.mjs";
export function materializeInherited(batch, source) {
  const result = previous(batch, source);
  if (batch === "pwc") {
    const row = ["M16-old-result", "artifacts/write-intent-page.ts",
      "if (intentId !== poll.intentId || version !== pollVersion) return;\n      await handleStatus(out, false, function () { return intentId === poll.intentId && version === pollVersion; });",
      "await handleStatus(out, false, function () { return intentId === poll.intentId && version === pollVersion; });",
      "src/artifacts/write-intent-page-regressions.test.ts", "late result"];
    const expression = / {2}\["M16-old-result",[\s\S]*?(?=\n {2}\[|\n\];)/g;
    const matches = [...result.source.matchAll(expression)];
    assert.equal(matches.length, 1, "Unique inherited stale-status case");
    result.changes.push({ name: row[0], original: matches[0][0], replacement: row,
      reason: "Remove the status ownership guard at the versioned continuation boundary" });
    result.source = result.source.replace(expression, `  ${JSON.stringify(row)},`);
    return result;
  }
  if (batch !== "pwa") return result;
  for (const name of ["page-clock-after-resolve", "delegation-clock-after-resolve"]) {
    const pattern = new RegExp(`  \\["${name}",[\\s\\S]*?(?=\\n  \\[|\\n\\];)`, "g");
    const matches = [...result.source.matchAll(pattern)];
    assert.equal(matches.length, 1, `Unique inherited case: ${name}`);
    const replacement = matches[0][0].replaceAll("deps.resolvePage(c.req.raw);",
      "deps.resolvePage(c.req.raw, scope, tx);");
    assert.notEqual(replacement, matches[0][0]);
    result.changes.push({ name, original: matches[0][0], replacement,
      reason: "Keep the stale-clock fault while preserving caller scope and transaction arguments" });
    result.source = result.source.replace(matches[0][0], replacement);
  }
  return result;
}
