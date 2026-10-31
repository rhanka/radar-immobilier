import { DEFAULT_S3_BUDGET, S3_RETRY_HEADROOM_MS, type ArtifactS3Budget } from "./s3-timeout.js";

/** Optional S3 time budget overrides; absent values keep DEFAULT_S3_BUDGET. */
export interface ArtifactsS3BudgetInput {
  readonly attemptTimeoutMs?: string | undefined;
  readonly maxAttempts?: string | undefined;
  readonly operationTimeoutMs?: string | undefined;
}

export interface ArtifactsConfigInput {
  readonly storageScope?: string | undefined;
  readonly orgId?: string | undefined;
  readonly s3Bucket?: string | undefined;
  readonly s3Endpoint?: string | undefined;
  readonly s3Region?: string | undefined;
  readonly s3AccessKey?: string | undefined;
  readonly s3SecretKey?: string | undefined;
  /** Tuning only: never counted as present or missing configuration. */
  readonly s3Budget?: ArtifactsS3BudgetInput | undefined;
}

type RequiredConfigKey = Exclude<keyof ArtifactsConfigInput, "s3Budget">;

export type ArtifactsDisabledReason = "artifacts_config_absent" | "artifacts_config_incomplete";

export type ArtifactsStorageConfig =
  | {
      readonly enabled: true;
      readonly storageScope: string;
      readonly orgId: string;
      readonly s3Bucket: string;
      readonly s3Endpoint: string;
      readonly s3Region: string;
      readonly s3AccessKey: string;
      readonly s3SecretKey: string;
      /** Resolved by resolveArtifactsStorageConfig; composition defaults it when omitted. */
      readonly s3Budget?: ArtifactS3Budget | undefined;
    }
  | { readonly enabled: false; readonly reason: ArtifactsDisabledReason; readonly missing?: string[] };

const STORAGE_SCOPE_RE = /^[A-Za-z0-9_-]+$/;

function present(value: string | undefined): boolean {
  return value !== undefined && value.trim() !== "";
}

const S3_BUDGET_VARS = {
  attemptTimeoutMs: "ARTIFACTS_S3_ATTEMPT_TIMEOUT_MS",
  maxAttempts: "ARTIFACTS_S3_MAX_ATTEMPTS",
  operationTimeoutMs: "ARTIFACTS_S3_OPERATION_TIMEOUT_MS",
} as const;

const S3_BUDGET_BOUNDS: Record<keyof ArtifactS3Budget, readonly [number, number]> = {
  attemptTimeoutMs: [500, 30_000],
  maxAttempts: [1, 5],
  operationTimeoutMs: [500, 120_000],
};

function budgetValue(input: ArtifactsS3BudgetInput, key: keyof ArtifactS3Budget): number | undefined {
  const raw = input[key];
  if (!present(raw)) return undefined;
  const [min, max] = S3_BUDGET_BOUNDS[key];
  const text = raw!.trim();
  const value = Number(text);
  if (!/^[0-9]+$/.test(text) || value < min || value > max) {
    throw new Error(`invalid ${S3_BUDGET_VARS[key]}: expected an integer in [${min}, ${max}]`);
  }
  return value;
}

/** The operation deadline must cover every attempt, or the retries it allows never run. */
export function resolveS3Budget(input: ArtifactsS3BudgetInput = {}): ArtifactS3Budget {
  const attemptTimeoutMs = budgetValue(input, "attemptTimeoutMs") ?? DEFAULT_S3_BUDGET.attemptTimeoutMs;
  const maxAttempts = budgetValue(input, "maxAttempts") ?? DEFAULT_S3_BUDGET.maxAttempts;
  const explicit = budgetValue(input, "operationTimeoutMs");
  const operationTimeoutMs = explicit ?? attemptTimeoutMs * maxAttempts + S3_RETRY_HEADROOM_MS;
  const [, maxOperation] = S3_BUDGET_BOUNDS.operationTimeoutMs;
  if (explicit === undefined && operationTimeoutMs > maxOperation) {
    throw new Error(`invalid ${S3_BUDGET_VARS.operationTimeoutMs}: derived ${operationTimeoutMs} ms ` +
      `(${S3_BUDGET_VARS.maxAttempts} x ${S3_BUDGET_VARS.attemptTimeoutMs} + ${S3_RETRY_HEADROOM_MS}) ` +
      `exceeds ${maxOperation}`);
  }
  if (operationTimeoutMs < attemptTimeoutMs * maxAttempts) {
    throw new Error(`invalid ${S3_BUDGET_VARS.operationTimeoutMs}: must cover ` +
      `${S3_BUDGET_VARS.maxAttempts} x ${S3_BUDGET_VARS.attemptTimeoutMs}`);
  }
  return Object.freeze({ attemptTimeoutMs, maxAttempts, operationTimeoutMs });
}

export function readArtifactsEnv(
  env: NodeJS.ProcessEnv = process.env,
): ArtifactsConfigInput {
  return {
    storageScope: env["ARTIFACTS_STORAGE_SCOPE"],
    orgId: env["ARTIFACTS_ORG_ID"],
    s3Bucket: env["ARTIFACTS_S3_BUCKET"],
    s3Endpoint: env["ARTIFACTS_S3_ENDPOINT"],
    s3Region: env["ARTIFACTS_S3_REGION"],
    s3AccessKey: env["ARTIFACTS_S3_ACCESS_KEY"],
    s3SecretKey: env["ARTIFACTS_S3_SECRET_KEY"],
    s3Budget: {
      attemptTimeoutMs: env[S3_BUDGET_VARS.attemptTimeoutMs],
      maxAttempts: env[S3_BUDGET_VARS.maxAttempts],
      operationTimeoutMs: env[S3_BUDGET_VARS.operationTimeoutMs],
    },
  };
}

export function resolveArtifactsStorageConfig(
  input: ArtifactsConfigInput,
): ArtifactsStorageConfig {
  const values: Record<RequiredConfigKey, string | undefined> = {
    storageScope: input.storageScope,
    orgId: input.orgId,
    s3Bucket: input.s3Bucket,
    s3Endpoint: input.s3Endpoint,
    s3Region: input.s3Region,
    s3AccessKey: input.s3AccessKey,
    s3SecretKey: input.s3SecretKey,
  };
  const varNames: Record<RequiredConfigKey, string> = {
    storageScope: "ARTIFACTS_STORAGE_SCOPE",
    orgId: "ARTIFACTS_ORG_ID",
    s3Bucket: "ARTIFACTS_S3_BUCKET",
    s3Endpoint: "ARTIFACTS_S3_ENDPOINT",
    s3Region: "ARTIFACTS_S3_REGION",
    s3AccessKey: "ARTIFACTS_S3_ACCESS_KEY",
    s3SecretKey: "ARTIFACTS_S3_SECRET_KEY",
  };

  const set = (Object.keys(values) as RequiredConfigKey[]).filter(
    (key) => present(values[key]),
  );
  if (set.length === 0) {
    return { enabled: false, reason: "artifacts_config_absent" };
  }

  if (present(input.storageScope) && !STORAGE_SCOPE_RE.test(input.storageScope!.trim())) {
    throw new Error("invalid ARTIFACTS_STORAGE_SCOPE: expected [A-Za-z0-9_-]+");
  }
  if (present(input.s3Endpoint)) {
    try {
      const endpoint = new URL(input.s3Endpoint!.trim());
      if (!["http:", "https:"].includes(endpoint.protocol)) throw new Error("invalid endpoint");
    } catch { throw new Error("invalid ARTIFACTS_S3_ENDPOINT: expected an http(s) URL"); }
  }
  if (present(input.s3Region) && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.s3Region!.trim())) {
    throw new Error("invalid ARTIFACTS_S3_REGION: expected a lowercase region identifier");
  }

  // Partial config is closed: name the missing variables only, never values.
  const missing = (
    Object.keys(values) as RequiredConfigKey[]
  ).filter((key) => !present(values[key]));
  if (missing.length > 0) {
    return { enabled: false, reason: "artifacts_config_incomplete",
      missing: missing.map((key) => varNames[key]) };
  }

  const storageScope = values.storageScope!.trim();
  const orgId = values.orgId!.trim();
  const s3Bucket = values.s3Bucket!.trim();
  const s3Endpoint = values.s3Endpoint!.trim();
  const endpoint = new URL(s3Endpoint);
  const s3Budget = resolveS3Budget(input.s3Budget);

  return {
    enabled: true,
    storageScope,
    orgId,
    s3Bucket,
    s3Endpoint: endpoint.toString().replace(/\/$/, ""),
    s3Region: values.s3Region!.trim(),
    s3AccessKey: values.s3AccessKey!,
    s3SecretKey: values.s3SecretKey!,
    s3Budget,
  };
}
