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
import { isGeneralActivation, type ActivationConfig } from "./activation.js";

export type AdmissionDeniedBody =
  | { readonly error: "activation_closed" }
  | { readonly error: "not_in_cohort" }
  | { readonly error: "account_not_approved"; readonly status: string }
  | { readonly error: "workspace_membership_required" }
  | { readonly error: "workspace_ambiguous" };

export type AdmissionResult =
  | { readonly allowed: true; readonly workspaceId: string }
  | { readonly allowed: false; readonly status: 403 | 409; readonly body: AdmissionDeniedBody };

export interface AdmissionAuthority {
  readonly readStatus: (sub: string) => Promise<string | null>;
  readonly readActivation: () => ActivationConfig;
  readonly nowMs?: (() => number) | undefined;
  readonly readMemberships?: ((sub: string) => Promise<string[]>) | undefined;
  readonly scope?: string | undefined;
}

export function createAdmissionAuthority(
  accounts: AccountStatusQueryable,
  readActivation: () => ActivationConfig,
  nowMs?: () => number,
  scope?: string,
): AdmissionAuthority {
  return {
    readStatus: (sub) => readAccountStatus(accounts, sub),
    readActivation,
    ...(nowMs ? { nowMs } : {}),
    ...(scope ? { scope } : {}),
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
  scope?: string,
  nowMs?: () => number,
): AdmissionAuthority {
  const base = createAdmissionAuthority(accounts, readActivation, nowMs, scope);
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

export function checkScopeMembership(
  memberships: readonly string[],
  expectedScope?: string,
): AdmissionResult {
  const unique = [...new Set(memberships.map((entry) => entry.toLowerCase()))];
  if (unique.length === 0) {
    return { allowed: false, status: 403, body: { error: "workspace_membership_required" } };
  }
  if (unique.length !== 1) {
    return { allowed: false, status: 409, body: { error: "workspace_ambiguous" } };
  }
  const workspaceId = unique[0]!;
  if (expectedScope !== undefined && expectedScope.trim() !== "" &&
    workspaceId !== expectedScope.toLowerCase()) {
    return { allowed: false, status: 403, body: { error: "workspace_membership_required" } };
  }
  return { allowed: true, workspaceId };
}

function checkActivation(
  authority: AdmissionAuthority,
  sub: string,
): { readonly result: AdmissionResult; readonly general: boolean } {
  const activation = authority.readActivation();
  if (!activation.enabled) {
    return { result: { allowed: false, status: 403, body: { error: "activation_closed" } }, general: false };
  }
  if (isGeneralActivation(activation)) {
    // General opening: every approved account publishes; storage stays a
    // server-owned namespace, so no workspace is frozen here.
    return { result: { allowed: true, workspaceId: "" }, general: true };
  }
  const now = authority.nowMs ? authority.nowMs() : Date.now();
  if (activation.expiresAtMs <= now) {
    return { result: { allowed: false, status: 403, body: { error: "activation_closed" } }, general: false };
  }
  if (!activation.subjects.includes(sub)) {
    return { result: { allowed: false, status: 403, body: { error: "not_in_cohort" } }, general: false };
  }
  return { result: { allowed: true, workspaceId: authority.scope ?? "" }, general: false };
}

export async function checkAdmission(
  authority: AdmissionAuthority,
  sub: string,
  expectedScope?: string,
): Promise<AdmissionResult> {
  const scope = expectedScope ?? authority.scope;
  const activation = checkActivation(authority, sub);
  if (!activation.result.allowed) return activation.result;
  const status = await authority.readStatus(sub);
  if (!isApprovedAccountStatus(status)) {
    return {
      allowed: false,
      status: 403,
      body: { error: "account_not_approved", status: status ?? "unknown" },
    };
  }
  const afterStatus = checkActivation(authority, sub);
  if (!afterStatus.result.allowed) return afterStatus.result;
  // General mode requires no workspace: zero, one or several memberships all
  // publish. The membership query is skipped, not merely ignored.
  if (afterStatus.general) return afterStatus.result;
  if (authority.readMemberships) {
    const memberships = await authority.readMemberships(sub);
    const membership = checkScopeMembership(memberships, scope);
    if (!membership.allowed) return membership;
    const fresh = checkActivation(authority, sub);
    if (!fresh.result.allowed) return fresh.result;
    return membership;
  }
  return checkActivation(authority, sub).result;
}
