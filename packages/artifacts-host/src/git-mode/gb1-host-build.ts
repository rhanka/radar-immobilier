import rows from "./gb1-install-script-rows.json" with { type: "json" };
import type { InstallScriptRow } from "./gb1-qualification.js";

/**
 * Host build qualification sent as `buildQualification` with every sandbox
 * build job request of the host build API client (build-api.ts; GB1): no install
 * script runs (`postinstallAllowlist: []`), and each lockfile install-script
 * entry is declared as a DISABLED row with its exact package, version and
 * integrity. Generated file, checked against the lock by gb1-qualification.test.ts.
 */
export const IMMO_HOST_BUILD_QUALIFICATION: Readonly<{
  postinstallAllowlist: readonly never[]; installScriptRows: readonly InstallScriptRow[];
}> = Object.freeze({ postinstallAllowlist: [], installScriptRows: rows.installScriptRows as InstallScriptRow[] });
