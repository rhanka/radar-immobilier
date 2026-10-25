import type pg from "pg";
import { requirePublicFunction, COMMIT_CONTRACT_SPECIFIER,
  type R2CommitCoordinator } from "./artifacts-provider-contract.helpers.js";

/** Host SQL is confined to the registered participant's leased connection. */
export interface PolicyClient {
  query<T>(text: string, params: readonly unknown[]): Promise<{ rows: T[]; rowCount: number }>;
}

export async function readTestPolicyRevision(client: PolicyClient): Promise<string> {
  const table = await client.query<{ present: string | null }>(
    "SELECT to_regclass('test_policy_revision') AS present", []);
  if (!table.rows[0]?.present) return "radar-test-policy/v1";
  const revision = await client.query<{ rev: string }>(
    "SELECT rev FROM test_policy_revision WHERE id = 1 FOR SHARE", []);
  if (!revision.rows[0]) throw new Error("test policy revision is absent");
  return revision.rows[0].rev;
}

export async function createCandidateCoordinator(pool: pg.Pool, testObserver: unknown): Promise<R2CommitCoordinator> {
  const create = await requirePublicFunction<(options: unknown) => R2CommitCoordinator>(
    COMMIT_CONTRACT_SPECIFIER, "createArtifactCommitCoordinator");
  const executor = await requirePublicFunction<(pool: pg.Pool) => unknown>(
    "@sentropic/artifacts/adapters/postgres", "createPostgresCommitExecutor");
  return create({ executor: executor(pool), testObserver,
    policy: { createParticipant(client: PolicyClient, transactionToken: string) {
      return {
        readRevision: () => readTestPolicyRevision(client),
        async checkApproval(input: { actorId: string }) {
          const result = await client.query<{ status: string }>(
            "SELECT status FROM account_users WHERE sub = $1 FOR SHARE", [input.actorId]);
          return { approved: result.rows[0]?.status === "approved", reason: "denied" };
        },
        // Quota accounting stays explicitly uncovered in H3 units 5-6.
        async reserveQuota() { return { reserved: true }; },
        mintFence(policyRevision: string, invocationId: string) {
          return { fenceId: `test-fence-${transactionToken}`, transactionId: transactionToken,
            invocationId, policyRevision };
        },
      };
    } },
  });
}
