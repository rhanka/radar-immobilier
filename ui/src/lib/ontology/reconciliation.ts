/**
 * Reconciliation studio — pure read-model + view helpers (no Svelte, unit-tested).
 *
 * Mirrors the per-city graphify PROJECT STATE served read-only by the API
 * (SPEC_ONTOLOGY_DATA_MODEL.md §3.3, §6.1 D1): canonical entities grouped by node
 * type, the reconciliation candidate queue (`entity_match` pairs + score + shared
 * normalized terms), and raw mentions with their `rawRef` provenance. This is the
 * exact data the reconciliation screen renders. Mutation (accept/reject) is
 * deferred to the studio's write-guarded core (this lot is read-only).
 */

/** A reconciled canonical entity (mirrors the API `entities[]` shape). */
export interface CanonicalEntityV {
  id: string;
  type: string;
  label: string;
  aliases: string[];
  memberMentionIds: string[];
  evidenceRefs: string[];
  status: "validated" | "candidate";
}

/** A raw modeled-entity mention (mirrors the API `mentions[]` shape). */
export interface MentionV {
  id: string;
  type: string;
  label: string;
  normalized_terms: string[];
  source_refs: string[];
}

/** A graphify `entity_match` reconciliation candidate (subset radar renders). */
export interface CandidateV {
  id: string;
  candidate_id: string;
  canonical_id: string;
  score?: number;
  shared_terms?: string[];
  normalized_terms?: string[];
}

/** The three API payloads a city's studio view consumes. */
export interface OntologyCityState {
  citySlug: string;
  profileHash: string;
  generatedAt: string;
  entities: CanonicalEntityV[];
  candidates: CandidateV[];
  rawRefs: string[];
  mentions: MentionV[];
}

/** The pilot cities selectable in the studio (slug + display label). */
export interface StudioCity {
  slug: string;
  label: string;
}

export const STUDIO_CITIES: readonly StudioCity[] = [
  { slug: "salaberry-de-valleyfield", label: "Salaberry-de-Valleyfield" },
  { slug: "beauharnois", label: "Beauharnois" },
];

/**
 * Canonical node-type display order for the studio (profile §1.1 V1 types).
 * Types not in this list sort to the end, alphabetically.
 */
export const NODE_TYPE_ORDER: readonly string[] = [
  "Lot",
  "Valuation",
  "Zone",
  "Bylaw",
  "DesignationEvent",
  "Adresse",
  "Constraint",
  "Source",
  "Signal",
  "Municipality",
];

/** One node-type group of canonicals (the studio renders one card per group). */
export interface EntityGroup {
  type: string;
  entities: CanonicalEntityV[];
}

/** Group canonical entities by node type, ordered per NODE_TYPE_ORDER. */
export function groupEntitiesByType(
  entities: readonly CanonicalEntityV[],
): EntityGroup[] {
  const byType = new Map<string, CanonicalEntityV[]>();
  for (const e of entities) {
    const arr = byType.get(e.type) ?? [];
    arr.push(e);
    byType.set(e.type, arr);
  }
  const groups: EntityGroup[] = [];
  for (const [type, arr] of byType) {
    groups.push({
      type,
      entities: [...arr].sort((a, b) => a.label.localeCompare(b.label)),
    });
  }
  groups.sort((a, b) => {
    const ia = NODE_TYPE_ORDER.indexOf(a.type);
    const ib = NODE_TYPE_ORDER.indexOf(b.type);
    const ra = ia === -1 ? Number.MAX_SAFE_INTEGER : ia;
    const rb = ib === -1 ? Number.MAX_SAFE_INTEGER : ib;
    return ra !== rb ? ra - rb : a.type.localeCompare(b.type);
  });
  return groups;
}

/** Counts surfaced in the studio header / city selector. */
export interface StudioCounts {
  entityCount: number;
  candidateCount: number;
  mentionCount: number;
  validatedCount: number;
}

export function studioCounts(state: OntologyCityState): StudioCounts {
  return {
    entityCount: state.entities.length,
    candidateCount: state.candidates.length,
    mentionCount: state.mentions.length,
    validatedCount: state.entities.filter((e) => e.status === "validated").length,
  };
}

/** Human label for a candidate row (shared normalized terms drive the match). */
export function candidateSharedTerms(c: CandidateV): string[] {
  return c.shared_terms ?? c.normalized_terms ?? [];
}

/**
 * A mention's display provenance: the raw S3 evidence refs that back it. Owner
 * /PII is NEVER part of a mention (Loi 25, §7.4) — only structural refs.
 */
export function mentionProvenance(m: MentionV): string[] {
  return m.source_refs;
}

/** Short, file-name-only label for a raw S3 ref (the full key is the title). */
export function shortRawRef(ref: string): string {
  const parts = ref.split("/");
  return parts[parts.length - 1] ?? ref;
}

// ─────────────────────────────────────────────────────────────────────────────
// API client (read-only) — fetches the per-city project state.
// ─────────────────────────────────────────────────────────────────────────────

/** Empty-state marker when a city has no persisted project state (404). */
export const NO_PROJECT_STATE = "no-project-state" as const;

export type FetchCityStateResult =
  | { kind: "ok"; state: OntologyCityState }
  | { kind: "empty"; citySlug: string }
  | { kind: "error"; detail: string };

interface ApiEntitiesResponse {
  ok: boolean;
  citySlug: string;
  profileHash: string;
  generatedAt: string;
  entities: CanonicalEntityV[];
}
interface ApiCandidatesResponse {
  candidates: CandidateV[];
}
interface ApiMentionsResponse {
  rawRefs: string[];
  mentions: MentionV[];
}

function apiBase(baseUrl: string | undefined): string {
  return baseUrl ? baseUrl.replace(/\/$/, "") : "";
}

/**
 * Fetch and assemble a city's project state from the three read endpoints.
 * A 404 `no-project-state` on the entities endpoint resolves to `empty` (the
 * studio shows the seed CTA); a network/parse failure resolves to `error`.
 */
export async function fetchCityState(
  citySlug: string,
  fetchImpl: typeof fetch = fetch,
  baseUrl?: string,
): Promise<FetchCityStateResult> {
  const base = apiBase(baseUrl);
  try {
    const eRes = await fetchImpl(`${base}/api/ontology/${citySlug}/entities`);
    if (eRes.status === 404) {
      return { kind: "empty", citySlug };
    }
    if (!eRes.ok) {
      return { kind: "error", detail: `entities HTTP ${eRes.status}` };
    }
    const entities = (await eRes.json()) as ApiEntitiesResponse;

    const [cRes, mRes] = await Promise.all([
      fetchImpl(`${base}/api/ontology/${citySlug}/candidates`),
      fetchImpl(`${base}/api/ontology/${citySlug}/mentions`),
    ]);
    const candidates = cRes.ok
      ? ((await cRes.json()) as ApiCandidatesResponse).candidates
      : [];
    const mentionsBody = mRes.ok
      ? ((await mRes.json()) as ApiMentionsResponse)
      : { rawRefs: [], mentions: [] };

    return {
      kind: "ok",
      state: {
        citySlug: entities.citySlug,
        profileHash: entities.profileHash,
        generatedAt: entities.generatedAt,
        entities: entities.entities,
        candidates,
        rawRefs: mentionsBody.rawRefs,
        mentions: mentionsBody.mentions,
      },
    };
  } catch (e) {
    return {
      kind: "error",
      detail: e instanceof Error ? e.message : "Connexion impossible",
    };
  }
}

/**
 * Trigger the NETWORK-FREE real-data seed for a city
 * (POST /api/ontology/:city/exploit-samples). Returns whether the seed succeeded.
 */
export async function seedCity(
  citySlug: string,
  fetchImpl: typeof fetch = fetch,
  baseUrl?: string,
): Promise<{ ok: boolean; detail?: string }> {
  const base = apiBase(baseUrl);
  try {
    const res = await fetchImpl(
      `${base}/api/ontology/${citySlug}/exploit-samples`,
      { method: "POST" },
    );
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    const body = (await res.json()) as { ok: boolean };
    return { ok: body.ok };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : "échec" };
  }
}
