// Realigned oracle scorer. score-v3.mjs (v1) is left untouched so every published figure stays
// reproducible and so v1 and v2 can be read side by side on the same receipts.
//
// Three rules separate v2 from v1, each measured on the frozen v9/v12/v13 receipts:
//   R1 agenda-item numbering is dropped from the anchor AND from the candidate excerpt before
//      matching. v1 anchors such as "7.1 1070, RUE BISSONNETTE" made the score depend on whether
//      the model started its excerpt at the item number; contract v5 did, contract v8 did not.
//   R2 Bylaw is admitted next to Signal and DesignationEvent as an eligible candidate node type.
//      The oracle already carries bylaw adoptions and avis de motion as units; v1 could not credit
//      a model that materialised them as Bylaw nodes. This rule also enlarges the precision
//      denominator, so it lowers the score as often as it raises it.
//   R3 a unit may carry alternate citation sites, each with page and verbatim provenance, when the
//      same council act is verbatim on another page of the same frozen PDF. Frozen values are never
//      rewritten: alternate_sites is additive and lives only in manual-oracle-v2.json.
//
// Everything else - grouping by raises_signal, stage equality, PDF identity gates, the partial
// Waterloo oracle, duplicate accounting - is identical to v1 on purpose.

const normalized = (value) => value.normalize("NFC").toLocaleLowerCase("fr-CA")
  .replace(/\s+/g, " ").trim();

// "7.1 ", "13.2 ", "3.6 " and "5.5 " are agenda item numbers. A resolution number such as
// "2026-08-155" is not matched: the pattern requires whitespace right after the digits.
export const stripItemNumber = (value) => value.replace(/^\d+(?:\.\d+)*[.)]?\s+/, "");

export const ORACLE_V2_ELIGIBLE_NODE_TYPES = Object.freeze(["Signal", "DesignationEvent", "Bylaw"]);

export const oracleV2Rules = Object.freeze({
  R1: "agenda item numbering stripped from anchor and candidate",
  R2: "Bylaw admitted as an eligible candidate node type",
  R3: "unit alternate citation sites, each with page and verbatim provenance",
});

const metric = (numerator, denominator) => denominator ? numerator / denominator : null;

export function scoreValidV2(output, document, gold, options = {}) {
  const eligibleTypes = new Set(options.eligibleNodeTypes ?? ORACLE_V2_ELIGIBLE_NODE_TYPES);
  const stripNumbering = options.stripNumbering ?? true;
  const useAlternateSites = options.useAlternateSites ?? true;
  const key = (value) => stripNumbering ? stripItemNumber(normalized(value)) : normalized(value);
  const eligible = output.nodes.filter(({ node_type: type }) => eligibleTypes.has(type));
  const byId = new Map(eligible.map((node, index) => [node.id, index]));
  const parent = eligible.map((_, index) => index);
  const root = (index) => parent[index] === index ? index : (parent[index] = root(parent[index]));
  for (const edge of output.edges ?? []) {
    if (edge.relation !== "raises_signal" || !byId.has(edge.source) || !byId.has(edge.target)) continue;
    parent[root(byId.get(edge.target))] = root(byId.get(edge.source));
  }
  const groups = new Map();
  eligible.forEach((node, index) => {
    const groupKey = root(index);
    groups.set(groupKey, [...(groups.get(groupKey) ?? []), node]);
  });
  const evidence = new Map((output.evidence ?? []).map((item) => [item.id, item]));
  const matches = [];
  let unmatchedGroups = 0;
  for (const nodes of groups.values()) {
    const stages = new Set(nodes.flatMap((node) => {
      const properties = node.properties ?? node;
      return [properties.etape, properties.stage, properties.stade];
    }).filter(Boolean));
    const records = nodes.flatMap((node) => [
      ...(node.citations ?? []),
      ...(node.evidence_refs ?? []).map((id) => evidence.get(id)).filter(Boolean),
    ]).filter((record) => record.source_file === document.originalKey
      && record.rawRef === document.originalKey && record.docSha === document.sha256
      && record.sourceUrl === document.sourceUrl && record.modality === "pdf");
    const groupMatches = gold.filter((unit) => {
      if (!stages.has(unit.stage)) return false;
      const sites = [{ page: unit.page, anchor: unit.anchor },
        ...(useAlternateSites ? (unit.alternate_sites ?? []) : [])];
      return sites.some((site) => records.some((record) => record.page === site.page
        && typeof record.excerpt === "string" && key(record.excerpt).includes(key(site.anchor))));
    });
    if (groupMatches.length === 0) unmatchedGroups += 1;
    matches.push(...groupMatches.map(({ id }) => id));
  }
  const matchedIds = [...new Set(matches)];
  const duplicates = matches.length - matchedIds.length;
  const tp = matchedIds.length;
  const fn = gold.length - tp;
  const partialOracle = document.id === "waterloo-2026-08-18";
  const fp = partialOracle ? null : unmatchedGroups + duplicates;
  return { oracleUnits: gold.length, candidateGroups: groups.size, matchedIds,
    tp, fp, fn, precision: partialOracle ? null : metric(tp, tp + fp), recall: metric(tp, gold.length),
    f1: partialOracle || !(2 * tp + fp + fn) ? null : 2 * tp / (2 * tp + fp + fn),
    partialOracle, unmatchedGroups, duplicateMatches: duplicates };
}
