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
import { DESIGN_KIT_ASSETS, designKitAssetUrl, type DesignKitAsset } from "@radar/artifacts-host";
import { createDesignKitApp } from "./design-kit.js";
import type { SharedReaderTickets } from "./reader-tickets.js";
import type { PwIdentityDomain } from "./write-intent-principal.js";
import { samePwIdentityDomain } from "./write-intent-principal.js";

/**
 * Page layout for the reader approval form: centering and card rhythm only.
 * Colors, type and components come from the official kit stylesheets; the
 * exact bytes of this block are allow-listed in the approval CSP hash.
 */
export const APPROVAL_STYLE =
  "body{font-family:var(--st-font-sans);background:var(--st-semantic-surface-subtle);" +
  "color:var(--st-semantic-text-primary);margin:0}" +
  ".reader-approve{display:flex;justify-content:center;padding:var(--st-spacing-12) var(--st-spacing-4)}" +
  ".reader-approve__card{display:grid;gap:var(--st-spacing-4);max-width:32rem;width:100%}" +
  ".reader-approve__eyebrow{color:var(--st-semantic-text-muted);font-size:var(--st-typography-label-size);" +
  "font-weight:var(--st-typography-label-weight);letter-spacing:.04em;margin:0;text-transform:uppercase}" +
  ".reader-approve__card h1{font-family:var(--st-font-display);font-size:1.5rem;line-height:1.3;margin:0}" +
  ".reader-approve__facts{display:grid;gap:var(--st-spacing-2);margin:0}" +
  ".reader-approve__facts dt{color:var(--st-semantic-text-muted);font-size:var(--st-typography-label-size)}" +
  ".reader-approve__facts dd{margin:0;overflow-wrap:anywhere}" +
  ".reader-approve__card p{color:var(--st-semantic-text-secondary);font-size:var(--st-typography-control-size);" +
  "line-height:var(--st-typography-field-lineHeight);margin:0}";

/** sha256 of APPROVAL_STYLE, recomputed by design-kit tests. */
export const APPROVAL_STYLE_HASH = "sha256-4pJjQB/O86B2tW1LYkxXgDf+2+hArfYOA0/KodsqmN4=";

export const APPROVAL_BASE_CSP =
  `default-src 'none'; style-src 'self' '${APPROVAL_STYLE_HASH}'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`;

export function approvalStylesheetLinks(): string {
  return DESIGN_KIT_ASSETS.map((asset) =>
    `<link rel="stylesheet" href="${approvalDesignAssetUrl(asset)}">`).join("");
}

export function approvalDesignAssetUrl(asset: DesignKitAsset): string {
  // The application ingress sends / to the UI. Only /api/* reaches this
  // server through the existing nginx proxy; no new ingress is necessary.
  return designKitAssetUrl(asset).replace("/__artifacts/design", "/api/v1/artifacts/reader/design");
}

export function createReaderOpening(deps: {
  auth: AuthConfig; contentBase: string; authority: AuthorityReader; tickets: SharedReaderTickets;
  issuer: GrantIssuer; grantSecret: string; sessionSecret: string;
  now?: () => number;
  writeDomain?: PwIdentityDomain;
  permitsWrite?: (artifactId: string, releaseId: string) => Promise<boolean>;
  getArtifactIdForRelease?: (releaseId: string) => Promise<string | null>;
}) {
  const application = new Hono();
  const content = new Hono();
  application.use("*", bodyLimit({ maxSize: 4096 }));
  const escape = (value: string) => value.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
  application.use("*", async (c, next) => {
    c.header("Cache-Control", "private, no-store");
    c.header("Referrer-Policy", "no-referrer");
    c.header("Content-Security-Policy", APPROVAL_BASE_CSP);
    return next();
  });
  application.route("/design", createDesignKitApp());
  async function readablePinnedOrigin(value: unknown): Promise<string | null> {
    if (typeof value !== "string") return null;
    try {
      const url = new URL(value);
      const host = parseContentHost(url.host, deps.contentBase);
      return url.protocol === "https:" && url.origin === value && host.kind === "pinned" &&
        await deps.getArtifactIdForRelease?.(host.releaseId) ? url.origin : null;
    } catch { return null; }
  }
  application.get("/resume", async (c) => {
    const origin = await readablePinnedOrigin(c.req.query("origin"));
    // Restart at the content host so even a long login gets a fresh binding.
    return origin ? c.redirect(`${origin}/__reader/start`, 303) : c.json({ error: "not_found" }, 404);
  });
  async function approval(c: Context, input: Record<string, unknown>) {
    if (!deps.auth.enabled || c.req.header("authorization")) return null;
    const token = parseCookieHeader(c.req.header("cookie"), SESSION_COOKIE_NAME);
    const session = token ? await verifySession(token, { sessionSecret: deps.auth.sessionSecret }) : null;
    if (!session || typeof input.artifactId !== "string" || !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(input.artifactId) ||
      typeof input.binding !== "string" || !/^[a-f0-9]{64}$/.test(input.binding)) return null;
    let requestedRelease: string | undefined;
    if (typeof input.origin === "string") {
      try {
        const host = parseContentHost(new URL(input.origin).host, deps.contentBase);
        if (host.kind === "pinned") requestedRelease = host.releaseId;
      } catch { return null; }
    }
    const release = await deps.authority.getRelease(input.artifactId, requestedRelease);
    const profile = await deps.authority.getProfile(input.artifactId);
    const origin = await deps.authority.getContentOrigin(input.artifactId);
    const rights = await deps.authority.getRights(session.sub, input.artifactId);
    if (!release || !profile || !origin || !rights?.approved) return null;
    let contentOrigin = origin;
    if (input.origin !== undefined) {
      if (typeof input.origin !== "string") return null;
      try {
        const url = new URL(input.origin);
        if (url.protocol !== "https:" || url.origin !== input.origin) return null;
        const host = parseContentHost(url.host, deps.contentBase);
        if (!(host.kind === "stable" && host.artifactId === release.artifactId) &&
          !(host.kind === "pinned" && host.releaseId === release.releaseId)) return null;
        contentOrigin = input.origin;
      } catch { return null; }
    }
    if (c.req.method === "POST" && (input.releaseId !== release.releaseId ||
      input.profileFingerprint !== fingerprintReaderProfile(profile))) return null;
    const writeIdentity = deps.writeDomain && await deps.permitsWrite?.(release.artifactId, release.releaseId)
      ? deps.writeDomain : undefined;
    return { ...(writeIdentity ? { writeIdentity } : {}), browserBinding: input.binding,
      artifactId: release.artifactId, releaseId: release.releaseId,
      readerSub: session.sub, origin: contentOrigin, profileName: profile.name, policyRevision: profile.policyRevision,
      profileFingerprint: fingerprintReaderProfile(profile), returnTarget: "/" };
  }
  application.get("/approve", async (c) => {
    const token = parseCookieHeader(c.req.header("cookie"), SESSION_COOKIE_NAME);
    if (!token || !await verifySession(token, { sessionSecret: deps.auth.sessionSecret })) {
      const origin = await readablePinnedOrigin(c.req.query("origin"));
      if (!origin || !deps.auth.enabled || c.req.header("authorization")) return c.json({ error: "unauthenticated" }, 401);
      const returnTo = "/api/v1/artifacts/reader/resume?" + new URLSearchParams({ origin });
      return c.redirect("/api/v1/auth/login?" + new URLSearchParams({ returnTo }), 303);
    }
    const input = await approval(c, c.req.query());
    if (!input) return c.json({ error: "unauthenticated" }, 401);
    // no-referrer makes Chromium send Origin: null on the confirmation POST.
    // Keep the same-origin CSRF check usable without sending referrers off-site.
    c.header("Referrer-Policy", "same-origin");
    // Chromium checks form-action on the 303 chain too. Only the authorized
    // artifact origin may receive the redirect from this same-origin POST.
    c.header("Content-Security-Policy", `default-src 'none'; style-src 'self' '${APPROVAL_STYLE_HASH}'; ` +
      `form-action 'self' ${input.origin}; frame-ancestors 'none'; base-uri 'none'`);
    const release = await deps.authority.getRelease(input.artifactId, input.releaseId);
    return c.html(`<!doctype html><html lang="fr" data-st-theme="sent-tech"><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width, initial-scale=1">` +
      `<title>Ouvrir la page — Radar immobilier</title>` +
      approvalStylesheetLinks() +
      `<style>${APPROVAL_STYLE}</style></head><body><main class="reader-approve">` +
      `<div class="st-card reader-approve__card">` +
      `<p class="reader-approve__eyebrow">Radar immobilier</p>` +
      `<h1>Autoriser la lecture de vos paniers</h1>` +
      `<dl class="reader-approve__facts">` +
      `<div><dt>Page</dt><dd>${escape(input.artifactId)}</dd></div>` +
      `<div><dt>Auteur</dt><dd>${escape(release?.authorSub ?? "")}</dd></div>` +
      `<div><dt>Version</dt><dd>${escape(input.releaseId)}</dd></div></dl>` +
      `<p>Cette page lit vos paniers avec vos droits actuels.</p>` +
      (input.writeIdentity ? `<p>Cette page peut préparer des actions. Chaque écriture exige votre confirmation dans l’application.</p>` : "") +
      `<form method="post"><input type="hidden" name="artifactId" value="${escape(input.artifactId)}">` +
      `<input type="hidden" name="binding" value="${escape(input.browserBinding)}">` +
      `<input type="hidden" name="origin" value="${escape(input.origin)}">` +
      `<input type="hidden" name="releaseId" value="${escape(input.releaseId)}">` +
      `<input type="hidden" name="profileFingerprint" value="${escape(input.profileFingerprint)}">` +
      `<button class="st-button st-button--primary st-button--md" type="submit">Autoriser et ouvrir</button></form>` +
      `</div></main></body></html>`);
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
    const artifactId = host.kind === "stable" ? host.artifactId : host.kind === "pinned"
      ? await deps.getArtifactIdForRelease?.(host.releaseId) : null;
    if (!artifactId || !deps.auth.enabled) return c.json({ error: "not_found" }, 404);
    if (host.kind === "stable") {
      const release = await deps.authority.getRelease(artifactId);
      if (!release) return c.json({ error: "not_found" }, 404);
      return c.redirect(`https://${release.releaseId}.pinned.${deps.contentBase}/__reader/start`, 303);
    }
    const binding = randomBytes(32).toString("hex");
    c.header("Set-Cookie", `${PREVIEW_INIT_COOKIE}=${binding}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=60`);
    return c.redirect(`${deps.auth.appBaseUrl}/api/v1/artifacts/reader/approve?` +
      new URLSearchParams({ artifactId, binding, origin: `https://${c.req.header("host")}` }), 303);
  });
  content.get("/__reader/exchange", async (c) => {
    applyReaderContentHeaders(c);
    const binding = parseCookieHeader(c.req.header("cookie"), PREVIEW_INIT_COOKIE) ?? "";
    const ticket = await deps.tickets.consume(c.req.query("ticket") ?? "", binding);
    if (!ticket || `https://${c.req.header("host")}` !== ticket.origin ||
      !await validateTicketForExchange(ticket, deps.authority)) return c.json({ error: "unauthenticated" }, 401);
    const now = (deps.now ?? Date.now)();
    const sid = randomUUID();
    const resource = { ...deps.issuer, host: new URL(ticket.origin).host,
      artifactId: ticket.artifactId, releaseId: ticket.releaseId, readerSub: ticket.readerSub,
      sessionId: sid, profileName: ticket.profileName, policyRevision: ticket.policyRevision,
      profileFingerprint: ticket.profileFingerprint };
    const grant = await mintGrant(resource, deps.grantSecret, now);
    const writeIdentity = ticket.writeIdentity && deps.writeDomain &&
      samePwIdentityDomain(ticket.writeIdentity, deps.writeDomain) &&
      await deps.permitsWrite?.(ticket.artifactId, ticket.releaseId) ? deps.writeDomain : undefined;
    c.header("Set-Cookie", mintSessionCookie({ sid, readerSub: ticket.readerSub, artifactId: ticket.artifactId,
      createdAt: now, expiresAt: now + 900_000, resource,
      ...(writeIdentity ? { writeIdentity } : {}) }, deps.sessionSecret));
    c.header("Set-Cookie", `${PREVIEW_INIT_COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`, { append: true });
    return c.redirect(`/?grant=${encodeURIComponent(grant)}`, 303);
  });
  return { application, content };
}
