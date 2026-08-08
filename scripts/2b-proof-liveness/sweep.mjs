#!/usr/bin/env node
/**
 * #2b — Balayage périodique de vivacité des preuves servies (décision owner :
 * « canonique + sweep »). Re-mesure la vivacité des URL de preuve et FLAGUE les
 * mortes. Pas de repli auto-404 (CORS), pas de backend : un simple job planifié.
 *
 * Jeu balayé = `manifest.json` (dérivé de recette PROOF_URLS_SERVED) :
 *   - `critical`  (hasArchive=false) : orphelines = SEUL vecteur de « 404 nu »
 *     (aucun repli archive same-origin). Une morte ici → ÉCHEC du job (exit 1).
 *   - `monitored` (object-storage-public #2b) : re-autorisées ; une morte est
 *     signalée mais NON bloquante (repli archive ou surveillance simple).
 *
 * Usage :
 *   node sweep.mjs [--manifest <path>] [--out <report.json>] [--timeout 10000]
 *                  [--concurrency 8] [--self-test]
 * Sortie : rapport JSON + résumé stdout. Exit 1 SSI une orpheline (sans archive)
 * est morte (le vrai risque à corriger).
 */

/* global process, console, fetch, setTimeout, clearTimeout, AbortController */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const a = { manifest: join(HERE, "manifest.json"), out: null, timeout: 10000, concurrency: 8, selfTest: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--self-test") a.selfTest = true;
    else if (k === "--manifest") a.manifest = argv[++i];
    else if (k === "--out") a.out = argv[++i];
    else if (k === "--timeout") a.timeout = Number(argv[++i]);
    else if (k === "--concurrency") a.concurrency = Number(argv[++i]);
  }
  return a;
}

/** Vivant = réponse HTTP 2xx/3xx ; mort = 4xx/5xx/erreur réseau/timeout. */
function isAliveStatus(status) {
  return typeof status === "number" && status >= 200 && status < 400;
}

/**
 * Décision d'échec du job — PURE (testée sans réseau). Le job échoue SSI au
 * moins une preuve SANS repli archive (hasArchive=false) est morte : c'est le
 * seul cas de « 404 nu » servi. Les mortes AVEC repli sont signalées, non
 * bloquantes (l'archive same-origin couvre).
 */
export function decideExit(results) {
  const dead = results.filter((r) => !r.alive);
  const deadOrphans = dead.filter((r) => r.hasArchive === false);
  return {
    total: results.length,
    alive: results.length - dead.length,
    dead: dead.length,
    deadOrphans: deadOrphans.length,
    deadOrphanUrls: deadOrphans.map((r) => r.sourceUrl),
    exitCode: deadOrphans.length > 0 ? 1 : 0,
  };
}

async function probe(url, timeoutMs) {
  const attempt = async (method) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        redirect: "follow",
        signal: ctrl.signal,
        headers: { "user-agent": "radar-2b-liveness-sweep/1.0 (+scheduled proof check)" },
      });
      return { status: res.status, ok: res.ok };
    } finally {
      clearTimeout(t);
    }
  };
  try {
    const head = await attempt("HEAD");
    // Certains hôtes ne gèrent pas HEAD (405/501) → re-tenter en GET.
    if (head.status === 405 || head.status === 501 || head.status === 403) {
      try {
        return { status: (await attempt("GET")).status, error: null };
      } catch {
        return { status: head.status, error: null };
      }
    }
    return { status: head.status, error: null };
  } catch {
    // HEAD a échoué (réseau/timeout) → dernière chance en GET.
    try {
      return { status: (await attempt("GET")).status, error: null };
    } catch (e2) {
      return { status: null, error: String(e2?.name || e2 || "error") };
    }
  }
}

async function mapPool(items, concurrency, worker) {
  const out = new Array(items.length);
  let next = 0;
  async function run() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, run));
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.selfTest) {
    // Vérifie la logique de décision sans réseau (CI-safe).
    const cases = [
      { name: "tout vivant", res: [{ alive: true, hasArchive: false }], expect: 0 },
      { name: "morte AVEC archive → non-bloquant", res: [{ alive: false, hasArchive: true }], expect: 0 },
      { name: "orpheline morte → bloquant", res: [{ alive: false, hasArchive: false, sourceUrl: "x" }], expect: 1 },
    ];
    let ok = true;
    for (const c of cases) {
      const got = decideExit(c.res).exitCode;
      const pass = got === c.expect;
      ok = ok && pass;
      console.log(`${pass ? "OK  " : "FAIL"} self-test: ${c.name} (exit ${got}, attendu ${c.expect})`);
    }
    process.exit(ok ? 0 : 1);
  }

  const manifest = JSON.parse(await readFile(args.manifest, "utf8"));
  const items = manifest.items ?? [];
  console.log(
    `#2b sweep — ${items.length} URLs (${manifest.counts?.critical_no_archive ?? "?"} critiques sans archive, ` +
      `${manifest.counts?.monitored_object_storage ?? "?"} monitored) · source: ${manifest.source ?? "?"}`,
  );

  const results = await mapPool(items, args.concurrency, async (it) => {
    const { status, error } = await probe(it.sourceUrl, args.timeout);
    return {
      sourceUrl: it.sourceUrl,
      citySlug: it.citySlug,
      hasArchive: it.hasArchive === true,
      status,
      error,
      alive: isAliveStatus(status),
    };
  });

  const verdict = decideExit(results);
  const deadWithArchive = results.filter((r) => !r.alive && r.hasArchive);

  const report = {
    contract: "2b-proof-liveness-report/v1",
    manifestSource: manifest.source ?? null,
    // Horodatage injecté par l'appelant (CI) si fourni ; sinon absent (le script
    // n'invente pas de date pour rester déterministe/reproductible).
    ...verdict,
    deadWithArchive: deadWithArchive.map((r) => ({ sourceUrl: r.sourceUrl, citySlug: r.citySlug, status: r.status })),
    dead: results
      .filter((r) => !r.alive)
      .map((r) => ({ sourceUrl: r.sourceUrl, citySlug: r.citySlug, hasArchive: r.hasArchive, status: r.status, error: r.error })),
  };

  if (args.out) await writeFile(args.out, JSON.stringify(report, null, 2));

  console.log(
    `→ vivantes ${verdict.alive}/${verdict.total} · mortes ${verdict.dead} ` +
      `(dont ${verdict.deadOrphans} orphelines SANS archive = 404-nu, ${deadWithArchive.length} avec repli archive)`,
  );
  if (verdict.deadOrphans > 0) {
    console.error("::error title=Preuve orpheline morte (404 nu possible)::" + verdict.deadOrphanUrls.join(", "));
  }
  if (deadWithArchive.length > 0) {
    console.log("::warning title=Preuve publique morte mais repli archive présent::" + deadWithArchive.map((r) => r.sourceUrl).join(", "));
  }
  process.exit(verdict.exitCode);
}

// Exécuté directement (pas importé pour les tests).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error("sweep a échoué :", e);
    process.exit(2);
  });
}
