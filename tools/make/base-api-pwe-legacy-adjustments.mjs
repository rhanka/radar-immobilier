import assert from "node:assert/strict";

/** Keep the reset mutant discriminating after durable client budget restoration. */
export function materializeInherited(batch, source) {
  if (batch !== "pwc") return { source, changes: [] };
  const obsolete = '  ["M15-reset", "artifacts/write-intent-page.ts", "if (poll.intentId === intentId) return;", "", page, "fixed budget"],';
  assert.equal(source.split(obsolete).length, 2, "Unique inherited reset case is required");
  const before = "if (!document.hidden && !poll.stopped && poll.timer === null && !poll.inFlight) schedule(INTERVAL_MS);";
  const after = "poll.startedAt = Date.now(); poll.count = 0; poll.stopped = false;\n    " + before;
  const replacement = ["M15-reset", "artifacts/write-intent-page.ts", before, after,
    "tests/integration/pwe-page-reload.spec.ts", "closed budget after focus"];
  const changes = [{ name: "M15-reset", before, after, scope: replacement[4], title: replacement[5],
    reason: "Removing the duplicate-start guard alone is redundant after persisted budget restoration; exercise focus reset instead" }];
  return { source: source.replace(obsolete, `  ${JSON.stringify(replacement)},`), changes };
}
