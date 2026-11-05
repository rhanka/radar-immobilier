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

// Files parity LOT 2 §B.4 — single-range 206/416 with HEAD parity on the
// stable content host. Memory release files keep this suite DB-free: the
// same handler serves the S3-backed files in the parity integration spec.
const ARTIFACT = "123e4567-e89b-12d3-a456-426614174000";
const RELEASE = "123e4567-e89b-12d3-a456-426614174001";
const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const FINGERPRINT = fingerprintReaderProfile({ name: "demo", policyRevision: "pol-001",
  capabilities: ["geo.read", "signals.protected-read"] });

const FONT = Buffer.alloc(1000, 7);
const VIDEO = Buffer.alloc(10_000, 9);

function buildApp() {
  const provider = createMemoryReleaseFiles([
    { artifactId: ARTIFACT, releaseId: RELEASE, path: "/fonts/app.woff2", body: FONT },
    { artifactId: ARTIFACT, releaseId: RELEASE, path: "/assets/clip.mp4", body: VIDEO },
  ]);
  const readOperation = vi.fn(async (_op, params, _context) => {
    if ((params as { workspaceId: string }).workspaceId !== WORKSPACE) {
      throw new ClassificationError("workspace_not_authorized");
    }
    return { ok: true as const, contractVersion: "signal-classifications-v1" as const,
      workspaceId: WORKSPACE, citySlug: "valleyfield", mode: "signal" as const,
      population: "signal_nodes_v1" as const,
      snapshot: { kind: "signal-projection-v1" as const, baseToken: "a".repeat(64),
        queryToken: "b".repeat(64), queryDigest: "c".repeat(64),
        projectionVersion: "v1", catalogVersion: "d".repeat(64) },
      counts: { unit: "distinct_targets" as const, eligible: 1, visible: 1,
        discarded: 0, discardedByScope: { personalOnly: 0, workspaceOnly: 0, both: 0 },
        navigation: { basis: "after_content_personal_history_and_archive_before_basket" as const,
          population: 1, pertinent: 1, a_surveiller: 0, selectedDistinct: 1,
          selectionMemberships: 1, unselected: 0 }, matched: 1 },
      items: [], page: { limit: 20, nextCursor: null, truncated: false } };
  });
  return createReaderContentApp({ authority: createFixtureAuthority(),
    readOperation: readOperation as never,
    contentBase: "pages.example.test", grantSecret: GRANT_SECRET, sessionSecret: SESSION_SECRET,
    issuer: ISSUER, releaseFiles: provider, now: () => 1_000 });
}

async function grantFor(readerSub: string, sessionId: string): Promise<string> {
  return mintGrant({ ...ISSUER, host: HOST, artifactId: ARTIFACT, releaseId: RELEASE,
    readerSub, sessionId, profileName: "demo", policyRevision: "pol-001", profileFingerprint: FINGERPRINT,
    basketScope: true as const },
  GRANT_SECRET, 1_000);
}

describe("single-range content serving", () => {
  it("should serve 206 on a valid range with the byte-range headers", async () => {
    const app = buildApp();
    const cookie = await credentials("reader-alice", "session-1", 1_000, { basketScope: true });
    const grant = await grantFor("reader-alice", "session-1");
    const res = await app.request(`http://${HOST}/assets/clip.mp4?grant=${grant}`, {
      headers: { host: HOST, cookie, range: "bytes=0-99" },
    });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 0-99/10000");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(res.headers.get("content-type")).toContain("video/mp4");
    expect((await res.arrayBuffer()).byteLength).toBe(100);
  });

  it("should answer 416 with the size hint on an unsatisfiable range", async () => {
    const app = buildApp();
    const cookie = await credentials("reader-alice", "session-1", 1_000, { basketScope: true });
    const grant = await grantFor("reader-alice", "session-1");
    const res = await app.request(`http://${HOST}/assets/clip.mp4?grant=${grant}`, {
      headers: { host: HOST, cookie, range: "bytes=99999-" },
    });
    expect(res.status).toBe(416);
    expect(res.headers.get("content-range")).toBe("bytes */10000");
  });

  it("should fall back to the whole file on a malformed range", async () => {
    const app = buildApp();
    const cookie = await credentials("reader-alice", "session-1", 1_000, { basketScope: true });
    const grant = await grantFor("reader-alice", "session-1");
    const res = await app.request(`http://${HOST}/fonts/app.woff2?grant=${grant}`, {
      headers: { host: HOST, cookie, range: "bytes=banana" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(res.headers.get("content-type")).toContain("font/woff2");
    expect((await res.arrayBuffer()).byteLength).toBe(1000);
  });

  it("should keep HEAD parity with the GET range headers and an empty body", async () => {
    const app = buildApp();
    const cookie = await credentials("reader-alice", "session-1", 1_000, { basketScope: true });
    const grant = await grantFor("reader-alice", "session-1");
    const head = await app.request(`http://${HOST}/assets/clip.mp4?grant=${grant}`, {
      method: "HEAD", headers: { host: HOST, cookie, range: "bytes=0-99" },
    });
    expect(head.status).toBe(206);
    expect(head.headers.get("content-range")).toBe("bytes 0-99/10000");
    expect(head.headers.get("content-length")).toBe("100");
    expect((await head.arrayBuffer()).byteLength).toBe(0);
    const headFull = await app.request(`http://${HOST}/assets/clip.mp4?grant=${grant}`, {
      method: "HEAD", headers: { host: HOST, cookie },
    });
    expect(headFull.status).toBe(200);
    expect(headFull.headers.get("content-length")).toBe("10000");
  });
});
