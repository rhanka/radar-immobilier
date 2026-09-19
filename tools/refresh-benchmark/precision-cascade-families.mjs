// Where does the precision gain of the cascade come from? (i-cond request 2026-09-19, offline, no
// model call). Every removal motive is classified by reproducible keyword patterns:
//   A - rule:     the motive invokes the exclusion list (tax/collection, appointments, accounts,
//                 service contracts, leisure, road maintenance, correspondence, generic notices,
//                 "exclusions", "not an urban-planning act") - a gain a better-instructed extractor
//                 could have obtained by itself;
//   B - document: the motive invokes the text - only mentioned / cited / historical reminder /
//                 earlier text / no act or step in this sitting / wrong stage / wrong object /
//                 duplicate - the gain proper to re-reading;
//   C - mixed or unclassifiable: both families match, or none; counted apart, never split.
// Then precision in two scenarios: full filter (measured) and B-only filter (only the acts removed
// for lack of documentary support are removed). The difference is the part of the gain that the
// cascade itself explains; the rest may come from the prompt alignment.
//
//   node tools/refresh-benchmark/precision-cascade-families.mjs

import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { ORACLE_V3_DIR } from "./oracle-v3-lib.mjs";
import { cascadeOf } from "./precision-cascade.mjs";
import { aggregate, scoreCase, unresolvedUnits } from "./score-oracle-v3.mjs";

// Patterns on the motive, lower-cased, accents kept (motives are French). Published as is.
export const FAMILY_PATTERNS = Object.freeze({
  A: [/exclusion/u, /fiscal/u, /taxe/u, /recouvrement/u, /nomination/u, /embauche/u, /ressources humaines/u,
    /\bcomptes?\b/u, /dépenses?/u, /financi/u, /budg/u, /contrat/u, /services? professionnels?/u, /loisir/u, /\bsport/u,
    /culture/u, /voirie/u, /entretien/u, /correspondance/u, /avis public/u, /administrati/u,
    /(pas|aucun) (un |d'|de )?(acte|objet)s? d'(urbanisme|aménagement)/u, /hors (du )?(périmètre|champ)/u,
    /politique/u, /subvention/u, /aide financière/u],
  B: [/mentionn/u, /\bcité/u, /citée?s?\b/u, /rappel/u, /historique/u, /antérieur/u, /(à titre de |en |comme )?référence/u,
    /considérant/u, /aucun(e)? (acte|étape|démarche|action)/u, /sans (faire l'objet|acte|étape|action|démarche)/u,
    /n'est pas attest/u, /non attest/u, /absent/u, /ne figure pas/u, /étape (fausse|erronée|incorrecte)/u,
    /objet (faux|erroné|incorrect)/u, /doublon/u, /duplica/u, /déjà (validé|couvert|extrait|représenté)/u,
    /modifié par/u, /règlement (d'origine|de base)/u, /texte antérieur/u],
});

export function familyOf(reason) {
  const text = String(reason ?? "").toLowerCase();
  const a = FAMILY_PATTERNS.A.some((pattern) => pattern.test(text));
  const b = FAMILY_PATTERNS.B.some((pattern) => pattern.test(text));
  return a && !b ? "A" : b && !a ? "B" : "C";
}

const readJsonIfPresent = async (path) => {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
};
const f = (value) => value === null || value === undefined ? "N-A" : value.toFixed(3);
const pts = (before, after) => `${after - before >= 0 ? "+" : ""}${(100 * (after - before)).toFixed(1)}`;

export async function families({ repositoryRoot = process.cwd(), source: sourceArm = "astra-low" } = {}) {
  const config = cascadeOf(sourceArm);
  const v3 = resolve(repositoryRoot, ORACLE_V3_DIR); const cascade = resolve(repositoryRoot, config.dir);
  const manifest = JSON.parse(await readFile(resolve(repositoryRoot, "docs/reviews/refresh-benchmark/v101b/manifest.json"), "utf8"));
  const gold = JSON.parse(await readFile(join(v3, "consensus.json"), "utf8"));
  const neutral = unresolvedUnits((await readJsonIfPresent(join(v3, "unresolved.json")))?.entries ?? []);
  const options = { useStageAliases: true, partialOracle: false };
  const listed = { A: [], B: [], C: [] };
  const scenario = { none: [], full: [], bOnly: [], abOnly: [] };
  for (const document of manifest.documents) {
    const units = gold.units.filter(({ doc_sha: digest }) => digest === document.sha256);
    const neutralUnits = neutral.filter(({ documentId }) => documentId === document.id);
    const sourceReceipt = await readJsonIfPresent(join(resolve(repositoryRoot, config.sourceDir), `${document.id}--${sourceArm}.attempt-1.receipt.json`));
    const source = sourceReceipt?.validation?.accepted
      ? await readJsonIfPresent(join(resolve(repositoryRoot, config.sourceDir), `${document.id}--${sourceArm}.attempt-1.output.json`)) : null;
    const record = await readJsonIfPresent(join(cascade, "decisions", `${document.id}.json`));
    if (!source || !record) {
      // Refused by the source arm: nothing to filter; scored as the scorer does (all units missed).
      for (const name of Object.keys(scenario)) scenario[name].push(scoreCase({ state: "refused" }, document, units, { ...options, neutralUnits }));
      continue;
    }
    const byFamily = { A: new Set(), B: new Set(), C: new Set() };
    for (const { act, reason } of record?.filter?.removed ?? []) {
      const family = familyOf(reason);
      const view = record.acts.find(({ act: id }) => id === act);
      byFamily[family].add(act);
      listed[family].push({ documentId: document.id, act, label: view.view.map(({ label }) => label).filter(Boolean).join(" / ").slice(0, 140), reason });
    }
    const without = (families) => {
      const removed = new Set(record.acts.filter(({ act }) => families.some((family) => byFamily[family].has(act))).flatMap(({ nodeIds }) => nodeIds));
      return { ...source, nodes: source.nodes.filter(({ id }) => !removed.has(id)),
        edges: (source.edges ?? []).filter(({ source: from, target }) => !removed.has(from) && !removed.has(target)) };
    };
    const score = (output) => scoreCase({ state: "accepted", output }, document, units, { ...options, neutralUnits });
    scenario.none.push(score(source));
    scenario.full.push(score(without(["A", "B", "C"])));
    scenario.bOnly.push(score(without(["B"])));
    scenario.abOnly.push(score(without(["A", "B"])));
  }
  const totals = Object.fromEntries(Object.entries(scenario).map(([name, cases]) => [name, aggregate(cases)]));
  const result = { generatedAt: new Date().toISOString(), network: "none",
    rule: { A: FAMILY_PATTERNS.A.map(String), B: FAMILY_PATTERNS.B.map(String),
      decision: "A if only A patterns match; B if only B patterns match; otherwise C (both or none)" },
    counts: { A: listed.A.length, B: listed.B.length, C: listed.C.length }, totals, listed };
  await writeFile(join(cascade, "familles.json"), `${JSON.stringify(result, null, 1)}\n`);
  const row = (name, label) => { const t = totals[name];
    return `| ${label} | ${f(t.precision)} | ${f(t.recall)} | ${f(t.f1)} | ${t.tp} | ${t.fp} | ${pts(totals.none.precision, t.precision)} |`; };
  const section = (family, title) => [`## ${title} (${listed[family].length})`, "",
    ...listed[family].map(({ documentId, act, label, reason }) => `- ${documentId} ${act} — ${label} — « ${reason.replace(/\n/gu, " ")} »`), ""];
  const lines = [`# ${config.arm} — d'où vient le gain ? Familles de motifs de retrait`, "",
    "Classement déterministe par mots-clés sur le motif de chaque retrait (aucun appel modèle). Règle publiée dans `familles.json` :",
    "A = le motif invoque la liste d'exclusions (gain que la consigne seule pouvait donner) ; B = le motif invoque le texte",
    "(seulement mentionné, rappel, texte antérieur, aucun acte ou étape dans la séance, doublon) : gain propre à la relecture ;",
    "C = les deux ou aucun : compté à part, jamais réparti.", "",
    `Retraits : A ${listed.A.length} · B ${listed.B.length} · C ${listed.C.length}.`, "",
    `| Scénario | P | R | F1 | VP | FP | Δ précision vs ${sourceArm} |`, "|---|---:|---:|---:|---:|---:|---:|",
    row("none", `${sourceArm} seul`), row("bOnly", "filtre B seul (gain propre à la cascade)"),
    row("abOnly", "filtre A + B (sans C)"), row("full", "filtre complet (mesuré)"), "",
    ...section("A", "Famille A — règle"), ...section("B", "Famille B — document"), ...section("C", "Famille C — mixte ou inclassable")];
  await writeFile(join(cascade, "familles.md"), `${lines.join("\n")}\n`);
  return result;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const index = process.argv.indexOf("--source");
  const result = await families({ source: index > 0 ? process.argv[index + 1] : "astra-low" });
  console.log(JSON.stringify({ counts: result.counts, totals: Object.fromEntries(Object.entries(result.totals).map(([k, t]) =>
    [k, { p: Number(t.precision.toFixed(3)), r: Number(t.recall.toFixed(3)), f1: Number(t.f1.toFixed(3)), tp: t.tp, fp: t.fp }])) }));
}
