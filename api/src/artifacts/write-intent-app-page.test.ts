// PW-C PWC-02: application documents render server labels only, keep the
// private bootstrap out of URLs, and pin the controlled script by hash.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { PwIntentRow } from "../services/facets/pw-write-store.js";
import {
  APP_LOGIN_PATH,
  APP_SUMMARY_SCRIPT,
  APP_SUMMARY_SCRIPT_HASH,
} from "./write-intent-app-script.js";
import {
  renderWriteIntentLogin,
  renderWriteIntentManagement,
  renderWriteIntentSummary,
} from "./write-intent-app-page.js";

const HEX64 = "a".repeat(64);

function rowFor(operation: string, extra: Record<string, unknown> = {}) {
  return {
    intentId: "11111111-1111-4111-8111-111111111111",
    operation,
    workspaceId: "22222222-2222-4222-8222-222222222222",
    principal: { issuer: "https://auth.example.test", sub: "owner", tier: "preprod" },
    command: {
      operation,
      workspaceId: "22222222-2222-4222-8222-222222222222",
      target: { citySlug: "demo-town", type: "Signal", id: "sig-1" },
      expectedHeadId: null,
      displayedFingerprint: HEX64,
      expectedProjectionToken: HEX64,
      commandKey: "33333333-3333-4333-8333-333333333333",
      expiresAtMs: 1700000000000,
      ...extra,
    },
    commandKey: "33333333-3333-4333-8333-333333333333",
    expectedProjectionToken: HEX64,
    expiresAt: new Date("2026-10-27T12:02:00.000Z"),
    challengeKeyId: "synthetic-key",
    challengeId: "b".repeat(64),
    intentDigest: "c".repeat(64),
  } as unknown as PwIntentRow;
}

function appFor(render: (c: never) => Response) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.header("Cross-Origin-Opener-Policy", "same-origin");
    c.header("Cache-Control", "private, no-store");
    c.header("Vary", "Cookie, Authorization");
    c.header("X-Frame-Options", "DENY");
    await next();
  });
  app.get("/", (c) => render(c as never));
  return app;
}

function servedScript(html: string): string {
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  expect(match).not.toBeNull();
  return match![1]!;
}

function bootstrapOf(html: string): Record<string, unknown> {
  const match = html.match(
    /<script id="pw-bootstrap" type="application\/json">([\s\S]*?)<\/script>/);
  expect(match).not.toBeNull();
  return JSON.parse(match![1]!) as Record<string, unknown>;
}

describe("write intent application documents", () => {
  it.each(["summary", "management", "login"])("should preserve isolation headers on %s", async (kind) => {
    const row = rowFor("facets.signals.personal.select.v1", { basket: "pertinent" });
    const response = await appFor((c) => kind === "login" ? renderWriteIntentLogin(c)
      : kind === "management" ? renderWriteIntentManagement(c, row, { csrf: "csrf" })
        : renderWriteIntentSummary(c, row, { csrf: "csrf", challengeToken: "challenge" })).request("/");
    expect(response.headers.get("cross-origin-opener-policy")).toBe("same-origin");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Cookie, Authorization");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });

  it("should pin the served script bytes with the exported hash and CSP", async () => {
    const res = await appFor((c) => renderWriteIntentSummary(c, rowFor(
      "facets.signals.personal.select.v1", { basket: "pertinent" }),
      { csrf: "csrf", challengeToken: "challenge" })).request("/");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(createHash("sha256").update(servedScript(html)).digest("base64"))
      .toBe(APP_SUMMARY_SCRIPT_HASH);
    expect(createHash("sha256").update(APP_SUMMARY_SCRIPT).digest("base64"))
      .toBe(APP_SUMMARY_SCRIPT_HASH);
    expect(res.headers.get("content-security-policy")).toContain(`script-src 'sha256-${APP_SUMMARY_SCRIPT_HASH}'`);
    expect(res.headers.get("content-security-policy")).toContain("form-action 'self'");
    expect(res.headers.get("content-security-policy")).toContain("connect-src 'self'");
  });

  it.each([
    ["facets.signals.personal.select.v1", { basket: "pertinent" }, "Select a personal basket"],
    ["facets.signals.personal.deselect.v1", { basket: "a_surveiller" }, "Remove a personal basket"],
    ["facets.signals.personal.discard.v1",
      { reasonCode: "NON-PERTINENT", deselect: ["pertinent"], expectedSelectionHeads: { pertinent: null } },
      "Discard for me"],
    ["facets.signals.personal.restore.v1", {}, "Restore for me"],
    ["facets.signals.workspace.discard.v1", { reasonCode: "NON-PERTINENT" }, "Discard for the workspace"],
    ["facets.signals.workspace.restore.v1", {}, "Restore for the workspace"],
  ])("should summarize %s without leaking server secrets", async (operation, extra, title) => {
    const res = await appFor((c) => renderWriteIntentSummary(c, rowFor(operation, extra),
      { csrf: "csrf-value", challengeToken: "challenge-value" })).request("/");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(title);
    const boot = bootstrapOf(html);
    expect(boot).toMatchObject({ csrf: "csrf-value", challengeToken: "challenge-value" });
    expect(JSON.stringify(boot)).not.toContain("synthetic-key");
    expect(html).not.toContain("synthetic-key");
    expect(html).not.toContain("radar_session");
  });

  it("should escape hostile target identifiers in labels and bootstrap", async () => {
    const hostile = `x</dd><script>alert(1)</script>`;
    const row = rowFor("facets.signals.personal.select.v1", { basket: "pertinent" });
    (row.command as { target: { id: string } }).target.id = hostile;
    const html = await (await appFor((c) => renderWriteIntentSummary(c, row,
      { csrf: "csrf", challengeToken: "challenge" })).request("/")).text();
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(bootstrapOf(html).intentId).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("should keep the management view free of business data and challenge", async () => {
    const res = await appFor((c) => renderWriteIntentManagement(c,
      rowFor("facets.signals.personal.discard.v1",
        { reasonCode: "NON-PERTINENT", deselect: ["pertinent"] }),
      { csrf: "csrf-value" })).request("/");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('id="pw-revoke"');
    expect(html).not.toContain('id="pw-confirm"');
    expect(html).not.toContain("Displayed fingerprint");
    expect(html).not.toContain("NON-PERTINENT");
    const boot = bootstrapOf(html);
    expect(boot.csrf).toBe("csrf-value");
    expect(boot.challengeToken).toBeUndefined();
    expect(boot.confirmUrl).toBeUndefined();
  });

  it("should serve the login document with the fixed login link", async () => {
    const app = new Hono();
    app.get("/", (c) => renderWriteIntentLogin(c));
    const response = await app.request("/");
    expect(response.status).toBe(401);
    const html = await response.text();
    expect(html).toContain(`href="${APP_LOGIN_PATH}"`);
    expect(APP_LOGIN_PATH).toBe("/api/v1/auth/login");
    expect(html).not.toContain('<script id="pw-bootstrap"');
  });
});
