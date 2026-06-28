import { describe, expect, it } from "vitest";
import { loadConfig, resolveAuthConfig } from "./config.js";

// Minimal env that satisfies all required fields (no OIDC wiring).
const BASE_ENV: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  POSTGRES_HOST: "localhost",
  POSTGRES_USER: "radar",
  POSTGRES_PASSWORD: "pw",
  POSTGRES_DB: "radar",
  S3_ENDPOINT: "http://localhost:9000",
  S3_ACCESS_KEY: "minio",
  S3_SECRET_KEY: "minio",
};

describe("loadConfig", () => {
  describe("OIDC disabled (variables absent)", () => {
    it("parses successfully when OIDC vars are undefined", () => {
      const cfg = loadConfig({ ...BASE_ENV });
      expect(cfg.SENTROPIC_OAUTH_CLIENT_ID).toBeUndefined();
      expect(cfg.SENTROPIC_OAUTH_CLIENT_SECRET).toBeUndefined();
      expect(cfg.SESSION_SECRET).toBeUndefined();
    });

    it("parses successfully when OIDC vars are empty strings (K8s ConfigMap 'unset' pattern)", () => {
      const cfg = loadConfig({
        ...BASE_ENV,
        // K8s ConfigMap sets these to "" to intentionally disable OIDC.
        SENTROPIC_OAUTH_CLIENT_ID: "",
        SENTROPIC_OAUTH_CLIENT_SECRET: "",
        SENTROPIC_IDP_ISSUER: "",
        SENTROPIC_OAUTH_REDIRECT_URI: "",
        AUTH_CALLBACK_BASE_URL: "",
        SESSION_SECRET: "",
      });
      // Empty strings must be normalised to undefined — not a validation error.
      expect(cfg.SENTROPIC_OAUTH_CLIENT_ID).toBeUndefined();
      expect(cfg.SENTROPIC_OAUTH_CLIENT_SECRET).toBeUndefined();
      expect(cfg.SESSION_SECRET).toBeUndefined();
    });

    it("resolveAuthConfig returns enabled=false when OIDC vars are absent", () => {
      const cfg = loadConfig({ ...BASE_ENV });
      const auth = resolveAuthConfig(cfg);
      expect(auth.enabled).toBe(false);
    });

    it("resolveAuthConfig returns enabled=false when OIDC vars are empty strings", () => {
      const cfg = loadConfig({
        ...BASE_ENV,
        SENTROPIC_OAUTH_CLIENT_ID: "",
        SENTROPIC_OAUTH_CLIENT_SECRET: "",
        SENTROPIC_IDP_ISSUER: "",
        SENTROPIC_OAUTH_REDIRECT_URI: "",
        AUTH_CALLBACK_BASE_URL: "",
        SESSION_SECRET: "",
      });
      const auth = resolveAuthConfig(cfg);
      expect(auth.enabled).toBe(false);
    });
  });

  describe("OIDC enabled (all required vars present and non-empty)", () => {
    const OIDC_ENV: NodeJS.ProcessEnv = {
      ...BASE_ENV,
      SENTROPIC_IDP_ISSUER: "https://auth.example.test",
      SENTROPIC_OAUTH_CLIENT_ID: "radar-immobilier",
      SENTROPIC_OAUTH_CLIENT_SECRET: "super-secret",
      SENTROPIC_OAUTH_REDIRECT_URI: "https://immo.example.test/api/v1/auth/oauth/callback",
      AUTH_CALLBACK_BASE_URL: "https://immo.example.test",
      SESSION_SECRET: "session-signing-key-min-32-chars-x",
    };

    it("parses successfully with all OIDC vars present", () => {
      const cfg = loadConfig(OIDC_ENV);
      expect(cfg.SENTROPIC_OAUTH_CLIENT_ID).toBe("radar-immobilier");
      expect(cfg.SESSION_SECRET).toBe("session-signing-key-min-32-chars-x");
    });

    it("resolveAuthConfig returns enabled=true when all required fields are set", () => {
      const cfg = loadConfig(OIDC_ENV);
      const auth = resolveAuthConfig(cfg);
      expect(auth.enabled).toBe(true);
      expect(auth.issuer).toBe("https://auth.example.test");
      expect(auth.clientId).toBe("radar-immobilier");
    });
  });

  describe("session lifetime (durable session — wp5 §B)", () => {
    it("defaults SESSION_TTL_SECONDS to 15 days (was 8h — root cause of re-auth churn)", () => {
      const cfg = loadConfig({ ...BASE_ENV });
      expect(cfg.SESSION_TTL_SECONDS).toBe(1_296_000);
      expect(resolveAuthConfig(cfg).sessionTtlSeconds).toBe(1_296_000);
    });

    it("defaults SESSION_ABSOLUTE_TTL_SECONDS to 30 days (sliding ceiling)", () => {
      const cfg = loadConfig({ ...BASE_ENV });
      expect(cfg.SESSION_ABSOLUTE_TTL_SECONDS).toBe(2_592_000);
      expect(resolveAuthConfig(cfg).sessionAbsoluteTtlSeconds).toBe(2_592_000);
    });

    it("honours explicit SESSION_TTL_SECONDS / SESSION_ABSOLUTE_TTL_SECONDS overrides", () => {
      const cfg = loadConfig({
        ...BASE_ENV,
        SESSION_TTL_SECONDS: "604800",
        SESSION_ABSOLUTE_TTL_SECONDS: "1209600",
      });
      const auth = resolveAuthConfig(cfg);
      expect(auth.sessionTtlSeconds).toBe(604800);
      expect(auth.sessionAbsoluteTtlSeconds).toBe(1209600);
    });
  });
});
