/**
 * A6 integration: browser-bound init -> atomic ticket -> trust summary.
 * Synthetic fixtures only; no DB, no network, deterministic clocks.
 */
import { describe, expect, it } from "vitest";
import { createFixtureAuthority } from "../../src/artifacts/reader-profile.js";
import { validatePreviewInit } from "../../src/artifacts/preview-init.js";
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
    const ticket = store.mint({ ...INIT, readerSub: "reader-alice" });
    expect(ticket.ticket.length).toBeGreaterThanOrEqual(32);
    expect(ticket.expiresAt).toBe(1_000 + 60_000);
    expect(store.consume(ticket.ticket, INIT.browserBinding)?.readerSub).toBe("reader-alice");
    expect(store.consume(ticket.ticket, INIT.browserBinding)).toBeNull();
  });

  it("should refuse binding mismatches before any ticket exists", async () => {
    const authority = createFixtureAuthority();
    expect(await validatePreviewInit({ ...INIT, origin: "https://evil.example" }, authority)).toBeNull();
    expect(await validatePreviewInit({ ...INIT, artifactId: "artifact-unknown" }, authority)).toBeNull();
    expect(await validatePreviewInit({ ...INIT, returnTarget: "https://evil.example/" }, authority)).toBeNull();
  });
});
