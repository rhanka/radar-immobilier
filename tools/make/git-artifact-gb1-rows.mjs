// Prints the GB1 install-script qualification rows derived from a lockfile
// (default: the repository package-lock.json). Node 24 strips the types of
// the imported TypeScript module; no dependency is installed or executed.
import { readFileSync } from "node:fs";
import { installScriptRowsFromLock } from "../../packages/artifacts-host/src/git-mode/gb1-qualification.ts";

const lock = JSON.parse(readFileSync(process.argv[2] ?? "package-lock.json", "utf8"));
process.stdout.write(`${JSON.stringify({ postinstallAllowlist: [], installScriptRows: installScriptRowsFromLock(lock) }, null, 2)}\n`);
