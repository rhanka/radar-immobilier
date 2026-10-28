import { createHmac } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { FacetError } from "../services/facets/target.js";
import type { PwIdentityDomain } from "./write-intent-principal.js";
import { samePwIdentityDomain } from "./write-intent-principal.js";
import { readSessionClaims } from "./preview-session.js";
import { parseContentHost } from "./content-host.js";
import type { GrantIssuer } from "./preview-grant.js";
import type { AuthorityReader } from "./reader-profile.js";
import { adaptGrantToReader } from "./reader-context.js";
import { writeIntentTransaction } from "./write-intent-transaction.js";
import { PUBLISHED_WRITE_POLICY, readPublishedWriteAuthority } from "./published-write-authority.js";
import { WRITE_GRANT_AUDIENCE, WRITE_PROFILE_NAME, SIGNAL_WRITE_OPERATIONS } from "./write-profile.js";
import type { WritePrepareBody } from "./write-intent-schemas.js";
import type { PageWriteAuthority } from "./write-intent-page-authority.js";

export const PW_BOOTSTRAP_PATH = "/__reader/api/facets.write.bootstrap.v1";
export const PW_SCRIPT_PATH = "/__reader/write.js";

export interface PublishedWritePageOptions {
  db: Database;
  scope: string;
  contentBase: string;
  authority: AuthorityReader;
  domain: PwIdentityDomain;
  sessionSecret: string;
  grantSecret: string;
  readIssuer: GrantIssuer;
  permitsWrite: (artifactId: string, releaseId: string) => Promise<boolean>;
  nowMs?: () => number;
}

export function createPublishedWritePage(options: PublishedWritePageOptions) {
  const clock = options.nowMs ?? Date.now;
  const digest = (value: unknown) => createHmac("sha256", options.grantSecret)
    .update(JSON.stringify(value)).digest("hex");
  const grantIssuer = { issuer: options.domain.appOrigin, audience: WRITE_GRANT_AUDIENCE,
    tier: options.domain.tier, identityIssuer: options.domain.identityIssuer };

  async function authenticate(request: Request) {
    if (request.headers.has("authorization") || request.headers.has("x-reader-sub")) return null;
    const session = readSessionClaims(request.headers.get("cookie"), options.sessionSecret, clock());
    const resource = session?.resource;
    const host = request.headers.get("host") ?? new URL(request.url).host;
    const parsed = parseContentHost(host, options.contentBase);
    if (!session || !resource || !session.writeIdentity || parsed.kind !== "pinned" ||
      !samePwIdentityDomain(session.writeIdentity, options.domain) ||
      resource.host !== host || resource.releaseId !== parsed.releaseId ||
      resource.sessionId !== session.sid || resource.readerSub !== session.readerSub ||
      resource.artifactId !== session.artifactId || resource.issuer !== options.readIssuer.issuer ||
      resource.audience !== options.readIssuer.audience || resource.tier !== options.readIssuer.tier ||
      !await adaptGrantToReader(resource, options.authority) ||
      !await options.permitsWrite(session.artifactId, resource.releaseId)) return null;
    const binding = await writeIntentTransaction(options.db, (tx) => readPublishedWriteAuthority(tx, {
      scope: options.scope, artifactId: session.artifactId, releaseId: resource.releaseId, readerSub: session.readerSub,
    }));
    if (session.expiresAt <= clock()) throw new FacetError(401, "page_session_expired");
    const instance = digest(["instance", session.sid, resource.host]);
    const csrf = digest(["csrf", session.sid, resource.host, instance]);
    return { session, resource, binding, instance, csrf };
  }

  async function resolvePage(request: Request, body?: WritePrepareBody): Promise<PageWriteAuthority | null> {
    const page = await authenticate(request);
    if (!page) return null;
    const { session, resource, binding, instance, csrf } = page;
    if (request.method === "POST" && (request.headers.get("origin") !== `https://${resource.host}` ||
      request.headers.get("x-reader-instance") !== instance || request.headers.get("x-reader-csrf") !== csrf)) {
      throw new FacetError(403, "csrf_refused");
    }
    let scope = body ? { workspaceId: body.workspaceId, citySlug: body.target.citySlug } : null;
    if (!scope) {
      const url = new URL(request.url);
      const id = url.searchParams.get("intentId") ?? url.pathname.split("/").at(-1) ?? "";
      if (!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)) return null;
      const result = await options.db.execute(sql`SELECT workspace_id,city_slug FROM pw_write_intents
        WHERE intent_id=${id}::uuid AND page_session_id=${session.sid} AND page_instance_id=${instance}`);
      const row = result.rows[0];
      if (!row) return null;
      scope = { workspaceId: String(row["workspace_id"]), citySlug: String(row["city_slug"]) };
    }
    const jti = digest(["grant", session.sid, scope]);
    return { grant: { ...grantIssuer, jti, sessionId: session.sid, sub: session.readerSub,
      readerSub: session.readerSub, artifactId: session.artifactId, releaseId: resource.releaseId,
      host: resource.host, profileName: WRITE_PROFILE_NAME, profileFingerprint: digest(PUBLISHED_WRITE_POLICY),
      policyRevision: PUBLISHED_WRITE_POLICY, ...scope, operations: SIGNAL_WRITE_OPERATIONS },
    pageInstanceId: instance, pageExpiresAtMs: session.expiresAt, delegationExpiresAtMs: session.expiresAt,
    authorityReferences: { tier: options.domain.tier, policy: PUBLISHED_WRITE_POLICY,
      release: `${options.scope}:${resource.releaseId}`, delegation: jti,
      reader: digest([options.domain, session.readerSub]), grant: jti, page_session: session.sid,
      reader_runtime: JSON.stringify(binding) } };
  }
  return { authenticate, resolvePage, grantIssuer, grantKeyId: "published-write-v1", grantSecret: options.grantSecret };
}
