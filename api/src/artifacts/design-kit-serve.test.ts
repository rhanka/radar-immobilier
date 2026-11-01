import { describe, expect, it } from "vitest";
import { DESIGN_KIT_ASSETS, DESIGN_KIT_VERSION, validatePublishFilePath } from "@radar/artifacts-host";
import { mintGrant } from "./preview-grant.js";
import { fingerprintReaderProfile } from "./reader-profile.js";
import {
  GRANT_SECRET,
  HOST,
  ISSUER,
  credentials,
  makeApp,
  request,
} from "./reader-test-fixture.js";

const FINGERPRINT = fingerprintReaderProfile({ name: "demo", policyRevision: "pol-001",
  capabilities: ["geo.read", "signals.protected-read"] });
const ARTIFACT_ID = "123e4567-e89b-12d3-a456-426614174000";
const RELEASE_ID = "123e4567-e89b-12d3-a456-426614174001";

async function authorized() {
  const app = makeApp();
  const cookie = await credentials("reader-alice", "session-1", 1_000);
  const grant = await mintGrant(
    { ...ISSUER, host: HOST, artifactId: ARTIFACT_ID, releaseId: RELEASE_ID,
      readerSub: "reader-alice", sessionId: "session-1", profileName: "demo",
      policyRevision: "pol-001", profileFingerprint: FINGERPRINT },
    GRANT_SECRET,
    1_000,
  );
  return { app, cookie, grant };
}

describe("reserved design-kit path", () => {
  it("should serve the pinned stylesheets to an authorized reader on the content origin", async () => {
    const { app, cookie, grant } = await authorized();
    for (const asset of DESIGN_KIT_ASSETS) {
      const res = await request(app, `/__artifacts/design/${DESIGN_KIT_VERSION}/${asset.sha256Hex}/${asset.file}`, cookie, grant);
      expect(res.status, asset.file).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/css");
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      expect(await res.text()).toContain("--st-");
    }
  });

  it("should refuse anonymous readers and unknown or forged design URLs", async () => {
    const { app, cookie, grant } = await authorized();
    const [first] = DESIGN_KIT_ASSETS;
    const url = `/__artifacts/design/${DESIGN_KIT_VERSION}/${first!.sha256Hex}/${first!.file}`;
    expect((await request(app, url)).status).toBe(401);
    expect((await request(app, url, cookie, "forged-grant")).status).toBe(401);
    for (const forged of [
      `/__artifacts/design/ds-0.00.00-r9/${first!.sha256Hex}/${first!.file}`,
      `/__artifacts/design/${DESIGN_KIT_VERSION}/${"0".repeat(64)}/${first!.file}`,
      `/__artifacts/design/${DESIGN_KIT_VERSION}/${first!.sha256Hex}/other.css`,
      `/__artifacts/design/${DESIGN_KIT_VERSION}/${first!.sha256Hex}/..%2Findex.html`,
    ]) {
      expect((await request(app, forged, cookie, grant)).status, forged).toBe(404);
    }
  });

  it("should keep author files from shadowing the reserved prefix", async () => {
    // The publish policy reserves the __artifacts first segment, so no
    // publication can claim the design path; the kit costs no budget bytes.
    expect(validatePublishFilePath("__artifacts/design/x/y/sent-tech.css")).not.toEqual([]);
    const { app, cookie, grant } = await authorized();
    const res = await request(app, `/__artifacts/design/${DESIGN_KIT_VERSION}/${DESIGN_KIT_ASSETS[0]!.sha256Hex}/sent-tech.css/extra`, cookie, grant);
    expect(res.status).toBe(404);
  });
});
