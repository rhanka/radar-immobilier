import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { describeDb } from "../../src/services/facets/workspace-archive-fixture.js";
import { bumpGraphSourceRevision, readProjectionScope } from "../../src/services/facets/projection-revisions.js";
import { writeWorkspaceArchiveFacet } from "../../src/services/facets/workspace-writer.js";
import { facadeFixture } from "./mcp-signal-search-facade-fixture.js";
import { barrier } from "./mcp-signal-search-fixture.js";

async function delayedSearch() {
  const f = await facadeFixture();
  await f.data.pool.query("UPDATE graph_nodes SET source_ref = 'raw/synthetic/card.pdf' WHERE id = $1",
    [f.signal.node.id]);
  const started = barrier(), resume = barrier();
  f.head.mockImplementation(async () => { started.release(); await resume.waiting; return null; });
  return { ...f, started, resume };
}

describeDb("T13 production facade authority and projection races", () => {
  it.each(["added", "removed", "replaced", "unapproved"])(
    "rejects %s authority after documentary enrichment starts", async (change) => {
      const f = await delayedSearch();
      const before = await readProjectionScope(f.data.db, f.data.contributor.sub,
        f.data.workspaceId, "synthetic-city", "signal");
      const response = f.search("&showDiscarded=1");
      await f.started.waiting;
      try {
        if (change === "unapproved") {
          await f.data.pool.query("UPDATE account_users SET status = 'pending' WHERE id = $1", [f.data.contributor.id]);
        } else await f.memberships(change === "added" ? [f.data.workspaceId, f.data.otherId]
          : change === "removed" ? [] : [f.data.otherId]);
        if (change === "added") {
          const after = await readProjectionScope(f.data.db, f.data.contributor.sub,
            f.data.workspaceId, "synthetic-city", "signal");
          expect(after.token).toBe(before.token);
        }
      } finally { f.resume.release(); }
      const result = await response;
      expect(result.status).toBeGreaterThanOrEqual(400);
      const body = await result.json();
      expect(body).not.toHaveProperty("signals");
      if (change === "added") expect(body.error).toBe("workspace_ambiguous");
      if (change === "replaced") expect(body.error).toBe("workspace_context_changed");
    });
  it("discards stale source cards and reuses the documentary cache on retry", async () => {
    const f = await delayedSearch();
    const response = f.search();
    await f.started.waiting;
    try {
      await f.data.pool.query("UPDATE graph_nodes SET label = 'Updated source' WHERE id = $1", [f.signal.node.id]);
      await f.data.db.transaction((tx) => bumpGraphSourceRevision(tx, "synthetic-city"));
    } finally { f.resume.release(); }
    const result = await response;
    expect(result.status).toBe(200);
    expect((await result.json()).signals[0].summary).toBe("Updated source");
    expect(f.head).toHaveBeenCalledTimes(1);
  });
  it("keeps an explicitly authorized workspace when another membership becomes active", async () => {
    const f = await delayedSearch();
    const response = f.search("&workspaceId=" + f.data.workspaceId);
    await f.started.waiting;
    try { await f.memberships([f.data.workspaceId, f.data.otherId]); }
    finally { f.resume.release(); }
    const result = await response;
    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body.workspaceId).toBe(f.data.workspaceId);
    expect(body.signals[0].id).toBe(f.signal.node.id);
  });
  it("reapplies common archive masking after an archive changes during enrichment", async () => {
    const f = await delayedSearch();
    const response = f.search();
    await f.started.waiting;
    try {
      // The displayed fingerprint is read again because source_ref changed.
      const current = await f.request(f.path("reveal?citySlug=synthetic-city&type=Signal&id=" + f.signal.node.id));
      const card = await current.json();
      await writeWorkspaceArchiveFacet(f.data.db, f.data.moderator.sub, f.data.workspaceId,
        { action: "discard", target: f.signal.target, reasonCode: "N-NON-RES",
          expectedHeadId: null, displayedFingerprint: card.displayedFingerprint, commandKey: randomUUID() });
    } finally { f.resume.release(); }
    expect((await (await response).json()).signals).toEqual([]);
    expect(f.head).toHaveBeenCalledTimes(1);
  });
  it("rejects membership revocation while the authorized projection waits for a DB lock", async () => {
    const f = await facadeFixture();
    const lock = await f.data.pool.connect();
    let response: Promise<Response> | undefined;
    try {
      await lock.query("BEGIN");
      await lock.query("SELECT id FROM account_users WHERE id=$1 FOR UPDATE", [f.data.contributor.id]);
      response = f.search();
      let blocked = false;
      for (let attempt = 0; attempt < 50 && !blocked; attempt++) {
        const rows = await f.data.pool.query(`SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
          AND wait_event_type='Lock' AND query LIKE '%account_users%'`);
        blocked = rows.rowCount! > 0;
        if (!blocked) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(blocked).toBe(true);
      await f.memberships([]);
    } finally { await lock.query("ROLLBACK"); lock.release(); }
    const denied = await response!;
    expect(denied.status).toBe(403);
    expect(await denied.json()).not.toHaveProperty("signals");
    expect(f.head).not.toHaveBeenCalled();
  });
});
