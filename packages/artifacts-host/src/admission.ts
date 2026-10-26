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
  | { readonly error: "account_not_approved"; readonly status: string }
  | { readonly error: "workspace_membership_required" }
  | { readonly error: "workspace_ambiguous" };

export type AdmissionResult =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly status: 403 | 409; readonly body: AdmissionDeniedBody };

export interface AdmissionAuthority {
  readonly readStatus: (sub: string) => Promise<string | null>;
  readonly readActivation: () => ActivationConfig;
  readonly nowMs?: (() => number) | undefined;
  readonly readMemberships?: ((sub: string) => Promise<string[]>) | undefined;
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

export interface MembershipQueryable {
  query(
    text: string,
    params?: unknown[],
  ): Promise<{ readonly rows: ReadonlyArray<Record<string, unknown>> }>;
}

export function createArtifactAdmissionAuthority(
  accounts: AccountStatusQueryable & MembershipQueryable,
  readActivation: () => ActivationConfig,
  nowMs?: () => number,
): AdmissionAuthority {
  const base = createAdmissionAuthority(accounts, readActivation, nowMs);
  return {
    ...base,
    readMemberships: async (sub: string): Promise<string[]> => {
      const res = await accounts.query(
        "SELECT workspace_id FROM workspace_memberships WHERE account_id = " +
          "(SELECT id FROM account_users WHERE sub = $1) AND status = 'active' AND revoked_at IS NULL",
        [sub],
      );
      const ids: string[] = [];
      for (const row of res.rows) {
        const raw = (row as Record<string, unknown>)["workspace_id"];
        if (typeof raw === "string" && raw.length > 0) ids.push(raw);
      }
      return ids;
    },
  };
}

export function checkScopeMembership(memberships: readonly string[]): AdmissionResult {
  const unique = [...new Set(memberships.map((entry) => entry.toLowerCase()))];
  if (unique.length === 0) {
    return { allowed: false, status: 403, body: { error: "workspace_membership_required" } };
  }
  if (unique.length !== 1) {
    return { allowed: false, status: 409, body: { error: "workspace_ambiguous" } };
  }
  return { allowed: true };
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
  const afterStatus = checkActivation(authority, sub);
  if (!afterStatus.allowed) return afterStatus;
  if (authority.readMemberships) {
    const memberships = await authority.readMemberships(sub);
    const membership = checkScopeMembership(memberships);
    if (!membership.allowed) return membership;
    return checkActivation(authority, sub);
  }
  return checkActivation(authority, sub);
}
