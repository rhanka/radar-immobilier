import { describe, expect, it } from "vitest";
import { createFixtureAuthority, fingerprintReaderProfile } from "./reader-profile.js";
import { mintGrant } from "./preview-grant.js";
import { renewGrant } from "./preview-renewal.js";
import { validateTicketForExchange } from "./preview-exchange.js";
import { createTicketStore } from "./preview-tickets.js";
import { createActivationRegistry } from "./release-activation.js";

const artifactId = "123e4567-e89b-12d3-a456-426614174000";
const releaseId = "123e4567-e89b-12d3-a456-426614174001";
const issuer = { issuer: "https://api.example.test", audience: "https://api.example.test/reader", tier: "preprod" };
const claims = { ...issuer, artifactId, releaseId, readerSub: "reader-alice",
  host: "artifact.pages.example.test", sessionId: "session-1", profileName: "demo", policyRevision: "pol-001",
  profileFingerprint: fingerprintReaderProfile({ name: "demo", policyRevision: "pol-001",
    capabilities: ["geo.read", "signals.protected-read"] }) };
const secret = "grant-secret-32-bytes-long-padding!";

describe("authority decision consistency", () => {
  it.each(["approval", "policy"])("should refuse renewal when %s changes during final reads", async reason => {
    const base = createFixtureAuthority();
    let version = 1;
    let profiles = 0;
    let releases = 0;
    const authority = { ...base,
      getAuthorizationVersion: async () => String(version),
      getProfile: async (id: string) => {
        if (++profiles === 2 && reason === "approval") version++;
        const profile = await base.getProfile(id);
        return profile && reason === "policy" && version > 1
          ? { ...profile, policyRevision: "pol-002" } : profile;
      },
      getRights: async (sub: string, id: string) => {
        const rights = await base.getRights(sub, id);
        return rights && reason === "approval" && version > 1
          ? { ...rights, approved: false } : rights;
      },
      getRelease: async (id: string) => {
        if (++releases === 2 && reason === "policy") version++;
        return base.getRelease(id);
      } };
    const token = await mintGrant(claims, secret, 1_000);
    expect(await renewGrant(token, { authority, issuer, secret }, () => false, 10_000)).toBeNull();
  });

  it("should refuse a policy change while exchange waits for reader rights", async () => {
    const base = createFixtureAuthority();
    let version = 1;
    const profile = (await base.getProfile(artifactId))!;
    const store = createTicketStore({ now: () => 1_000 });
    const minted = store.mint({ browserBinding: "browser-secret-at-least-32-characters",
      origin: "https://reader-1.pages.example.test", ...claims, returnTarget: "/index.html",
      profileFingerprint: fingerprintReaderProfile(profile) });
    const ticket = store.consume(minted.ticket, minted.browserBinding)!;
    const authority = { ...base,
      getAuthorizationVersion: async () => String(version),
      getProfile: async () => ({ ...profile, policyRevision: version === 1 ? "pol-001" : "pol-002" }),
      getRights: async (sub: string, id: string) => {
        version++;
        return base.getRights(sub, id);
      } };
    expect(await validateTicketForExchange(ticket, authority)).toBeNull();
  });

  it("should preserve a newer activation while the final release read is pending", async () => {
    const base = createFixtureAuthority();
    const registry = createActivationRegistry();
    let current = releaseId;
    let calls = 0;
    let entered!: () => void;
    let resume!: () => void;
    const pending = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { resume = resolve; });
    const authority = { ...base,
      getAuthorizationVersion: async () => current,
      getRelease: async () => {
        const captured = { artifactId, releaseId: current, authorSub: "author-alice" };
        if (++calls === 3) { entered(); await gate; }
        return captured;
      } };
    const stale = registry.activate(artifactId, releaseId, authority);
    await pending;
    current = "release-002";
    expect(await registry.activate(artifactId, current, authority)).not.toBeNull();
    resume();
    expect(await stale).toBeNull();
    expect(registry.active(artifactId)?.releaseId).toBe(current);
  });
});
