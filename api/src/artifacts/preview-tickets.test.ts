import { describe, expect, it } from "vitest";
import { createFixtureAuthority, fingerprintReaderProfile } from "./reader-profile.js";
import {
  createTicketStore,
  isTicketProfileCurrent,
  PREVIEW_TICKET_TTL_MS,
} from "./preview-tickets.js";

const INPUT = {
  browserBinding: "browser-secret-at-least-32-characters",
  origin: "https://reader-1.pages.example.test",
  artifactId: "123e4567-e89b-12d3-a456-426614174000",
  releaseId: "123e4567-e89b-12d3-a456-426614174001",
  profileName: "demo",
  policyRevision: "pol-001",
  profileFingerprint: fingerprintReaderProfile({
    name: "demo",
    policyRevision: "pol-001",
    capabilities: ["geo.read", "signals.protected-read"],
  }),
  readerSub: "reader-alice",
  returnTarget: "/index.html",
};

describe("preview ticket store", () => {
  it("should consume a ticket exactly once", () => {
    const store = createTicketStore({ now: () => 1_000 });
    const minted = store.mint(INPUT);
    expect(store.size()).toBe(1);
    expect(store.consume(minted.ticket, INPUT.browserBinding)).not.toBeNull();
    expect(store.consume(minted.ticket, INPUT.browserBinding)).toBeNull();
    expect(store.size()).toBe(0);
  });

  it("should refuse concurrent second consumption", () => {
    const store = createTicketStore({ now: () => 1_000 });
    const minted = store.mint(INPUT);
    const results = [store.consume(minted.ticket, INPUT.browserBinding), store.consume(minted.ticket, INPUT.browserBinding)];
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("should expire tickets after the 60 s bound", () => {
    let now = 1_000;
    const store = createTicketStore({ now: () => now });
    const minted = store.mint(INPUT);
    now += PREVIEW_TICKET_TTL_MS + 1;
    expect(store.consume(minted.ticket, INPUT.browserBinding)).toBeNull();
  });

  it("should reject unknown ticket strings", () => {
    const store = createTicketStore({ now: () => 1_000 });
    expect(store.consume("not-a-ticket", INPUT.browserBinding)).toBeNull();
    expect(store.size()).toBe(0);
  });

  it("should bind the ticket to the approved profile revision", async () => {
    const authority = createFixtureAuthority();
    const profile = (await authority.getProfile(INPUT.artifactId))!;
    const store = createTicketStore({ now: () => 1_000 });
    const minted = store.mint(INPUT);
    expect(minted.policyRevision).toBe("pol-001");
    expect(isTicketProfileCurrent(minted, profile)).toBe(true);
  });

  it("should refuse the same profile name with a substituted policy", async () => {
    const authority = createFixtureAuthority();
    const profile = (await authority.getProfile(INPUT.artifactId))!;
    const store = createTicketStore({ now: () => 1_000 });
    const minted = store.mint(INPUT);
    expect(isTicketProfileCurrent(minted, { ...profile, policyRevision: "pol-002" })).toBe(false);
    expect(
      isTicketProfileCurrent(minted, { ...profile, capabilities: ["geo.read"] }),
    ).toBe(false);
  });
});
