import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { describeDb } from "../../src/services/facets/workspace-archive-fixture.js";
import { authorityFixture } from "./pw-write-authority-fixture.js";
import { createWritePageSurface } from "../../src/artifacts/write-intent-page-surface.js";
import { createReaderContentApp } from "../../src/artifacts/content-serve.js";
import { mintGrant } from "../../src/artifacts/preview-grant.js";
import { mintSessionCookie } from "../../src/artifacts/preview-session.js";
import { fingerprintReaderProfile } from "../../src/artifacts/reader-profile.js";
import { PW_PAGE_SCRIPT } from "../../src/artifacts/write-intent-page.js";
import { SIGNAL_WRITE_OPERATIONS } from "../../src/artifacts/write-profile.js";
import type { WritePrepareBody } from "../../src/artifacts/write-intent-schemas.js";
import type { ObjectStore } from "../../src/storage/object-store.js";
import { effects } from "./pwe-fixture.js";

describeDb("PW-C served page and BASE read composition", () => {
  it("should serve all explicit gestures, the real script/CSP, and current reader state/search without effects", async () => {
    const h = await authorityFixture(), actor = h.f.contributor.sub;
    const host = h.page.grant.host, origin = `https://${host}`, now = Date.now();
    const profile = { name: "pwcr-read", policyRevision: "read-v1", capabilities: ["signals.protected-read" as const] };
    const issuer = { issuer: "https://read.example.test", audience: "reader-test", tier: "preprod" };
    const key = "read-grant-key".repeat(4), sessionKey = "page-key".repeat(5);
    const claims = { ...issuer, host, artifactId: h.page.grant.artifactId, releaseId: h.page.grant.releaseId,
      readerSub: actor, sessionId: h.page.grant.sessionId, profileName: profile.name,
      policyRevision: profile.policyRevision, profileFingerprint: fingerprintReaderProfile(profile) };
    const grant = await mintGrant(claims, key, now);
    const cookie = mintSessionCookie({ sid: claims.sessionId, readerSub: actor, artifactId: claims.artifactId,
      createdAt: now, expiresAt: now + 900_000 }, sessionKey).split(";")[0]!;
    const { basket: _basket, ...common } = h.body;
    const gestures = SIGNAL_WRITE_OPERATIONS.map((operation) => ({ ...common, operation,
      ...(operation.includes(".select.") || operation.includes(".deselect.") ? { basket: "pertinent" } : {}),
      ...(operation.includes(".discard.") ? { reasonCode: "NON-PERTINENT" } : {}),
    })) as WritePrepareBody[];
    const surface = createWritePageSurface({ db: h.f.db, store: { head: async () => null } as unknown as ObjectStore,
      classification: { cursorKeyring: { currentKeyId: "pwcr", keys: new Map([["pwcr", Buffer.alloc(32, 7)]]) } },
      bootstrap: async () => ({ workspaceId: h.f.workspaceId, appOrigin: h.writeApp.domain.appOrigin,
        pageInstanceId: h.page.pageInstanceId, csrf: "c".repeat(40), readGrant: grant, gestures }) });
    const app = createReaderContentApp({ contentBase: "pages.example.test", grantSecret: key, sessionSecret: sessionKey, issuer,
      authority: { getAuthorizationVersion: async () => "current", getContentOrigin: async () => origin,
        getRelease: async () => ({ artifactId: claims.artifactId, releaseId: claims.releaseId, authorSub: "other-author" }),
        getProfile: async () => profile, getRights: async (sub, artifactId) => ({ readerSub: sub, artifactId,
          approved: sub === actor, capabilities: profile.capabilities }) }, writePageSurface: surface });
    const get = (path: string) => app.request(`${origin}${path}`, { headers: { host, cookie, "x-preview-grant": grant } });
    const before = await effects(h.f), response = await get("/");
    expect(response.status).toBe(200);
    const html = await response.text();
    for (const operation of SIGNAL_WRITE_OPERATIONS) expect(html).toContain(`data-pw-operation="${operation}"`);
    const script = html.match(/<script>([\s\S]*?)<\/script>/)![1]!;
    expect(script).toBe(PW_PAGE_SCRIPT);
    expect(response.headers.get("content-security-policy")).toContain(`'sha256-${createHash("sha256").update(script).digest("base64")}'`);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(html).not.toContain("Artifact reader example"); expect(html).not.toContain("radar_session=");
    const query = new URLSearchParams({ workspaceId: h.f.workspaceId, ...h.body.target });
    const state = await get(`/__reader/api/baskets.state.v1?${query}`); expect(state.status).toBe(200);
    expect(await state.json()).toMatchObject({ workspaceId: h.f.workspaceId, item: { target: h.body.target,
      displayedFingerprint: h.body.displayedFingerprint }, snapshot: { baseToken: h.body.expectedProjectionToken } });
    const search = await get(`/__reader/api/baskets.search.v1?workspaceId=${h.f.workspaceId}&citySlug=${h.body.target.citySlug}`);
    expect(search.status).toBe(200); expect((await search.json()).items).toHaveLength(1);
    expect(await effects(h.f)).toEqual(before);
  });
});
