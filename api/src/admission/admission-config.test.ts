// Lot I1 — unit tests for the admission config resolver (no DB, no network).
import { describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";
import { resolveAdmissionConfig, splitEnvList } from "./admission-config.js";
import { generateAdmissionKeypair } from "./snapshot.js";

describe("splitEnvList", () => {
  it("should split and trim, dropping blanks", () => {
    expect(splitEnvList(undefined)).toEqual([]);
    expect(splitEnvList("")).toEqual([]);
    expect(splitEnvList("https://a.test, https://b.test/ ,,")).toEqual([
      "https://a.test",
      "https://b.test/",
    ]);
  });
});

describe("resolveAdmissionConfig", () => {
  it("should stay closed by default", () => {
    const admission = resolveAdmissionConfig(loadConfig({} as NodeJS.ProcessEnv));
    expect(admission.syncEnabled).toBe(false);
    expect(admission.publicKeys.size).toBe(0);
    expect(admission.trustedIssuers).toEqual([]);
    expect(admission.signingKey).toBeUndefined();
    expect(admission.pushUrl).toBe("");
  });

  it("should enable the sync with keys and issuers", () => {
    const pair = generateAdmissionKeypair();
    const admission = resolveAdmissionConfig(
      loadConfig({
        ADMISSION_SYNC_ENABLED: "1",
        ADMISSION_PROD_PUBLIC_KEYS: pair.publicEntry,
        ADMISSION_TRUSTED_ISSUERS: "https://auth.test,https://preprod.auth.test",
      } as NodeJS.ProcessEnv),
    );
    expect(admission.syncEnabled).toBe(true);
    expect(admission.publicKeys.has(pair.kid)).toBe(true);
    expect(admission.trustedIssuers).toEqual(["https://auth.test", "https://preprod.auth.test"]);
  });

  it("should stay disabled when enabled but keyless", () => {
    const admission = resolveAdmissionConfig(
      loadConfig({ ADMISSION_SYNC_ENABLED: "1" } as NodeJS.ProcessEnv),
    );
    expect(admission.syncEnabled).toBe(false);
  });

  it("should throw on a malformed public key (fail-fast, never silently open)", () => {
    expect(() =>
      resolveAdmissionConfig(
        loadConfig({ ADMISSION_PROD_PUBLIC_KEYS: "garbage" } as NodeJS.ProcessEnv),
      ),
    ).toThrowError(/malformed/);
  });

  it("should resolve a prod emitter with signing key and push URL", () => {
    const pair = generateAdmissionKeypair();
    const admission = resolveAdmissionConfig(
      loadConfig({
        ADMISSION_SIGNING_KEY: pair.privateEntry,
        ADMISSION_SYNC_PUSH_URL: "https://preprod.immo.sent-tech.ca/api/v1/admission/ingest",
      } as NodeJS.ProcessEnv),
    );
    expect(admission.signingKey?.kid).toBe(pair.kid);
    expect(admission.pushUrl).toBe("https://preprod.immo.sent-tech.ca/api/v1/admission/ingest");
  });
});
