import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { MAP_KIT_ASSETS, MAP_KIT_VERSION, mapKitAssetUrl, validatePublishFilePath } from "@radar/artifacts-host";
import {
  DESIGN_KIT_JS_MIME,
  assertAssetIntegrity,
  createDesignKitApp,
  designKitMimeFor,
  getDesignKitBytes,
} from "../../src/artifacts/design-kit.js";
import { makeApp, request } from "../../src/artifacts/reader-test-fixture.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "..", "fixtures", "map-i4");

describe("map-i4 design-kit serving", () => {
  it("should serve the pinned map bundle on the api mount as public immutable ESM", async () => {
    // The bare kit app is mounted under /design in production
    // (reader-opening) and under /__artifacts/design on content origins:
    // request the mount-relative path here.
    const app = createDesignKitApp();
    for (const asset of MAP_KIT_ASSETS) {
      const first = await app.request(mapKitAssetUrl(asset).replace("/__artifacts/design", ""));
      expect(first.status, asset.file).toBe(200);
      expect(first.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
      expect(first.headers.get("cross-origin-resource-policy")).toBe("same-origin");
      expect(first.headers.get("content-type")).toBe(designKitMimeFor(asset));
      const second = await app.request(mapKitAssetUrl(asset).replace("/__artifacts/design", ""));
      expect(second.status, asset.file).toBe(200);
      const firstBytes = await first.text();
      expect(await second.text(), asset.file).toBe(firstBytes);
      expect(createHash("sha256").update(firstBytes).digest("hex"), asset.file).toBe(asset.sha256Hex);
    }
    const bundle = await (await app.request(mapKitAssetUrl(MAP_KIT_ASSETS[0]!).replace("/__artifacts/design", ""))).text();
    expect(bundle).toContain("export function createMap");
    expect(DESIGN_KIT_JS_MIME).toBe("text/javascript; charset=utf-8");
  });

  it("should return 404 for unknown kits, digests and files on the api mount", async () => {
    const app = createDesignKitApp();
    const [first] = MAP_KIT_ASSETS;
    for (const forged of [
      `/map-v9/${first!.sha256Hex}/${first!.file}`,
      `/${MAP_KIT_VERSION}/${"0".repeat(64)}/${first!.file}`,
      `/${MAP_KIT_VERSION}/${first!.sha256Hex}/other.mjs`,
      `/${MAP_KIT_VERSION}/${first!.sha256Hex}/${first!.file}/extra`,
      `/${MAP_KIT_VERSION}/not-a-digest/${first!.file}`,
    ]) {
      expect((await app.request(forged)).status, forged).toBe(404);
    }
  });

  it("should serve the map bundle on the content mount without reader authorization", async () => {
    const app = makeApp();
    for (const asset of MAP_KIT_ASSETS) {
      const anonymous = await request(app, mapKitAssetUrl(asset));
      expect(anonymous.status, asset.file).toBe(200);
      expect(anonymous.headers.get("content-type")).toContain(
        asset.mediaType === "text/javascript" ? "text/javascript" : "text/css",
      );
      expect(anonymous.headers.get("cache-control"), asset.file)
        .toBe("public, max-age=31536000, immutable");
      expect(createHash("sha256").update(await anonymous.text()).digest("hex")).toBe(asset.sha256Hex);
      const forged = await request(app,
        `/__artifacts/design/${MAP_KIT_VERSION}/${"0".repeat(64)}/${asset.file}`);
      expect(forged.status, asset.file).toBe(404);
      expect(forged.headers.get("cache-control"), asset.file).toBe("private, no-store");
    }
  });

  it("should fail closed on corrupted kit bytes", () => {
    for (const asset of MAP_KIT_ASSETS) {
      const bytes = getDesignKitBytes(asset);
      expect(() => assertAssetIntegrity(asset, bytes)).not.toThrow();
      expect(() => assertAssetIntegrity(asset, `${bytes} `)).toThrow("design_asset_integrity_failed");
      expect(() => assertAssetIntegrity(asset, bytes.slice(1))).toThrow("design_asset_integrity_failed");
      expect(() => assertAssetIntegrity({ ...asset, sizeBytes: asset.sizeBytes + 1 }, bytes))
        .toThrow("design_asset_integrity_failed");
    }
  });

  it("should keep the map base outside the publication budget", () => {
    // The publish policy reserves the __artifacts first segment, so no
    // publication can claim the kit path and the base costs no budget bytes.
    for (const asset of MAP_KIT_ASSETS) {
      expect(validatePublishFilePath(`__artifacts/design/${MAP_KIT_VERSION}/${asset.sha256Hex}/${asset.file}`))
        .not.toEqual([]);
    }
  });

  it("should keep the qualification page under the publication cap without the base", async () => {
    const pageFiles = ["qualif-page.html", "qualif-page.css", "qualif-app.js"].map((file) => ({
      file,
      bytes: readFileSync(join(fixtures, file), "utf8"),
    }));
    const total = pageFiles.reduce((sum, entry) => sum + Buffer.byteLength(entry.bytes), 0);
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThan(262144);
    // The served page renders the template tokens to the pinned kit URLs.
    const html = pageFiles.find((entry) => entry.file === "qualif-page.html")!.bytes
      .replaceAll("{{MAP_BASE_CSS}}", mapKitAssetUrl(MAP_KIT_ASSETS[1]!))
      .replaceAll("{{MAP_BASE_MJS}}", mapKitAssetUrl(MAP_KIT_ASSETS[0]!));
    for (const asset of MAP_KIT_ASSETS) {
      expect(html).toContain(mapKitAssetUrl(asset));
    }
    // The base travels by reference (kit URL), never inlined in page bytes.
    expect(html).not.toContain("export function createMap");
    expect(total + MAP_KIT_ASSETS.reduce((sum, asset) => sum + asset.sizeBytes, 0)).toBeGreaterThan(total);
  });
});
