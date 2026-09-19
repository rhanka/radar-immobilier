// Oracle v3 final reference (owner requirement 2026-09-18: "la référence finale doit être fiable à
// 100 %"). Pure functions, no I/O:
//
// 1. Verification (converge-* steps): after the six passes, each model votes alone on EVERY unit
//    ever proposed for a document (active or removed): options = its distinct versions + "absent".
//    A unit enters the reference only on a unanimous 3/3 vote for a present version (the version is
//    grounded verbatim in the frozen text, see groundUnit). Unanimous "absent" drops it.
// 2. Arbitration (arbitrate-* steps): every item without unanimity, plus, on the documents of the
//    human gold v2, every difference between that gold and the unanimous units (in either
//    direction). Each model sees the options with their verbatim excerpts and the reasoned
//    positions (verification votes, anonymised as A/B/C; the human gold as one more position, not
//    presumed right) and votes again. Unanimous -> resolved; otherwise -> unresolved, listed for the
//    owner with excerpts and positions. Nothing is decided silently.

import { calibrationMatch, contentKey, groundUnit, identity, pagesBlock, pairOneToOne, publicUnit, sha256 } from "./oracle-v3-lib.mjs";
import { rougeEquivalent, softEquivalent } from "./oracle-v3-soft.mjs";

export const FAMILY_ORDER = Object.freeze(["astra", "fable", "gemini"]);
const pad = (prefix, index) => `${prefix}${String(index + 1).padStart(2, "0")}`;

// Every unit ever proposed, with its distinct versions (v1 = first) plus "absent".
export function reviewItemsOf(state) {
  return state.units.map((unit, index) => {
    const options = []; const seen = new Set();
    for (const { unit: version } of unit.versions) {
      const key = contentKey(version);
      if (seen.has(key)) continue;
      seen.add(key); options.push({ option: `v${options.length + 1}`, unit: version });
    }
    options.push({ option: "absent", unit: null });
    const current = unit.status === "active"
      ? options.find(({ unit: version }) => version && contentKey(version) === contentKey(unit.current)).option
      : "absent";
    return { item: pad("i", index), unitId: unit.id, options, current, events: unit.events };
  });
}

// A vote counts only with a valid option and a non-empty reason.
export function validVote(item, vote) {
  return Boolean(vote && item.options.some(({ option }) => option === vote.choice)
    && typeof vote.reason === "string" && vote.reason.trim());
}

// Unanimity of the three families on one item.
export function unanimity(item, votesByFamily) {
  const choices = FAMILY_ORDER.map((family) => validVote(item, votesByFamily[family]) ? votesByFamily[family].choice : null);
  const tally = {};
  for (const choice of choices) if (choice) tally[choice] = (tally[choice] ?? 0) + 1;
  const unanimous = choices.every((choice) => choice && choice === choices[0]);
  return unanimous ? { outcome: "unanimous", choice: choices[0], tally }
    : { outcome: "split", choice: null, tally, missing: FAMILY_ORDER.filter((_, index) => !choices[index]) };
}

export const votesFor = (records, itemId) => Object.fromEntries(FAMILY_ORDER.map((family) =>
  [family, records[family]?.votes?.find((vote) => vote?.item === itemId) ?? null]));

// Deterministic anonymisation of the three families for one document (A/B/C).
export function positionLetters(documentId) {
  const order = [...FAMILY_ORDER].sort((left, right) =>
    sha256(`${documentId}:${left}`).localeCompare(sha256(`${documentId}:${right}`)));
  return Object.fromEntries(order.map((family, index) => [family, "ABC"[index]]));
}

// A human v2 unit as a candidate unit, grounded like any annotator unit when possible.
export function humanOptionUnit(human, pages) {
  const raw = { label: human.label, stage: human.stage, procedure: null, objet: human.anchor,
    page: human.page, citation: human.citation, anchor: human.anchor };
  const grounded = groundUnit(raw, pages);
  return grounded.ok ? { ...grounded.unit, humanId: human.id, grounded: true }
    : { ...raw, humanId: human.id, grounded: false, groundingCode: grounded.code };
}

const sameSiteAnyStage = (human, unit) => calibrationMatch({ ...human, stage: unit.stage }, unit);

// Verification outcome for a document: unanimous-present units, unanimous-absent items, splits.
export function verificationOutcome(state, records) {
  const items = reviewItemsOf(state);
  return items.map((item) => ({ ...item, votes: votesFor(records, item.item),
    result: unanimity(item, votesFor(records, item.item)) }));
}

// Items sent to arbitration for one document. `humans` = human v2 units of the document ([] when
// none); `partialHuman` = the human gold does not list every unit (only its units are checked).
export function arbitrationItemsOf({ documentId, pages, state, records, humans = [], partialHuman = false }) {
  const letters = positionLetters(documentId);
  const verified = verificationOutcome(state, records);
  const positionsOf = (entry, mapChoice = (choice) => choice) => FAMILY_ORDER.map((family) => {
    const vote = entry.votes[family];
    return { position: letters[family], family,
      choice: validVote(entry, vote) ? mapChoice(vote.choice) : null,
      reason: validVote(entry, vote) ? vote.reason.trim() : "vote manquant ou invalide" };
  });
  const presentUnanimous = verified.filter(({ result }) => result.outcome === "unanimous" && result.choice !== "absent")
    .map((entry) => ({ entry, unit: entry.options.find(({ option }) => option === entry.result.choice).unit }));
  const items = []; const usedHumans = new Set(); const usedUnits = new Set();

  // Human units matching a unanimous unit (same stage and site) raise no difference.
  const { pairs } = pairOneToOne(humans, presentUnanimous.map(({ unit }) => unit));
  for (const [human, unit] of pairs) {
    usedHumans.add(human.id);
    usedUnits.add(presentUnanimous.find((candidate) => candidate.unit === unit).entry.unitId);
  }

  // (a) Non-unanimous verification items; on human documents, the human position is attached.
  for (const entry of verified.filter(({ result }) => result.outcome === "split")) {
    let human = null;
    for (const candidate of humans.filter(({ id }) => !usedHumans.has(id))) {
      const option = entry.options.find(({ unit }) => unit && calibrationMatch(candidate, unit));
      if (option) { human = { humanId: candidate.id, choice: option.option }; usedHumans.add(candidate.id); break; }
    }
    if (!human && humans.length && !partialHuman) human = { humanId: null, choice: "absent" };
    items.push({ kind: "split", unitId: entry.unitId, verificationItem: entry.item,
      options: entry.options, positions: positionsOf(entry), human });
  }

  // (b) Human units without a unanimous counterpart.
  for (const human of humans.filter(({ id }) => !usedHumans.has(id))) {
    const humanUnit = humanOptionUnit(human, pages);
    const sibling = presentUnanimous.find(({ entry, unit }) => !usedUnits.has(entry.unitId) && sameSiteAnyStage(human, unit));
    if (sibling) {
      usedUnits.add(sibling.entry.unitId); usedHumans.add(human.id);
      items.push({ kind: "stage_divergent", unitId: sibling.entry.unitId, humanId: human.id,
        verificationItem: sibling.entry.item,
        options: [{ option: "v1", unit: sibling.unit }, { option: "v2", unit: humanUnit }, { option: "absent", unit: null }],
        positions: positionsOf(sibling.entry, (choice) => choice === sibling.entry.result.choice ? "v1" : "absent"),
        human: { humanId: human.id, choice: "v2" } });
      continue;
    }
    usedHumans.add(human.id);
    // Rejected unanimously at verification: the three reasoned "absent" votes are the positions.
    const rejected = verified.find((entry) => entry.result.outcome === "unanimous" && entry.result.choice === "absent"
      && entry.options.some(({ unit }) => unit && sameSiteAnyStage(human, unit)));
    items.push({ kind: "human_only", unitId: null, humanId: human.id, verificationItem: rejected?.item ?? null,
      options: [{ option: "v1", unit: humanUnit }, { option: "absent", unit: null }],
      positions: rejected ? positionsOf(rejected, () => "absent")
        : FAMILY_ORDER.map((family) => ({ position: letters[family], family, choice: "absent",
          reason: "unité jamais proposée par les annotateurs automatiques" })),
      human: { humanId: human.id, choice: "v1" } });
  }

  // (c) Unanimous units absent from a complete human gold.
  if (humans.length && !partialHuman) {
    for (const { entry, unit } of presentUnanimous.filter(({ entry }) => !usedUnits.has(entry.unitId))) {
      items.push({ kind: "v3_only", unitId: entry.unitId, humanId: null, verificationItem: entry.item,
        options: [{ option: "v1", unit }, { option: "absent", unit: null }],
        positions: positionsOf(entry, (choice) => choice === entry.result.choice ? "v1" : "absent"),
        human: { humanId: null, choice: "absent" } });
    }
  }
  return items.map((item, index) => ({ item: pad("a", index), ...item }));
}

// Arbitration result: unanimous on an option -> resolved; a present option that is not grounded
// verbatim cannot enter the reference -> unresolved.
export function resolveArbitration(item, votesByFamily) {
  const result = unanimity(item, votesByFamily);
  if (result.outcome !== "unanimous") return { outcome: "unresolved", choice: null, tally: result.tally, cause: "no_unanimity" };
  const option = item.options.find(({ option: name }) => name === result.choice);
  if (option.unit && option.unit.grounded === false) {
    return { outcome: "unresolved", choice: result.choice, tally: result.tally, cause: "option_not_grounded" };
  }
  return { outcome: "resolved", choice: result.choice, tally: result.tally };
}

// Soft merge (owner decision 2026-09-18, character intervals - see oracle-v3-soft.mjs): a split
// verification item whose three valid votes all chose PRESENT versions that are pairwise
// equivalent (same stage, object key strictly equal, same page, spans overlapping by >= 12
// normalised characters) is a cut difference, not a disagreement. It is merged on one of the voted
// versions, verbatim (most votes, then the longest citation, then the earliest) - never on a
// synthesised union. `pages` = frozen pages of the document; null disables the merge.
export function softMerge(entry, pages) {
  if (!entry || !pages) return null;
  const choices = FAMILY_ORDER.map((family) => validVote(entry, entry.votes?.[family]) ? entry.votes[family].choice : null);
  if (choices.some((choice) => !choice || choice === "absent")) return null;
  const unitOf = (choice) => entry.options.find(({ option }) => option === choice).unit;
  const units = choices.map(unitOf);
  if (!units.every((unit) => softEquivalent(unit, units[0], pages))) return null;
  const counts = {}; for (const choice of choices) counts[choice] = (counts[choice] ?? 0) + 1;
  const order = entry.options.map(({ option }) => option);
  const length = (choice) => [...String(unitOf(choice).citation ?? "")].length;
  const choice = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || length(b) - length(a)
    || order.indexOf(a) - order.indexOf(b))[0];
  return { outcome: "merged", choice, tally: counts, rule: "intervals" };
}

// Diagnostic only: would ROUGE-L (>= 0.5, same identity) have merged this item? Never decides.
export function rougeWouldMerge(entry) {
  if (!entry) return false;
  const choices = FAMILY_ORDER.map((family) => validVote(entry, entry.votes?.[family]) ? entry.votes[family].choice : null);
  if (choices.some((choice) => !choice || choice === "absent")) return false;
  const units = choices.map((choice) => entry.options.find(({ option }) => option === choice).unit);
  return units.every((unit) => rougeEquivalent(unit, units[0]));
}

// Final units of a document: unanimous-present units, minus those sent to arbitration, plus the
// arbitrated items resolved on a present option, plus the soft-merged items. Returns the units and
// one record per item.
export function finalUnits({ state, records, arbitration, arbitrationRecords, pages = null }) {
  const verified = verificationOutcome(state, records);
  const keep = new Map(verified.filter(({ result }) => result.outcome === "unanimous" && result.choice !== "absent")
    .map((entry) => [entry.unitId, { unitId: entry.unitId, via: "unanimous",
      unit: entry.options.find(({ option }) => option === entry.result.choice).unit }]));
  const decisions = [];
  for (const item of arbitration) {
    if (item.unitId) keep.delete(item.unitId);
    const votes = votesFor(arbitrationRecords, item.item);
    const complete = FAMILY_ORDER.every((family) => arbitrationRecords[family]);
    const arbitrated = complete ? resolveArbitration(item, votes) : { outcome: "pending", choice: null };
    const entry = item.kind === "split" ? verified.find(({ unitId }) => unitId === item.unitId) : null;
    const merged = softMerge(entry, pages);
    const resolution = merged ? { ...merged, arbitration: arbitrated } : arbitrated;
    const diagnostics = entry ? { intervalMerge: Boolean(merged), rougeMerge: rougeWouldMerge(entry) } : null;
    decisions.push({ ...item, votes, resolution, ...(diagnostics ? { softDiagnostics: diagnostics } : {}) });
    const option = ["resolved", "merged"].includes(resolution.outcome)
      ? item.options.find(({ option: name }) => name === resolution.choice) : null;
    if (option?.unit) keep.set(item.unitId ?? `h:${item.humanId}`, { unitId: item.unitId ?? `h:${item.humanId}`,
      via: resolution.outcome === "merged" ? "soft-merged" : "arbitrated", unit: option.unit });
  }
  return { units: [...keep.values()], verified, decisions };
}

// Who was right on a difference with the human gold.
export function humanVerdict(decision) {
  if (!decision.human) return null;
  const { outcome, choice } = decision.resolution;
  if (outcome === "pending") return "pending";
  if (outcome !== "resolved" && outcome !== "merged") return "unresolved";
  const humanChoice = decision.human.choice;
  const v3Choice = decision.kind === "human_only" ? "absent"
    : decision.kind === "split" ? null : "v1";
  if (choice === humanChoice) return "human_right";
  if (v3Choice && choice === v3Choice) return "v3_right";
  return decision.kind === "split" ? "human_wrong" : "neither";
}

export const publicOption = ({ option, unit }) => [option, unit ? publicUnit({ ...unit, id: undefined }) : "absent"];

// Verification message: every item, options without authorship, history or current state.
export function verifyUserMessage(document, pages, items) {
  return `${identity(document, pages)}

UNITÉS À VÉRIFIER (${items.length}) :
`
    + `${JSON.stringify({ items: items.map(({ item, options }) => ({ item,
      options: Object.fromEntries(options.map(publicOption)) })) }, null, 1)}`
    + `

TEXTE DU DOCUMENT :
${pagesBlock(pages)}`;
}

// Arbitration message: options with their verbatim excerpt, then the reasoned positions (A/B/C and
// the human gold when there is one), never the model names.
export function arbitrateUserMessage(document, pages, items) {
  return `${identity(document, pages)}

POINTS À ARBITRER (${items.length}) :
`
    + `${JSON.stringify({ items: items.map(({ item, options, positions, human }) => ({ item,
      options: Object.fromEntries(options.map(publicOption)),
      positions: [...positions].sort((left, right) => left.position.localeCompare(right.position))
        .map(({ position, choice, reason }) => ({ position: `annotateur ${position}`, choice, reason })),
      ...(human ? { reference_humaine: { choice: human.choice,
        note: "corrigé humain v2, non présumé juste" } } : {}) })) }, null, 1)}`
    + `

TEXTE DU DOCUMENT :
${pagesBlock(pages)}`;
}
