import { AsyncLocalStorage } from "node:async_hooks";
import type { GitCodeRightsPort, GitHumanDirectory, GitIdentity } from "@sentropic/artifacts";

/**
 * Per-user identity ports of the git mode (Δ4: authorization is per user,
 * never a platform-owner check).
 *
 * - Code rights: an explicit allowlist of immo principals who may read the
 *   repository code, intersected with the approved-account check. Empty by
 *   default: nobody holds code rights until the operator lists them.
 * - Human directory: one entry per editing user, immo principal to GitHub
 *   identity. Emails must be GitHub noreply addresses. A user without an
 *   entry has no human linkage: every write answers `access_denied`.
 * - Host write scope: the MCP binding records the verified token scopes of
 *   the call; outside such a call nothing holds the write scope.
 */

export const GIT_HOST_WRITE_SCOPE = "immo:artifacts:write" as const;

const invocationScopes = new AsyncLocalStorage<ReadonlySet<string>>();

/** Run `action` with the verified scopes of the current MCP call (set by the immo-mcp binding). */
export function withInvocationScopes<T>(scopes: readonly string[], action: () => T): T {
  return invocationScopes.run(new Set(scopes), action);
}

/** Fail-closed: false outside a recorded MCP call. */
export function invocationHasWriteScope(): boolean {
  return invocationScopes.getStore()?.has(GIT_HOST_WRITE_SCOPE) === true;
}

export interface CodeRightsInput {
  /** Principals (OIDC sub) explicitly granted code read rights on the immo repository. */
  readonly readers: readonly string[];
  /** Current approved-account check; a suspended account loses code rights at once. */
  readonly isApproved: (principalId: string) => Promise<boolean>;
  readonly repoId: string;
}

export function createImmoCodeRights(input: CodeRightsInput): GitCodeRightsPort {
  const readers = new Set(input.readers.map((entry) => entry.trim()).filter(Boolean));
  return {
    async canReadCode({ repoId, actorId }) {
      if (repoId !== input.repoId || !readers.has(actorId)) return false;
      try { return await input.isApproved(actorId); } catch { return false; }
    },
  };
}

export interface GitHumanEntry { readonly principalId: string; readonly name: string; readonly email: string }

const NOREPLY = /^[A-Za-z0-9-]+(\+[A-Za-z0-9-]+)?@users\.noreply\.github\.com$/;

export function createStaticGitHumanDirectory(entries: readonly GitHumanEntry[]): GitHumanDirectory {
  const map = new Map<string, GitIdentity>();
  for (const entry of entries) {
    if (!entry.principalId.trim() || !entry.name.trim() || !NOREPLY.test(entry.email) || map.has(entry.principalId)) {
      throw new Error("artifact_git_human_entry_invalid");
    }
    map.set(entry.principalId, Object.freeze({ name: entry.name, email: entry.email }));
  }
  return { async resolve({ principalId }) { return map.get(principalId) ?? null; } };
}

/** Parse `IMMO_ARTIFACTS_GIT_HUMANS` (JSON array of GitHumanEntry); unset is an empty directory. */
export function parseGitHumanEntries(raw: string | undefined): GitHumanEntry[] {
  if (raw === undefined || raw.trim() === "") return [];
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error("artifact_git_humans_invalid"); }
  if (!Array.isArray(value) || value.some((entry) => !entry || typeof entry !== "object" ||
    typeof entry.principalId !== "string" || typeof entry.name !== "string" || typeof entry.email !== "string")) {
    throw new Error("artifact_git_humans_invalid");
  }
  return value.map((entry) => ({ principalId: entry.principalId, name: entry.name, email: entry.email }));
}

/** 32-byte cursor MAC key, base64; absent or short keys leave the GitPort uncomposed (fail-closed). */
export function parseCursorKey(raw: string | undefined): Uint8Array | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const key = Buffer.from(raw.trim(), "base64");
  if (key.byteLength < 32 || key.toString("base64").replace(/=+$/, "") !== raw.trim().replace(/=+$/, "")) {
    throw new Error("artifact_git_cursor_key_invalid");
  }
  return new Uint8Array(key);
}
