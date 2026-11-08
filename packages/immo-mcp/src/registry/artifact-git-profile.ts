/**
 * Git-backed artifact mode: scopes, selection and effective profile of the
 * nine git tools (IMMO_ARTIFACTS_GIT_MODE, default off); the unrouted
 * artifacts_list_app_sources is never listed. Every table below is
 * filtered by the active git tools, so with the flag off none of them
 * contributes a key: the served catalogue, the assembled configuration and
 * every tool definition stay byte-identical. The embedded overlay
 * `config/immo-artifacts.git.v1.json` carries the same values and is checked
 * against these tables by `artifact-git-mode.test.ts`.
 *
 * Scopes (Δ4, immo naming): reads are `immo:artifacts:read`
 * (fetch_app_source, live_read, live_status); every other
 * git tool writes and needs `immo:artifacts:write`.
 */
import { GIT_ARTIFACT_TOOLS, GIT_MODE_ARTIFACT_TOOLS, GIT_READ_TOOLS, invitationToolScope, isGitInvitationTool,
  type GitArtifactTool } from "@radar/artifacts-host";

export const GIT_READ_SCOPE = "immo:artifacts:read" as const;
export const GIT_WRITE_SCOPE = "immo:artifacts:write" as const;

/** Top-level required arguments of each provider git tool definition. */
export const GIT_EFFECTIVE_REQUIRED: Readonly<Record<GitArtifactTool, readonly string[]>> = Object.freeze({
  artifacts_git_attach: ["artifactId", "idempotencyKey"],
  artifacts_fetch_app_source: [],
  artifacts_git_publish: ["artifactId", "commitSha", "expectedCurrentReleaseId", "idempotencyKey"],
  artifacts_git_commit: ["artifactId", "expectedHeadSha", "message", "idempotencyKey"],
  artifacts_live_write: ["artifactId", "expectedHeadSha", "expectedLiveRevision", "idempotencyKey"],
  artifacts_live_read: ["artifactId"],
  artifacts_live_reset: ["artifactId", "expectedHeadSha", "expectedLiveRevision", "idempotencyKey"],
  artifacts_live_status: ["artifactId"],
  artifacts_live_control: ["artifactId", "action", "idempotencyKey"],
  artifacts_live_invite: ["artifactId", "liveSessionId", "userRef", "expiresInSeconds", "idempotencyKey"],
  artifacts_live_accept_invitation: ["artifactId", "invitationId", "idempotencyKey"],
  artifacts_live_revoke_invitation: ["artifactId", "invitationId", "idempotencyKey"],
  artifacts_live_invitations: ["artifactId"],
});

/** Host semantics recorded in the effective profile (candidate integrity). */
const GIT_EFFECTIVE_NOTES: Readonly<Record<GitArtifactTool, Readonly<Record<string, string>>>> = Object.freeze({
  artifacts_git_attach: { binding: "own personal branch artifact/p/<id8-principal>/<slug>-<id8> of the A1 registry; code rights, write scope and GitHub linkage required" },
  artifacts_fetch_app_source: { source: "files at a server-resolved commit; current code rights required" },
  artifacts_git_publish: { build: "sandbox executor on the Sentropic builder; SG4b handoff verified and committed by immo in one transaction" },
  artifacts_git_commit: { commit: "commits the caller's own live draft under expectedHeadSha; never another user's binding" },
  artifacts_live_write: { live: "the caller's own personal binding only; builder_unavailable until a qualified worker exists" },
  artifacts_live_read: { live: "binding owner, or an invitee with an active session-bound invitation and current code rights" },
  artifacts_live_reset: { live: "the caller's own personal binding only" },
  artifacts_live_status: { live: "binding owner, or an invitee with an active session-bound invitation and current code rights" },
  artifacts_live_control: { live: "the caller's own personal binding only" },
  artifacts_live_invite: { live: "binding owner only; builder_unavailable until invitations are qualified" },
  artifacts_live_accept_invitation: { live: "the invited principal only; viewing only, builder_unavailable until invitations are qualified" },
  artifacts_live_revoke_invitation: { live: "the binding owner or the invitee; builder_unavailable until invitations are qualified" },
  artifacts_live_invitations: { live: "binding owner sees every invitation, an invitee only their own" },
});

export function gitToolScope(tool: GitArtifactTool): string {
  // Invitation tools: the package class map decides, never the tool mutability.
  if (isGitInvitationTool(tool)) return invitationToolScope(tool);
  return GIT_READ_TOOLS.includes(tool) ? GIT_READ_SCOPE : GIT_WRITE_SCOPE;
}

export function gitToolScopes(tools: readonly GitArtifactTool[] = GIT_MODE_ARTIFACT_TOOLS): Record<string, string> {
  return Object.fromEntries(tools.map((tool) => [tool, gitToolScope(tool)]));
}

export function gitSelection(tools: readonly GitArtifactTool[] = GIT_MODE_ARTIFACT_TOOLS) {
  return tools.map((tool) => {
    const operation = tool.slice("artifacts_".length) as GitOperation;
    return { tool, operation, method: "POST" as const, path: `/${operation}`, command: operation };
  });
}

export function gitEffectiveProfile(tools: readonly GitArtifactTool[] = GIT_MODE_ARTIFACT_TOOLS): Record<string, unknown> {
  return Object.fromEntries(tools.map((tool) => [tool, { required: [...GIT_EFFECTIVE_REQUIRED[tool]], ...GIT_EFFECTIVE_NOTES[tool] }]));
}

export type GitOperation = GitArtifactTool extends `artifacts_${infer Operation}` ? Operation : never;

export const ALL_GIT_TOOLS: readonly GitArtifactTool[] = GIT_ARTIFACT_TOOLS;
