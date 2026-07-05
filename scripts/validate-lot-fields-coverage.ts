/**
 * validate-lot-fields-coverage — VALIDATION EXHAUSTIVE de la couverture des
 * champs LOT enrichis (surface_m2 / adresse / code_postal / normes foldées)
 * sur TOUTES les collections `qc-lots-*` servies live par l'API geo.
 *
 * Usage : npx tsx scripts/validate-lot-fields-coverage.ts [--out <json>]
 *                [--concurrency N] [--base https://api.geo.sent-tech.ca]
 *
 * MÉTHODE (la MÊME que l'endpoint /api/source/coverage/:city/lot-fields —
 * le service `lot-fields-coverage` est importé tel quel, pas réimplémenté) :
 *   - listing live `GET /collections` → toutes les collections `qc-lots-<slug>` ;
 *   - par ville : total exact via `numberMatched` ; mesure EXACTE si ≤ 450
 *     lots, sinon échantillon STRATIFIÉ de 450 lots (3 tranches de 150 :
 *     début / milieu / fin via offset) — l'API geo ne supporte ni filtre CQL
 *     ni sélection de propriétés (vérifié live : filtres ignorés) ;
 *   - verbatim-or-null : un champ est compté présent uniquement si geo sert
 *     une valeur réelle. Jamais de valeur inventée.
 *
 * Sortie : JSON par ville (taux des 4 champs + méthode) + agrégats, à dater
 * du run. Les échecs réseau sont RAPPORTÉS comme `unreachable`, les réponses
 * « 0 lot » contradictoires (slug listé live) comme `suspect-empty` — ni l'un
 * ni l'autre ne devient un « 0 % » mesuré.
 */
import { writeFileSync } from "node:fs";
import {
  measureCityLotFields,
  type CityLotFieldsResponse,
} from "../api/src/services/geo/lot-fields-coverage.js";

const DEFAULT_BASE = "https://api.geo.sent-tech.ca";

interface CliOptions {
  base: string;
  out: string | null;
  concurrency: number;
}

function parseArgs(argv: string[]): CliOptions {
  // Concurrence VOLONTAIREMENT basse : à 8, geo rate-limite en répondant
  // 404/vide (mesuré 2026-07-05) — des zéros fabriqués, pas des mesures.
  const opts: CliOptions = { base: DEFAULT_BASE, out: null, concurrency: 3 };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--base" && argv[i + 1]) opts.base = String(argv[++i]);
    else if (argv[i] === "--out" && argv[i + 1]) opts.out = String(argv[++i]);
    else if (argv[i] === "--concurrency" && argv[i + 1]) {
      opts.concurrency = Math.max(1, Number(argv[++i]) || 8);
    }
  }
  return opts;
}

async function listLotCollections(base: string): Promise<string[]> {
  const res = await fetch(`${base}/collections?f=json`);
  if (!res.ok) throw new Error(`listing collections HTTP ${res.status}`);
  const body = (await res.json()) as { collections?: { id?: unknown }[] };
  const slugs: string[] = [];
  for (const item of body.collections ?? []) {
    if (typeof item?.id === "string" && item.id.startsWith("qc-lots-")) {
      slugs.push(item.id.slice("qc-lots-".length));
    }
  }
  return slugs.sort();
}

interface CityResult {
  citySlug: string;
  /**
   * `measured`      : mesure substantiée (totalLots > 0).
   * `unreachable`   : geo injoignable après retries (JAMAIS compté comme 0 %).
   * `suspect-empty` : geo répond « collection absente / 0 lot » pour un slug
   *                   pourtant LISTÉ live — contradiction observée sous charge
   *                   (rate-limiting répondant 404/vide, vérifié 2026-07-05 :
   *                   un premier balayage à concurrence 8 a zéroé 1016 villes
   *                   qui répondent normalement en direct). Exclu des taux,
   *                   rapporté à part — jamais un « 0 % » fabriqué.
   */
  status: "measured" | "unreachable" | "suspect-empty";
  measure?: CityLotFieldsResponse;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/**
 * Mesure avec retries + backoff : un échec réseau transitoire OU une réponse
 * « 0 lot » contradictoire (slug listé live) ne devient jamais un 0 % mesuré.
 */
async function measureWithRetry(
  citySlug: string,
  base: string,
): Promise<CityResult> {
  let lastEmpty: CityLotFieldsResponse | undefined;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (attempt > 0) await sleep(2000 * attempt + Math.random() * 1000);
    const measure = await measureCityLotFields(citySlug, base);
    if (measure === null) continue; // injoignable : backoff puis retry
    if ((measure.totalLots ?? 0) > 0) {
      return { citySlug, status: "measured", measure };
    }
    // Slug listé live mais réponse « absente/vide » : suspect, on retente.
    lastEmpty = measure;
  }
  return lastEmpty
    ? { citySlug, status: "suspect-empty", measure: lastEmpty }
    : { citySlug, status: "unreachable" };
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const startedAt = new Date().toISOString();
  const slugs = await listLotCollections(opts.base);
  process.stderr.write(
    `[validate-lot-fields] ${slugs.length} collections qc-lots-* listées live (${startedAt})\n`,
  );

  const results: CityResult[] = [];
  let cursor = 0;
  let done = 0;
  async function worker(): Promise<void> {
    while (cursor < slugs.length) {
      const slug = slugs[cursor];
      cursor += 1;
      if (slug === undefined) break;
      const result = await measureWithRetry(slug, opts.base);
      results.push(result);
      done += 1;
      if (done % 50 === 0) {
        process.stderr.write(
          `[validate-lot-fields] ${done}/${slugs.length} villes mesurées\n`,
        );
      }
    }
  }
  await Promise.all(
    Array.from({ length: opts.concurrency }, () => worker()),
  );
  results.sort((a, b) => a.citySlug.localeCompare(b.citySlug));

  const finishedAt = new Date().toISOString();
  const payload = {
    startedAt,
    finishedAt,
    base: opts.base,
    method:
      "numberMatched exact par collection ; mesure exacte ≤ 450 lots, sinon " +
      "échantillon stratifié de 450 lots (3 tranches de 150 : début/milieu/fin) ; " +
      "présence verbatim-or-null par champ (service lot-fields-coverage, " +
      "identique à l'endpoint /api/source/coverage/:city/lot-fields)",
    collections: slugs.length,
    results,
  };
  const json = JSON.stringify(payload, null, 2);
  if (opts.out) {
    writeFileSync(opts.out, json);
    process.stderr.write(`[validate-lot-fields] écrit : ${opts.out}\n`);
  } else {
    process.stdout.write(json + "\n");
  }
}

main().catch((err) => {
  process.stderr.write(`[validate-lot-fields] ÉCHEC : ${String(err)}\n`);
  process.exitCode = 1;
});
