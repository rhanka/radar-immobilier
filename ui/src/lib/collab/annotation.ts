/**
 * Types front des annotations « Domaine collaboratif » (v1 : signal + lot ;
 * zone différée owner-D4). CONTRACT-AGNOSTIC : compatible modèle **personnel**
 * (notes privées par user) OU **team-partagé** (auteur visible) — seul le
 * filtrage/attribution des `notes` fournies au composant change, pas la forme.
 *
 * Le client API (lane extraction, sous le contrat d'ancre i-arch#1) et la forme
 * exacte serveur seront liés ULTÉRIEUREMENT (0 touche `api/`/`drizzle` avant GO
 * i-cond). Ces types sont la surface FRONT présentielle, indépendante du back.
 */

/** Cibles annotables en v1 (zone différée). */
export type AnnotationTargetType = "signal" | "lot";

/** Ancre stable d'une cible : signal = `GraphSignalNode.id` ; lot = `noLot`. */
export interface AnnotationTarget {
  type: AnnotationTargetType;
  id: string;
  citySlug: string;
}

/** Une note affichée. `authorName` visible en mode team-partagé ; l'édition/
 *  suppression (owner-D2 tombstone) n'est proposée que sur SES propres notes. */
export interface EntityAnnotation {
  id: string;
  body: string;
  authorId: string;
  authorName?: string | null;
  /** ISO 8601. */
  createdAt: string;
  /** ISO 8601, présent si la note a été éditée (owner-D2). */
  updatedAt?: string | null;
}
