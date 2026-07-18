/**
 * m2 — Filtre de PLAGE DE DATES des signaux (AFFICHAGE UNIQUEMENT).
 *
 * C'est le PREMIER filtre du pipeline d'affichage : il définit la population de
 * base sur laquelle les axes A/B (Zonage · Résidentiel/Multifamilial · Précoce)
 * et les exclusions B viennent ensuite affiner. Comme les autres filtres de la
 * vue Signaux, il NE CLASSIFIE RIEN et ne recalcule aucun verdict serveur : il
 * ne fait que MASQUER les signaux dont la date d'étape sort de la plage.
 *
 * Champ filtré : la DATE DE LA DERNIÈRE ÉTAPE du signal (`etape_date`). Elle
 * vit dans les `props` graphify (forme aplatie ou imbriquée `props.properties`).
 * Repli sur la date de réunion / publication / ingestion pour placer dans le
 * temps un signal sans `etape_date` explicite — jamais une date inventée.
 *
 * Anti-invention : un signal SANS date exploitable est CONSERVÉ (on ne peut pas
 * affirmer qu'il est hors plage si on ne sait pas le dater). Le filtre ne retire
 * que ce qu'il peut positivement placer HORS de la plage.
 */

import type { GraphSignalNode } from "./graph-signal-detail-client.js";

/**
 * Plage de dates {start, end}. Structurellement compatible avec le
 * `DatePickerRange` du design-system (mêmes champs `Date | null`), ce qui permet
 * de la passer directement au `DatePicker mode="range"` sans adaptation.
 */
export interface SignalDateRange {
  start: Date | null;
  end: Date | null;
}

/** Presets proposés (en mois), dans l'ordre d'affichage du ButtonGroup. */
export const DATE_RANGE_PRESETS = [3, 6, 12] as const;

export type DateRangePresetMonths = (typeof DATE_RANGE_PRESETS)[number];

/** Preset présélectionné par défaut : 6 derniers mois. */
export const DEFAULT_PRESET_MONTHS: DateRangePresetMonths = 6;

/**
 * Soustrait `months` mois à une date (nouvelle instance, entrée inchangée).
 * Le débordement de fin de mois est laissé à `Date.setMonth` (ex. 31 août − 6
 * mois → 3 mars). Utilisé À L'IDENTIQUE par `presetRange` et
 * `activePresetForRange`, ce qui garantit que la reconstruction est exacte.
 */
export function subMonths(date: Date, months: number): Date {
  const next = new Date(date.getTime());
  next.setMonth(next.getMonth() - months);
  return next;
}

/**
 * Plage d'un preset : `end = now`, `start = now − N mois`.
 * `now` est injectable pour des tests déterministes.
 */
export function presetRange(
  months: DateRangePresetMonths,
  now: Date = new Date(),
): SignalDateRange {
  return { start: subMonths(now, months), end: new Date(now.getTime()) };
}

/** Plage par défaut de la vue : les 6 derniers mois. */
export function defaultDateRange(now: Date = new Date()): SignalDateRange {
  return presetRange(DEFAULT_PRESET_MONTHS, now);
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Quel preset (le cas échéant) une plage représente-t-elle ?
 *
 * On RECONSTRUIT le start attendu depuis le end de la plage : une plage de
 * preset vérifie `start === end − N mois`. Indépendant de `now` (donc stable
 * dans le temps) et robuste au décalage de timestamp entre le clic et une
 * relecture ultérieure. Une plage partielle (start ou end nul) ou custom → null,
 * ce qui DÉSÉLECTIONNE visuellement les presets.
 */
export function activePresetForRange(
  range: SignalDateRange,
): DateRangePresetMonths | null {
  if (!range.start || !range.end) return null;
  for (const months of DATE_RANGE_PRESETS) {
    if (isSameDay(range.start, subMonths(range.end, months))) return months;
  }
  return null;
}

/** Deux plages sont-elles équivalentes (au timestamp près) ? */
export function sameRange(a: SignalDateRange, b: SignalDateRange): boolean {
  const t = (d: Date | null): number | null => (d ? d.getTime() : null);
  return t(a.start) === t(b.start) && t(a.end) === t(b.end);
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).getTime();
}
function endOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).getTime();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `props.properties` (forme graphify imbriquée) puis `props` à plat. */
function propertyRecords(node: GraphSignalNode): Record<string, unknown>[] {
  const props = isRecord(node.props) ? node.props : {};
  const nested = isRecord(props.properties) ? props.properties : {};
  return [nested, props];
}

/**
 * Première valeur chaîne non vide trouvée pour l'une des `keys`, en parcourant
 * la forme imbriquée puis la forme à plat.
 */
function readString(node: GraphSignalNode, keys: string[]): string | null {
  for (const record of propertyRecords(node)) {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === "string" && value.trim() !== "") return value;
    }
  }
  return null;
}

/**
 * Date de la dernière étape d'un signal, ou `null` si aucune date exploitable.
 *
 * Précédence : `etape_date` (l'étape elle-même) → date de réunion → date de
 * publication du document → date d'ingestion. On priorise l'étape, puis on se
 * rabat sur la date la plus signifiante disponible pour maximiser la couverture
 * du filtre. Une chaîne non parsable → `null` (jamais une date fabriquée).
 */
export function signalEtapeDate(node: GraphSignalNode): Date | null {
  const raw =
    readString(node, [
      "etapeDate",
      "etape_date",
      "meetingDate",
      "meeting_date",
      "documentDate",
      "date",
    ]) ??
    node.publishedAt ??
    node.createdAt ??
    null;
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * La date tombe-t-elle DANS la plage ? Bornes INCLUSIVES au jour près (le start
 * inclut tout son jour, le end aussi). Une borne nulle est ouverte (−∞ / +∞), ce
 * qui rend une sélection custom partielle gracieuse. `null` (date inconnue) →
 * conservé (cf. anti-invention en tête de module).
 */
export function isWithinRange(date: Date | null, range: SignalDateRange): boolean {
  if (!date) return true;
  const t = date.getTime();
  const lo = range.start ? startOfDay(range.start) : Number.NEGATIVE_INFINITY;
  const hi = range.end ? endOfDay(range.end) : Number.POSITIVE_INFINITY;
  return t >= lo && t <= hi;
}

/**
 * PREMIER étage du pipeline d'affichage : restreint les nœuds bruts d'une ville
 * à ceux dont la date d'étape tombe dans la plage. Retourne un nouveau tableau
 * (ordre d'entrée conservé) — la projection A/B et les exclusions s'appliquent
 * ensuite en aval.
 */
export function filterNodesByEtapeDate(
  nodes: readonly GraphSignalNode[],
  range: SignalDateRange,
): GraphSignalNode[] {
  return nodes.filter((node) => isWithinRange(signalEtapeDate(node), range));
}
