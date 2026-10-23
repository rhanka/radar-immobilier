/**
 * Reader profile / release / authority seam (ARTEFACTS A6/H5).
 *
 * Consumes A1's early profile/release/authority contract shape without
 * binding its real provider: every authority answer flows through the
 * injected `AuthorityReader` seam. Fixture-only success never closes
 * production integration; the Sol integrator binds the real provider.
 */

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
  readonly approved: boolean;
  readonly capabilities: readonly ReaderCapability[];
}

/** Authority answers reread on every init/renewal (never cached grants). */
export interface AuthorityReader {
  readonly getContentOrigin: (artifactId: string) => Promise<string | null>;
  readonly getRelease: (artifactId: string) => Promise<ArtifactReleaseRef | null>;
  readonly getProfile: (artifactId: string) => Promise<ReaderProfile | null>;
  readonly getRights: (readerSub: string) => Promise<ReaderRights | null>;
}

export function intersectCapabilities(
  profile: ReaderProfile,
  rights: ReaderRights,
): ReaderCapability[] {
  return profile.capabilities.filter((c) => rights.capabilities.includes(c));
}

/** Synthetic fixture authority for unit/integration/E2E proofs only. */
export function createFixtureAuthority(): AuthorityReader {
  const profiles = new Map<string, ReaderProfile>([
    ["123e4567-e89b-12d3-a456-426614174000", { name: "demo", policyRevision: "pol-001", capabilities: ["geo.read", "signals.protected-read"] }],
  ]);
  const releases = new Map<string, ArtifactReleaseRef>([
    ["123e4567-e89b-12d3-a456-426614174000", { artifactId: "123e4567-e89b-12d3-a456-426614174000", releaseId: "123e4567-e89b-12d3-a456-426614174001", authorSub: "author-alice" }],
  ]);
  const rights = new Map<string, ReaderRights>([
    ["reader-alice", { readerSub: "reader-alice", approved: true, capabilities: ["geo.read", "signals.protected-read"] }],
    ["reader-bob", { readerSub: "reader-bob", approved: true, capabilities: ["geo.read", "signals.protected-read"] }],
    ["reader-mallory", { readerSub: "reader-mallory", approved: false, capabilities: [] }],
  ]);
  return {
    getContentOrigin: async (artifactId) => releases.has(artifactId) ? "https://reader-1.pages.example.test" : null,
    getRelease: async (artifactId) => releases.get(artifactId) ?? null,
    getProfile: async (artifactId) => profiles.get(artifactId) ?? null,
    getRights: async (readerSub) => rights.get(readerSub) ?? null,
  };
}
