import type { AuthConfig } from "../config.js";
import type { Database } from "../db/client.js";
import type { AccountStatusQueryable } from "@radar/artifacts-host";
import type { createStoredReader } from "./reader-storage.js";
import type { GrantIssuer } from "./preview-grant.js";
import { resolvePwIdentityDomain } from "./write-intent-principal.js";
import { createPublishedWritePage, PW_BOOTSTRAP_PATH, PW_SCRIPT_PATH } from "./published-write-page.js";
import { PUBLISHED_WRITE_DECLARATION, PUBLISHED_WRITE_FILE } from "./published-write-authority.js";
import { pageWriteListenerRoute } from "./write-intent-page-listener.js";
import { writeIntentH5Route } from "./write-intent-h5-route.js";
import { createWriteAppSurface } from "./write-intent-app-surface.js";
import { PW_PAGE_SCRIPT } from "./write-intent-page.js";
import { writeIntentError } from "./write-intent-errors.js";

export function createPublishedWriteRuntime(options: {
  db: Database; auth: AuthConfig; accounts: AccountStatusQueryable;
  storage: ReturnType<typeof createStoredReader>; scope: string; contentBase: string;
  readIssuer: GrantIssuer; readGrantSecret: string; sessionSecret: string;
  env: Record<string, string | undefined>;
}) {
  const domain = resolvePwIdentityDomain(options.auth, options.env["PW_IDENTITY_TIER"]);
  const grantSecret = options.env["PW_WRITE_GRANT_SECRET"] ?? "";
  const challengeSecret = options.env["PW_CHALLENGE_SECRET"] ?? "";
  const secrets = [grantSecret, challengeSecret, options.readGrantSecret, options.sessionSecret,
    options.auth.sessionSecret];
  if (!domain || secrets.some((key) => Buffer.byteLength(key) < 32) || new Set(secrets).size !== secrets.length) return null;
  const permitsWrite = async (artifactId: string, releaseId: string) => {
    const file = await options.storage.releaseFiles.getFile(artifactId, releaseId, `/${PUBLISHED_WRITE_FILE}`);
    return !!file && Buffer.from(file.body).toString("utf8") === PUBLISHED_WRITE_DECLARATION;
  };
  const page = createPublishedWritePage({ db: options.db, scope: options.scope,
    contentBase: options.contentBase, authority: options.storage.authority, domain,
    sessionSecret: options.sessionSecret, grantSecret, readIssuer: options.readIssuer, permitsWrite });
  const h5 = { ...page, db: options.db, challengeKeyId: "published-write-v1",
    confirmationBaseUrl: `${domain.appOrigin}/artifact-write/intents`,
    managementBaseUrl: `${domain.appOrigin}/artifact-write/intents`,
    statusBaseUrl: `${domain.appOrigin}/api/v1/artifacts/reader/facets/write-intents` };
  const receiver = writeIntentH5Route(h5);
  const pageWrite = pageWriteListenerRoute({ ...page, contentBase: options.contentBase, applicationOrigin: domain.appOrigin,
    forward: (request) => Promise.resolve(receiver.fetch(request)) });
  for (const path of [PW_BOOTSTRAP_PATH, PW_SCRIPT_PATH]) pageWrite.get(path, async (c) => {
    c.header("Cache-Control", "private, no-store");
    c.header("Vary", "Cookie, Authorization");
    try {
      const reader = await page.authenticate(c.req.raw);
      if (!reader) return c.json({ error: "unauthenticated" }, 401);
      if (path === PW_BOOTSTRAP_PATH) return c.json({ pageInstanceId: reader.instance, csrf: reader.csrf });
      c.header("Content-Type", "text/javascript; charset=utf-8");
      return c.body(`window.__pwWriteCredentials = async function () {
        const response = await fetch(${JSON.stringify(PW_BOOTSTRAP_PATH)}, {credentials:"same-origin"});
        if (!response.ok) throw new Error("write_bootstrap_unavailable");
        const body = await response.json();
        return {"x-reader-instance":body.pageInstanceId,"x-reader-csrf":body.csrf};
      };\n${PW_PAGE_SCRIPT}`);
    } catch (error) { return writeIntentError(c, error); }
  });
  return { domain, permitsWrite, pageWrite, h5,
    application: createWriteAppSurface({ db: options.db, auth: options.auth, domain,
      accounts: options.accounts, sessionSecret: options.auth.sessionSecret,
      challengeKeys: new Map([["published-write-v1", new TextEncoder().encode(challengeSecret)]]) }) };
}
