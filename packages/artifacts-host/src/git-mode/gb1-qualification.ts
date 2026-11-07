/**
 * GB1 install-script qualification rows of the immo build (A-LIVE §7.2-7.3).
 *
 * The builder runs `npm ci --ignore-scripts`; the descriptor keeps
 * `postinstallAllowlist: []`. GB1 still refuses a lockfile whose
 * install-script entries are not each listed as a DISABLED qualification row
 * with their exact package, version and integrity. The rows are generated
 * from package-lock.json (`make -f tools/make/git-artifact.mk gb1-rows`),
 * never written by hand; gb1-qualification.test.ts fails when the committed
 * rows and the lock diverge.
 *
 * Dependency-free on purpose: the generator imports this file directly with
 * Node's type stripping.
 */
export interface InstallScriptRow {
  readonly path: string;
  readonly package: string;
  readonly version: string;
  readonly integrity: string;
  readonly scripts: "disabled";
}

export const GB1_POSTINSTALL_ALLOWLIST: readonly never[] = Object.freeze([]);

interface LockEntry { readonly name?: string; readonly version?: string; readonly integrity?: string; readonly hasInstallScript?: boolean }

export function installScriptRowsFromLock(lock: { readonly packages?: Readonly<Record<string, LockEntry>> }): InstallScriptRow[] {
  const rows: InstallScriptRow[] = [];
  for (const [path, entry] of Object.entries(lock.packages ?? {})) {
    if (entry.hasInstallScript !== true) continue;
    const name = entry.name ?? path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
    if (!path.includes("node_modules/") || !name || typeof entry.version !== "string" || !entry.version) {
      throw new Error(`gb1_install_script_entry_invalid: ${path}`);
    }
    if (typeof entry.integrity !== "string" || !/^sha(256|384|512)-[A-Za-z0-9+/]+=*$/.test(entry.integrity)) {
      throw new Error(`dependency_integrity_missing: ${path}`);
    }
    rows.push({ path, package: name, version: entry.version, integrity: entry.integrity, scripts: "disabled" });
  }
  return rows.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}
