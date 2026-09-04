/**
 * annotations-client — client UI des annotations « Domaine collaboratif » (§2),
 * endpoint UNIFIÉ `/api/v1/prospects/notes` (signal + lot, contrat #576).
 *
 * Wire : requête **snake_case** (`target_type`/`no_lot`/`city_slug`/`signal_id`/
 * `body`). L'`authorId` est résolu SERVEUR via la session approuvée (cookie) →
 * le client ne s'auto-attribue jamais (`credentials: "same-origin"`). Mutations
 * author-only (403 cross-author côté serveur), édition in-place, suppression soft.
 *
 * ⚠ Forme de réponse HÉTÉROGÈNE (vérifié backend) : GET/listNotes renvoie
 * l'auteur **à plat** (`authorName`/`authorEmail`), POST/PATCH le renvoie
 * **imbriqué** (`author:{name,email}`). Le mapping lit LES DEUX. Stratégie :
 * mutations → succès seul, le parent **refetch** `listAnnotations` (canonise sur
 * la forme GET : ordre desc, attribution, soft-delete masqué).
 * Gabarit : `ui/src/lib/prospect/prospect-marks-client.ts`.
 */
import { fetchWithTimeout } from "$lib/net/fetch-with-timeout.js";
import type { AnnotationTarget, EntityAnnotation } from "$lib/collab/annotation.js";

interface WireNote {
  id: string;
  body: string;
  authorId?: string | null;
  // GET (à plat) :
  authorName?: string | null;
  authorEmail?: string | null;
  // POST/PATCH (imbriqué) :
  author?: { id?: string; name?: string | null; email?: string | null } | null;
  createdAt: string;
  updatedAt?: string | null;
}

function apiUrl(path: string): string {
  return `${import.meta.env.VITE_API_BASE_URL ?? ""}${path}`;
}

/** Note serveur → annotation présentielle (auteur : plat OU imbriqué, name puis email). */
function toEntityAnnotation(n: WireNote): EntityAnnotation {
  return {
    id: n.id,
    body: n.body,
    authorId: n.authorId ?? n.author?.id ?? "",
    authorName: n.authorName ?? n.author?.name ?? n.authorEmail ?? n.author?.email ?? null,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt ?? null,
  };
}

/** Query de lecture unifiée (snake_case), discriminée sur le type de cible. */
function listQuery(target: AnnotationTarget): string {
  const p = new URLSearchParams();
  p.set("target_type", target.type);
  if (target.type === "signal") {
    p.set("signal_id", target.id);
  } else {
    p.set("no_lot", target.id);
    p.set("city_slug", target.citySlug);
  }
  return p.toString();
}

const JSON_HEADERS = { "content-type": "application/json" } as const;

/** Liste les annotations ACTIVES d'une cible (tri desc serveur, soft-delete masqué). */
export async function listAnnotations(target: AnnotationTarget): Promise<EntityAnnotation[]> {
  const res = await fetchWithTimeout(apiUrl(`/api/v1/prospects/notes?${listQuery(target)}`), {
    init: { credentials: "same-origin" },
  });
  if (!res.ok) throw new Error(`annotations list HTTP ${res.status}`);
  const body = (await res.json()) as { ok?: boolean; notes?: WireNote[] };
  if (!body.ok) throw new Error("annotations list: api ok=false");
  return (body.notes ?? []).map(toEntityAnnotation);
}

/** Crée une annotation (auteur = session serveur ; jamais auto-attribué). */
export async function createAnnotation(target: AnnotationTarget, text: string): Promise<void> {
  const payload =
    target.type === "signal"
      ? { target_type: "signal", signal_id: target.id, body: text }
      : { target_type: "lot", no_lot: target.id, city_slug: target.citySlug, body: text };
  const res = await fetchWithTimeout(apiUrl("/api/v1/prospects/notes"), {
    init: {
      method: "POST",
      credentials: "same-origin",
      headers: JSON_HEADERS,
      body: JSON.stringify(payload),
    },
  });
  if (!res.ok) throw new Error(`annotation create HTTP ${res.status}`);
}

/** Édite le corps (author-only serveur → 403 sinon). */
export async function editAnnotation(id: string, text: string): Promise<void> {
  const res = await fetchWithTimeout(apiUrl(`/api/v1/prospects/notes/${encodeURIComponent(id)}`), {
    init: {
      method: "PATCH",
      credentials: "same-origin",
      headers: JSON_HEADERS,
      body: JSON.stringify({ body: text }),
    },
  });
  if (!res.ok) throw new Error(`annotation edit HTTP ${res.status}`);
}

/** Supprime (soft-delete author-only serveur). */
export async function deleteAnnotation(id: string): Promise<void> {
  const res = await fetchWithTimeout(apiUrl(`/api/v1/prospects/notes/${encodeURIComponent(id)}`), {
    init: {
      method: "DELETE",
      credentials: "same-origin",
      headers: JSON_HEADERS,
      body: JSON.stringify({}),
    },
  });
  if (!res.ok) throw new Error(`annotation delete HTTP ${res.status}`);
}
