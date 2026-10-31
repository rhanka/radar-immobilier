import type { ArtifactS3Budget } from "./s3-timeout.js";

export interface ArtifactsConfigInput {
  readonly storageScope?: string | undefined;
  readonly orgId?: string | undefined;
  readonly s3Bucket?: string | undefined;
  readonly s3Endpoint?: string | undefined;
  readonly s3Region?: string | undefined;
  readonly s3AccessKey?: string | undefined;
  readonly s3SecretKey?: string | undefined;
}

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
      /** Omitted: composition uses DEFAULT_S3_BUDGET. */
      readonly s3Budget?: ArtifactS3Budget | undefined;
    }
  | { readonly enabled: false; readonly reason: ArtifactsDisabledReason; readonly missing?: string[] };

const STORAGE_SCOPE_RE = /^[A-Za-z0-9_-]+$/;

function present(value: string | undefined): boolean {
  return value !== undefined && value.trim() !== "";
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
  };
}

export function resolveArtifactsStorageConfig(
  input: ArtifactsConfigInput,
): ArtifactsStorageConfig {
  const values: Record<keyof ArtifactsConfigInput, string | undefined> = {
    storageScope: input.storageScope,
    orgId: input.orgId,
    s3Bucket: input.s3Bucket,
    s3Endpoint: input.s3Endpoint,
    s3Region: input.s3Region,
    s3AccessKey: input.s3AccessKey,
    s3SecretKey: input.s3SecretKey,
  };
  const varNames: Record<keyof ArtifactsConfigInput, string> = {
    storageScope: "ARTIFACTS_STORAGE_SCOPE",
    orgId: "ARTIFACTS_ORG_ID",
    s3Bucket: "ARTIFACTS_S3_BUCKET",
    s3Endpoint: "ARTIFACTS_S3_ENDPOINT",
    s3Region: "ARTIFACTS_S3_REGION",
    s3AccessKey: "ARTIFACTS_S3_ACCESS_KEY",
    s3SecretKey: "ARTIFACTS_S3_SECRET_KEY",
  };

  const set = (Object.keys(values) as Array<keyof ArtifactsConfigInput>).filter(
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
    Object.keys(values) as Array<keyof ArtifactsConfigInput>
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

  return {
    enabled: true,
    storageScope,
    orgId,
    s3Bucket,
    s3Endpoint: endpoint.toString().replace(/\/$/, ""),
    s3Region: values.s3Region!.trim(),
    s3AccessKey: values.s3AccessKey!,
    s3SecretKey: values.s3SecretKey!,
  };
}
