/**
 * Reproduction VERSIONNÉE + REJOUABLE de la cohorte « Nouveau B » (6 derniers mois, 5 toggles).
 *
 * Vérité-terrain owner (screenshot UI) : 185 signaux · 124 villes, ancres par-ville
 *   Sainte-Martine=6, Saint-Michel=4, Saint-Jean-Baptiste=4, Mont-Tremblant=4, Brossard=3.
 *
 * Ce script N'invente rien : il importe les VRAIES fonctions de production et rejoue,
 * à l'octet, le chemin SIGNAL-LEVEL du rail « Nouveau B » :
 *   1. classifyVivierSignal        (api/src/services/graph/vivier-v2.ts)   → classification serveur par nœud
 *   2. projectComposedVivierB      (ui/src/lib/signals/vivier-view-mode.ts) → INTERSECTION z∧r∧p
 *        (exclusion_reason===null ∧ zonage='oui' ∧ isResidentialEligible ∧ etape∈{avis_motion,projet_reglement})
 *   3. filterNodesByEtapeDate      (ui/src/lib/signals/signal-date-filter.ts) → 6 mois calendaires,
 *        [startOfDay(today−6mo), endOfDay(today)] inclusif, dates NULLES gardées
 *   4. applyVivierBExclusions      (ui/src/lib/signals/vivier-b-display-filter.ts) → AND-NOT
 *        (retire piia-sans-preuve-résid + instrument='derogation')
 * Puis : signaux = filtered.length ; villes = distinct(citySlug), triées.
 *
 * NB — le rail montre TOUTES les villes servies (pas set-167 : Mont-Tremblant, ancre, est hors 167).
 * NB — c'est une INTERSECTION (z∧r∧p), confirmée par le match bit-à-bit des 5 ancres — pas une union.
 *
 * SOURCE (pointeur versionné) :
 *   dump prod-PG graph_nodes (projection exacte de listCitiesWithSignalNodes, export OVH read-only)
 *   S3 : s3://radar-immobilier-docs-pocs/scratch/postbrossard-7263-20260803/graph_nodes.ndjson
 *   export OVH 2026-08-06 · 7298 nœuds · sha256 d9cb3cc6b9700caa1ba711d7fa204597e2db8be6b4002a764a7f386a43e57699
 *
 * INVOCATION :
 *   DUMP=<path/graph_nodes.ndjson> [NOW=<ms epoch, défaut Date.now()>] \
 *   TSX_TSCONFIG_PATH=scripts/cohorte-vivier-b/tsconfig.json \
 *   tsx scripts/cohorte-vivier-b/reproduce-cohort.ts
 *   → stdout : "N signaux · M villes", les 5 ancres, puis la liste de slugs triée.
 *   Sort en code 2 si les 5 ancres ne matchent PAS (garde anti-dérive : la fidélité est vérifiée, pas supposée).
 */
/* eslint-disable @typescript-eslint/no-explicit-any --
 * Script de reproduction : pont entre les enregistrements NDJSON dynamiques du dump et les
 * fonctions de production typées. Les `any` sont exactement la frontière JSON→fonction-typée
 * (cast au bord). Le comportement est vérifié par ancres (sort en code 2 si mismatch), donc on
 * ne re-dérive pas les types structurels ici ; typecheck reste vert. */
import { readFileSync } from "node:fs";
import { classifyVivierSignal } from "../../api/src/services/graph/vivier-v2.ts";
import { projectComposedVivierB, DEFAULT_B_AXES } from "../../ui/src/lib/signals/vivier-view-mode.ts";
import {
  filterNodesByEtapeDate,
  defaultSignalTimeRange,
  dateRangeFromSignalTimeRange,
} from "../../ui/src/lib/signals/signal-date-filter.ts";
import {
  applyVivierBExclusions,
  DEFAULT_VIVIER_B_EXCLUSIONS,
} from "../../ui/src/lib/signals/vivier-b-display-filter.ts";

const DUMP = process.env.DUMP;
if (!DUMP) { console.error("DUMP=<path graph_nodes.ndjson> requis"); process.exit(2); }
const NOW = process.env.NOW ? Number(process.env.NOW) : Date.now();

const ANCHORS: Record<string, number> = {
  "sainte-martine": 6, "saint-michel": 4, "saint-jean-baptiste": 4, "mont-tremblant": 4, "brossard": 3,
};

const raw: any[] = [];
for (const line of readFileSync(DUMP, "utf8").split("\n")) { if (line.trim()) raw.push(JSON.parse(line)); }

const nodes = raw.map((r) => {
  const props = r.props ?? {};
  const pp = props && typeof props === "object" && props.properties ? props.properties : {};
  const classification = classifyVivierSignal({
    id: r.id, type: r.type,
    category: r.category ?? pp.category ?? null,
    label: r.label ?? null,
    description: r.description ?? pp.description ?? null,
    etape: pp.etape ?? r.etapeAnnote ?? null,
    nbUnitesMax: r.nbUnitesMax ?? pp.nb_unites_max ?? null,
    intensite: r.intensite ?? pp.intensite ?? null,
    props,
    sourceRef: r.sourceRef ?? null,
    fraicheur: pp.etape_date ?? pp.date ?? null,
  } as any);
  return {
    id: r.id, citySlug: r.citySlug, type: r.type,
    label: r.label ?? null, description: r.description ?? pp.description ?? null,
    props, publishedAt: props.publishedAt ?? null, createdAt: null, classification,
  } as any;
});

const range = dateRangeFromSignalTimeRange(defaultSignalTimeRange(NOW));
const projected = projectComposedVivierB(nodes as any, DEFAULT_B_AXES);
const dated = filterNodesByEtapeDate(projected.nodes as any, range as any);
const filtered = applyVivierBExclusions(dated as any, DEFAULT_VIVIER_B_EXCLUSIONS);

const perCity: Record<string, number> = {};
for (const n of filtered as any[]) perCity[n.citySlug] = (perCity[n.citySlug] ?? 0) + 1;
const cities = Object.keys(perCity).sort((a, b) => a.localeCompare(b));

console.error(`SOURCE dump=${DUMP} now=${new Date(NOW).toISOString()} window=${JSON.stringify(range)}`);
console.error(`RESULT ${filtered.length} signaux · ${cities.length} villes`);
let anchorsOk = true;
for (const [slug, exp] of Object.entries(ANCHORS)) {
  const got = perCity[slug] ?? 0;
  const ok = got === exp;
  anchorsOk = anchorsOk && ok;
  console.error(`  anchor ${slug}: got ${got} exp ${exp} ${ok ? "OK" : "MISMATCH"}`);
}
// slug list to stdout (versionnable)
for (const s of cities) console.log(s);

if (!anchorsOk) {
  console.error("ANCHORS MISMATCH → le dump ne correspond pas à la vérité-terrain owner (fraîcheur) — voir METHOD.md");
  process.exit(2);
}
