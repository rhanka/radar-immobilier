/**
 * CIBLAGE — pure read/write model + view helpers (no Svelte, unit-tested).
 *
 * Mirrors the `CiblagePlan` documents served by the API (pipeline stage 1 of 3:
 * ciblage → recueil → exploitation). A plan is a PURE DECLARATION of WHAT to
 * collect — cities, source bindings (from the REAL `prioritySources` catalogue
 * delivered by the API), and a cadence. Saving a plan NEVER triggers a
 * collection: the "Lancer la collecte" affordance is intentionally disabled
 * ("à venir"), because the recueil execution is a separate next lot. The plan id
 * is what a later recueil run stamps onto each collected RawDocument provenance
 * (`ciblagePlanId`).
 */

/** The three CIBLAGE cadences (mirror the ÉV7 automation model + domain enum). */
export type CiblageCadenceV = "initial" | "recurrent" | "approfondissement";

export const CIBLAGE_CADENCES: readonly {
  value: CiblageCadenceV;
  label: string;
  hint: string;
}[] = [
  { value: "initial", label: "Initial", hint: "Premier balayage complet d'un périmètre" },
  { value: "recurrent", label: "Récurrent", hint: "Rafraîchissement au rythme naturel de la source" },
  {
    value: "approfondissement",
    label: "Approfondissement",
    hint: "Passe plus profonde, déclenchée par un signal",
  },
];

/** A persisted ciblage plan (mirrors the API `plan` shape). */
export interface CiblagePlanV {
  id: string;
  label: string;
  citySlugs: string[];
  sourceBindingIds: string[];
  cadence: CiblageCadenceV;
  enabled: boolean;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

/** A selectable source binding from the REAL prioritySources catalogue. */
export interface SourceBindingV {
  sourceId: string;
  kind: string;
  city?: string;
  tier: string;
  cadence: string;
}

/** The editable create/edit form payload. */
export interface CiblagePlanFormV {
  label: string;
  citySlugs: string[];
  sourceBindingIds: string[];
  cadence: CiblageCadenceV;
  enabled: boolean;
  notes: string;
}

/** The pilot cities a plan can target (slug + display label). */
export interface CiblageCity {
  slug: string;
  label: string;
}

export const CIBLAGE_CITIES: readonly CiblageCity[] = [
  { slug: "salaberry-de-valleyfield", label: "Salaberry-de-Valleyfield" },
  { slug: "beauharnois", label: "Beauharnois" },
];

/** An empty form (defaults: enabled, recurrent cadence). */
export function emptyForm(): CiblagePlanFormV {
  return {
    label: "",
    citySlugs: [],
    sourceBindingIds: [],
    cadence: "recurrent",
    enabled: true,
    notes: "",
  };
}

/** Hydrate the form from an existing plan (for editing). */
export function formFromPlan(plan: CiblagePlanV): CiblagePlanFormV {
  return {
    label: plan.label,
    citySlugs: [...plan.citySlugs],
    sourceBindingIds: [...plan.sourceBindingIds],
    cadence: plan.cadence,
    enabled: plan.enabled,
    notes: plan.notes ?? "",
  };
}

/** Whether a form is submittable (label + at least one source binding). */
export function isFormValid(form: CiblagePlanFormV): boolean {
  return form.label.trim().length > 0 && form.sourceBindingIds.length > 0;
}

/** Human label for a cadence value. */
export function cadenceLabel(cadence: CiblageCadenceV): string {
  return CIBLAGE_CADENCES.find((c) => c.value === cadence)?.label ?? cadence;
}

/** Human label for a city slug (falls back to the slug). */
export function cityLabel(slug: string): string {
  return CIBLAGE_CITIES.find((c) => c.slug === slug)?.label ?? slug;
}

/** One group of source bindings (the picker renders one group per kind). */
export interface BindingGroup {
  kind: string;
  bindings: SourceBindingV[];
}

/** Group source bindings by `kind`, sorted by kind then sourceId. */
export function groupBindingsByKind(
  bindings: readonly SourceBindingV[],
): BindingGroup[] {
  const byKind = new Map<string, SourceBindingV[]>();
  for (const b of bindings) {
    const arr = byKind.get(b.kind) ?? [];
    arr.push(b);
    byKind.set(b.kind, arr);
  }
  return [...byKind.entries()]
    .map(([kind, arr]) => ({
      kind,
      bindings: [...arr].sort((a, b) => a.sourceId.localeCompare(b.sourceId)),
    }))
    .sort((a, b) => a.kind.localeCompare(b.kind));
}

/** Toggle membership of a value in a string array (immutable). */
export function toggleIn(list: readonly string[], value: string): string[] {
  return list.includes(value)
    ? list.filter((v) => v !== value)
    : [...list, value];
}

// ─────────────────────────────────────────────────────────────────────────────
// API client — list / create / patch / delete ciblage plans.
// ─────────────────────────────────────────────────────────────────────────────

function apiBase(baseUrl: string | undefined): string {
  return baseUrl ? baseUrl.replace(/\/$/, "") : "";
}

export type FetchCiblageResult =
  | { kind: "ok"; plans: CiblagePlanV[]; sourceBindings: SourceBindingV[] }
  | { kind: "error"; detail: string };

interface ApiListResponse {
  ok: boolean;
  plans: CiblagePlanV[];
  sourceBindings: SourceBindingV[];
}

/** Fetch all plans + the REAL selectable source catalogue. */
export async function fetchCiblage(
  fetchImpl: typeof fetch = fetch,
  baseUrl?: string,
): Promise<FetchCiblageResult> {
  const base = apiBase(baseUrl);
  try {
    const res = await fetchImpl(`${base}/api/ciblage`);
    if (!res.ok) return { kind: "error", detail: `HTTP ${res.status}` };
    const body = (await res.json()) as ApiListResponse;
    return {
      kind: "ok",
      plans: body.plans,
      sourceBindings: body.sourceBindings,
    };
  } catch (e) {
    return {
      kind: "error",
      detail: e instanceof Error ? e.message : "Connexion impossible",
    };
  }
}

export type SavePlanResult =
  | { ok: true; plan: CiblagePlanV }
  | { ok: false; detail: string };

/** Create a new plan from a form payload. */
export async function createPlan(
  form: CiblagePlanFormV,
  fetchImpl: typeof fetch = fetch,
  baseUrl?: string,
): Promise<SavePlanResult> {
  return savePlan("POST", `/api/ciblage`, form, fetchImpl, baseUrl);
}

/** Edit an existing plan (PATCH) from a form payload. */
export async function updatePlan(
  id: string,
  form: CiblagePlanFormV,
  fetchImpl: typeof fetch = fetch,
  baseUrl?: string,
): Promise<SavePlanResult> {
  return savePlan("PATCH", `/api/ciblage/${id}`, form, fetchImpl, baseUrl);
}

async function savePlan(
  method: "POST" | "PATCH",
  path: string,
  form: CiblagePlanFormV,
  fetchImpl: typeof fetch,
  baseUrl?: string,
): Promise<SavePlanResult> {
  const base = apiBase(baseUrl);
  const payload = {
    label: form.label.trim(),
    citySlugs: form.citySlugs,
    sourceBindingIds: form.sourceBindingIds,
    cadence: form.cadence,
    enabled: form.enabled,
    ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
  };
  try {
    const res = await fetchImpl(`${base}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        detail?: string;
        error?: string;
      } | null;
      return { ok: false, detail: body?.detail ?? body?.error ?? `HTTP ${res.status}` };
    }
    const body = (await res.json()) as { plan: CiblagePlanV };
    return { ok: true, plan: body.plan };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : "échec" };
  }
}

/** Delete a plan by id. */
export async function deletePlan(
  id: string,
  fetchImpl: typeof fetch = fetch,
  baseUrl?: string,
): Promise<{ ok: boolean; detail?: string }> {
  const base = apiBase(baseUrl);
  try {
    const res = await fetchImpl(`${base}/api/ciblage/${id}`, {
      method: "DELETE",
    });
    return res.ok ? { ok: true } : { ok: false, detail: `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : "échec" };
  }
}
