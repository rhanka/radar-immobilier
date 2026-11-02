import pg from "pg";
import { composeArtifactHost, createArtifactAdmissionAuthority, guardArtifactPool, readArtifactsEnv,
  resolveArtifactsStorageConfig, readActivationEnv, resolveActivationConfig } from "@radar/artifacts-host";
import { ARTIFACT_P0B, createDeleteConfirmation } from "@radar/artifacts-host";
import { bindArtifactProvider, IMMO_ARTIFACT_PROFILE,
  type FrozenCallAuthority } from "./registry/artifact-provider.js";
import { ARTIFACT_WRITE_SCOPE, readArtifactScopePolicy } from "./registry/artifact-profile.js";
import { bindDatabaseName } from "./database-url.js";

/** Trusted production composition; configuration supplies storage, never caller authority. */
export async function createArtifactBinding(env: NodeJS.ProcessEnv) {
  const config = resolveArtifactsStorageConfig(readArtifactsEnv(env));
  const readActivation = () => resolveActivationConfig(readActivationEnv(env));
  if (!config.enabled || !readActivation().enabled) return undefined;
  // Read before any connection so an invalid transition flag fails startup closed.
  const scopePolicy = readArtifactScopePolicy(env);
  const roleUrl = env.IMMO_MCP_ARTIFACT_DATABASE_URL;
  const contentBase = env.ARTIFACTS_CONTENT_BASE;
  if (!roleUrl || !contentBase) throw new Error("artifact_binding_incomplete");
  const url = bindDatabaseName(roleUrl, env.IMMO_MCP_DATABASE_NAME);
  const origin = new URL(`https://${contentBase}/`);
  if (origin.host !== contentBase || origin.hostname !== contentBase || origin.pathname !== "/" ||
    origin.username || origin.password || origin.search || origin.hash) throw new Error("artifact_content_base_invalid");
  const pool = guardArtifactPool(new pg.Pool({ connectionString: url, max: 5, connectionTimeoutMillis: 2000,
    options: "-c statement_timeout=5000 -c lock_timeout=1000" }));
  try {
    const confirmation = ARTIFACT_P0B ? createDeleteConfirmation(pool, config.storageScope,
      new URL(env.IMMO_MCP_OAUTH_RESOURCE ?? "").origin) : undefined;
    const host = await composeArtifactHost(pool, config, undefined,
      { profile: IMMO_ARTIFACT_PROFILE, readActivation, contentBase, ...(confirmation ? { confirmation } : {}) });
    const admission = createArtifactAdmissionAuthority(pool, readActivation, config.storageScope);
    const binding = bindArtifactProvider({ app: host.app, storageScopeId: config.storageScope,
      admission, scopePolicy,
      ...(confirmation ? { prepareDelete: confirmation.prepareDelete } : {}),
      authorizeCommit(request, frozen?: FrozenCallAuthority) {
        const actorId = request.principal.sub;
        return async (context, transaction) => {
          if (context.actorId !== actorId || context.storageScopeId !== config.storageScope ||
            // A commit is always a mutation: the legacy read transition never applies here.
            !request.principal.scopes.includes(ARTIFACT_WRITE_SCOPE)) {
            return { allowed: false, reason: "denied", publicCode: "access_denied", status: 403, retriable: false };
          }
          const participant = (transaction as { participant?: {
            checkApproval?: (input: { actorId: string; operation: string }) => Promise<{
              approved?: unknown; publicCode?: unknown; status?: unknown; workspaceId?: unknown }>;
          } } | null | undefined)?.participant;
          if (frozen && participant && typeof participant.checkApproval === "function") {
            try {
              const approval = await participant.checkApproval({ actorId, operation: context.operation });
              if (approval && typeof approval.approved === "boolean" && approval.approved === false) {
                const publicCode = typeof approval.publicCode === "string" &&
                  /^[a-z][a-z0-9_]{0,63}$/.test(approval.publicCode)
                  ? approval.publicCode : "access_denied";
                const status = approval.status === 409 ? 409 : 403;
                return { allowed: false as const, reason: "denied" as const,
                  publicCode, status, retriable: false as const };
              }
              if (typeof approval?.workspaceId === "string" &&
                approval.workspaceId.toLowerCase() !== frozen.workspaceId.toLowerCase()) {
                return { allowed: false as const, reason: "denied" as const,
                  publicCode: "workspace_membership_required", status: 403, retriable: false as const };
              }
            } catch {
              return { allowed: false as const, reason: "unavailable" as const,
                publicCode: "capability_unavailable", status: 503, retriable: true as const };
            }
          }
          return host.authorizeCommit(context, transaction);
        };
      },
    });
    return { binding, async close() { host.close(); await pool.end(); } };
  } catch (error) { await pool.end(); throw error; }
}
