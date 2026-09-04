import { describe, expect, it } from "vitest";
import {
  loadConfig,
  resolveAuthConfig,
  resolveGeoDocumentsS3Config,
  resolveGraphPrefix,
} from "./config.js";

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

describe("resolveGraphPrefix (1-store migration)", () => {
  it("defaults to graph/ (baseline unchanged) when GRAPH_S3_PREFIX is unset", () => {
    expect(resolveGraphPrefix(loadConfig({ ...BASE_ENV }))).toBe("graph/");
  });

  it("uses a configured preprod prefix", () => {
    expect(resolveGraphPrefix(loadConfig({ ...BASE_ENV, GRAPH_S3_PREFIX: "graph-preprod/" }))).toBe(
      "graph-preprod/",
    );
  });

  it("normalizes to exactly one trailing slash", () => {
    expect(resolveGraphPrefix(loadConfig({ ...BASE_ENV, GRAPH_S3_PREFIX: "graph-preprod" }))).toBe(
      "graph-preprod/",
    );
    expect(resolveGraphPrefix(loadConfig({ ...BASE_ENV, GRAPH_S3_PREFIX: "graph-preprod///" }))).toBe(
      "graph-preprod/",
    );
  });

  it("falls back to graph/ for an empty prefix", () => {
    expect(resolveGraphPrefix(loadConfig({ ...BASE_ENV, GRAPH_S3_PREFIX: "" }))).toBe("graph/");
  });
});

describe("loadConfig", () => {
  describe("immo→geo document repoint", () => {
    it("is OFF by default and rejects a non-boolean toggle value", () => {
      const config = loadConfig({ ...BASE_ENV });
      expect(config.GEO_DOCUMENTS_REPOINT).toBe(false);
      expect(config.GEO_DOCUMENTS_INDEX_PATH).toBe(
        "work/coverage/geo-pv-cas-sha-slug-index.json",
      );
      expect(() =>
        loadConfig({ ...BASE_ENV, GEO_DOCUMENTS_REPOINT: "yes" }),
      ).toThrow();
    });

    it("resolves the dedicated geo config from GEO_DOCUMENTS_S3_* only (no immo fallback)", () => {
      const config = loadConfig({
        ...BASE_ENV,
        // Immo values are present but must NOT leak into the geo reader.
        SCRAPE_S3_ENDPOINT: "http://immo-should-not-be-used:9000",
        SCRAPE_S3_BUCKET: "radar-immobilier-docs",
        GEO_DOCUMENTS_REPOINT: "1",
        GEO_DOCUMENTS_S3_ENDPOINT: "https://s3.geo.example.test",
        GEO_DOCUMENTS_S3_REGION: "bhs",
        GEO_DOCUMENTS_S3_BUCKET: "sentropic-geo",
        GEO_DOCUMENTS_S3_ACCESS_KEY: "geo-read-access",
        GEO_DOCUMENTS_S3_SECRET_KEY: "geo-read-secret",
        GEO_DOCUMENTS_S3_FORCE_PATH_STYLE: "true",
      });

      expect(config.GEO_DOCUMENTS_REPOINT).toBe(true);
      expect(resolveGeoDocumentsS3Config(config)).toEqual({
        endpoint: "https://s3.geo.example.test",
        region: "bhs",
        bucket: "sentropic-geo",
        accessKey: "geo-read-access",
        secretKey: "geo-read-secret",
        forcePathStyle: true,
      });
    });

    it("requires forcePathStyle (its safe default differs per backend: MinIO true vs OVH false)", () => {
      // All five other geo fields present, force-path-style omitted → fail closed
      // rather than silently defaulting to a value wrong for the target backend.
      const config = loadConfig({
        ...BASE_ENV,
        GEO_DOCUMENTS_REPOINT: "1",
        GEO_DOCUMENTS_S3_ENDPOINT: "https://s3.geo.example.test",
        GEO_DOCUMENTS_S3_REGION: "bhs",
        GEO_DOCUMENTS_S3_BUCKET: "sentropic-geo",
        GEO_DOCUMENTS_S3_ACCESS_KEY: "geo-read-access",
        GEO_DOCUMENTS_S3_SECRET_KEY: "geo-read-secret",
      });
      expect(() => resolveGeoDocumentsS3Config(config)).toThrow(
        "GEO_DOCUMENTS_S3_FORCE_PATH_STYLE is required when GEO_DOCUMENTS_REPOINT=1",
      );
    });

    it("carries forcePathStyle=false through for a virtual-hosted OVH bucket", () => {
      const config = loadConfig({
        ...BASE_ENV,
        GEO_DOCUMENTS_REPOINT: "1",
        GEO_DOCUMENTS_S3_ENDPOINT: "https://s3.bhs.io.cloud.ovh.net",
        GEO_DOCUMENTS_S3_REGION: "bhs",
        GEO_DOCUMENTS_S3_BUCKET: "sentropic-geo",
        GEO_DOCUMENTS_S3_ACCESS_KEY: "geo-read-access",
        GEO_DOCUMENTS_S3_SECRET_KEY: "geo-read-secret",
        GEO_DOCUMENTS_S3_FORCE_PATH_STYLE: "false",
      });
      expect(resolveGeoDocumentsS3Config(config).forcePathStyle).toBe(false);
    });

    it("fails fast instead of inheriting immo config when the geo wiring is incomplete", () => {
      const config = loadConfig({ ...BASE_ENV, GEO_DOCUMENTS_REPOINT: "1" });
      expect(() => resolveGeoDocumentsS3Config(config)).toThrow(
        "GEO_DOCUMENTS_S3_ENDPOINT is required when GEO_DOCUMENTS_REPOINT=1",
      );
    });
  });

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

    it("derives the IdP JWKS URI and the bearer audience allowlist (per-user MCP, D4)", () => {
      const auth = resolveAuthConfig(loadConfig(OIDC_ENV));
      expect(auth.jwksUri).toBe("https://auth.example.test/.well-known/jwks.json");
      // api origin + `${origin}/mcp` (the immo-mcp resource), bounded to our origin.
      expect(auth.bearerAudiences).toEqual([
        "https://immo.example.test",
        "https://immo.example.test/mcp",
      ]);
    });

    it("honours an explicit SENTROPIC_IDP_JWKS_URI override", () => {
      const auth = resolveAuthConfig(
        loadConfig({ ...OIDC_ENV, SENTROPIC_IDP_JWKS_URI: "https://auth.example.test/keys" }),
      );
      expect(auth.jwksUri).toBe("https://auth.example.test/keys");
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
