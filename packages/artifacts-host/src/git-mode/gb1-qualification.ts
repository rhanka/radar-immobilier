/**
 * GB1 install-script qualification of the immo build (A-LIVE §7.2-7.3,
 * Sentropic decision 2026-11-07).
 *
 * The builder runs `npm ci --ignore-scripts`; `postinstallAllowlist` stays
 * empty. GB1 still refuses a lockfile whose install-script entries are not
 * each declared with their exact package, version and literal SRI. The file
 * `artifact-build/gb1-qualification.json` is that declaration, bound to the
 * exact lockfile bytes by `lockSha256`. It is generated from package-lock.json
 * (`make -f tools/make/git-artifact.mk gb1-rows ENV=test-<slug>`), never
 * written by hand; gb1-qualification.test.ts fails when it and the lock
 * diverge. Branches can never write it (A1 refused path).
 *
 * Dependency-free on purpose: the generator imports this file directly with
 * Node's type stripping.
 */
export interface ScriptQualification {
  readonly package: string;
  readonly version: string;
  readonly integrity: string;
}

export interface Gb1Qualification {
  readonly v: 1;
  readonly lockSha256: string;
  readonly postinstallAllowlist: readonly never[];
  readonly scriptQualification: readonly ScriptQualification[];
}

export const GB1_QUALIFICATION_PATH = "artifact-build/gb1-qualification.json" as const;
export const GB1_QUALIFICATION_MAX_BYTES = 64 * 1024;

interface LockEntry { readonly name?: string; readonly version?: string; readonly integrity?: string; readonly hasInstallScript?: boolean }

export function scriptQualificationFromLock(lock: { readonly packages?: Readonly<Record<string, LockEntry>> }): ScriptQualification[] {
  const rows: ScriptQualification[] = [];
  for (const [path, entry] of Object.entries(lock.packages ?? {})) {
    if (entry.hasInstallScript !== true) continue;
    const name = entry.name ?? path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
    if (!path.includes("node_modules/") || !name || typeof entry.version !== "string" || !entry.version) {
      throw new Error(`gb1_install_script_entry_invalid: ${path}`);
    }
    if (typeof entry.integrity !== "string" || !/^sha(256|384|512)-[A-Za-z0-9+/]+=*$/.test(entry.integrity)) {
      throw new Error(`dependency_integrity_missing: ${path}`);
    }
    rows.push({ package: name, version: entry.version, integrity: entry.integrity });
  }
  const order = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  return rows.sort((a, b) => order(a.package, b.package) || order(a.version, b.version) || order(a.integrity, b.integrity));
}

/** The file content for a lockfile (bytes for the hash, parsed JSON for the rows). */
export function gb1Qualification(lockBytes: Uint8Array, sha256Hex: (bytes: Uint8Array) => string): Gb1Qualification {
  const lock = JSON.parse(new TextDecoder().decode(lockBytes)) as { packages?: Record<string, LockEntry> };
  return { v: 1, lockSha256: sha256Hex(lockBytes), postinstallAllowlist: [], scriptQualification: scriptQualificationFromLock(lock) };
}
