/**
 * Artifact build boot hook (J1.2d/e wagon 7): installs the artifact
 * transport in front of `fetch` before any component request. Selected by
 * the `VITE_ARTIFACT_MODE=1` alias in `vite.config.ts`.
 */
import { installArtifactTransport } from "./artifact-transport";

export function bootArtifactTransport(): void {
  installArtifactTransport();
}
