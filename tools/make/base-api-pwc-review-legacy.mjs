import assert from "node:assert/strict";
import { materializeInherited as previous } from "./base-api-pwe-legacy-adjustments.mjs";

/** Retain each inherited fault after response projection and locked result moves. */
export function materializeInherited(batch, source) {
  const result = previous(batch, source);
  const replacements = batch === "pwa" ? [
    ["summary-membership", "write-intent-app-route.ts", " || !canRead", "",
      "src/artifacts/write-intent-app-review.test.ts", "membership loss with approval intact"],
  ] : batch === "pwc" ? [
    ["M14-forwarded-headers", "artifacts/write-intent-page-listener.ts",
      "applyReaderContentHeaders(c);", "", "src/artifacts/write-intent-page-listener.test.ts",
      "private headers on forwarded HTTP"],
    ["M16-management-state", "artifacts/write-intent-app-result.ts",
      "pwIntentStatus(row, (deps.nowMs ?? Date.now)())", '"pending"',
      "src/artifacts/write-intent-app-surface-db.test.ts", "confirm through the summary"],
    ["M16-old-result", "artifacts/write-intent-page.ts",
      "if (intentId !== poll.intentId) return;\n      await handleStatus(out);", "await handleStatus(out);",
      "src/artifacts/write-intent-page-regressions.test.ts", "late result"],
  ] : [];
  for (const row of replacements) {
    const expression = new RegExp(`  \\["${row[0]}",[\\s\\S]*?(?=\\n  \\[|\\n\\];)`, "g");
    const matches = [...result.source.matchAll(expression)];
    assert.equal(matches.length, 1, `Unique inherited case: ${row[0]}`);
    result.changes.push({ name: row[0], original: matches[0][0], replacement: row,
      reason: "Same public invariant at its current implementation boundary" });
    result.source = result.source.replace(expression, `  ${JSON.stringify(row)},`);
  }
  return result;
}
