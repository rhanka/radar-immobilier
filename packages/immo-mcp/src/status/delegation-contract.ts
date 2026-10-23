/** Trusted policy/proofs come from the issuer adapter, never tool arguments.
 * This inert validator does not verify a signature or qualify/wire A or B. */
import { z } from "zod";
import { FingerprintSchema } from "./wire-schemas.js";

export const RECEIVER_PREFIX = "/api/v1/mcp/facets";
export const FACET_FALLBACK_SCOPES = ["immo:facets:read", "immo:facets:write"] as const;
const RouteSchema = z.object({
  method: z.enum(["GET", "POST"]), path: z.string().min(1),
  inputContract: z.string().min(1), schemaDigest: FingerprintSchema,
}).strict();
export const DelegationProfileSchema = z.object({
  issuer: z.string().min(1), audience: z.string().min(1), humanSub: z.string().min(1),
  workloadActor: z.string().min(1), workloadClient: z.string().min(1),
  expiresAt: z.string().min(1), operationProfile: z.string().min(1),
  invocationScopes: z.array(z.string().min(1)).min(1), routes: z.array(RouteSchema).min(1),
  policyRevision: z.string().min(1), environment: z.string().min(1),
}).strict();
export type DelegationProfile = z.infer<typeof DelegationProfileSchema>;
export interface DelegationPolicy {
  readonly issuer: string;
  readonly audience: string;
  readonly humanSub: string;
  readonly workloadActor: string;
  readonly workloadClient: string;
  readonly operationProfile: string;
  readonly policyRevision: string;
  readonly environment: string;
  readonly routes: readonly z.infer<typeof RouteSchema>[];
  readonly requiredInvocationScopes: readonly string[];
  readonly allowedInvocationScopes: readonly string[];
  readonly maxLifetimeSeconds: number;
  readonly permitsWrites: boolean;
  readonly issuerEnforced: boolean;
  readonly receiverVerified: boolean;
}
export type DelegationError = "delegation_missing" | "delegation_forged" | "delegation_broadened"
  | "audience_mismatch" | "workload_mismatch" | "profile_expired" | "insufficient_scope";

export function validateDelegationProfile(
  input: unknown, nowIso: string, expected: DelegationPolicy,
): DelegationError | null {
  if (input == null) return "delegation_missing";
  const parsed = DelegationProfileSchema.safeParse(input);
  if (!parsed.success || !expected.issuerEnforced || !expected.receiverVerified) return "delegation_forged";
  const profile = parsed.data;
  if (profile.issuer !== expected.issuer || profile.humanSub !== expected.humanSub) return "delegation_forged";
  if (profile.audience !== expected.audience) return "audience_mismatch";
  if (profile.workloadActor !== expected.workloadActor || profile.workloadClient !== expected.workloadClient) {
    return "workload_mismatch";
  }
  if (profile.operationProfile !== expected.operationProfile || profile.environment !== expected.environment
    || profile.policyRevision !== expected.policyRevision) return "delegation_broadened";
  const now = Date.parse(nowIso), expiry = Date.parse(profile.expiresAt);
  if (!Number.isFinite(now) || !Number.isFinite(expiry) || expiry <= now
    || !Number.isFinite(expected.maxLifetimeSeconds) || expected.maxLifetimeSeconds <= 0
    || expiry - now > expected.maxLifetimeSeconds * 1000) return "profile_expired";
  if (expected.requiredInvocationScopes.length === 0
    || expected.requiredInvocationScopes.some((scope) => !profile.invocationScopes.includes(scope))) {
    return "insufficient_scope";
  }
  if (profile.invocationScopes.some((scope) => !expected.allowedInvocationScopes.includes(scope))) {
    return "delegation_broadened";
  }
  for (const route of profile.routes) {
    if (!route.path.startsWith(`${RECEIVER_PREFIX}/`) || /[%?#\\]|\/\.|\/\//.test(route.path)
      || !expected.routes.some((allowed) => allowed.method === route.method && allowed.path === route.path
        && allowed.inputContract === route.inputContract && allowed.schemaDigest === route.schemaDigest)) {
      return "delegation_broadened";
    }
  }
  return null;
}

/** Generic scopes alone fail. A needs a verified bounded write profile as well.
 * Dedicated B scopes do not qualify B's consent, exchange or receiver themselves. */
export function canAuthorizeWrite(profile: unknown, nowIso: string, policy: DelegationPolicy): boolean {
  return policy.permitsWrites && validateDelegationProfile(profile, nowIso, policy) === null;
}

/** JSON tuples prevent collisions across every required cache dimension. */
export function delegationCacheKey(input: {
  readonly humanSub: string; readonly credentialId: string; readonly workloadActor: string;
  readonly workloadClient: string; readonly operationProfile: string;
  readonly environment: string; readonly policyRevision: string;
}): string {
  return JSON.stringify([input.humanSub, input.credentialId, input.workloadActor, input.workloadClient,
    input.operationProfile, input.environment, input.policyRevision]);
}
