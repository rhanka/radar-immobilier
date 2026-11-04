import { randomBytes, randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { AuthConfig } from "../config.js";
import { SESSION_COOKIE_NAME, verifySession } from "../services/auth/session.js";
import { fingerprintReaderProfile, type AuthorityReader } from "./reader-profile.js";
import { mintGrant, type GrantIssuer } from "./preview-grant.js";
import { validateTicketForExchange } from "./preview-exchange.js";
import { mintInitCookie, mintRetryCookie, mintSessionCookie, parseCookieHeader, PREVIEW_INIT_COOKIE, PREVIEW_RETRY_COOKIE, readSessionClaims } from "./preview-session.js";
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

/**
 * Stylesheets for the neutral expired page. Unlike the approval page (served
 * on the application origin), the expired page is served on the content host
 * where every /api/* path answers 401: it must use the public content-origin
 * design-kit path /__artifacts/design/… (same-origin, covered by the
 * style-src 'self' CSP below).
 */
export function contentStylesheetLinks(): string {
  return DESIGN_KIT_ASSETS.map((asset) =>
    `<link rel="stylesheet" href="${designKitAssetUrl(asset)}">`).join("");
}

/**
 * Neutral expired-opening page (French, no identifiers).
 *
 * Shown to browsers only, after the single auto-restart below has already
 * failed: every refusal (unknown, reused or expired ticket, origin mismatch,
 * withdrawn approval) renders these exact bytes with the same status, so the
 * page never reveals whether the artifact exists or why it was refused.
 */
export function expiredReaderOpeningHtml(): string {
  return `<!doctype html><html lang="fr" data-st-theme="sent-tech"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>Lien expiré — Radar immobilier</title>` +
    contentStylesheetLinks() +
    `<style>${APPROVAL_STYLE}</style></head><body><main class="reader-approve">` +
    `<div class="st-card reader-approve__card">` +
    `<p class="reader-approve__eyebrow">Radar immobilier</p>` +
    `<h1>Ce lien d'ouverture a expiré</h1>` +
    `<p>Ce lien d'ouverture a expiré. Rouvrir la page depuis ce lien pour obtenir une nouvelle ouverture.</p>` +
    `<a class="st-button st-button--primary st-button--md" href="/__reader/start">Rouvrir la page</a>` +
    `</div></main></body></html>`;
}

/**
 * Lot I2: neutral post-auth refusal (French, no identifiers).
 *
 * Every opening failure behind the application session — unknown label,
 * out-of-scope artifact, non-reader, revoked grant — renders these exact
 * bytes with a 404 status on the control origin, so the page never reveals
 * whether the artifact exists or why it was refused.
 */
export function refusedReaderOpeningHtml(): string {
  return `<!doctype html><html lang="fr" data-st-theme="sent-tech"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>Page non disponible — Radar immobilier</title>` +
    approvalStylesheetLinks() +
    `<style>${APPROVAL_STYLE}</style></head><body><main class="reader-approve">` +
    `<div class="st-card reader-approve__card">` +
    `<p class="reader-approve__eyebrow">Radar immobilier</p>` +
    `<h1>Cette page n'est pas disponible</h1>` +
    `<p>Ce lien est invalide, a expiré, ou vous n'avez pas accès à cette page. Rouvrez-la depuis le lien d'origine.</p>` +
    `</div></main></body></html>`;
}

function wantsBrowserExchange(c: Context): boolean {
  return (c.req.header("accept") ?? "").includes("text/html");
}

function hasExchangeRetry(c: Context): boolean {
  return parseCookieHeader(c.req.header("cookie"), PREVIEW_RETRY_COOKIE) === "1";
}

export function createReaderOpening(deps: {
  auth: AuthConfig; contentBase: string; authority: AuthorityReader; tickets: SharedReaderTickets;
  issuer: GrantIssuer; grantSecret: string; sessionSecret: string;
  now?: () => number;
  writeDomain?: PwIdentityDomain;
  permitsWrite?: (artifactId: string, releaseId: string) => Promise<boolean>;
  getArtifactIdForRelease?: (releaseId: string) => Promise<string | null>;
  /**
   * Lot I1 (R1/a): JIT reconciliation of the preprod sub by verified email,
   * run BEFORE getRights. Absent keeps the historical behaviour (disabled).
   */
  reconcile?: (input: { sub: string; email?: string; emailVerified: boolean; issuer: string }) => Promise<unknown>;
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
  /**
   * Lot I2: shape-only origin check, no existence lookup. Any single-UUID
   * label on the content base is accepted pre-auth; whether it names an
   * artifact, a release or nothing is resolved AFTER authentication, so an
   * anonymous probe cannot distinguish an unknown UUID from a restricted
   * artifact (and no releaseId is ever revealed pre-auth).
   */
  function validContentOriginShape(value: unknown): string | null {
    if (typeof value !== "string") return null;
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.origin !== value) return null;
      return parseContentHost(url.host, deps.contentBase).kind === "content" ? url.origin : null;
    } catch { return null; }
  }
  application.get("/resume", async (c) => {
    const origin = validContentOriginShape(c.req.query("origin"));
    // Restart at the content host so even a long login gets a fresh binding.
    return origin ? c.redirect(`${origin}/__reader/start`, 303) : c.json({ error: "not_found" }, 404);
  });
  /**
   * Lot I2: post-auth label resolution. Runs only behind the application
   * session: a stable (artifact) label opens the current release, an exact
   * (release) label opens that release. Unknown labels and artifact/release
   * id collisions fail closed as refusals.
   */
  async function resolveOpeningLabel(label: string): Promise<{ artifactId: string; requestedRelease?: string } | null> {
    const [artifactRelease, releaseArtifactId] = await Promise.all([
      deps.authority.getRelease(label),
      deps.getArtifactIdForRelease?.(label) ?? null,
    ]);
    if (artifactRelease && releaseArtifactId) return null;
    if (artifactRelease) return { artifactId: artifactRelease.artifactId };
    if (releaseArtifactId) return { artifactId: releaseArtifactId, requestedRelease: label };
    return null;
  }
  async function resolveOpeningOrigin(origin: string): Promise<{ artifactId: string; requestedRelease?: string } | null> {
    try {
      const host = parseContentHost(new URL(origin).host, deps.contentBase);
      if (host.kind !== "content") return null;
      return resolveOpeningLabel(host.id);
    } catch { return null; }
  }
  async function approval(c: Context, input: Record<string, unknown> & {
    requestedRelease?: string | undefined }) {
    if (!deps.auth.enabled || c.req.header("authorization")) return null;
    const token = parseCookieHeader(c.req.header("cookie"), SESSION_COOKIE_NAME);
    const session = token ? await verifySession(token, { sessionSecret: deps.auth.sessionSecret }) : null;
    if (!session || typeof input.artifactId !== "string" || !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(input.artifactId) ||
      typeof input.binding !== "string" || !/^[a-f0-9]{64}$/.test(input.binding)) return null;
    // Lot I2: the artifact/release pair is resolved server-side AFTER
    // authentication (resolveOpeningOrigin); the query/body never selects it.
    const requestedRelease = typeof input.requestedRelease === "string" &&
      /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(input.requestedRelease)
      ? input.requestedRelease : undefined;
    const release = await deps.authority.getRelease(input.artifactId, requestedRelease);
    const profile = await deps.authority.getProfile(input.artifactId);
    const origin = await deps.authority.getContentOrigin(input.artifactId);
    // Lot I1 (R1/a, normative): reconcile the preprod sub by verified email
    // BEFORE getRights, so the first click on a shared link links, then the
    // same flow opens the artifact — no prior step, no DB restore.
    await deps.reconcile?.({ sub: session.sub,
      ...(session.email !== undefined ? { email: session.email } : {}),
      emailVerified: session.emailVerified === true,
      issuer: session.idpIssuer ?? "",
    });
    const rights = await deps.authority.getRights(session.sub, input.artifactId);
    if (!release || !profile || !origin || !rights?.approved) return null;
    let contentOrigin = origin;
    if (input.origin !== undefined) {
      if (typeof input.origin !== "string") return null;
      try {
        const url = new URL(input.origin);
        if (url.protocol !== "https:" || url.origin !== input.origin) return null;
        const host = parseContentHost(url.host, deps.contentBase);
        // Exactly the new hosts: single UUID label matching this release's
        // artifact (stable) or release (exact). Anything else is refused.
        if (host.kind !== "content" ||
          (host.id !== release.artifactId && host.id !== release.releaseId)) return null;
        // Id-collision guard: a label that is both an artifact and a release
        // fails closed instead of serving either.
        const [collisionArtifact, collisionRelease] = await Promise.all([
          deps.authority.getRelease(host.id),
          deps.getArtifactIdForRelease?.(host.id) ?? null,
        ]);
        if (collisionArtifact && collisionRelease) return null;
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
  /**
   * Lot I2: indistinct refusal on every surface. Browsers get the neutral
   * 404 page (same bytes, same status, every cause); machine clients get a
   * typed `not_found` 404 that masks unknown/out-of-scope/non-reader the
   * same way the G2 MCP surfaces do.
   */
  function refusal(c: Context) {
    if (!wantsBrowserExchange(c)) return c.json({ error: "not_found" }, 404);
    c.header("Content-Security-Policy", APPROVAL_BASE_CSP);
    return c.html(refusedReaderOpeningHtml(), 404);
  }
  /** Resolve the content-origin label AFTER authentication, then approve. */
  async function openingInput(c: Context, params: Record<string, unknown>) {
    if (typeof params.origin !== "string") return null;
    const resolved = await resolveOpeningOrigin(params.origin);
    if (!resolved) return null;
    // The artifact/release pair is resolved server-side from the origin
    // label only: drop any client-supplied requestedRelease so the query or
    // body can never select the release (Q3 bounds every version anyway, but
    // the comment below must stay true).
    const clientParams = { ...params };
    delete clientParams.requestedRelease;
    return approval(c, { ...clientParams, ...resolved });
  }
  application.get("/approve", async (c) => {
    const token = parseCookieHeader(c.req.header("cookie"), SESSION_COOKIE_NAME);
    if (!token || !await verifySession(token, { sessionSecret: deps.auth.sessionSecret })) {
      const origin = validContentOriginShape(c.req.query("origin"));
      if (!origin || !deps.auth.enabled || c.req.header("authorization")) return c.json({ error: "unauthenticated" }, 401);
      const returnTo = "/api/v1/artifacts/reader/resume?" + new URLSearchParams({ origin });
      return c.redirect("/api/v1/auth/login?" + new URLSearchParams({ returnTo }), 303);
    }
    const input = await openingInput(c, c.req.query());
    if (!input) return refusal(c);
    // no-referrer makes Chromium send Origin: null on the confirmation POST.
    // Keep the same-origin CSRF check usable without sending referrers off-site.
    c.header("Referrer-Policy", "same-origin");
    // Chromium checks form-action on the 303 chain too. Only the authorized
    // artifact origin may receive the redirect from this same-origin POST.
    c.header("Content-Security-Policy", `default-src 'none'; style-src 'self' '${APPROVAL_STYLE_HASH}'; ` +
      `form-action 'self' ${input.origin}; frame-ancestors 'none'; base-uri 'none'`);
    // Lot I2: neutral opening screen. No basket consent here (deferred to
    // the first H5 call via /__reader/consent) and no author identity: the
    // page opens the document, files and shell-state under the reader's
    // rights, nothing more.
    return c.html(`<!doctype html><html lang="fr" data-st-theme="sent-tech"><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width, initial-scale=1">` +
      `<title>Ouvrir la page — Radar immobilier</title>` +
      approvalStylesheetLinks() +
      `<style>${APPROVAL_STYLE}</style></head><body><main class="reader-approve">` +
      `<div class="st-card reader-approve__card">` +
      `<p class="reader-approve__eyebrow">Radar immobilier</p>` +
      `<h1>Ouvrir la page</h1>` +
      `<p>Cette page partagée s'ouvre avec vos droits actuels.</p>` +
      (input.writeIdentity ? `<p>Cette page peut préparer des actions. Chaque écriture exige votre confirmation dans l’application.</p>` : "") +
      `<form method="post"><input type="hidden" name="artifactId" value="${escape(input.artifactId)}">` +
      `<input type="hidden" name="binding" value="${escape(input.browserBinding)}">` +
      `<input type="hidden" name="origin" value="${escape(input.origin)}">` +
      `<input type="hidden" name="releaseId" value="${escape(input.releaseId)}">` +
      `<input type="hidden" name="profileFingerprint" value="${escape(input.profileFingerprint)}">` +
      `<button class="st-button st-button--primary st-button--md" type="submit">Ouvrir la page</button></form>` +
      `</div></main></body></html>`);
  });
  application.post("/approve", async (c) => {
    if (!deps.auth.enabled || c.req.header("origin") !== deps.auth.appBaseUrl) return c.json({ error: "forbidden_origin" }, 403);
    const input = await openingInput(c, await c.req.parseBody());
    if (!input) return refusal(c);
    const ticket = await deps.tickets.mint(input);
    return c.redirect(`${input.origin}/__reader/exchange?ticket=${ticket.ticket}`, 303);
  });
  /**
   * Lot I2: deferred basket consent. The opening above grants the document
   * only; the FIRST H5 business call (`baskets.context/search/state`,
   * `workspaces.list`) answers `basket_consent_required`, and the bridge
   * navigates here top-level. Same DS page as the former opening screen,
   * moved: it consents to read the READER's own baskets, then mints a
   * basket-scoped session and replays the call once.
   */
  function consentPage(input: { artifactId: string; browserBinding: string; origin: string;
    releaseId: string; profileFingerprint: string; writeIdentity?: unknown }): string {
    return `<!doctype html><html lang="fr" data-st-theme="sent-tech"><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width, initial-scale=1">` +
      `<title>Autoriser la lecture de vos paniers — Radar immobilier</title>` +
      approvalStylesheetLinks() +
      `<style>${APPROVAL_STYLE}</style></head><body><main class="reader-approve">` +
      `<div class="st-card reader-approve__card">` +
      `<p class="reader-approve__eyebrow">Radar immobilier</p>` +
      `<h1>Autoriser la lecture de vos paniers</h1>` +
      `<p>Cette page lit vos propres paniers avec vos droits actuels, jamais ceux de l'auteur.</p>` +
      (input.writeIdentity ? `<p>Cette page peut préparer des actions. Chaque écriture exige votre confirmation dans l’application.</p>` : "") +
      `<form method="post"><input type="hidden" name="artifactId" value="${escape(input.artifactId)}">` +
      `<input type="hidden" name="binding" value="${escape(input.browserBinding)}">` +
      `<input type="hidden" name="origin" value="${escape(input.origin)}">` +
      `<input type="hidden" name="releaseId" value="${escape(input.releaseId)}">` +
      `<input type="hidden" name="profileFingerprint" value="${escape(input.profileFingerprint)}">` +
      `<button class="st-button st-button--primary st-button--md" type="submit">Autoriser et ouvrir</button></form>` +
      `</div></main></body></html>`;
  }
  application.get("/consent", async (c) => {
    const token = parseCookieHeader(c.req.header("cookie"), SESSION_COOKIE_NAME);
    if (!token || !await verifySession(token, { sessionSecret: deps.auth.sessionSecret })) {
      const origin = validContentOriginShape(c.req.query("origin"));
      if (!origin || !deps.auth.enabled || c.req.header("authorization")) return c.json({ error: "unauthenticated" }, 401);
      const returnTo = "/api/v1/artifacts/reader/resume?" + new URLSearchParams({ origin });
      return c.redirect("/api/v1/auth/login?" + new URLSearchParams({ returnTo }), 303);
    }
    const input = await openingInput(c, c.req.query());
    if (!input) return refusal(c);
    c.header("Referrer-Policy", "same-origin");
    c.header("Content-Security-Policy", `default-src 'none'; style-src 'self' '${APPROVAL_STYLE_HASH}'; ` +
      `form-action 'self' ${input.origin}; frame-ancestors 'none'; base-uri 'none'`);
    return c.html(consentPage(input));
  });
  application.post("/consent", async (c) => {
    if (!deps.auth.enabled || c.req.header("origin") !== deps.auth.appBaseUrl) return c.json({ error: "forbidden_origin" }, 403);
    const input = await openingInput(c, await c.req.parseBody());
    if (!input) return refusal(c);
    const ticket = await deps.tickets.mint({ ...input, basketScope: true });
    return c.redirect(`${input.origin}/__reader/exchange?ticket=${ticket.ticket}`, 303);
  });
  content.get("/__reader/start", async (c) => {
    const host = parseContentHost(c.req.header("host"), deps.contentBase);
    // Lot I2: no existence check before authentication. Every well-formed
    // label — stable or exact, known or unknown — takes the same 303 to the
    // control-origin opening, which resolves the label AFTER auth. The
    // pre-auth 303 to the version host (which revealed existence and the
    // releaseId) is gone; only malformed/foreign hosts stay 404.
    if (host.kind !== "content" || !deps.auth.enabled) return c.json({ error: "not_found" }, 404);
    const binding = randomBytes(32).toString("hex");
    // 10-minute binding window aligned with the ticket TTL (DB default) and
    // the approval page lifetime: a tab opened from a Claude link is often
    // approved minutes later, and the previous 60 s cookie expired first.
    c.header("Set-Cookie", mintInitCookie(binding));
    return c.redirect(`${deps.auth.appBaseUrl}/api/v1/artifacts/reader/approve?` +
      new URLSearchParams({ binding, origin: `https://${c.req.header("host")}` }), 303);
  });
  content.get("/__reader/consent", async (c) => {
    const host = parseContentHost(c.req.header("host"), deps.contentBase);
    if (host.kind !== "content" || !deps.auth.enabled) return c.json({ error: "not_found" }, 404);
    // Entry to the deferred basket consent: requires the document session
    // minted at opening (same host). Without it, restart the opening; the
    // consent page itself re-verifies approval and ACL before consenting.
    const session = readSessionClaims(c.req.header("cookie"), deps.sessionSecret, (deps.now ?? Date.now)());
    const bound = session?.resource && `https://${c.req.header("host")}` ===
      `https://${session.resource.host}`;
    if (!session || !bound) {
      if (!wantsBrowserExchange(c)) return c.json({ error: "unauthenticated" }, 401);
      return c.redirect("/__reader/start", 303);
    }
    const resolved = await resolveOpeningLabel(host.id);
    const artifactId = resolved?.artifactId ?? session.artifactId;
    const binding = randomBytes(32).toString("hex");
    c.header("Set-Cookie", mintInitCookie(binding));
    return c.redirect(`${deps.auth.appBaseUrl}/api/v1/artifacts/reader/consent?` +
      new URLSearchParams({ artifactId, binding, origin: `https://${c.req.header("host")}` }), 303);
  });
  content.get("/__reader/exchange", async (c) => {
    applyReaderContentHeaders(c);
    const binding = parseCookieHeader(c.req.header("cookie"), PREVIEW_INIT_COOKIE) ?? "";
    const ticket = await deps.tickets.consume(c.req.query("ticket") ?? "", binding);
    if (!ticket || `https://${c.req.header("host")}` !== ticket.origin ||
      !await validateTicketForExchange(ticket, deps.authority)) {
      // Non-browser clients (fetch, existing contracts) keep the 401 JSON.
      if (!wantsBrowserExchange(c)) return c.json({ error: "unauthenticated" }, 401);
      // Browsers never see raw JSON: the first failure restarts the opening
      // on the same content host with a fresh binding and a fresh approval.
      // The short retry cookie bounds this to a single auto-restart; a
      // second failure renders the neutral expired page instead of looping.
      // Every cause renders the same response, so refusals stay
      // indistinguishable (no artifact/release existence or reason leaks).
      if (hasExchangeRetry(c)) {
        c.header("Content-Security-Policy", APPROVAL_BASE_CSP);
        return c.html(expiredReaderOpeningHtml(), 401);
      }
      c.header("Set-Cookie", mintRetryCookie());
      return c.redirect("/__reader/start", 303);
    }
    const now = (deps.now ?? Date.now)();
    const sid = randomUUID();
    // Lot I2: consent tickets mint a basket-scoped session and grant; the
    // opening ticket stays document-only.
    const basketScope = ticket.basketScope === true ? { basketScope: true as const } : {};
    const resource = { ...deps.issuer, host: new URL(ticket.origin).host,
      artifactId: ticket.artifactId, releaseId: ticket.releaseId, readerSub: ticket.readerSub,
      sessionId: sid, profileName: ticket.profileName, policyRevision: ticket.policyRevision,
      profileFingerprint: ticket.profileFingerprint, ...basketScope };
    const grant = await mintGrant(resource, deps.grantSecret, now);
    const writeIdentity = ticket.writeIdentity && deps.writeDomain &&
      samePwIdentityDomain(ticket.writeIdentity, deps.writeDomain) &&
      await deps.permitsWrite?.(ticket.artifactId, ticket.releaseId) ? deps.writeDomain : undefined;
    c.header("Set-Cookie", mintSessionCookie({ sid, readerSub: ticket.readerSub, artifactId: ticket.artifactId,
      createdAt: now, expiresAt: now + 900_000, resource, ...basketScope,
      ...(writeIdentity ? { writeIdentity } : {}) }, deps.sessionSecret));
    c.header("Set-Cookie", `${PREVIEW_INIT_COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`, { append: true });
    c.header("Set-Cookie", `${PREVIEW_RETRY_COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`, { append: true });
    return c.redirect(`/?grant=${encodeURIComponent(grant)}`, 303);
  });
  return { application, content };
}
