import { z } from "zod";

/**
 * Optional string that treats the empty string as absent.
 * K8s ConfigMaps often set a key to "" to "unset" it; Zod's .optional()
 * accepts undefined but rejects "" against .min(1). This helper normalises
 * "" → undefined before the inner schema runs, so `.min(1).optional()` works
 * as intended even when the env var is present but empty.
 */
function optStr(inner: z.ZodString) {
  return z.preprocess((v) => (v === "" ? undefined : v), inner.optional());
}

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(3000),

  POSTGRES_HOST: z.string().default("postgres"),
  POSTGRES_PORT: z.coerce.number().int().positive().default(5432),
  POSTGRES_USER: z.string().default("radar"),
  POSTGRES_PASSWORD: z.string().default("changeme-dev-only"),
  POSTGRES_DB: z.string().default("radar"),

  S3_ENDPOINT: z.string().url().default("http://minio:9000"),
  S3_REGION: z.string().default("fr-par"),
  S3_BUCKET: z.string().default("radar-immobilier-raw"),
  S3_ACCESS_KEY: z.string().default("minioadmin"),
  S3_SECRET_KEY: z.string().default("minioadmin"),
  /** MinIO needs path-style addressing; Scaleway works with either. */
  S3_FORCE_PATH_STYLE: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),

  /**
   * Dedicated scraping-document store (Scaleway Object Storage `radar-immobilier-docs`
   * in production). Each variable falls back to its S3_* counterpart when absent, so
   * local dev keeps MinIO as the default store without any extra configuration.
   * In production, set these to the SCW bucket credentials (Object Storage scoped
   * keys for `radar-immobilier-docs`, region fr-par) — NEVER commit real secrets.
   */
  SCRAPE_S3_ENDPOINT: z.string().url().optional(),
  SCRAPE_S3_REGION: z.string().optional(),
  SCRAPE_S3_BUCKET: z.string().optional(),
  SCRAPE_S3_ACCESS_KEY: z.string().optional(),
  SCRAPE_S3_SECRET_KEY: z.string().optional(),
  /** When absent, inherits S3_FORCE_PATH_STYLE. Scaleway does not need path-style. */
  SCRAPE_S3_FORCE_PATH_STYLE: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),

  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),

  /**
   * Graph object store — Scaleway bucket that holds graphify `graph/{city}/latest.json`
   * outputs (radar-immobilier-docs-pocs in prod). Falls back to the SCRAPE_S3_*
   * values when absent; those in turn fall back to S3_* (MinIO locally).
   * In production, point these at the same bucket as SCRAPE_S3_* (both targets
   * the `radar-immobilier-docs-pocs` bucket). NEVER commit real secrets.
   */
  GRAPH_S3_ENDPOINT: z.string().url().optional(),
  GRAPH_S3_REGION: z.string().optional(),
  GRAPH_S3_BUCKET: z.string().optional(),
  GRAPH_S3_ACCESS_KEY: z.string().optional(),
  GRAPH_S3_SECRET_KEY: z.string().optional(),
  GRAPH_S3_FORCE_PATH_STYLE: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),

  /**
   * Shared secret that gates the reconciliation-studio WRITE route
   * (POST /api/ontology/:city/patch). Optional: when unset, the write route is
   * disabled and every patch is refused with 401 (fail-closed — the studio stays
   * read-only). Set per-environment; NEVER commit a real secret.
   */
  RADAR_ONTOLOGY_WRITE_TOKEN: z.string().min(1).optional(),

  /**
   * Master switch for the OPTIONAL @sentropic/llm-mesh semantic (LLM-backed)
   * mention extraction (`services/exploitation/semantic-extract.ts`). OFF by
   * default ("0"): radar runs only its deterministic, anti-invention extraction
   * and never reaches a provider (CI/tests stay offline). Set to "1" — together
   * with at least one provider key below — to augment unstructured docs with
   * semantic mentions. The provider keys themselves are read by the shared mesh
   * (`services/chat/mesh-runtime.ts`), not parsed here, so they live alongside
   * the existing chat keys (ANTHROPIC_API_KEY / OPENAI_API_KEY / MISTRAL_API_KEY
   * / GEMINI_API_KEY|GOOGLE_API_KEY / COHERE_API_KEY). For radar-dev, source
   * `../sentropic/.env.prod` into the api process env (see `.env.example`).
   */
  RADAR_LLM_EXTRACTION: z
    .enum(["0", "1"])
    .default("0")
    .transform((v) => v === "1"),

  // ── Sentropic OIDC relying-party (human auth delegation) ───────────────
  // radar is the OIDC RP to the shared sentropic IdP (auth.sent-tech.ca).
  // The flow is authorization_code + PKCE, the id_token is verified against
  // the IdP JWKS, and the api mints its OWN signed session cookie. See
  // deploy/k8s/80-auth.yaml + README "Auth delegation" and services/auth/.
  //
  // ALL of these are OPTIONAL so local dev / tests stay open by default
  // (fail-open, same posture as RADAR_ONTOLOGY_WRITE_TOKEN). Auth is enabled
  // only when both SESSION_SECRET *and* SENTROPIC_OAUTH_CLIENT_SECRET are set
  // (the two secrets the deployment injects from radar-sentropic-auth).
  //
  // Note: optStr() is used here instead of z.string().min(1).optional() because
  // K8s ConfigMaps may set a key to "" to "disable" it. Zod's .min(1) rejects
  // the empty string even with .optional() (which only allows undefined). The
  // optStr() helper normalises "" → undefined so that an empty ConfigMap key is
  // treated as absent and does not trigger a validation error.
  /** IdP issuer origin, e.g. https://auth.sent-tech.ca. Discovery is at
   * `${issuer}/.well-known/openid-configuration`. */
  SENTROPIC_IDP_ISSUER: optStr(z.string().url()),
  /** This app's registered oauth_clients id at the IdP. */
  SENTROPIC_OAUTH_CLIENT_ID: optStr(z.string().min(1)),
  /** Confidential client secret (client_secret_basic). Secret. */
  SENTROPIC_OAUTH_CLIENT_SECRET: optStr(z.string().min(1)),
  /** Absolute redirect_uri registered at the IdP, e.g.
   * https://immo.sent-tech.ca/api/v1/auth/oauth/callback. */
  SENTROPIC_OAUTH_REDIRECT_URI: optStr(z.string().url()),
  /** Space-separated scopes; openid is always required. */
  SENTROPIC_OAUTH_SCOPES: z.string().default("openid profile email"),
  /** Public base URL of this app (the Ingress host). Used to scope the
   * session cookie and as the post-login landing default. */
  AUTH_CALLBACK_BASE_URL: optStr(z.string().url()),
  /** Symmetric key the api uses to sign its OWN session cookie (HS256).
   * Secret — distinct from the IdP. */
  SESSION_SECRET: optStr(z.string().min(1)),
  /** Session cookie lifetime in seconds (default 8h). */
  SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(28800),

  // ── Scaleway Transactional Email (TEM) — emails d'invitation ────────────
  // L'egress SMTP est BLOQUÉ au niveau plateforme sur ce cluster (BR-37b), donc
  // le relais smtp.tem.scw.cloud:587 ne délivre jamais. On envoie via l'API HTTP
  // TEM (POST .../transactional-email/v1alpha1/regions/{region}/emails), comme
  // sentropic. Quand SCW_TEM_SECRET_KEY est absent, le mailer log le lien
  // d'invitation sur stdout (mode dégradé — ne bloque pas la démo).
  SCW_TEM_API_BASE_URL: z.string().default("https://api.scaleway.com"),
  SCW_TEM_REGION: z.string().default("fr-par"),
  SCW_TEM_PROJECT_ID: optStr(z.string().min(1)),
  SCW_TEM_FROM_EMAIL: z.string().default("no-reply@sent-tech.ca"),
  SCW_TEM_FROM_NAME: z.string().default("Radar"),
  SCW_TEM_SECRET_KEY: optStr(z.string().min(1)),
});

export type AppConfig = z.infer<typeof envSchema>;

/**
 * Resolved, effective configuration for the scraping-document S3 store.
 * Each field falls back to the corresponding S3_* value when the SCRAPE_S3_*
 * override is absent, so local dev keeps MinIO without any extra setup.
 */
export interface ScrapeS3Config {
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly accessKey: string;
  readonly secretKey: string;
  readonly forcePathStyle: boolean;
}

/**
 * Derive the effective scraping-store config from a parsed AppConfig.
 * SCW production values (fr-par, radar-immobilier-docs) are the intended
 * overrides; MinIO local defaults are inherited when SCRAPE_S3_* are absent.
 */
export function resolveScrapeS3Config(config: AppConfig): ScrapeS3Config {
  return {
    endpoint: config.SCRAPE_S3_ENDPOINT ?? config.S3_ENDPOINT,
    region: config.SCRAPE_S3_REGION ?? config.S3_REGION,
    bucket: config.SCRAPE_S3_BUCKET ?? "radar-immobilier-docs",
    accessKey: config.SCRAPE_S3_ACCESS_KEY ?? config.S3_ACCESS_KEY,
    secretKey: config.SCRAPE_S3_SECRET_KEY ?? config.S3_SECRET_KEY,
    forcePathStyle:
      config.SCRAPE_S3_FORCE_PATH_STYLE ?? config.S3_FORCE_PATH_STYLE,
  };
}

/**
 * Derive the effective graph object store config from a parsed AppConfig.
 * GRAPH_S3_* override SCRAPE_S3_* which override S3_*. In production the
 * graph snapshots (`graph/{city}/latest.json`) live in the same SCW bucket as
 * the scraped documents (`radar-immobilier-docs-pocs`), so the GRAPH_S3_*
 * vars can simply be left unset and the SCRAPE_S3_* fallback is correct.
 */
export function resolveGraphS3Config(config: AppConfig): ScrapeS3Config {
  const scrape = resolveScrapeS3Config(config);
  return {
    endpoint: config.GRAPH_S3_ENDPOINT ?? scrape.endpoint,
    region: config.GRAPH_S3_REGION ?? scrape.region,
    bucket: config.GRAPH_S3_BUCKET ?? scrape.bucket,
    accessKey: config.GRAPH_S3_ACCESS_KEY ?? scrape.accessKey,
    secretKey: config.GRAPH_S3_SECRET_KEY ?? scrape.secretKey,
    forcePathStyle:
      config.GRAPH_S3_FORCE_PATH_STYLE ?? scrape.forcePathStyle,
  };
}

/**
 * Effective OIDC relying-party configuration, derived from the SENTROPIC_ /
 * SESSION_ env. `enabled` is true only when the deployment injected BOTH the
 * client secret and the session secret (and the non-secret wiring is present),
 * so local dev / tests stay open by default (fail-open). When disabled, the
 * auth routes return 503 and the protect middleware lets every request through.
 */
export interface AuthConfig {
  readonly enabled: boolean;
  readonly issuer: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
  readonly scopes: string;
  /** Public app origin; the cookie + post-login landing default. */
  readonly appBaseUrl: string;
  readonly sessionSecret: string;
  readonly sessionTtlSeconds: number;
}

/**
 * Derive the effective auth config from a parsed AppConfig. Returns
 * `{ enabled: false, ... }` (with empty strings) unless every required field
 * is present — that is the single switch the routes/middleware read.
 */
export function resolveAuthConfig(config: AppConfig): AuthConfig {
  const issuer = config.SENTROPIC_IDP_ISSUER ?? "";
  const clientId = config.SENTROPIC_OAUTH_CLIENT_ID ?? "";
  const clientSecret = config.SENTROPIC_OAUTH_CLIENT_SECRET ?? "";
  const redirectUri = config.SENTROPIC_OAUTH_REDIRECT_URI ?? "";
  const appBaseUrl = config.AUTH_CALLBACK_BASE_URL ?? "";
  const sessionSecret = config.SESSION_SECRET ?? "";

  const enabled =
    issuer !== "" &&
    clientId !== "" &&
    clientSecret !== "" &&
    redirectUri !== "" &&
    sessionSecret !== "";

  return {
    enabled,
    issuer: issuer.replace(/\/$/, ""),
    clientId,
    clientSecret,
    redirectUri,
    scopes: config.SENTROPIC_OAUTH_SCOPES,
    appBaseUrl: appBaseUrl.replace(/\/$/, ""),
    sessionSecret,
    sessionTtlSeconds: config.SESSION_TTL_SECONDS,
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return envSchema.parse(env);
}

/**
 * Effective Scaleway TEM mailer configuration, derived from AppConfig.
 * When SCW_TEM_SECRET_KEY is absent, `enabled` is false and the mailer falls
 * back to logging the invitation link on stdout (fail-open for demo/dev).
 * SMTP is intentionally NOT used: egress on :587 is blocked at the platform
 * level (BR-37b), so all mail goes through the TEM HTTP API.
 */
export interface TemConfig {
  readonly enabled: boolean;
  readonly apiBaseUrl: string;
  readonly region: string;
  readonly projectId?: string | undefined;
  readonly fromEmail: string;
  readonly fromName: string;
  readonly secretKey?: string | undefined;
}

export function resolveTemConfig(config: AppConfig): TemConfig {
  const secretKey = config.SCW_TEM_SECRET_KEY ?? "";
  const tem: TemConfig = {
    enabled: secretKey !== "",
    apiBaseUrl: config.SCW_TEM_API_BASE_URL,
    region: config.SCW_TEM_REGION,
    fromEmail: config.SCW_TEM_FROM_EMAIL,
    fromName: config.SCW_TEM_FROM_NAME,
  };
  // exactOptionalPropertyTypes: only include projectId/secretKey when defined.
  return {
    ...tem,
    ...(config.SCW_TEM_PROJECT_ID !== undefined
      ? { projectId: config.SCW_TEM_PROJECT_ID }
      : {}),
    ...(config.SCW_TEM_SECRET_KEY !== undefined
      ? { secretKey: config.SCW_TEM_SECRET_KEY }
      : {}),
  };
}
