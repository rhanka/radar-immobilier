import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { describeDb } from "../../src/services/facets/scope-db-fixture.js";
import { classificationFixture } from "./classification-fixture.js";
import { graphNodes, facetReasonCodes } from "../../src/db/schema.js";
import { bumpGraphSourceRevision } from "../../src/services/facets/projection-revisions.js";
import { targetFingerprint } from "../../src/services/facets/target.js";
import { writeScopedPersonalFacet } from "../../src/services/facets/scoped-writer.js";
import { FACET_PROFILE } from "../../src/services/facets/codebook.js";

describeDb("classification PostgreSQL pagination", () => {
  it("should paginate more than 100 identities and filter personal baskets before the limit", async () => {
    const f = await classificationFixture();
    const nodes = await f.data.db.insert(graphNodes).values(Array.from({ length: 103 }, (_, index) => ({
      id: `signal-${String(index).padStart(3, "0")}`, type: "Signal", citySlug: "synthetic-city", label: `Signal ${index}`,
      props: index % 2 ? {} : { properties: { etape_date: "2026-01-01" } },
    }))).returning();
    await f.data.db.transaction((tx) => bumpGraphSourceRevision(tx, "synthetic-city"));
    const chosen = nodes.at(-1)!;
    await writeScopedPersonalFacet(f.data.db, f.data.contributor.sub, f.data.workspaceId, {
      action: "select", basket: "pertinent", target: { citySlug: "synthetic-city", type: "Signal", id: chosen.id },
      expectedHeadId: null, displayedFingerprint: targetFingerprint(chosen), commandKey: randomUUID(),
    });
    const filtered = await (await f.request("signal-facets/search?citySlug=synthetic-city&basket=pertinent&limit=1")).json();
    expect(filtered.items.map((item: { target: { id: string } }) => item.target.id)).toEqual([chosen.id]);
    expect(filtered.counts).toMatchObject({ eligible: 104, matched: 1 });
    const ids: string[] = [];
    let cursor: string | null = null;
    let token: string | undefined;
    do {
      const params = new URLSearchParams({ citySlug: "synthetic-city", limit: "20" });
      if (cursor) params.set("cursor", cursor);
      const response = await f.request(`signal-facets/search?${params}`);
      expect(response.status).toBe(200);
      const body = await response.json();
      token ??= body.snapshot.queryToken;
      expect(body.snapshot.queryToken).toBe(token);
      expect(body.counts.matched).toBe(104);
      ids.push(...body.items.map((item: { target: { id: string } }) => item.target.id));
      cursor = body.page.nextCursor;
      expect(body.page.truncated).toBe(cursor !== null);
    } while (cursor);
    expect(ids).toHaveLength(104);
    expect(new Set(ids).size).toBe(104);
  });
  it("should refuse reader/filter/limit mismatches and source changes without returning a page", async () => {
    const f = await classificationFixture();
    await f.data.db.insert(graphNodes).values({ id: "second", type: "Signal", citySlug: "synthetic-city", label: "Second" });
    const first = await (await f.request("signal-facets/search?citySlug=synthetic-city&limit=1")).json();
    expect(first.page.nextCursor).toBeTypeOf("string");
    const params = new URLSearchParams({ citySlug: "synthetic-city", limit: "1", cursor: first.page.nextCursor });
    for (const [sub, change] of [[f.data.moderator.sub, ""], [f.data.contributor.sub, "&basket=none"]]) {
      const response = await f.request(`signal-facets/search?${params}${change}`, sub);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ ok: false, error: { code: "incompatible_continuation" } });
    }
    params.set("limit", "2");
    expect((await f.request(`signal-facets/search?${params}`)).status).toBe(400);
    params.set("limit", "1");
    await f.data.pool.query("UPDATE graph_nodes SET label='Changed' WHERE city_slug='synthetic-city' AND id='second'");
    await f.data.db.transaction((tx) => bumpGraphSourceRevision(tx, "synthetic-city"));
    const changed = await f.request(`signal-facets/search?${params}`);
    expect(changed.status).toBe(409);
    expect(await changed.json()).toMatchObject({ ok: false, error: { code: "snapshot_changed", action: "restart_query", retryable: true } });
  });
  it("should bind the current catalog and check authority before an invalid cursor", async () => {
    const f = await classificationFixture();
    await f.data.db.insert(graphNodes).values({ id: "second", type: "Signal", citySlug: "synthetic-city", label: "Second" });
    const first = await (await f.request("signal-facets/search?citySlug=synthetic-city&limit=1")).json();
    await f.data.db.insert(facetReasonCodes).values({ profileId: FACET_PROFILE, code: "P-TEST", verdict: "pertinent" });
    const params = new URLSearchParams({ citySlug: "synthetic-city", limit: "1", cursor: first.page.nextCursor });
    expect((await (await f.request(`signal-facets/search?${params}`)).json()).error.code).toBe("incompatible_continuation");
    await f.data.pool.query("UPDATE workspace_memberships SET status='revoked',revoked_at=now() WHERE workspace_id=$1 AND account_id=$2", [f.data.workspaceId, f.data.contributor.id]);
    const revoked = await f.request("signal-facets/search?citySlug=synthetic-city&cursor=invalid");
    expect(revoked.status).toBe(403);
    expect((await revoked.json()).error.code).toBe("workspace_not_authorized");
  });
});
