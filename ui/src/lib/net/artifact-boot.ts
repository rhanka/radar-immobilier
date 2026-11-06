/**
 * App build boot hook for the artifact transport (J1.2d/e wagon 7): a no-op.
 * The artifact build (`VITE_ARTIFACT_MODE=1`) aliases this module to
 * `artifact-boot.artifact.ts` in `vite.config.ts`, so the app bundle never
 * contains the transport (the empty call is tree-shaken away).
 */
export function bootArtifactTransport(): void {}
