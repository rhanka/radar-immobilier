import { describe, expect, it, vi } from "vitest";
import { mintGrant } from "./preview-grant.js";
import { createFixtureAuthority, fingerprintReaderProfile } from "./reader-profile.js";
import { createReaderContentApp } from "./content-serve.js";
import { createMemoryReleaseFiles } from "./release-files.js";
import { ClassificationError } from "../services/facets/classification-errors.js";
import {
  GRANT_SECRET,
  HOST,
  ISSUER,
  SESSION_SECRET,
  credentials,
} from "./reader-test-fixture.js";

const ARTIFACT = "123e4567-e89b-12d3-a456-426614174000";
const RELEASE = "123e4567-e89b-12d3-a456-426614174001";
const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const FOREIGN = "22222222-2222-4222-8222-222222222222";
const FINGERPRINT = fingerprintReaderProfile({ name: "demo", policyRevision: "pol-001",
  capabilities: ["geo.read", "signals.protected-read"] });

function searchResponse(matched: number, extra: Record<string, number>) {
  const digest = (ch: string) => ch.repeat(64);
  return {
    ok: true as const, contractVersion: "signal-classifications-v1" as const,
    workspaceId: WORKSPACE, citySlug: "valleyfield", mode: "signal" as const,
    population: "signal_nodes_v1" as const,
    snapshot: { kind: "signal-projection-v1" as const, baseToken: digest("a"),
      queryToken: digest("b"), queryDigest: digest("c"), projectionVersion: "v1", catalogVersion: digest("d") },
    counts: { unit: "distinct_targets" as const, eligible: extra.eligible!, visible: extra.visible!,
      discarded: extra.discarded!, discardedByScope: { personalOnly: extra.personalOnly!,
        workspaceOnly: 0, both: 0 },
      navigation: { basis: "after_content_personal_history_and_archive_before_basket" as const,
        population: extra.population!, pertinent: extra.pertinent!, a_surveiller: extra.surveiller!,
        selectedDistinct: extra.selected!, selectionMemberships: extra.memberships!, unselected: extra.unselected! },
      matched },
    items: [], page: { limit: 20, nextCursor: null, truncated: false },
  };
}

const ALICE = searchResponse(2, { eligible: 2, visible: 2, discarded: 0, personalOnly: 0,
  population: 2, pertinent: 1, surveiller: 1, selected: 2, memberships: 2, unselected: 0 });
const BOB = searchResponse(1, { eligible: 2, visible: 1, discarded: 1, personalOnly: 1,
  population: 2, pertinent: 1, surveiller: 0, selected: 1, memberships: 1, unselected: 1 });

const PUBLISHED_INDEX = `<!doctype html><html><head>` +
  `<link rel="stylesheet" href="/styles.css"></head><body>` +
  `<script src="/app.js"></script></body></html>`;
const PUBLISHED_JS = `const grant = new URLSearchParams(location.search).get("grant");` +
  `fetch("/__reader/api/baskets.search.v1?workspaceId=${WORKSPACE}&citySlug=valleyfield",` +
  ` { headers: { "x-preview-grant": grant } });`;

function buildApp(readOperation: ReturnType<typeof vi.fn>) {
  const provider = createMemoryReleaseFiles([
    { artifactId: ARTIFACT, releaseId: RELEASE, path: "/index.html", body: PUBLISHED_INDEX },
    { artifactId: ARTIFACT, releaseId: RELEASE, path: "/app.js", body: PUBLISHED_JS },
    { artifactId: ARTIFACT, releaseId: RELEASE, path: "/styles.css", body: "body{color:#111}" },
  ]);
  return createReaderContentApp({ authority: createFixtureAuthority(), readOperation: readOperation as never,
    contentBase: "pages.example.test", grantSecret: GRANT_SECRET, sessionSecret: SESSION_SECRET,
    issuer: ISSUER, releaseFiles: provider, now: () => 1_000 });
}

async function grantFor(readerSub: string, sessionId: string): Promise<string> {
  return mintGrant({ ...ISSUER, host: HOST, artifactId: ARTIFACT, releaseId: RELEASE,
    readerSub, sessionId, profileName: "demo", policyRevision: "pol-001", profileFingerprint: FINGERPRINT },
  GRANT_SECRET, 1_000);
}

function stubSearch() {
  return vi.fn(async (_op, _params, context) => {
    const params = _params as { workspaceId: string };
    if (params.workspaceId !== WORKSPACE) throw new ClassificationError("workspace_not_authorized");
    return (context as { readerSub: string }).readerSub === "reader-alice" ? ALICE : BOB;
  });
}

describe("published basket page", () => {
  it("should serve a real HTML/CSS/JS set whose JS can call a basket read", async () => {
    const app = buildApp(stubSearch());
    const cookie = await credentials("reader-alice", "session-1", 1_000);
    const grant = await grantFor("reader-alice", "session-1");
    const page = await app.request(`http://${HOST}/index.html?grant=${grant}`, {
      headers: { host: HOST, cookie },
    });
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain(`/app.js?grant=`);
    expect(html).toContain(`/styles.css?grant=`);
    expect(page.headers.get("content-security-policy")).toContain("script-src 'self'");
    const js = await app.request(`http://${HOST}/app.js?grant=${grant}`, {
      headers: { host: HOST, cookie },
    });
    expect(js.status).toBe(200);
    expect(js.headers.get("content-type")).toContain("text/javascript");
    const api = await app.request(
      `http://${HOST}/__reader/api/baskets.search.v1?workspaceId=${WORKSPACE}&citySlug=valleyfield`, {
        headers: { host: HOST, cookie, "x-preview-grant": grant },
      });
    expect(api.status).toBe(200);
    expect((await api.json() as { counts: { matched: number } }).counts.matched).toBe(2);
  });

  it("should isolate two readers and refuse foreign workspaces", async () => {
    const app = buildApp(stubSearch());
    for (const [reader, session, matched] of [["reader-alice", "s-a", 2], ["reader-bob", "s-b", 1]] as const) {
      const cookie = await credentials(reader, session, 1_000);
      const grant = await grantFor(reader, session);
      const res = await app.request(
        `http://${HOST}/__reader/api/baskets.search.v1?workspaceId=${WORKSPACE}&citySlug=valleyfield`, {
          headers: { host: HOST, cookie, "x-preview-grant": grant },
        });
      expect(res.status).toBe(200);
      expect((await res.json() as { counts: { matched: number } }).counts.matched).toBe(matched);
    }
    const cookie = await credentials("reader-alice", "session-1", 1_000);
    const grant = await grantFor("reader-alice", "session-1");
    const foreign = await app.request(
      `http://${HOST}/__reader/api/baskets.search.v1?workspaceId=${FOREIGN}&citySlug=valleyfield`, {
        headers: { host: HOST, cookie, "x-preview-grant": grant },
      });
    expect(foreign.status).toBe(403);
  });
});
