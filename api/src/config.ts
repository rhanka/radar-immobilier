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
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return envSchema.parse(env);
}
