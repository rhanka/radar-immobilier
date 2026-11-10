/**
 * Signal classement (spec-classement-signaux-2026-11-08): pure mapping between
 * the existing basket heads (selection pertinent/a_surveiller + archive) and
 * the four UI classes. No I/O, no new persistence.
 */
export type SignalClass = "pertinent" | "a_surveiller" | "ecarte" | "non_classe";
export type ClassementVerdict = "pertinent" | "a_surveiller" | "non_pertinent";

export interface ReasonCodeEntry {
  code: string;
  verdict: ClassementVerdict;
  label?: string | null;
}

export type ClassementFilter = Record<SignalClass, boolean>;

export const DEFAULT_CLASSEMENT_FILTER: ClassementFilter = {
  pertinent: true,
  a_surveiller: true,
  non_classe: true,
  ecarte: false,
};

export const SIGNAL_CLASSES: readonly SignalClass[] = [
  "pertinent",
  "a_surveiller",
  "non_classe",
  "ecarte",
];

/**
 * Class → DS semantic token mapping (icon colour only; labels stay primary):
 * pertinent → feedback-success, a_surveiller → feedback-warning,
 * ecarte → text-muted (neutral), non_classe → text-secondary (neutral).
 * Same tokens drive the card IconButton (ghost) and the cascade menu icons.
 */
export const CLASSEMENT_META: Record<SignalClass, { label: string; icon: string; token: string }> = {
  pertinent: { label: "Pertinent", icon: "Target", token: "var(--st-semantic-feedback-success)" },
  a_surveiller: { label: "À surveiller", icon: "Eye", token: "var(--st-semantic-feedback-warning)" },
  ecarte: { label: "Écarté", icon: "EyeOff", token: "var(--st-semantic-text-muted)" },
  non_classe: { label: "Non classé", icon: "CircleDashed", token: "var(--st-semantic-text-secondary)" },
};

const VERDICT_FOR_CLASS: Record<Exclude<SignalClass, "non_classe">, ClassementVerdict> = {
  pertinent: "pertinent",
  a_surveiller: "a_surveiller",
  ecarte: "non_pertinent",
};

export interface ClassementHeadLike {
  target: { citySlug: string; type: string; id: string };
  facet: string;
  basket: string | null;
  state: string;
  reasonCode: string | null;
  id?: string;
}

export interface ArchiveHeadLike {
  target: { citySlug: string; type: string; id: string };
  personal: { id: string; state: string; reasonCode: string | null } | null;
  workspace: { id: string; state: string; reasonCode: string | null } | null;
  effectiveDiscarded: boolean;
}

export interface ClassementEntry {
  classe: SignalClass;
  reasonCode: string | null;
  /** Active selection head id per basket (null when the basket is off). */
  pertinentHeadId: string | null;
  aSurveillerHeadId: string | null;
  /**
   * Latest selection head id per basket, ANY state. The facet writer
   * compares expectedHeadId against the stream head even when that head
   * is inactive (deselected): sending null there is a 409
   * facet_head_conflict, so a Non classé signal that was once classified
   * must keep its inactive head id for the next write.
   */
  pertinentExpectedHeadId: string | null;
  aSurveillerExpectedHeadId: string | null;
  archiveHeadId: string | null;
  discarded: boolean;
}

export const EMPTY_CLASSEMENT_ENTRY: ClassementEntry = {
  classe: "non_classe",
  reasonCode: null,
  pertinentHeadId: null,
  aSurveillerHeadId: null,
  pertinentExpectedHeadId: null,
  aSurveillerExpectedHeadId: null,
  archiveHeadId: null,
  discarded: false,
};

export function classementKey(type: string, id: string, citySlug?: string | null): string {
  return citySlug ? `${citySlug}:${type}:${id}` : `${type}:${id}`;
}

export function buildClassementMap(
  selection: readonly ClassementHeadLike[],
  archive: readonly ArchiveHeadLike[],
): Map<string, ClassementEntry> {
  const map = new Map<string, ClassementEntry>();
  const ensure = (type: string, id: string, citySlug?: string | null): ClassementEntry => {
    const key = classementKey(type, id, citySlug);
    const existing = map.get(key);
    if (existing) return existing;
    const entry: ClassementEntry = { ...EMPTY_CLASSEMENT_ENTRY };
    map.set(key, entry);
    return entry;
  };
  for (const row of archive) {
    const entry = ensure(row.target.type, row.target.id, row.target.citySlug);
    // F9: expectedHeadId must be the EFFECTIVE head — the active archive
    // head (personal first, else workspace), not always the personal one.
    const activeHead = row.personal?.state === "active"
      ? row.personal
      : row.workspace?.state === "active" ? row.workspace : null;
    entry.archiveHeadId = activeHead?.id ?? row.personal?.id ?? row.workspace?.id ?? null;
    if (row.effectiveDiscarded) {
      entry.classe = "ecarte";
      entry.discarded = true;
      entry.reasonCode = activeHead?.reasonCode ?? row.personal?.reasonCode ?? row.workspace?.reasonCode ?? null;
    }
  }
  for (const head of selection) {
    if (head.facet !== "selection") continue;
    const entry = ensure(head.target.type, head.target.id, head.target.citySlug);
    // The expected head tracks the latest head in ANY state (see
    // ClassementEntry): an inactive head is still the stream head the
    // writer compares against.
    if (head.basket === "pertinent") entry.pertinentExpectedHeadId = head.id ?? null;
    if (head.basket === "a_surveiller") entry.aSurveillerExpectedHeadId = head.id ?? null;
    if (head.state !== "active") continue;
    if (head.basket === "pertinent") entry.pertinentHeadId = head.id ?? null;
    if (head.basket === "a_surveiller") entry.aSurveillerHeadId = head.id ?? null;
    if (entry.discarded) continue;
    // Single-class view: pertinent wins when legacy data holds both baskets.
    if (head.basket === "pertinent" || entry.classe === "non_classe") {
      entry.classe = head.basket as SignalClass;
      entry.reasonCode = head.reasonCode;
    }
  }
  return map;
}

export function classementCounts(classes: readonly SignalClass[]): Record<SignalClass, number> {
  const counts: Record<SignalClass, number> = { pertinent: 0, a_surveiller: 0, non_classe: 0, ecarte: 0 };
  for (const classe of classes) counts[classe] += 1;
  return counts;
}

export function filterNodesByClassement<T extends { id: string; type: string; citySlug?: string | null }>(
  nodes: readonly T[],
  map: ReadonlyMap<string, ClassementEntry>,
  filter: ClassementFilter,
): T[] {
  return nodes.filter((node) => {
    const classe = map.get(classementKey(node.type, node.id, node.citySlug))?.classe
      ?? map.get(classementKey(node.type, node.id))?.classe ?? "non_classe";
    return filter[classe];
  });
}

export function reasonCodesForClass(
  entries: readonly ReasonCodeEntry[],
  classe: SignalClass,
): ReasonCodeEntry[] {
  if (classe === "non_classe") return [];
  const verdict = VERDICT_FOR_CLASS[classe];
  return entries.filter((entry) => entry.verdict === verdict);
}

export function validateClassementChoice(
  classe: SignalClass,
  reasonCode: string | null | undefined,
  entries: readonly ReasonCodeEntry[],
): { ok: true } | { ok: false; error: string } {
  if (classe === "non_classe") {
    return reasonCode ? { ok: false, error: "reason_not_allowed" } : { ok: true };
  }
  if (classe === "ecarte" && !reasonCode) return { ok: false, error: "reason_code_required" };
  if (reasonCode) {
    const match = reasonCodesForClass(entries, classe).some((entry) => entry.code === reasonCode);
    if (!match) return { ok: false, error: "invalid_reason_code" };
  }
  return { ok: true };
}
