/**
 * 6L1 projection scope: pure revision-token composition.
 *
 * The token depends only on the viewer's personal state in the workspace,
 * the applicable workspace state, the viewer's applicable permissions,
 * the source revisions covering the loaded populations, and the selected
 * mode. No global private-event counter and no wall-clock timestamp feeds
 * it: identical authorized content yields an identical token even when
 * timestamps match or imports arrive backdated.
 */

import { digest, targetFingerprint } from "./target.js";

/** Signal-only mode until 6J/6K qualify lot modes. */
export const SIGNAL_PROJECTION_MODE = "signal" as const;

export type ProjectionMode = typeof SIGNAL_PROJECTION_MODE;

export interface ProjectionScope {
  workspaceId: string;
  accountId: string;
  citySlug: string;
  mode: ProjectionMode;
  personalRevision: number;
  workspaceRevision: number;
  sourceRevision: number;
  sourceDigest: string;
  membershipRevision: number;
  moderateArchive: boolean;
  manageMembers: boolean;
}

const TOKEN_VERSION = "projection-revision-v1";

/** Authorized token: every listed component, nothing else. */
export function projectionToken(scope: ProjectionScope): string {
  return digest({
    version: TOKEN_VERSION,
    workspaceId: scope.workspaceId.toLowerCase(),
    accountId: scope.accountId.toLowerCase(),
    citySlug: scope.citySlug,
    mode: scope.mode,
    personalRevision: scope.personalRevision,
    workspaceRevision: scope.workspaceRevision,
    sourceRevision: scope.sourceRevision,
    sourceDigest: scope.sourceDigest,
    membershipRevision: scope.membershipRevision,
    moderateArchive: scope.moderateArchive,
    manageMembers: scope.manageMembers,
  });
}

export interface SourceContentRow {
  id: string;
  type: string;
  label: string;
  sourceRef: string | null;
  props: unknown;
}

/**
 * City content digest over served signal content: per-node fingerprints
 * (community excluded, like the 6B displayed version), sorted by value.
 */
export function sourceContentDigest(rows: readonly SourceContentRow[]): string {
  const fingerprints = rows.map((row) => digest({ id: row.id, fingerprint: targetFingerprint({
    type: row.type,
    label: row.label,
    sourceRef: row.sourceRef,
    props: (row.props ?? {}) as Record<string, unknown>,
  }) })).sort();
  return digest(fingerprints);
}
