import { describe, expect, it } from "vitest";
import { revokeMembership } from "../../src/services/workspaces/mutations.js";
import {
  decideInvalidationTick,
  decodeInvalidationCursor,
  encodeInvalidationCursor,
  isCompatibleCursor,
  pollProjectionInvalidation,
} from "../../src/services/facets/projection-invalidation.js";
import { describeDb } from "../../src/services/facets/workspace-archive-fixture.js";
import { httpFixture, verifiedBearer } from "./base-api-http-fixture.js";

describe("base-api projection invalidation tick and cursor", () => {
  it("coalesces invalidations to the latest authorized token", () => {
    expect(decideInvalidationTick("token-a", "token-a")).toEqual({ kind: "steady" });
    expect(decideInvalidationTick("token-a", "token-b")).toEqual({ kind: "invalidated", token: "token-b" });
    expect(decideInvalidationTick(null, "token-b")).toEqual({ kind: "invalidated", token: "token-b" });
    const live = { sub: "viewer", workspaceId: "ws", citySlug: "city", mode: "signal" };
    const cursor = { version: 1, sub: "viewer", workspaceId: "ws",
      citySlug: "city", mode: "signal" as const, token: "token-a" };
    expect(isCompatibleCursor(cursor, live)).toBe(true);
    expect(isCompatibleCursor({ ...cursor, workspaceId: "other" }, live)).toBe(false);
    expect(decodeInvalidationCursor(encodeInvalidationCursor(cursor))).toEqual(cursor);
    expect(decodeInvalidationCursor("lost")).toBeNull();
  });
});

describeDb("base-api composed projection invalidations", () => {
  it("resynchronizes incompatible cursors through the composed guard", async () => {
    const f = await httpFixture();
    const base = f.path("projection-events?citySlug=synthetic-city&mode=signal");
    const scope = await pollProjectionInvalidation(f.data.db, f.data.contributor.sub,
      f.data.workspaceId, "synthetic-city", "signal");
    const foreign = encodeInvalidationCursor({ version: 1, sub: f.data.contributor.sub,
      workspaceId: f.data.otherId, citySlug: "synthetic-city", mode: "signal", token: scope.token });
    const res = await f.request(`${base}&cursor=${foreign}`);
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    const text = new TextDecoder().decode((await reader.read()).value);
    await reader.cancel();
    expect(text).toContain("event: resync");
    expect(text).toContain("cursor_incompatible");
    expect(text).toContain(scope.token);
  });
  it("closes revoked viewers without opening a stream", async () => {
    const f = await httpFixture();
    const base = f.path("projection-events?citySlug=synthetic-city&mode=signal");
    const scope = await pollProjectionInvalidation(f.data.db, f.data.contributor.sub,
      f.data.workspaceId, "synthetic-city", "signal");
    await revokeMembership(f.data.db, { workspaceId: f.data.workspaceId, targetAccountId: f.data.contributor.id,
      actorSub: f.data.moderator.sub, reason: "synthetic idle revocation", expectedRevision: scope.membershipRevision });
    const res = await f.request(base);
    expect(res.status).toBe(403);
    expect(res.headers.get("content-type")).not.toContain("text/event-stream");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("keeps bearer and header guards on the composed stream", async () => {
    const f = await httpFixture();
    const base = f.path("projection-events?citySlug=synthetic-city&mode=signal");
    const bearer = await f.request(base, f.data.contributor.sub,
      { headers: verifiedBearer(f.data.contributor.sub) });
    expect(bearer.status).toBe(403);
    expect(await bearer.json()).toMatchObject({ error: "browser_session_required" });
    const anonymous = await f.app.request(base);
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get("cache-control")).toBe("private, no-store");
  });
});
