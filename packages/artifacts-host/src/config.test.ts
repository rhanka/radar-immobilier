import { describe, expect, it } from "vitest";
import {
  readArtifactsEnv,
  resolveArtifactsStorageConfig,
  type ArtifactsConfigInput,
} from "./config.js";

const FULL: ArtifactsConfigInput = {
  storageScope: "scope-01_abc",
  orgId: "org-1",
  s3Bucket: "radar-artifacts-dedicated",
  s3Endpoint: "https://s3.example.net",
  s3Region: "ca-central-1",
  s3AccessKey: "AKIAEXAMPLE",
  s3SecretKey: "secret-example",
};

describe("resolveArtifactsStorageConfig", () => {
  it("stays disabled when every variable is absent or empty", () => {
    expect(resolveArtifactsStorageConfig({})).toEqual({
      enabled: false,
      reason: "artifacts_config_absent",
    });
    expect(
      resolveArtifactsStorageConfig({
        storageScope: "",
        orgId: "   ",
        s3Bucket: undefined,
        s3Endpoint: "",
        s3Region: " ",
        s3AccessKey: "",
        s3SecretKey: "  ",
      }),
    ).toEqual({ enabled: false, reason: "artifacts_config_absent" });
  });

  it("resolves a complete config", () => {
    expect(resolveArtifactsStorageConfig(FULL)).toEqual({
      enabled: true,
      ...FULL,
      s3Endpoint: "https://s3.example.net",
    });
  });

  it("closes on a partial config and names only the missing variables", () => {
    const result = resolveArtifactsStorageConfig({ storageScope: "scope-1",
      s3AccessKey: "AKIAEXAMPLE", s3SecretKey: "secret-example" });
    expect(result).toEqual({ enabled: false, reason: "artifacts_config_incomplete",
      missing: ["ARTIFACTS_ORG_ID", "ARTIFACTS_S3_BUCKET", "ARTIFACTS_S3_ENDPOINT", "ARTIFACTS_S3_REGION"] });
    for (const value of ["AKIAEXAMPLE", "secret-example", "scope-1"]) {
      expect(JSON.stringify(result)).not.toContain(value);
    }
  });

  it("stops on a malformed scope (fail-fast, never silently disabled)", () => {
    for (const scope of ["has space", "scope/x", "scope:1", "..", ""]) {
      if (scope === "") continue; // empty alone is partial, covered above
      expect(() => resolveArtifactsStorageConfig({ ...FULL, storageScope: scope }), scope).toThrow(
        "invalid ARTIFACTS_STORAGE_SCOPE",
      );
    }
  });

  it("stops on a malformed endpoint", () => {
    for (const endpoint of ["not-a-url", "ftp://s3.example.net", "s3.example.net"]) {
      expect(() => resolveArtifactsStorageConfig({ ...FULL, s3Endpoint: endpoint }), endpoint).toThrow(
        "invalid ARTIFACTS_S3_ENDPOINT",
      );
    }
  });
  it("stops on malformed supplied values even when the rest is missing", () => {
    expect(() => resolveArtifactsStorageConfig({ storageScope: "bad/scope" })).toThrow("invalid ARTIFACTS_STORAGE_SCOPE");
    expect(() => resolveArtifactsStorageConfig({ s3Endpoint: "ftp://invalid.example" })).toThrow("invalid ARTIFACTS_S3_ENDPOINT");
  });
  it("closes when the region is missing and rejects malformed complete or partial regions", () => {
    expect(resolveArtifactsStorageConfig({ ...FULL, s3Region: undefined })).toEqual({
      enabled: false, reason: "artifacts_config_incomplete", missing: ["ARTIFACTS_S3_REGION"],
    });
    for (const s3Region of ["CA-central-1", "https://region", "region space", "-region"]) {
      expect(() => resolveArtifactsStorageConfig({ ...FULL, s3Region })).toThrow("invalid ARTIFACTS_S3_REGION");
      expect(() => resolveArtifactsStorageConfig({ s3Region })).toThrow("invalid ARTIFACTS_S3_REGION");
    }
  });
});

describe("readArtifactsEnv", () => {
  it("maps the seven ARTIFACTS_* variables and ignores the rest", () => {
    expect(
      readArtifactsEnv({
        ARTIFACTS_STORAGE_SCOPE: "scope-1",
        ARTIFACTS_ORG_ID: "org-1",
        ARTIFACTS_S3_BUCKET: "bucket-1",
        ARTIFACTS_S3_ENDPOINT: "https://s3.example.net",
        ARTIFACTS_S3_REGION: "ca-central-1",
        ARTIFACTS_S3_ACCESS_KEY: "AK",
        ARTIFACTS_S3_SECRET_KEY: "SK",
        UNRELATED: "x",
      }),
    ).toEqual({
      storageScope: "scope-1",
      orgId: "org-1",
      s3Bucket: "bucket-1",
      s3Endpoint: "https://s3.example.net",
      s3Region: "ca-central-1",
      s3AccessKey: "AK",
      s3SecretKey: "SK",
    });
  });
});
