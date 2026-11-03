// Lot I1 — admission sync configuration (fail-closed on both sides).
import type { KeyObject } from "node:crypto";
import type { AppConfig } from "../config.js";
import { parsePrivateKeyEntry, parsePublicKeyList } from "./snapshot.js";

export interface AdmissionConfig {
  /** Preprod: the ingest webhook answers only when true AND keys exist. */
  syncEnabled: boolean;
  /** Preprod: accepted prod public keys (current + previous during rotation). */
  publicKeys: Map<string, KeyObject>;
  /** Issuers trusted for JIT email linking (preprod + prod IdP). */
  trustedIssuers: string[];
  /** Prod only: signing key (private). Absent everywhere else. */
  signingKey: { kid: string; key: KeyObject } | undefined;
  /** Prod only: preprod ingest webhook URL (push target). */
  pushUrl: string;
}

/** Split a comma-separated env list, dropping blanks. */
export function splitEnvList(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(",").map((part) => part.trim()).filter((part) => part !== "");
}

/**
 * Resolve the admission config from parsed env. Throws on malformed keys
 * (fail-fast at startup, never silently disabled when explicitly configured).
 */
export function resolveAdmissionConfig(config: AppConfig): AdmissionConfig {
  const publicKeys = config.ADMISSION_PROD_PUBLIC_KEYS
    ? parsePublicKeyList(config.ADMISSION_PROD_PUBLIC_KEYS)
    : new Map<string, KeyObject>();
  let signingKey: AdmissionConfig["signingKey"];
  if (config.ADMISSION_SIGNING_KEY) {
    const parsed = parsePrivateKeyEntry(config.ADMISSION_SIGNING_KEY);
    signingKey = { kid: parsed.kid, key: parsed.key };
  }
  return {
    syncEnabled: config.ADMISSION_SYNC_ENABLED && publicKeys.size > 0,
    publicKeys,
    trustedIssuers: splitEnvList(config.ADMISSION_TRUSTED_ISSUERS),
    signingKey,
    pushUrl: config.ADMISSION_SYNC_PUSH_URL ?? "",
  };
}
