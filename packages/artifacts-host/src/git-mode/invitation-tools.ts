import { LIVE_INVITATION_TOOL_CLASSES } from "@sentropic/artifacts";
import { GIT_INVITATION_TOOLS } from "./flag.js";

/** Host scopes of the two access classes of the package (A-LIVE v2 §9; no new scope). */
export const INVITATION_READ_SCOPE = "immo:artifacts:read" as const;
export const INVITATION_WRITE_SCOPE = "immo:artifacts:write" as const;

export type GitInvitationTool = (typeof GIT_INVITATION_TOOLS)[number];

export const isGitInvitationTool = (name: string): name is GitInvitationTool =>
  (GIT_INVITATION_TOOLS as readonly string[]).includes(name);

/**
 * OAuth scope of an invitation tool, from the package class map ONLY
 * (`write` -> immo:artifacts:write, `read` -> immo:artifacts:read). Never
 * derived from tool mutability: accept and revoke are state transitions in
 * class `read`.
 */
export function invitationToolScope(tool: GitInvitationTool): string {
  return LIVE_INVITATION_TOOL_CLASSES[tool] === "write" ? INVITATION_WRITE_SCOPE : INVITATION_READ_SCOPE;
}
