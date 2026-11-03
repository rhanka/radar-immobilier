/**
 * Unit tests for the served-contract pointer reader, precondition P1
 * (I-1A, converged r3 §2 + geo-review-r3 G2).
 *
 * The pointer is read ONLY through the GEO_SERVED_CONTRACT_S3_* credential.
 * Absent or unreadable ⇒ `missing source`, never a fabricated value. Any key
 * outside `exports/immo/` is refused BEFORE any client call (negative test
 * asserts the client is never invoked).
 */
import { describe, expect, it, vi } from "vitest";
import {
  SERVED_CONTRACT_ALLOWED_PREFIX,
  SERVED_CONTRACT_POINTER_KEY,
  assertContractKeyAllowed,
  parseSnapshotSha256,
  readServedContractPointer,
  resolveServedContractStoreConfig,
} from "./served-contract-pointer.js";

const FULL_ENV = {
  GEO_SERVED_CONTRACT_S3_ENDPOINT: "https://s3.example.org",
  GEO_SERVED_CONTRACT_S3_REGION: "bhs",
  GEO_SERVED_CONTRACT_S3_BUCKET: "sentropic-geo",
  GEO_SERVED_CONTRACT_S3_ACCESS_KEY: "AKID",
  GEO_SERVED_CONTRACT_S3_SECRET_KEY: "secret",
};

describe("resolveServedContractStoreConfig (configuration only)", () => {
  it("resolves the full credential from configuration", () => {
    expect(resolveServedContractStoreConfig(FULL_ENV)?.bucket).toBe("sentropic-geo");
  });

  it("resolves to undefined when ANY field is missing (missing source)", () => {
    for (const key of Object.keys(FULL_ENV)) {
      const partial = { ...FULL_ENV };
      delete partial[key as keyof typeof partial];
      expect(resolveServedContractStoreConfig(partial)).toBeUndefined();
    }
    expect(resolveServedContractStoreConfig({})).toBeUndefined();
  });
});

describe("assertContractKeyAllowed (G2 prefix scoping)", () => {
  it("allows the exact pointer key and the served-contract v1 tree", () => {
    expect(assertContractKeyAllowed(SERVED_CONTRACT_POINTER_KEY)).toBe(true);
    expect(
      assertContractKeyAllowed("exports/immo/geo-served-contract/v1/snapshots/abc.json"),
    ).toBe(true);
  });

  it("refuses keys outside exports/immo/geo-served-contract/v1/", () => {
    expect(assertContractKeyAllowed("raw/pv-index/cas/deadbeef.pdf")).toBe(false);
    expect(assertContractKeyAllowed("capture/pv/2024/doc.pdf")).toBe(false);
    expect(assertContractKeyAllowed("exports/other/file.json")).toBe(false);
    expect(assertContractKeyAllowed("exports/immo/other-export/file.json")).toBe(false);
    expect(assertContractKeyAllowed("exports/immo/geo-served-contract/v0/latest.json")).toBe(false);
    expect(assertContractKeyAllowed("pmtiles/qc-zones.pmtiles")).toBe(false);
    expect(assertContractKeyAllowed("")).toBe(false);
  });

  it("refuses path traversal, empty segments and control characters", () => {
    expect(
      assertContractKeyAllowed("exports/immo/geo-served-contract/v1/../../raw/pv-index/cas/deadbeef.pdf"),
    ).toBe(false);
    expect(assertContractKeyAllowed("exports/immo/../raw/pv-index/cas/deadbeef.pdf")).toBe(false);
    expect(
      assertContractKeyAllowed("exports/immo/geo-served-contract/v1//snapshots/abc.json"),
    ).toBe(false);
    expect(
      assertContractKeyAllowed("exports/immo/geo-served-contract/v1/snapshots/ab\nc.json"),
    ).toBe(false);
    expect(
      assertContractKeyAllowed("exports/immo/geo-served-contract/v1/snapshots/ab\rc.json"),
    ).toBe(false);
    expect(
      assertContractKeyAllowed("exports/immo/geo-served-contract/v1/snapshots/ab\tc.json"),
    ).toBe(false);
    expect(
      assertContractKeyAllowed("exports/immo/geo-served-contract/v1/snapshots/ab\u007fc.json"),
    ).toBe(false);
  });

  it("the allowed prefix is exactly exports/immo/geo-served-contract/v1/", () => {
    expect(SERVED_CONTRACT_ALLOWED_PREFIX).toBe("exports/immo/geo-served-contract/v1/");
    expect(SERVED_CONTRACT_POINTER_KEY.startsWith(SERVED_CONTRACT_ALLOWED_PREFIX)).toBe(true);
  });
});

describe("readServedContractPointer (missing source, never fabricated)", () => {
  it("reports missing source when the credential is not configured", async () => {
    const client = { getObjectText: vi.fn() };
    const pointer = await readServedContractPointer({ env: {}, client });
    expect(pointer).toEqual({ status: "missing source", reason: "credential-not-configured" });
    expect(client.getObjectText).not.toHaveBeenCalled();
  });

  it("reports missing source when no client is wired (I-1A state)", async () => {
    const pointer = await readServedContractPointer({ env: FULL_ENV });
    expect(pointer).toEqual({ status: "missing source", reason: "reader-not-wired" });
  });

  it("REFUSES a read outside exports/immo/geo-served-contract/v1/ with ZERO upstream calls (G2 negative)", async () => {
    const client = { getObjectText: vi.fn(async () => "never") };
    const pointer = await readServedContractPointer({
      env: FULL_ENV,
      client,
      key: "raw/pv-index/cas/deadbeef.pdf",
    });
    expect(pointer).toEqual({
      status: "refused",
      reason: "read-outside-exports-immo-refused",
    });
    expect(client.getObjectText).not.toHaveBeenCalled();
  });

  it("REFUSES raw/ and capture/ reads with ZERO upstream calls (prefix-RO negative)", async () => {
    // P1 grantor procedure: a prefix-scoped RO credential is accepted only
    // when reads outside the served-contract tree are refused. raw/ (captured
    // source documents incl. PV PDFs) and capture/ must never be readable.
    for (const key of [
      "raw/pv-index/cas/deadbeef.pdf",
      "capture/pv/2024/doc.pdf",
      "exports/immo/geo-served-contract/v1/../../raw/pv-index/cas/deadbeef.pdf",
      "exports/immo/geo-served-contract/v1/../../capture/pv/2024/doc.pdf",
    ]) {
      const client = { getObjectText: vi.fn(async () => "never") };
      const pointer = await readServedContractPointer({ env: FULL_ENV, client, key });
      expect(pointer).toEqual({
        status: "refused",
        reason: "read-outside-exports-immo-refused",
      });
      expect(client.getObjectText).not.toHaveBeenCalled();
    }
  });

  it("reports missing source when the pointer object is absent", async () => {
    const client = { getObjectText: vi.fn(async () => null) };
    const pointer = await readServedContractPointer({ env: FULL_ENV, client });
    expect(pointer).toEqual({ status: "missing source", reason: "pointer-absent" });
    expect(client.getObjectText).toHaveBeenCalledWith(
      "sentropic-geo",
      SERVED_CONTRACT_POINTER_KEY,
    );
  });

  it("reports missing source when the client throws", async () => {
    const client = {
      getObjectText: vi.fn(async () => {
        throw new Error("AccessDenied");
      }),
    };
    const pointer = await readServedContractPointer({ env: FULL_ENV, client });
    expect(pointer).toEqual({ status: "missing source", reason: "pointer-unreadable" });
  });

  it("reports missing source on invalid or marker-less bodies", async () => {
    const invalid = { getObjectText: vi.fn(async () => "not-json{{{") };
    expect(await readServedContractPointer({ env: FULL_ENV, client: invalid })).toEqual({
      status: "missing source",
      reason: "pointer-invalid",
    });
    const noMarker = { getObjectText: vi.fn(async () => JSON.stringify({ ok: true })) };
    expect(await readServedContractPointer({ env: FULL_ENV, client: noMarker })).toEqual({
      status: "missing source",
      reason: "pointer-without-snapshot",
    });
  });

  it("returns the snapshot marker when the pointer reads", async () => {
    const client = {
      getObjectText: vi.fn(async () =>
        JSON.stringify({ schema_version: "1.0", snapshot_sha256: "deadbeef".repeat(8) }),
      ),
    };
    const pointer = await readServedContractPointer({ env: FULL_ENV, client });
    expect(pointer).toEqual({ status: "ok", snapshotSha256: "deadbeef".repeat(8) });
  });
});

describe("parseSnapshotSha256", () => {
  it("accepts a non-empty marker and rejects anything else", () => {
    expect(parseSnapshotSha256({ snapshot_sha256: "abc123" })).toBe("abc123");
    expect(parseSnapshotSha256({})).toBeUndefined();
    expect(parseSnapshotSha256(null)).toBeUndefined();
    expect(parseSnapshotSha256({ snapshot_sha256: 42 })).toBeUndefined();
  });
});
