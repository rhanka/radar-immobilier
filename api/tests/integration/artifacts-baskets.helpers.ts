import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import { workspaceFixture, workspaceSignal } from "../../src/services/facets/workspace-archive-fixture.js";
import { writeScopedPersonalFacet } from "../../src/services/facets/scoped-writer.js";
import { createBasketReadOperation } from "../../src/artifacts/reader-baskets.js";
import { createReaderContentApp } from "../../src/artifacts/content-serve.js";
import { createStoredReader, BASKET_READER_PROFILE } from "../../src/artifacts/reader-storage.js";
import { createReaderOpening } from "../../src/artifacts/reader-opening.js";
import { createApp } from "../../src/app.js";
import { resolveReaderCursorKeyring } from "../../src/artifacts/reader-cursor-keyring.js";
import { mintGrant } from "../../src/artifacts/preview-grant.js";
import { fingerprintReaderProfile } from "../../src/artifacts/reader-profile.js";
import { mintSessionCookie } from "../../src/artifacts/preview-session.js";
import { GRANT_SECRET, ISSUER, SESSION_SECRET } from "../../src/artifacts/reader-test-fixture.js";
import type { ObjectStore } from "../../src/storage/object-store.js";
import { auth, type Harness } from "./artifacts-h2.helpers.js";

export async function publishedBaskets(h: Harness, options: { native?: boolean; eol?: string } = {}) {
  const data = await workspaceFixture();
  const first = await workspaceSignal(data, "First basket signal");
  const second = await workspaceSignal(data, "Second basket signal");
  for (const signal of [first, second]) await writeScopedPersonalFacet(data.db, data.contributor.sub, data.workspaceId, {
    action: "select", basket: "pertinent", target: signal.target, expectedHeadId: null,
    displayedFingerprint: signal.fingerprint, commandKey: randomUUID(),
  });
  await writeScopedPersonalFacet(data.db, data.moderator.sub, data.workspaceId, {
    action: "select", basket: "pertinent", target: second.target, expectedHeadId: null,
    displayedFingerprint: second.fingerprint, commandKey: randomUUID(),
  });
  for (const person of [data.contributor, data.moderator, data.outsider]) await h.pool.query(
    "INSERT INTO account_users (sub,status) VALUES ($1,'approved')", [person.sub]);
  const ensured = await h.control.handle("ensure", "author-alice", {
    bindingName: randomUUID(), idempotencyKey: randomUUID(),
  });
  expect(ensured.status).toBe(201);
  const artifactId = (ensured.body as { artifactId: string }).artifactId;
  const query = new URLSearchParams({ workspaceId: data.workspaceId, citySlug: "synthetic-city", basket: "pertinent" });
  const files = [
    { path: "index.html", mimeType: "text/html", text: '<!doctype html><link rel="stylesheet" href="/style.css"><body><script src="/main.js"></script></body>' },
    { path: "style.css", mimeType: "text/css", text: "body{color:rgb(17, 34, 51)}" },
    { path: "main.js", mimeType: "text/javascript", text:
      `const grant=new URLSearchParams(location.search).get('grant');` +
      `history.replaceState(null,'',location.pathname);` +
      `fetch('/__reader/api/baskets.search.v1?${query}',{headers:{'x-preview-grant':grant}})` +
      `.then(r=>r.json()).then(r=>{document.body.dataset.matched=String(r.counts.matched);` +
      `document.body.dataset.cookies=document.cookie;document.body.textContent=r.items.map(i=>i.target.id).join(',')});` },
  ];
  if (options.native) {
    const read = files[2]!.text;
    const inline = ["window.dynamicLoaded=new Promise(resolve=>{", 'const s=document.createElement("script");',
      's.src="/dynamic.js?v=1";', "s.onload=resolve;document.head.append(s);", "});",
      'document.body.dataset.inlineReady="1";'].join(options.eol ?? "\n");
    files[0]!.text = '<!doctype html><link rel="stylesheet" href="/style.css"><body data-version="one">' +
      `<script>${inline}</script><script type="module" src="/main.js"></script></body>`;
    files[1]!.text = '@import url("./theme.css");';
    files[2]!.text = 'import {readPage} from "./baskets.js";await window.dynamicLoaded;readPage();';
    files.push({ path: "baskets.js", mimeType: "text/javascript", text: `export function readPage(){${read}}` },
      { path: "theme.css", mimeType: "text/css", text: "body{color:rgb(17,34,51)}" },
      { path: "dynamic.js", mimeType: "text/javascript", text: 'document.body.dataset.dynamicReady="1";' });
  }
  const published = await h.control.handle("publish", "author-alice", { artifactId, files, idempotencyKey: randomUUID() });
  expect(published.status).toBe(201);
  const releaseId = (published.body as { releaseId: string }).releaseId;
  for (const person of [data.contributor, data.moderator, data.outsider]) await h.pool.query(
    "INSERT INTO artifacts.artifact_access (artifact_id,principal_id,permission) VALUES ($1,$2,'read')", [artifactId, person.sub]);
  const host = `${artifactId}.pages.example.test`;
  const ringEnv = { CLASSIFICATION_CURSOR_SECRET: Buffer.alloc(32, 7).toString("base64"), CLASSIFICATION_CURSOR_KEY_ID: "l3-persistent" };
  const stored = () => createStoredReader(h.pool, h.config.storageScope, "pages.example.test", h.blobs);
  const runtime = () => {
    const storage = stored();
    const opening = createReaderOpening({ ...storage, auth, contentBase: "pages.example.test",
      issuer: ISSUER, grantSecret: GRANT_SECRET, sessionSecret: SESSION_SECRET });
    const readerContent = createReaderContentApp({ ...storage, contentBase: "pages.example.test", openingContent: opening.content,
    grantSecret: GRANT_SECRET, sessionSecret: SESSION_SECRET, issuer: ISSUER,
    readOperation: createBasketReadOperation({ db: data.db, store: { head: async () => null } as unknown as ObjectStore,
      classification: { cursorKeyring: resolveReaderCursorKeyring(ringEnv)! } }),
    });
    return createApp({ db: data.db, auth, store: { head: async () => null } as unknown as ObjectStore,
      checkDb: async () => ({ ok: true }), checkObjectStore: async () => ({ ok: true }),
      contentHost: { enabled: true, contentBase: "pages.example.test" }, readerContent, readerOpening: opening.application });
  };
  const credentials = async (sub: string, requestedRelease = releaseId, requestedHost = host) => {
    const now = Date.now();
    const sid = randomUUID();
    const grant = await mintGrant({ ...ISSUER, host: requestedHost, artifactId, releaseId: requestedRelease, readerSub: sub, sessionId: sid,
      profileName: BASKET_READER_PROFILE.name, policyRevision: BASKET_READER_PROFILE.policyRevision,
      profileFingerprint: fingerprintReaderProfile(BASKET_READER_PROFILE) }, GRANT_SECRET, now);
    const cookie = mintSessionCookie({ sid, readerSub: sub, artifactId, createdAt: now, expiresAt: now + 900_000 }, SESSION_SECRET).split(";")[0]!;
    return { grant, cookie, host: requestedHost };
  };
  return { data, first, second, artifactId, releaseId, host, files, stored, runtime, credentials };
}
