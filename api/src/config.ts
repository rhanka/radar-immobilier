import { z } from "zod";

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

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return envSchema.parse(env);
}
