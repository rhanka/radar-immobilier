import { randomBytes, randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { AuthConfig } from "../config.js";
import { SESSION_COOKIE_NAME, verifySession } from "../services/auth/session.js";
import { fingerprintReaderProfile, type AuthorityReader } from "./reader-profile.js";
import { mintGrant, type GrantIssuer } from "./preview-grant.js";
import { validateTicketForExchange } from "./preview-exchange.js";
import { mintSessionCookie, parseCookieHeader, PREVIEW_INIT_COOKIE } from "./preview-session.js";
import { parseContentHost } from "./content-host.js";
import { applyReaderContentHeaders } from "./content-isolation.js";
import type { SharedReaderTickets } from "./reader-tickets.js";

export function createReaderOpening(deps: {
  auth: AuthConfig; contentBase: string; authority: AuthorityReader; tickets: SharedReaderTickets;
  issuer: GrantIssuer; grantSecret: string; sessionSecret: string;
  now?: () => number;
}) {
  const application = new Hono();
  const content = new Hono();
  application.use("*", bodyLimit({ maxSize: 4096 }));
  const escape = (value: string) => value.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
  application.use("*", async (c, next) => {
    c.header("Cache-Control", "private, no-store");
    c.header("Referrer-Policy", "no-referrer");
    c.header("Content-Security-Policy", "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    return next();
  });
  async function approval(c: Context, input: Record<string, unknown>) {
    if (!deps.auth.enabled || c.req.header("authorization")) return null;
    const token = parseCookieHeader(c.req.header("cookie"), SESSION_COOKIE_NAME);
    const session = token ? await verifySession(token, { sessionSecret: deps.auth.sessionSecret }) : null;
    if (!session || typeof input.artifactId !== "string" || !/^[a-f0-9-]{36}$/.test(input.artifactId) ||
      typeof input.binding !== "string" || !/^[a-f0-9]{64}$/.test(input.binding)) return null;
    const release = await deps.authority.getRelease(input.artifactId);
    const profile = await deps.authority.getProfile(input.artifactId);
    const origin = await deps.authority.getContentOrigin(input.artifactId);
    const rights = await deps.authority.getRights(session.sub, input.artifactId);
    if (!release || !profile || !origin || !rights?.approved) return null;
    return { browserBinding: input.binding, artifactId: release.artifactId, releaseId: release.releaseId,
      readerSub: session.sub, origin, profileName: profile.name, policyRevision: profile.policyRevision,
      profileFingerprint: fingerprintReaderProfile(profile), returnTarget: "/" };
  }
  application.get("/approve", async (c) => {
    const input = await approval(c, c.req.query());
    if (!input) return c.json({ error: "unauthenticated" }, 401);
    const release = await deps.authority.getRelease(input.artifactId);
    return c.html(`<!doctype html><html lang="fr"><meta charset="utf-8"><title>Ouvrir la page</title>` +
      `<h1>Autoriser la lecture de vos paniers</h1><p>Page : ${escape(input.artifactId)}</p>` +
      `<p>Auteur : ${escape(release?.authorSub ?? "")}</p>` +
      `<p>Version : ${escape(input.releaseId)}. Cette page lit vos paniers avec vos droits actuels.</p>` +
      `<form method="post"><input type="hidden" name="artifactId" value="${escape(input.artifactId)}">` +
      `<input type="hidden" name="binding" value="${escape(input.browserBinding)}">` +
      `<button type="submit">Autoriser et ouvrir</button></form></html>`);
  });
  application.post("/approve", async (c) => {
    if (!deps.auth.enabled || c.req.header("origin") !== deps.auth.appBaseUrl) return c.json({ error: "forbidden_origin" }, 403);
    const input = await approval(c, await c.req.parseBody());
    if (!input) return c.json({ error: "unauthenticated" }, 401);
    const ticket = await deps.tickets.mint(input);
    return c.redirect(`${input.origin}/__reader/exchange?ticket=${ticket.ticket}`, 303);
  });
  content.get("/__reader/start", async (c) => {
    const host = parseContentHost(c.req.header("host"), deps.contentBase);
    if (host.kind !== "stable" || !deps.auth.enabled) return c.json({ error: "not_found" }, 404);
    const binding = randomBytes(32).toString("hex");
    c.header("Set-Cookie", `${PREVIEW_INIT_COOKIE}=${binding}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=60`);
    return c.redirect(`${deps.auth.appBaseUrl}/api/v1/artifacts/reader/approve?` +
      new URLSearchParams({ artifactId: host.artifactId, binding }), 303);
  });
  content.get("/__reader/exchange", async (c) => {
    applyReaderContentHeaders(c);
    const binding = parseCookieHeader(c.req.header("cookie"), PREVIEW_INIT_COOKIE) ?? "";
    const ticket = await deps.tickets.consume(c.req.query("ticket") ?? "", binding);
    if (!ticket || `https://${c.req.header("host")}` !== ticket.origin ||
      !await validateTicketForExchange(ticket, deps.authority)) return c.json({ error: "unauthenticated" }, 401);
    const now = (deps.now ?? Date.now)();
    const sid = randomUUID();
    const grant = await mintGrant({ ...deps.issuer, host: new URL(ticket.origin).host,
      artifactId: ticket.artifactId, releaseId: ticket.releaseId, readerSub: ticket.readerSub,
      sessionId: sid, profileName: ticket.profileName, policyRevision: ticket.policyRevision,
      profileFingerprint: ticket.profileFingerprint }, deps.grantSecret, now);
    c.header("Set-Cookie", mintSessionCookie({ sid, readerSub: ticket.readerSub, artifactId: ticket.artifactId,
      createdAt: now, expiresAt: now + 900_000 }, deps.sessionSecret));
    c.header("Set-Cookie", `${PREVIEW_INIT_COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`, { append: true });
    return c.redirect(`/?grant=${encodeURIComponent(grant)}`, 303);
  });
  return { application, content };
}
