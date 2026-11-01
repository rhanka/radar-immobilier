/**
 * Provider-neutral Radar artifact profile (H3 contracts slice, spec r2 C3/C4).
 *
 * A6 can prepare against these immutable values before the candidate arrives.
 * Compilation and attestation require the actual upstream construction API.
 */

/** Frozen r2 operation selection for the Radar profile, ordered. */
import { ACTIVE_ARTIFACT_TOOLS } from "./p0b-profile.js";
export const FROZEN_CAPABILITIES = Object.freeze([...ACTIVE_ARTIFACT_TOOLS].sort());

export type ArtifactCapability = (typeof FROZEN_CAPABILITIES)[number];

/**
 * Radar effective profile (spec r2 C3/C4): selection plus operation limits,
 * defaults and contract revisions. A semantic-only change must invalidate
 * composition evidence through the compiled digest.
 */
export const RADAR_EFFECTIVE_PROFILE = Object.freeze({
  selection: Object.freeze([...FROZEN_CAPABILITIES]),
  closedObjects: true,
  limits: Object.freeze({
    ensureBindingName: Object.freeze({ minUtf16: 1, maxUtf16: 128, normalize: false }),
    callerKey: Object.freeze({ trimNonempty: true, maxUtf16: 256, keepWhitespace: true,
      rejectLoneSurrogates: true, normalize: false }),
    artifactId: Object.freeze({ validator: "lowercase-uuid" }),
    publishFiles: Object.freeze({ min: 1, max: 32 }),
    publishBytes: Object.freeze({ maxDecodedPerFile: 262144, maxDecodedTotal: 262144 }),
    mime: Object.freeze(["text/html", "text/css", "text/javascript", "application/json"]),
    path: Object.freeze({ maxUtf8Bytes: 1024, forbidColon: true, forbidDel: true,
      noEmptyDotSegments: true, noBackslash: true, noPercent: true,
      noQueryFragment: true, noControls: true,
      forbiddenFirstSegment: Object.freeze(["api", "__artifacts", "livez", "health"]) }),
    fileContent: Object.freeze({ exactlyOneOfTextOrBytes: true, textEncoding: "utf8",
      byteIntegerMin: 0, byteIntegerMax: 255, uniquePaths: true }),
    profile: Object.freeze({ flatJsonPrimitivesOnly: true }),
    list: Object.freeze({ integerOnly: true, limitMin: 1, limitMax: 100,
      limitDefault: 20, offsetMin: 0, offsetDefault: 0 }),
  }),
  emptyParametersOnly: true,
  defaults: Object.freeze({ parameters: Object.freeze({}), profile: Object.freeze({}) }),
  provenance: Object.freeze({ kind: "inline-original", callerSourceAbsent: true }),
  revisions: Object.freeze({ profile: "radar-c4-r2", providerContract: "0.2.0", commandCodec: "v1" }),
});

export type RadarEffectiveProfile = typeof RADAR_EFFECTIVE_PROFILE;

/** Proposed reader-facing attestation fields; not a provider qualification. */
export interface CompiledArtifactsProfile {
  readonly digest: string;
  readonly selectedCapabilities: readonly string[];
  readonly [key: string]: unknown;
}
/** Assert the installed profile selection, deterministically ordered. */
export function assertFrozenSelection(names: readonly unknown[]): asserts names is readonly string[] {
  const frozen = [...FROZEN_CAPABILITIES].sort();
  if (names.some((name) => typeof name !== "string")) {
    throw new Error("[contract-violation] provider selection: expected string names");
  }
  const actual = [...names].sort();
  if (actual.length !== frozen.length || actual.some((name, index) => name !== frozen[index])) {
    throw new Error(
      `[contract-violation] provider selection: expected exactly ${frozen.join(", ")}`,
    );
  }
}
