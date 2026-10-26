/** Provider-neutral authority seam. Runtime binding awaits the candidate API. */
export type AuthorizePurpose = "finalize" | "replay";

export type CommitOperation = "ensure" | "publish";

export interface AuthorizeCommitContext {
  readonly invocationId: string;
  readonly actorId: string;
  readonly storageScopeId: string;
  readonly operation: CommitOperation;
  readonly artifactId?: string | undefined;
  readonly purpose: AuthorizePurpose;
  readonly policyRevision: string;
}

export type AuthorizeCommitDecision =
  | { readonly allowed: true; readonly fence: unknown }
  | { readonly allowed: false; readonly reason: string; readonly publicCode: string;
      readonly status: number; readonly retriable: boolean };

export type AuthorizeCommit = (
  context: AuthorizeCommitContext,
  transaction: unknown,
) => Promise<AuthorizeCommitDecision>;

/** Policy revision proposed for the Radar profile. */
export const POLICY_REVISION = "radar-c4-r2";
