/**
 * H3 cohort/approval admission (861C §5.1, review point 2).
 *
 * Authority source: the activation config reread through `readActivation` on
 * every admission check plus `account_users.status` reread from the database.
 * Activation is checked again after that asynchronous query. There is no
 * cached copy and no TTL.
 *
 * No deliberate grace is added before storage dispatch. This guard cannot
 * cancel a provider commit already in flight; a physical drain bound needs
 * provider-level enforcement and measurement, outside this seam.
 */
import {
  isApprovedAccountStatus,
  readAccountStatus,
  type AccountStatusQueryable,
} from "./account-status.js";
import type { ActivationConfig } from "./activation.js";

export type AdmissionDeniedBody =
  | { readonly error: "activation_closed" }
  | { readonly error: "not_in_cohort" }
  | { readonly error: "account_not_approved"; readonly status: string };

export type AdmissionResult =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly status: 403; readonly body: AdmissionDeniedBody };

export interface AdmissionAuthority {
  readonly readStatus: (sub: string) => Promise<string | null>;
  readonly readActivation: () => ActivationConfig;
  readonly nowMs?: (() => number) | undefined;
}

export function createAdmissionAuthority(
  accounts: AccountStatusQueryable,
  readActivation: () => ActivationConfig,
  nowMs?: () => number,
): AdmissionAuthority {
  return {
    readStatus: (sub) => readAccountStatus(accounts, sub),
    readActivation,
    ...(nowMs ? { nowMs } : {}),
  };
}

function checkActivation(
  authority: AdmissionAuthority,
  sub: string,
): AdmissionResult {
  const activation = authority.readActivation();
  if (!activation.enabled) {
    return { allowed: false, status: 403, body: { error: "activation_closed" } };
  }
  const now = authority.nowMs ? authority.nowMs() : Date.now();
  if (activation.expiresAtMs <= now) {
    return { allowed: false, status: 403, body: { error: "activation_closed" } };
  }
  if (!activation.subjects.includes(sub)) {
    return { allowed: false, status: 403, body: { error: "not_in_cohort" } };
  }
  return { allowed: true };
}

export async function checkAdmission(
  authority: AdmissionAuthority,
  sub: string,
): Promise<AdmissionResult> {
  const activation = checkActivation(authority, sub);
  if (!activation.allowed) return activation;
  const status = await authority.readStatus(sub);
  if (!isApprovedAccountStatus(status)) {
    return {
      allowed: false,
      status: 403,
      body: { error: "account_not_approved", status: status ?? "unknown" },
    };
  }
  return checkActivation(authority, sub);
}
