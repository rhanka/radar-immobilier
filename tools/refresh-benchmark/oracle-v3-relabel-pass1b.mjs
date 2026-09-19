// One-off, traced relabelling (owner decision 2026-09-18): astra-pass2 must run on the 100 documents
// after fable-pass1 and gemini-pass1. The 52 documents astra-pass2 had processed right after
// astra-pass1 (before that order was fixed) become the archived step astra-pass1b, between
// astra-pass1 and fable-pass1 in their gold lineage. Nothing is re-annotated or dropped:
//   - annotations/astra-pass2 and corrige/astra-pass2 move to .../astra-pass1b; every string value
//     "astra-pass2" in them (step, versions[].step, events[].step) becomes "astra-pass1b", and each
//     annotation/receipt records relabeledFrom;
//   - the later steps that already read that gold (fable-pass1 so far) get the same value
//     relabelling; inputStateSha256 is recomputed on the relabelled input gold, the former value is
//     kept as inputStateSha256BeforeRelabel;
//   - relabel-astra-pass1b.json lists every file with its sha256 before and after.
// The model inputs are unchanged: the pass message carries the active units without history.
//
//   node tools/refresh-benchmark/oracle-v3-relabel-pass1b.mjs [--out <dir>]

import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { ORACLE_V3_DIR, PASS_STEPS, sha256 } from "./oracle-v3-lib.mjs";

const FROM = "astra-pass2";
const TO = "astra-pass1b";

const exists = async (path) => { try { await stat(path); return true; } catch { return false; } };
const relabelValues = (value) => {
  if (value === FROM) return TO;
  if (Array.isArray(value)) return value.map(relabelValues);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, relabelValues(item)]));
  }
  return value;
};
const serialise = (value) => `${JSON.stringify(value, null, 1)}\n`;

export async function relabelEarlyAstraPass2({ outRoot }) {
  for (const kind of ["annotations", "corrige"]) {
    if (await exists(join(outRoot, kind, TO))) throw new Error(`${kind}/${TO} already exists: relabel already done`);
  }
  const log = { relabeledAt: new Date().toISOString(), from: FROM, to: TO,
    reason: "owner 2026-09-18: astra-pass2 runs on the 100 documents after fable-pass1 and gemini-pass1; "
      + "the early astra-pass2 outputs are kept as the archived step astra-pass1b",
    documents: [], files: [] };
  const record = (path, before, after) => log.files.push({ path: path.slice(outRoot.length + 1),
    sha256Before: sha256(before), sha256After: sha256(after) });

  // 1. The early outputs themselves.
  const moved = [];
  for (const kind of ["annotations", "corrige"]) {
    const source = join(outRoot, kind, FROM);
    if (!await exists(source)) continue;
    const target = join(outRoot, kind, TO);
    await mkdir(target, { recursive: true });
    for (const name of (await readdir(source)).sort()) {
      const before = await readFile(join(source, name), "utf8");
      let value = relabelValues(JSON.parse(before));
      if (kind === "annotations" && !name.startsWith("_")) value = { ...value, relabeledFrom: FROM };
      const after = serialise(value);
      await writeFile(join(target, name), after);
      record(join(target, name), before, after);
      if (kind === "annotations" && /^[^_].*(?<!\.receipt|\.error|\.parse-error)\.json$/u.test(name)) {
        log.documents.push(name.replace(/\.json$/u, ""));
      }
    }
    moved.push(source);
  }

  // 2. Later steps that already read that gold.
  const early = new Set(log.documents);
  for (const step of PASS_STEPS.filter(({ id }) => id !== FROM)) {
    for (const kind of ["annotations", "corrige"]) {
      const directory = join(outRoot, kind, step.id);
      if (!await exists(directory)) continue;
      for (const name of (await readdir(directory)).sort()) {
        const documentId = name.replace(/(\.receipt|\.error|\.parse-error)?\.json$/u, "");
        if (!early.has(documentId)) continue;
        const before = await readFile(join(directory, name), "utf8");
        if (!before.includes(`"${FROM}"`)) continue;
        let value = relabelValues(JSON.parse(before));
        if (kind === "annotations" && value.inputStateStep === TO) {
          const input = JSON.parse(await readFile(join(outRoot, "corrige", TO, `${documentId}.json`), "utf8"));
          value = { ...value, inputStateSha256BeforeRelabel: value.inputStateSha256,
            inputStateSha256: sha256(JSON.stringify(input)) };
        }
        const after = serialise(value);
        await writeFile(join(directory, name), after);
        record(join(directory, name), before, after);
      }
    }
  }

  // 3. Only now drop the old directories (their content lives under astra-pass1b).
  for (const source of moved) await rm(source, { recursive: true });
  await writeFile(join(outRoot, "relabel-astra-pass1b.json"), serialise(log));
  return { documents: log.documents.length, files: log.files.length };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const index = process.argv.indexOf("--out");
  const outRoot = resolve(process.cwd(), index > 0 ? process.argv[index + 1] : ORACLE_V3_DIR);
  console.log(JSON.stringify(await relabelEarlyAstraPass2({ outRoot })));
}
