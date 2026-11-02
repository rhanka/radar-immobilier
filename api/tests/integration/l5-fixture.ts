import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import { S3Client } from "@aws-sdk/client-s3";
import { composeArtifactHost, createArtifactControl, createDeleteConfirmation } from "@radar/artifacts-host";
import { workspaceFixture, workspaceSignal } from "../../src/services/facets/workspace-archive-fixture.js";
import { loadConfig } from "../../src/config.js";
import { createTestS3BlobStore } from "../artifacts-blob-store.helpers.js";
import { seedArtifactMemberships } from "./artifacts-membership.helpers.js";
import { createStoredReader } from "../../src/artifacts/reader-storage.js";
import { createPublishedWriteRuntime } from "../../src/artifacts/published-write-runtime.js";
import { PUBLISHED_WRITE_DECLARATION } from "../../src/artifacts/published-write-authority.js";
import { createReaderOpening } from "../../src/artifacts/reader-opening.js";
import { createReaderContentApp } from "../../src/artifacts/content-serve.js";
import { createApp } from "../../src/app.js";
import { normalLogin } from "./pwe-normal-login.js";
import { readProjectionScope } from "../../src/services/facets/projection-revisions.js";
import type { ObjectStore } from "../../src/storage/object-store.js";
import type { WritePrepareBody } from "../../src/artifacts/write-intent-schemas.js";

export const L5_DOMAIN = { identityIssuer: "https://preprod.auth.sent-tech.ca", tier: "preprod" as const,
  appOrigin: "https://preprod.immo.sent-tech.ca", clientId: "l5-synthetic" };
export const L5_ENV = { PW_IDENTITY_TIER: "preprod", PW_WRITE_GRANT_SECRET: "w".repeat(40), PW_CHALLENGE_SECRET: "c".repeat(40) };
export const L5_READ = { issuer: L5_DOMAIN.appOrigin, audience: "l5-reader", tier: "preprod" };
export const L5_READ_KEY = "r".repeat(40), L5_P_KEY = "p".repeat(40);

export async function l5Publication(write = true) {
  const f = await workspaceFixture();
  const signal = await workspaceSignal(f, "Published reader signal");
  const author = `author-${randomUUID()}`;
  await f.pool.query("INSERT INTO account_users(sub,status) VALUES($1,'approved')", [author]);
  await seedArtifactMemberships(f.pool);
  const env = loadConfig(), scope = `l5_${randomUUID().replaceAll("-", "")}`;
  const config = { enabled: true as const, storageScope: scope, orgId: "l5", s3Bucket: env.S3_BUCKET,
    s3Endpoint: env.S3_ENDPOINT, s3Region: "us-east-1", s3AccessKey: env.S3_ACCESS_KEY, s3SecretKey: env.S3_SECRET_KEY };
  const s3 = new S3Client({ endpoint: config.s3Endpoint, forcePathStyle: true, region: config.s3Region,
    credentials: { accessKeyId: config.s3AccessKey, secretAccessKey: config.s3SecretKey } });
  const blobs = createTestS3BlobStore({ client: s3, bucket: config.s3Bucket });
  await f.pool.query("INSERT INTO artifacts.storage_scopes(id,org_id) VALUES($1,$2)", [scope, config.orgId]);
  await f.pool.query("INSERT INTO artifacts.host_quotas(storage_scope_id,operation_limit,byte_limit) VALUES($1,1000,1000000)", [scope]);
  const host = (await composeArtifactHost(f.pool, config, blobs, {
    confirmation: createDeleteConfirmation(f.pool, scope, L5_DOMAIN.appOrigin) }))!;
  const control = createArtifactControl(host, scope, "pages.example.test");
  const ensured = await control.handle("ensure", author, { bindingName: randomUUID(), idempotencyKey: randomUUID() });
  expect(ensured.status).toBe(201);
  const artifactId = (ensured.body as { artifactId: string }).artifactId;
  const published = await control.handle("publish", author, { artifactId, idempotencyKey: randomUUID(), files: [
    { path: "index.html", mimeType: "text/html", text: '<!doctype html><h1>Published L5</h1><script src="/__reader/write.js"></script>' },
    ...(write ? [{ path: "radar-write.json", mimeType: "application/json", text: PUBLISHED_WRITE_DECLARATION }] : []),
  ] });
  expect(published.status).toBe(201);
  const releaseId = (published.body as { releaseId: string }).releaseId;
  const pageHost = `${releaseId}.pinned.pages.example.test`, origin = `https://${pageHost}`;
  for (const person of [f.contributor, f.moderator, f.outsider]) await f.pool.query(
    "INSERT INTO artifacts.artifact_access(artifact_id,principal_id,permission) VALUES($1,$2,'read')", [artifactId, person.sub]);
  return { f, signal, author, scope, artifactId, releaseId, pageHost, origin, control, blobs,
    async close() {
      for (const key of await blobs.listKeys(`artifacts/${scope}/`)) await blobs.deleteBlob(key);
      host.close(); s3.destroy();
    } };
}

export async function l5Fixture(write = true) {
  const publication = await l5Publication(write);
  const { f, signal, author, scope, artifactId, releaseId, pageHost, origin, blobs } = publication;
  const login = await normalLogin(L5_DOMAIN, f.db, f.contributor.sub);
  const storage = createStoredReader(f.pool, scope, "pages.example.test", blobs);
  const runtime = createPublishedWriteRuntime({ db: f.db, auth: login.auth, accounts: f.pool, storage, scope,
    contentBase: "pages.example.test", readIssuer: L5_READ, readGrantSecret: L5_READ_KEY, sessionSecret: L5_P_KEY, env: L5_ENV })!;
  const opening = createReaderOpening({ ...storage, auth: login.auth, contentBase: "pages.example.test", issuer: L5_READ,
    grantSecret: L5_READ_KEY, sessionSecret: L5_P_KEY, writeDomain: runtime.domain, permitsWrite: runtime.permitsWrite });
  const app = createApp({ db: f.db, auth: login.auth, store: {} as ObjectStore, checkDb: async () => ({ ok: true }),
    checkObjectStore: async () => ({ ok: true }), writeH5: runtime.h5, writeApp: runtime.application,
    contentHost: { enabled: true, contentBase: "pages.example.test" }, readerOpening: opening.application,
    readerContent: createReaderContentApp({ ...storage, contentBase: "pages.example.test", issuer: L5_READ,
      grantSecret: L5_READ_KEY, sessionSecret: L5_P_KEY, openingContent: opening.content, pageWrite: runtime.pageWrite }) });
  // Execute the actual PG one-use ticket path; do not manufacture P or write grants.
  const start = await app.request(`${origin}/__reader/start`, { headers: { host: pageHost } });
  const init = start.headers.getSetCookie()[0]!.split(";")[0]!;
  const approvalUrl = start.headers.get("location")!;
  const params = new URL(approvalUrl).searchParams;
  const profile = await storage.authority.getProfile(artifactId);
  const { fingerprintReaderProfile } = await import("../../src/artifacts/reader-profile.js");
  params.set("releaseId", releaseId); params.set("profileFingerprint", fingerprintReaderProfile(profile!));
  const approved = await app.request(`${L5_DOMAIN.appOrigin}/api/v1/artifacts/reader/approve`, { method: "POST",
    headers: { host: new URL(L5_DOMAIN.appOrigin).host, cookie: login.cookie, origin: L5_DOMAIN.appOrigin,
      "content-type": "application/x-www-form-urlencoded" }, body: params.toString() });
  expect(approved.status).toBe(303);
  const exchanged = await app.request(approved.headers.get("location")!, { headers: { host: pageHost, cookie: init } });
  expect(exchanged.status).toBe(303);
  const cookie = exchanged.headers.getSetCookie().find((value) => value.startsWith("__Host-preview-session="))!.split(";")[0]!;
  const headers = { host: pageHost, cookie };
  const readGrant = new URL(exchanged.headers.get("location")!, origin).searchParams.get("grant")!;
  const bootstrap = await app.request(`${origin}/__reader/api/facets.write.bootstrap.v1?workspaceId=${f.workspaceId}`,
    { headers: { ...headers, "x-preview-grant": readGrant } });
  const privatePage = bootstrap.ok ? await bootstrap.json() : null;
  const projection = await readProjectionScope(f.db, f.contributor.sub, f.workspaceId, signal.target.citySlug, "signal");
  const body: WritePrepareBody = { operation: "facets.signals.personal.select.v1", workspaceId: f.workspaceId, target: signal.target,
    basket: "pertinent", expectedHeadId: null, displayedFingerprint: signal.fingerprint, expectedProjectionToken: projection.token };
  const prepare = (extra: Record<string, string> = {}, input: WritePrepareBody = body, key = randomUUID()) => app.request(
    `${origin}/__reader/api/facets.write-intents.prepare.v1`, { method: "POST", headers: { ...headers, origin,
      "content-type": "application/json", "idempotency-key": key, "x-reader-instance": privatePage?.pageInstanceId ?? "",
      "x-reader-csrf": privatePage?.csrf ?? "", ...extra }, body: JSON.stringify(input) });
  return { f, signal, author, scope, artifactId, releaseId, origin, pageHost, headers, cookie, login, runtime, app,
    body, prepare, bootstrap, privatePage, readGrant, close: publication.close };
}
