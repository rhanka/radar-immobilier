import { describe, expect, it } from "vitest";
import { createFixtureAuthority, fingerprintReaderProfile } from "./reader-profile.js";
import { validateTicketForExchange } from "./preview-exchange.js";
import { createTicketStore } from "./preview-tickets.js";

const ARTIFACT = "123e4567-e89b-12d3-a456-426614174000";
const RELEASE = "123e4567-e89b-12d3-a456-426614174001";
const PROFILE = { name: "demo", policyRevision: "pol-001",
  capabilities: ["geo.read", "signals.protected-read"] as const };

function ticket() {
  const store = createTicketStore({ now: () => 1_000 });
  const minted = store.mint({
    browserBinding: "browser-secret-at-least-32-characters",
    origin: "https://reader-1.pages.example.test",
    artifactId: ARTIFACT,
    releaseId: RELEASE,
    profileName: PROFILE.name,
    policyRevision: PROFILE.policyRevision,
    profileFingerprint: fingerprintReaderProfile({ ...PROFILE, capabilities: [...PROFILE.capabilities] }),
    readerSub: "reader-alice",
    returnTarget: "/index.html",
  });
  return store.consume(minted.ticket, "browser-secret-at-least-32-characters")!;
}

describe("preview ticket exchange", () => {
  it("should accept the approved profile at exchange", async () => {
    expect(await validateTicketForExchange(ticket(), createFixtureAuthority())).not.toBeNull();
  });

  it("should refuse a substituted policy with the same profile name", async () => {
    const consumed = ticket();
    const mutated = { ...createFixtureAuthority(),
      getProfile: async () => ({ name: "demo", policyRevision: "pol-002",
        capabilities: ["geo.read" as const] }) };
    expect(await validateTicketForExchange(consumed, mutated)).toBeNull();
  });

  it("should refuse substituted capabilities with an unchanged revision", async () => {
    const consumed = ticket();
    const mutated = { ...createFixtureAuthority(),
      getProfile: async () => ({ name: "demo", policyRevision: "pol-001",
        capabilities: ["geo.read" as const] }) };
    expect(await validateTicketForExchange(consumed, mutated)).toBeNull();
  });

  it("should refuse exchange after per-artifact approval is withdrawn", async () => {
    const consumed = ticket();
    const base = createFixtureAuthority();
    const revoked = { ...base,
      getRights: async (readerSub: string, artifactId: string) =>
        artifactId === ARTIFACT ? null : base.getRights(readerSub, artifactId) };
    expect(await validateTicketForExchange(consumed, revoked)).toBeNull();
  });
});
