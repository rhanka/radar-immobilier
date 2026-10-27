/**
 * H3 rehearsal activation config (861C §5.1), extended with the general
 * opening mode (artefacts-ouverture L1).
 *
 * Explicit opt-in around H2 storage: a complete storage configuration alone
 * never authorizes publication. `off` stays closed; `validation` keeps the
 * rehearsal semantics (all three activation settings must be present and
 * valid, and the window must not be expired); `general` opens publication
 * to every approved account with no cohort and no expiry. Anything else
 * stays closed. An explicit but malformed value throws (fail-fast, never
 * silently disabled), matching the storage and content-base parsers.
 * Missing-variable reports name variables only, never values.
 *
 * Proposed names (no existing variables are read here):
 * - ARTIFACTS_CONTROL_MODE: `off` (default), `validation` or `general`.
 * - ARTIFACTS_VALIDATION_SUBJECTS: comma-separated exact verified subject IDs
 *   (`validation` only; optional in `general`, validated when supplied).
 * - ARTIFACTS_VALIDATION_UNTIL: absolute ISO-8601 expiration, evaluated at
 *   admission time against the caller-supplied clock (entry and commit
 *   reread, see admission.ts). `validation` only; optional in `general`.
 */
export interface ActivationConfigInput {
  readonly controlMode?: string | undefined;
  readonly validationSubjects?: string | undefined;
  readonly validationUntil?: string | undefined;
}

export type ActivationDisabledReason =
  | "activation_absent"
  | "activation_off"
  | "activation_incomplete"
  | "activation_expired";

/** Opening mode: rehearsal cohort (`validation`) or every approved account (`general`). */
export type ActivationMode = "general" | "validation";

export type ActivationConfig =
  | {
      readonly enabled: true;
      readonly subjects: readonly string[];
      readonly expiresAtMs: number;
      /** Opening mode; hand-built fixtures without a mode behave as `validation`. */
      readonly mode?: ActivationMode | undefined;
    }
  | { readonly enabled: false; readonly reason: ActivationDisabledReason; readonly missing?: string[] };

/** True for an enabled `general` config: no cohort, no expiry. */
export function isGeneralActivation(config: ActivationConfig): boolean {
  return config.enabled && config.mode === "general";
}

function present(value: string | undefined): boolean {
  return value !== undefined && value.trim() !== "";
}

function parseSubjects(raw: string): string[] {
  const subjects: string[] = [];
  for (const token of raw.split(",").map((part) => part.trim())) {
    if (token === "" || token.length > 256 || /[\s,]/.test(token)) {
      throw new Error(
        "invalid ARTIFACTS_VALIDATION_SUBJECTS: expected a comma-separated list of non-empty subject IDs",
      );
    }
    if (!subjects.includes(token)) subjects.push(token);
  }
  if (subjects.length === 0) {
    throw new Error(
      "invalid ARTIFACTS_VALIDATION_SUBJECTS: expected a comma-separated list of non-empty subject IDs",
    );
  }
  return subjects;
}

function parseUntil(raw: string): number {
  const timestamp = raw.trim();
  const iso = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
  const expiresAtMs = Date.parse(timestamp);
  const date = timestamp.slice(0, 10);
  const calendar = Date.parse(`${date}T00:00:00Z`);
  if (!iso.test(timestamp) || !Number.isFinite(expiresAtMs) ||
    !Number.isFinite(calendar) || new Date(calendar).toISOString().slice(0, 10) !== date) {
    throw new Error("invalid ARTIFACTS_VALIDATION_UNTIL: expected an ISO-8601 timestamp");
  }
  return expiresAtMs;
}

export function readActivationEnv(
  env: NodeJS.ProcessEnv = process.env,
): ActivationConfigInput {
  return {
    controlMode: env["ARTIFACTS_CONTROL_MODE"],
    validationSubjects: env["ARTIFACTS_VALIDATION_SUBJECTS"],
    validationUntil: env["ARTIFACTS_VALIDATION_UNTIL"],
  };
}

export function resolveActivationConfig(
  input: ActivationConfigInput,
  nowMs: number = Date.now(),
): ActivationConfig {
  const modeSupplied = present(input.controlMode);
  const subjectsSupplied = present(input.validationSubjects);
  const untilSupplied = present(input.validationUntil);

  // Malformed supplied values stop startup even when the rest is missing.
  if (modeSupplied) {
    const mode = input.controlMode!.trim();
    if (mode !== "off" && mode !== "validation" && mode !== "general") {
      throw new Error('invalid ARTIFACTS_CONTROL_MODE: expected "off", "validation" or "general"');
    }
  }
  let subjects: string[] | undefined;
  if (subjectsSupplied) subjects = parseSubjects(input.validationSubjects!);
  let expiresAtMs: number | undefined;
  if (untilSupplied) expiresAtMs = parseUntil(input.validationUntil!);

  if (!modeSupplied && !subjectsSupplied && !untilSupplied) {
    return { enabled: false, reason: "activation_absent" };
  }
  if (modeSupplied && input.controlMode!.trim() === "off") {
    return { enabled: false, reason: "activation_off" };
  }
  if (modeSupplied && input.controlMode!.trim() === "general") {
    // No cohort, no expiry: supplied subjects/until are validated above when
    // present but never required. Infinity keeps every expiry comparison open.
    return { enabled: true, subjects: subjects ?? [], expiresAtMs: expiresAtMs ?? Number.POSITIVE_INFINITY,
      mode: "general" };
  }
  const missing: string[] = [];
  if (!modeSupplied) missing.push("ARTIFACTS_CONTROL_MODE");
  if (!subjectsSupplied) missing.push("ARTIFACTS_VALIDATION_SUBJECTS");
  if (!untilSupplied) missing.push("ARTIFACTS_VALIDATION_UNTIL");
  if (missing.length > 0) {
    return { enabled: false, reason: "activation_incomplete", missing };
  }
  if (expiresAtMs! <= nowMs) {
    return { enabled: false, reason: "activation_expired" };
  }
  return { enabled: true, subjects: subjects!, expiresAtMs: expiresAtMs!, mode: "validation" };
}
