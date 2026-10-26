import pg from "pg";
import { composeArtifactHost, createArtifactAdmissionAuthority, guardArtifactPool, readArtifactsEnv,
  resolveArtifactsStorageConfig, readActivationEnv, resolveActivationConfig } from "@radar/artifacts-host";
import { bindArtifactProvider, IMMO_ARTIFACT_PROFILE,
  type FrozenCallAuthority } from "./registry/artifact-provider.js";
import { ARTIFACT_INVOCATION_SCOPE } from "./registry/artifact-profile.js";

/** Trusted production composition; configuration supplies storage, never caller authority. */
export async function createArtifactBinding(env: NodeJS.ProcessEnv) {
  const config = resolveArtifactsStorageConfig(readArtifactsEnv(env));
  const readActivation = () => resolveActivationConfig(readActivationEnv(env));
  if (!config.enabled || !readActivation().enabled) return undefined;
  const url = env.IMMO_MCP_ARTIFACT_DATABASE_URL;
  const contentBase = env.ARTIFACTS_CONTENT_BASE;
  if (!url || !contentBase) throw new Error("artifact_binding_incomplete");
  const origin = new URL(`https://${contentBase}/`);
  if (origin.host !== contentBase || origin.hostname !== contentBase || origin.pathname !== "/" ||
    origin.username || origin.password || origin.search || origin.hash) throw new Error("artifact_content_base_invalid");
  const pool = guardArtifactPool(new pg.Pool({ connectionString: url, max: 5, connectionTimeoutMillis: 2000,
    options: "-c statement_timeout=5000 -c lock_timeout=1000" }));
  try {
    const host = await composeArtifactHost(pool, config, undefined,
      { profile: IMMO_ARTIFACT_PROFILE, readActivation, contentBase });
    const admission = createArtifactAdmissionAuthority(pool, readActivation, config.storageScope);
    const binding = bindArtifactProvider({ app: host.app, storageScopeId: config.storageScope,
      admission,
      authorizeCommit(request, frozen?: FrozenCallAuthority) {
        const actorId = request.principal.sub;
        return async (context, transaction) => {
          if (context.actorId !== actorId || context.storageScopeId !== config.storageScope ||
            !request.principal.scopes.includes(ARTIFACT_INVOCATION_SCOPE)) {
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
