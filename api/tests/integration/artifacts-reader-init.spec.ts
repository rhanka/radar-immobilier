/**
 * A6 integration: browser-bound init -> atomic ticket -> trust summary.
 * Synthetic fixtures only; no DB, no network, deterministic clocks.
 */
import { describe, expect, it } from "vitest";
import { createFixtureAuthority, fingerprintReaderProfile } from "../../src/artifacts/reader-profile.js";
import { validatePreviewInit } from "../../src/artifacts/preview-init.js";
import { validateTicketForExchange } from "../../src/artifacts/preview-exchange.js";
import { createTicketStore } from "../../src/artifacts/preview-tickets.js";

const INIT = {
  browserBinding: "browser-secret-at-least-32-characters",
  origin: "https://reader-1.pages.example.test",
  artifactId: "123e4567-e89b-12d3-a456-426614174000",
  releaseId: "123e4567-e89b-12d3-a456-426614174001",
  profileName: "demo",
  returnTarget: "/index.html",
};

describe("artifacts reader init and ticket flow", () => {
  it("should validate init, mint one ticket and consume it once", async () => {
    const authority = createFixtureAuthority();
    const summary = await validatePreviewInit(INIT, authority);
    expect(summary).not.toBeNull();
    expect(summary?.authorSub).toBe("author-alice");
    expect(summary?.capabilities).toEqual(["geo.read", "signals.protected-read"]);

    const store = createTicketStore({ now: () => 1_000 });
    const ticket = store.mint({ ...INIT,
      readerSub: "reader-alice",
      policyRevision: summary!.policyRevision,
      profileFingerprint: fingerprintReaderProfile({ name: summary!.profileName,
        policyRevision: summary!.policyRevision,
        capabilities: summary!.capabilities as ("geo.read" | "signals.protected-read")[] }),
    });
    expect(ticket.ticket.length).toBeGreaterThanOrEqual(32);
    expect(ticket.expiresAt).toBe(1_000 + 60_000);
    expect(ticket.policyRevision).toBe(summary!.policyRevision);
    const consumed = store.consume(ticket.ticket, INIT.browserBinding);
    expect(consumed?.readerSub).toBe("reader-alice");
    expect(await validateTicketForExchange(consumed!, authority)).not.toBeNull();
    expect(store.consume(ticket.ticket, INIT.browserBinding)).toBeNull();
  });

  it("should refuse exchange when the policy changes after init", async () => {
    const authority = createFixtureAuthority();
    const summary = (await validatePreviewInit(INIT, authority))!;
    const store = createTicketStore({ now: () => 1_000 });
    const ticket = store.mint({ ...INIT,
      readerSub: "reader-alice",
      policyRevision: summary.policyRevision,
      profileFingerprint: fingerprintReaderProfile({ name: summary.profileName,
        policyRevision: summary.policyRevision,
        capabilities: summary.capabilities as ("geo.read" | "signals.protected-read")[] }),
    });
    const consumed = store.consume(ticket.ticket, INIT.browserBinding)!;
    const mutated = { ...authority,
      getProfile: async () => ({ name: "demo", policyRevision: "pol-002",
        capabilities: ["geo.read" as const] }) };
    expect(await validateTicketForExchange(consumed, mutated)).toBeNull();
  });

  it("should refuse binding mismatches before any ticket exists", async () => {
    const authority = createFixtureAuthority();
    expect(await validatePreviewInit({ ...INIT, origin: "https://evil.example" }, authority)).toBeNull();
    expect(await validatePreviewInit({ ...INIT, artifactId: "artifact-unknown" }, authority)).toBeNull();
    expect(await validatePreviewInit({ ...INIT, returnTarget: "https://evil.example/" }, authority)).toBeNull();
  });
});
