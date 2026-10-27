// Live SSE qualification; reused fixtures create disposable synthetic databases.
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { accountUsers } from "../db/schema.js";
import { describeDb, revisionFixture, revisionCitySignal } from "../services/facets/projection-revisions-fixture.js";
import { pollProjectionInvalidation } from "../services/facets/projection-invalidation.js";
import { writeScopedPersonalFacet } from "../services/facets/scoped-writer.js";
import { writeWorkspaceArchiveFacet } from "../services/facets/workspace-writer.js";
import { revokeMembership } from "../services/workspaces/mutations.js";
import { scopedProjectionEventsRoute } from "./scoped-projection-events.js";

describeDb("6L2 live SSE cycles", () => {
  async function setup() {
    const f = await revisionFixture();
    const signal = await revisionCitySignal(f);
    const url = `/api/v1/workspaces/${f.workspaceId}/signal-facets/projection-events`
      + `?citySlug=${signal.target.citySlug}&mode=signal`;
    const open = async (sub: string, now = () => 1000) => {
      const app = new Hono();
      app.use("*", async (c, next) => {
        c.set("session" as never, { sub, exp: 2 } as never); await next(); });
      app.route("/", scopedProjectionEventsRoute({ db: f.db, auth: { enabled: true },
        watchIntervalMs: 100, now }));
      const response = await app.request(url);
      expect(response.status).toBe(200);
      const reader = response.body!.getReader();
      expect(new TextDecoder().decode((await reader.read()).value)).toContain("event: resync");
      return reader;
    };
    return { f, ...signal, open };
  }
  async function read(reader: ReadableStreamDefaultReader<Uint8Array>) {
    let timer: ReturnType<typeof setTimeout>;
    try {
      const result = await Promise.race([reader.read(), new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), 1500);
      })]);
      expect(result, "watcher must emit within 1.5 seconds").not.toBeNull();
      return result!;
    } finally { clearTimeout(timer!); }
  }
  it("should authorize each cycle before emitting a changed token", async () => {
    const { f, target, fingerprint, open } = await setup();
    const reader = await open(f.contributor.sub);
    try {
      await f.db.update(accountUsers).set({ status: "suspended" }).where(eq(accountUsers.id, f.contributor.id));
      await writeWorkspaceArchiveFacet(f.db, f.moderator.sub, f.workspaceId,
        { action: "discard", target, reasonCode: "N-NON-RES", expectedHeadId: null,
          displayedFingerprint: fingerprint, commandKey: randomUUID() });
      expect(new TextDecoder().decode((await read(reader)).value)).toContain("event: closed");
      expect((await read(reader)).done).toBe(true);
    } finally { await reader.cancel(); }
  });
  it("should close an idle stream after membership revocation", async () => {
    const { f, target, open } = await setup();
    const reader = await open(f.contributor.sub);
    try {
      const scope = await pollProjectionInvalidation(f.db, f.contributor.sub, f.workspaceId, target.citySlug, "signal");
      await revokeMembership(f.db, { workspaceId: f.workspaceId, targetAccountId: f.contributor.id,
        actorSub: f.moderator.sub, reason: "synthetic idle revocation", expectedRevision: scope.membershipRevision });
      expect(new TextDecoder().decode((await read(reader)).value)).toContain("event: closed");
      expect((await read(reader)).done).toBe(true);
    } finally { await reader.cancel(); }
  });
  it("should close expired browser credentials without a business change", async () => {
    const { f, open } = await setup();
    let now = 1000;
    const reader = await open(f.contributor.sub, () => now);
    try {
      now = 2000;
      expect(new TextDecoder().decode((await read(reader)).value)).toContain('"reason":"session_expired"');
      expect((await read(reader)).done).toBe(true);
    } finally { await reader.cancel(); }
  });
  it("should emit no private change to another member and converge across tabs", async () => {
    const { f, target, fingerprint, open } = await setup();
    const readers = await Promise.all([open(f.contributor.sub), open(f.contributor.sub), open(f.moderator.sub)]);
    try {
      const moderatorNext = readers[2]!.read();
      await writeScopedPersonalFacet(f.db, f.contributor.sub, f.workspaceId,
        { action: "discard", target, reasonCode: "N-NON-RES", expectedHeadId: null,
          displayedFingerprint: fingerprint, commandKey: randomUUID() });
      for (const reader of readers.slice(0, 2)) {
        expect(new TextDecoder().decode((await read(reader)).value)).toContain("event: invalidated");
      }
      expect(await Promise.race([moderatorNext, new Promise<null>((resolve) => setTimeout(() => resolve(null), 250))]))
        .toBeNull();
      await writeWorkspaceArchiveFacet(f.db, f.moderator.sub, f.workspaceId,
        { action: "discard", target, reasonCode: "N-NON-RES", expectedHeadId: null,
          displayedFingerprint: fingerprint, commandKey: randomUUID() });
      for (const reader of readers.slice(0, 2)) {
        expect(new TextDecoder().decode((await read(reader)).value)).toContain("event: invalidated");
      }
      expect(new TextDecoder().decode((await moderatorNext).value)).toContain("event: invalidated");
    } finally { await Promise.all(readers.map((reader) => reader.cancel())); }
  });
  it("should measure synthetic authorization cost at the proposed cadence", async () => {
    const { f, target } = await setup();
    const started = performance.now();
    for (let cycle = 0; cycle < 10; cycle += 1) {
      for (const sub of [f.contributor.sub, f.moderator.sub]) {
        await pollProjectionInvalidation(f.db, sub, f.workspaceId, target.citySlug, "signal");
      }
    }
    const elapsed = performance.now() - started;
    console.info(JSON.stringify({ qualification: "6L2-synthetic-watch", polls: 20,
      elapsedMs: elapsed, meanMs: elapsed / 20, intervalMs: 1000 }));
    expect(elapsed).toBeLessThan(2000);
  });
});
