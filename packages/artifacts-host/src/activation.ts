/**
 * H3 rehearsal activation config (861C §5.1).
 *
 * Explicit opt-in around H2 storage: a complete storage configuration alone
 * never authorizes the rehearsal. All three activation settings must be
 * present and valid, the mode must be `validation`, and the window must not
 * be expired. Anything else stays closed. An explicit but malformed value
 * throws (fail-fast, never silently disabled), matching the storage and
 * content-base parsers. Missing-variable reports name variables only, never
 * values.
 *
 * Proposed names (no existing variables are read here):
 * - ARTIFACTS_CONTROL_MODE: `off` (default) or `validation`.
 * - ARTIFACTS_VALIDATION_SUBJECTS: comma-separated exact verified subject IDs.
 * - ARTIFACTS_VALIDATION_UNTIL: absolute ISO-8601 expiration, evaluated at
 *   admission time against the caller-supplied clock (entry and commit
 *   reread, see admission.ts).
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

export type ActivationConfig =
  | {
      readonly enabled: true;
      readonly subjects: readonly string[];
      readonly expiresAtMs: number;
    }
  | { readonly enabled: false; readonly reason: ActivationDisabledReason; readonly missing?: string[] };

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
    if (mode !== "off" && mode !== "validation") {
      throw new Error('invalid ARTIFACTS_CONTROL_MODE: expected "off" or "validation"');
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
  return { enabled: true, subjects: subjects!, expiresAtMs: expiresAtMs! };
}
