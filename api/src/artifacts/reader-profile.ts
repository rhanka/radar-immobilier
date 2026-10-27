/**
 * Reader profile / release / authority seam (ARTEFACTS A6/H5).
 *
 * Every authority answer flows through the injected AuthorityReader port.
 * reader-storage binds the runtime to PostgreSQL; the synthetic authority
 * below is reserved for module tests.
 */

import { createHash } from "node:crypto";

export type ReaderCapability = "geo.read" | "signals.protected-read";

export interface ReaderProfile {
  readonly name: string;
  readonly policyRevision: string;
  readonly capabilities: readonly ReaderCapability[];
}

export interface ArtifactReleaseRef {
  readonly artifactId: string;
  readonly releaseId: string;
  readonly authorSub: string;
}

export interface ReaderRights {
  readonly readerSub: string;
  readonly artifactId: string;
  readonly approved: boolean;
  readonly capabilities: readonly ReaderCapability[];
}

/** Authority answers reread on every init/renewal (never cached grants). */
export interface AuthorityReader {
  /** Current at completion; changes on any release, profile or ACL update.
   * Versions are never reused, including after a rollback (no ABA).
   */
  readonly getAuthorizationVersion: (artifactId: string) => Promise<string | null>;
  readonly getContentOrigin: (artifactId: string) => Promise<string | null>;
  readonly getRelease: (artifactId: string) => Promise<ArtifactReleaseRef | null>;
  readonly getProfile: (artifactId: string) => Promise<ReaderProfile | null>;
  /** Per-artifact access decision: the couple (readerSub, artifactId) is mandatory. */
  readonly getRights: (readerSub: string, artifactId: string) => Promise<ReaderRights | null>;
}

export function intersectCapabilities(
  profile: ReaderProfile,
  rights: ReaderRights,
): ReaderCapability[] {
  return profile.capabilities.filter((c) => rights.capabilities.includes(c));
}

/** Immutable fingerprint of the approved profile carried by preview tickets. */
export function fingerprintReaderProfile(profile: ReaderProfile): string {
  const capabilities = [...profile.capabilities].sort();
  return createHash("sha256")
    .update(JSON.stringify([profile.name, profile.policyRevision, capabilities]), "utf8")
    .digest("hex");
}

/** Synthetic fixture authority for unit/integration/E2E proofs only. */
export function createFixtureAuthority(): AuthorityReader {
  const profiles = new Map<string, ReaderProfile>([
    ["123e4567-e89b-12d3-a456-426614174000", { name: "demo", policyRevision: "pol-001", capabilities: ["geo.read", "signals.protected-read"] }],
  ]);
  const releases = new Map<string, ArtifactReleaseRef>([
    ["123e4567-e89b-12d3-a456-426614174000", { artifactId: "123e4567-e89b-12d3-a456-426614174000", releaseId: "123e4567-e89b-12d3-a456-426614174001", authorSub: "author-alice" }],
  ]);
  const artifactId = "123e4567-e89b-12d3-a456-426614174000";
  const rights = new Map<string, ReaderRights>([
    [`reader-alice|${artifactId}`, { readerSub: "reader-alice", artifactId, approved: true, capabilities: ["geo.read", "signals.protected-read"] }],
    [`reader-bob|${artifactId}`, { readerSub: "reader-bob", artifactId, approved: true, capabilities: ["geo.read", "signals.protected-read"] }],
    [`reader-mallory|${artifactId}`, { readerSub: "reader-mallory", artifactId, approved: false, capabilities: [] }],
  ]);
  return {
    getAuthorizationVersion: async (id) => releases.has(id) ? "fixture-v1" : null,
    getContentOrigin: async (id) => releases.has(id) ? "https://reader-1.pages.example.test" : null,
    getRelease: async (id) => releases.get(id) ?? null,
    getProfile: async (id) => profiles.get(id) ?? null,
    getRights: async (readerSub, id) => rights.get(`${readerSub}|${id}`) ?? null,
  };
}
