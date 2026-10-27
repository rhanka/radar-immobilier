/** D4 order and public opening invariant, on an immutable server-resolved snapshot.
 * S1/S2 must resolve/recheck this authority in their existing transactions. */
import { WorkspaceIdSchema } from "./wire-schemas.js";

export interface StatusAuthority {
  readonly credentialVerified: boolean;
  readonly humanSub: string;
  readonly resolvedSub: string;
  readonly accountId: string;
  readonly accountApproved: boolean;
  readonly workspaceId: string;
  readonly membership: { readonly accountId: string; readonly workspaceId: string; readonly active: boolean };
  readonly signalEpochServed: boolean;
  readonly lotDestinationEnabled: boolean;
  readonly lotDestinationOpen: boolean;
}
export type AuthorityDenial = "unauthenticated" | "account_not_approved"
  | "workspace_not_authorized" | "business_closed";
export function statusAuthorityDenial(
  state: StatusAuthority, operation: "context" | "signal" | "lot",
): AuthorityDenial | null {
  if (!state.credentialVerified || !state.humanSub || state.humanSub !== state.resolvedSub
    || !WorkspaceIdSchema.safeParse(state.accountId).success) return "unauthenticated";
  if (!state.accountApproved) return "account_not_approved";
  if (!WorkspaceIdSchema.safeParse(state.workspaceId).success || !state.membership.active
    || state.membership.accountId !== state.accountId || state.membership.workspaceId !== state.workspaceId) {
    return "workspace_not_authorized";
  }
  if (operation === "context") return null;
  if (!state.signalEpochServed) return "business_closed";
  if (operation === "lot" && (!state.lotDestinationEnabled || !state.lotDestinationOpen)) return "business_closed";
  return null;
}
