import { Hono } from "hono";
import { expect, it } from "vitest";
import { ScopeError } from "../services/facets/scope.js";
import { WorkspaceError } from "../services/workspaces/types.js";
import { revokeMembership } from "../services/workspaces/mutations.js";
import {
  encodeInvalidationCursor,
  pollProjectionInvalidation,
} from "../services/facets/projection-invalidation.js";
import {
  scopedProjectionEventsRoute,
  toStreamEnd,
} from "./scoped-projection-events.js";
import { describeDb, fixture } from "../services/facets/scope-db-fixture.js";
import {
  describeDb as describeRevisionDb,
  revisionCitySignal,
  revisionFixture,
} from "../services/facets/projection-revisions-fixture.js";
import type { Database } from "../db/client.js";

function appFor(f: { db: Database }, session: { sub: string } | null, maxEvents = 1) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("session" as never, (session && { ...session, exp: 4102444800 }) as never); await next(); });
  app.route("/", scopedProjectionEventsRoute({ db: f.db, auth: { enabled: true }, maxEvents }));
  return app;
}

function firstFrame(text: string): { event: string; data: Record<string, unknown> } {
  const block = text.split("\n\n")[0]!;
  const event = block.split("\n")[0]!.replace("event: ", "");
  const data = JSON.parse(block.split("\n")[1]!.replace("data: ", "")) as Record<string, unknown>;
  return { event, data };
}

describeRevisionDb("6L2 projection SSE contract", () => {
  it("should guard event reads and open with an initial resync", async () => {
    const f = await revisionFixture();
    const { target } = await revisionCitySignal(f);
    const base = `/api/v1/workspaces/${f.workspaceId}/signal-facets/projection-events`
      + `?citySlug=${target.citySlug}&mode=signal`;
    const anonymous = appFor(f, null);
    expect((await anonymous.request(base)).status).toBe(401);
    const outsider = appFor(f, { sub: f.outsider.sub });
    expect((await outsider.request(base)).status).toBe(403);
    const member = appFor(f, { sub: f.contributor.sub });
    expect((await member.request(base.replace(target.citySlug, "bad_city"))).status).toBe(400);
    expect((await member.request(base.replace("mode=signal", "mode=lot"))).status).toBe(400);
    const res = await member.request(base);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const frame = firstFrame(await res.text());
    expect(frame.event).toBe("resync");
    expect(frame.data).toMatchObject({ reason: "initial_connection" });
    const scope = await pollProjectionInvalidation(f.db, f.contributor.sub,
      f.workspaceId, target.citySlug, "signal");
    expect(frame.data).toMatchObject({ token: scope.token });
  });

  it("should resynchronize on restart and on incompatible cursors", async () => {
    const f = await revisionFixture();
    const { target } = await revisionCitySignal(f);
    const base = `/api/v1/workspaces/${f.workspaceId}/signal-facets/projection-events`
      + `?citySlug=${target.citySlug}&mode=signal`;
    const member = appFor(f, { sub: f.contributor.sub });
    const scope = await pollProjectionInvalidation(f.db, f.contributor.sub,
      f.workspaceId, target.citySlug, "signal");
    const live = { version: 1, sub: f.contributor.sub, workspaceId: f.workspaceId,
      citySlug: target.citySlug, mode: "signal" as const, token: scope.token };
    const restart = firstFrame(await (await member.request(
      `${base}&cursor=${encodeInvalidationCursor(live)}`)).text());
    expect(restart.event).toBe("resync");
    expect(restart.data).toMatchObject({ reason: "restart", token: scope.token });
    const foreign = firstFrame(await (await member.request(
      `${base}&cursor=${encodeInvalidationCursor({ ...live, workspaceId: f.otherId })}`)).text());
    expect(foreign.event).toBe("resync");
    expect(foreign.data).toMatchObject({ reason: "cursor_incompatible", token: scope.token });
    const lost = firstFrame(await (await member.request(`${base}&cursor=lost`)).text());
    expect(lost.event).toBe("resync");
    expect(lost.data).toMatchObject({ reason: "cursor_incompatible" });
  });

  it("should refuse revoked viewers without opening a stream", async () => {
    const f = await revisionFixture();
    const { target } = await revisionCitySignal(f);
    const base = `/api/v1/workspaces/${f.workspaceId}/signal-facets/projection-events`
      + `?citySlug=${target.citySlug}&mode=signal`;
    const scope = await pollProjectionInvalidation(f.db, f.contributor.sub,
      f.workspaceId, target.citySlug, "signal");
    await revokeMembership(f.db, { workspaceId: f.workspaceId, targetAccountId: f.contributor.id,
      actorSub: f.moderator.sub, reason: "synthetic idle revocation",
      expectedRevision: scope.membershipRevision });
    const res = await appFor(f, { sub: f.contributor.sub }).request(base);
    expect(res.status).toBe(403);
    expect(res.headers.get("content-type")).not.toContain("text/event-stream");
  });

  it("should map quiet-cycle failures to close or retry frames", () => {
    expect(toStreamEnd(new WorkspaceError(403, "workspace_membership_required")))
      .toMatchObject({ kind: "closed", status: 403 });
    expect(toStreamEnd(new ScopeError(503, "personal_history_unresolved")))
      .toMatchObject({ kind: "unavailable", status: 503 });
    expect(toStreamEnd(new Error("synthetic transport failure")))
      .toMatchObject({ kind: "unavailable" });
  });
});

describeDb("6L2 projection SSE without activation", () => {
  it("should stay unavailable before the scope is activated", async () => {
    const f = await fixture();
    const app = new Hono();
    const session = { sub: f.member.sub, exp: 4102444800 };
    app.use("*", async (c, next) => { c.set("session" as never, session as never); await next(); });
    app.route("/", scopedProjectionEventsRoute({ db: f.db, auth: { enabled: true }, maxEvents: 1 }));
    const res = await app.request(
      `/api/v1/workspaces/${f.workspaceId}/signal-facets/projection-events?citySlug=synthetic-city&mode=signal`);
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });
});
