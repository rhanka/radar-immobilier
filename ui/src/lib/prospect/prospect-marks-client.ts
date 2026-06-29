/**
 * Client UI pour les marquages/notes prospect (CS-L3).
 *
 * API backend existante : /api/v1/prospects/*.
 * Anti-PII : ces endpoints exposent uniquement noLot/citySlug/statuts/notes,
 * jamais propriétaire/adresse personnelle.
 */

export type ProspectDimension = "pipeline" | "marche";
export type PipelineStatus = "favori" | "ecarte" | "sollicite" | "lettre_envoyee";
export type MarketStatus = "en_vente";
export type ProspectStatus = PipelineStatus | MarketStatus;
export type ProspectMode = "real" | "simulation";

export interface ProspectMark {
  id: string;
  lotVersionId?: string | null;
  noLot: string;
  citySlug: string;
  dimension: ProspectDimension;
  statut: ProspectStatus;
  mode: ProspectMode;
  authorId?: string | null;
  supersedes?: string | null;
  createdAt: string;
}

export interface ProspectNote {
  id: string;
  noLot: string;
  citySlug: string;
  authorId?: string | null;
  body: string;
  mode: ProspectMode;
  createdAt: string;
}

export interface ProspectLotState {
  marks: ProspectMark[];
  notes: ProspectNote[];
}

export interface ProspectCounters {
  all: number;
  favori: number;
  ecarte: number;
  sollicite: number;
  lettre_envoyee: number;
  en_vente: number;
  unmarked: number;
}

const STATUS_LABELS: Record<ProspectStatus, string> = {
  favori: "Favori",
  ecarte: "Non retenu",
  sollicite: "Sollicité",
  lettre_envoyee: "Lettre envoyée",
  en_vente: "En vente",
};

const STATUS_SHORT_LABELS: Record<ProspectStatus, string> = {
  favori: "★",
  ecarte: "Écarté",
  sollicite: "Sollicité",
  lettre_envoyee: "Lettre",
  en_vente: "Vente",
};

export function prospectStatusLabel(status: ProspectStatus): string {
  return STATUS_LABELS[status];
}

export function prospectStatusShortLabel(status: ProspectStatus): string {
  return STATUS_SHORT_LABELS[status];
}

export function activePipelineMark(marks: ProspectMark[]): ProspectMark | null {
  return newestMark(marks.filter((mark) => mark.dimension === "pipeline"));
}

export function activeMarketMark(marks: ProspectMark[]): ProspectMark | null {
  return newestMark(marks.filter((mark) => mark.dimension === "marche"));
}

function newestMark(marks: ProspectMark[]): ProspectMark | null {
  return [...marks].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0] ?? null;
}

export function computeProspectCounters(
  lots: Array<{ noLot: string; citySlug?: string | null }>,
  marks: ProspectMark[],
): ProspectCounters {
  const byLot = new Map<string, ProspectMark[]>();
  for (const mark of marks) {
    const key = lotKey(mark.noLot, mark.citySlug);
    byLot.set(key, [...(byLot.get(key) ?? []), mark]);
  }

  const counters: ProspectCounters = {
    all: lots.length,
    favori: 0,
    ecarte: 0,
    sollicite: 0,
    lettre_envoyee: 0,
    en_vente: 0,
    unmarked: 0,
  };

  for (const lot of lots) {
    const citySlug = lot.citySlug ?? "";
    const lotMarks = byLot.get(lotKey(lot.noLot, citySlug)) ?? [];
    const pipeline = activePipelineMark(lotMarks);
    const market = activeMarketMark(lotMarks);
    if (pipeline) counters[pipeline.statut as PipelineStatus] += 1;
    if (market?.statut === "en_vente") counters.en_vente += 1;
    if (!pipeline && !market) counters.unmarked += 1;
  }

  return counters;
}

export function lotKey(noLot: string, citySlug: string): string {
  return `${citySlug}::${noLot}`;
}

function apiUrl(path: string, baseUrl = import.meta.env.VITE_API_BASE_URL ?? ""): string {
  const base = baseUrl ? baseUrl.replace(/\/$/, "") : "";
  return `${base}${path}`;
}

export async function fetchProspectMarksForLot(
  noLot: string,
  citySlug: string,
  baseUrl?: string,
): Promise<ProspectMark[]> {
  const res = await fetch(apiUrl(`/api/v1/prospects/lots/${encodeURIComponent(noLot)}/${encodeURIComponent(citySlug)}/marks`, baseUrl));
  if (!res.ok) throw new Error(`prospect marks HTTP ${res.status}`);
  const body = (await res.json()) as { ok?: boolean; marks?: ProspectMark[] };
  if (!body.ok) throw new Error("prospect marks: api returned ok=false");
  return body.marks ?? [];
}

export async function fetchProspectMarksForZone(
  citySlug: string,
  baseUrl?: string,
): Promise<ProspectMark[]> {
  const res = await fetch(apiUrl(`/api/v1/prospects/zones/${encodeURIComponent(citySlug)}/marks`, baseUrl));
  if (!res.ok) throw new Error(`prospect zone marks HTTP ${res.status}`);
  const body = (await res.json()) as { ok?: boolean; marks?: ProspectMark[] };
  if (!body.ok) throw new Error("prospect zone marks: api returned ok=false");
  return body.marks ?? [];
}

export async function fetchProspectNotesForLot(
  noLot: string,
  citySlug: string,
  baseUrl?: string,
): Promise<ProspectNote[]> {
  const res = await fetch(apiUrl(`/api/v1/prospects/lots/${encodeURIComponent(noLot)}/${encodeURIComponent(citySlug)}/notes`, baseUrl));
  if (!res.ok) throw new Error(`prospect notes HTTP ${res.status}`);
  const body = (await res.json()) as { ok?: boolean; notes?: ProspectNote[] };
  if (!body.ok) throw new Error("prospect notes: api returned ok=false");
  return body.notes ?? [];
}

export async function fetchProspectLotState(
  noLot: string,
  citySlug: string,
  baseUrl?: string,
): Promise<ProspectLotState> {
  const [marks, notes] = await Promise.all([
    fetchProspectMarksForLot(noLot, citySlug, baseUrl),
    fetchProspectNotesForLot(noLot, citySlug, baseUrl),
  ]);
  return { marks, notes };
}

// ── Écriture (append-only) ──────────────────────────────────────────────────
// Liste blanche stricte (Loi 25) : seuls statut/note/prix-public sont transmis,
// jamais d'identité propriétaire ni d'adresse personnelle.

export interface CreateProspectMarkInput {
  lotVersionId?: string | null;
  noLot: string;
  citySlug: string;
  dimension: ProspectDimension;
  statut: ProspectStatus;
  mode?: ProspectMode;
  /** Marché uniquement : prix demandé (annonce publique, non-PII). */
  prixDemande?: number | null;
  /** Marché uniquement : lien d'annonce publique. */
  lienAnnonce?: string | null;
}

/** POST /api/v1/prospects/marks → 201 { ok, mark }. Pose un statut (supersede LWW côté API). */
export async function createProspectMark(
  input: CreateProspectMarkInput,
  baseUrl?: string,
): Promise<ProspectMark> {
  const payload: Record<string, unknown> = {
    ...(input.lotVersionId != null ? { lotVersionId: input.lotVersionId } : {}),
    noLot: input.noLot,
    citySlug: input.citySlug,
    dimension: input.dimension,
    statut: input.statut,
    mode: input.mode ?? "real",
  };
  if (input.dimension === "marche") {
    if (input.prixDemande !== undefined) payload.prixDemande = input.prixDemande;
    if (input.lienAnnonce !== undefined) payload.lienAnnonce = input.lienAnnonce;
  }
  const res = await fetch(apiUrl(`/api/v1/prospects/marks`, baseUrl), {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`prospect mark create HTTP ${res.status}`);
  const body = (await res.json()) as { ok?: boolean; mark?: ProspectMark };
  if (!body.ok || !body.mark) throw new Error("prospect mark create: réponse invalide");
  return body.mark;
}

export interface CreateProspectNoteInput {
  noLot: string;
  citySlug: string;
  body: string;
  mode?: ProspectMode;
  lotVersionId?: string | null;
}

/** POST /api/v1/prospects/notes → 201 { ok, note }. Ajoute une note libre append-only. */
export async function createProspectNote(
  input: CreateProspectNoteInput,
  baseUrl?: string,
): Promise<ProspectNote> {
  const payload: Record<string, unknown> = {
    ...(input.lotVersionId != null ? { lotVersionId: input.lotVersionId } : {}),
    noLot: input.noLot,
    citySlug: input.citySlug,
    body: input.body,
    mode: input.mode ?? "real",
  };
  const res = await fetch(apiUrl(`/api/v1/prospects/notes`, baseUrl), {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`prospect note create HTTP ${res.status}`);
  const body = (await res.json()) as { ok?: boolean; note?: ProspectNote };
  if (!body.ok || !body.note) throw new Error("prospect note create: réponse invalide");
  return body.note;
}
