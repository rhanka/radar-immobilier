/**
 * Service métier — marquage d'équipe Steve (Inc 2).
 *
 * Logique append-only/supersedes en transaction, LWW serveur, idempotence batch.
 *
 * Principe fondamental :
 *   - On ne modifie jamais un marquage existant.
 *   - Pour changer un statut : on insère un nouveau marquage (new) et, en
 *     transaction, on stampe `superseded_by = new.id` sur l'ancien actif.
 *   - L'index partiel UNIQUE(lot_version_id, dimension) WHERE superseded_by IS NULL
 *     garantit l'unicité de chaîne active côté DB.
 *   - LWW : le serveur est la source de vérité ; le dernier POST gagne.
 *
 * PII (Loi 25) :
 *   - Ce service ne lit ni n'expose jamais prospect_contacts.
 *   - La couche contact (lecture + journalisation) est dans contact-service.ts.
 */

import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import {
  prospectMarks,
  prospectNotes,
} from "../../db/schema.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ProspectDimension = "pipeline" | "marche";
export type ProspectStatut = "favori" | "ecarte" | "sollicite" | "lettre_envoyee" | "en_vente";
export type ProspectMode = "real" | "simulation";

export interface CreateMarkInput {
  lotVersionId: string;
  noLot: string;
  citySlug: string;
  dimension: ProspectDimension;
  statut: ProspectStatut;
  mode: ProspectMode;
  authorId: string;
  prixDemande?: number | null;
  lienAnnonce?: string | null;
}

export interface CreateNoteInput {
  noLot: string;
  citySlug: string;
  authorId: string;
  body: string;
  mode: ProspectMode;
}

export interface BatchMarkInput {
  lotVersionIds: string[];
  lotMeta: Record<string, { noLot: string; citySlug: string }>;
  dimension: ProspectDimension;
  statut: ProspectStatut;
  mode: ProspectMode;
  authorId: string;
}

// ─── Requêtes lecture ─────────────────────────────────────────────────────────

export async function getActiveMark(
  db: Database,
  lotVersionId: string,
  dimension: ProspectDimension,
) {
  const rows = await db
    .select()
    .from(prospectMarks)
    .where(
      and(
        eq(prospectMarks.lotVersionId, lotVersionId),
        eq(prospectMarks.dimension, dimension),
        isNull(prospectMarks.supersededBy),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function getActiveMarksForLot(
  db: Database,
  noLot: string,
  citySlug: string,
) {
  return db
    .select()
    .from(prospectMarks)
    .where(
      and(
        eq(prospectMarks.noLot, noLot),
        eq(prospectMarks.citySlug, citySlug),
        isNull(prospectMarks.supersededBy),
      ),
    );
}

export async function getActiveMarksForZone(
  db: Database,
  citySlug: string,
) {
  return db
    .select()
    .from(prospectMarks)
    .where(
      and(
        eq(prospectMarks.citySlug, citySlug),
        isNull(prospectMarks.supersededBy),
      ),
    );
}

export async function getNotesForLot(
  db: Database,
  noLot: string,
  citySlug: string,
) {
  return db
    .select()
    .from(prospectNotes)
    .where(
      and(
        eq(prospectNotes.noLot, noLot),
        eq(prospectNotes.citySlug, citySlug),
      ),
    );
}

// ─── Écriture : marquage unitaire ─────────────────────────────────────────────

/**
 * Crée ou met à jour un marquage (append-only + supersedes en transaction LWW).
 *
 * Ordre transactionnel (évite la violation de prospect_marks_active_uq) :
 *   a. Générer l'UUID du nouveau marquage côté app.
 *   b. UPDATE l'ancien actif : superseded_by = newId
 *      → l'ancien passe de 1 actif à 0 actif pour ce (lot_version_id, dimension).
 *      → la FK superseded_by est DEFERRABLE INITIALLY DEFERRED (migration 0006) :
 *        elle tolère que newId n'existe pas encore au moment de l'UPDATE.
 *   c. INSERT le nouveau avec cet id et superseded_by = NULL
 *      → 0 actif devient 1 actif ; l'index partiel unique est satisfait.
 *   d. COMMIT → la FK différée valide (le nouveau existe désormais).
 *
 * À chaque instant dans la transaction l'index partiel voit 0 ou 1 actif.
 */
export async function upsertMark(
  db: Database,
  input: CreateMarkInput,
) {
  return db.transaction(async (tx) => {
    // a. Générer l'id du nouveau marquage côté application.
    const newId = randomUUID();

    // b. Chercher et superséder l'actif courant (si existant).
    const existingRows = await tx
      .select({ id: prospectMarks.id })
      .from(prospectMarks)
      .where(
        and(
          eq(prospectMarks.lotVersionId, input.lotVersionId),
          eq(prospectMarks.dimension, input.dimension),
          isNull(prospectMarks.supersededBy),
        ),
      )
      .limit(1);

    const previousId = existingRows[0]?.id ?? null;

    if (previousId) {
      // UPDATE d'abord : l'ancien passe de actif (superseded_by IS NULL) à inactif.
      // La FK superseded_by est DEFERRABLE INITIALLY DEFERRED : newId peut ne pas
      // encore exister à cet instant ; la contrainte FK est vérifiée au COMMIT.
      await tx
        .update(prospectMarks)
        .set({ supersededBy: newId })
        .where(eq(prospectMarks.id, previousId));
    }

    // c. INSERT le nouveau avec l'id pré-généré et superseded_by = NULL.
    //    À ce stade il y a exactement 1 actif → l'index partiel unique est satisfait.
    const [newMark] = await tx
      .insert(prospectMarks)
      .values({
        id: newId,
        lotVersionId: input.lotVersionId,
        noLot: input.noLot,
        citySlug: input.citySlug,
        dimension: input.dimension,
        statut: input.statut,
        mode: input.mode,
        authorId: input.authorId,
        supersedes: previousId,
        prixDemande:
          input.prixDemande != null ? String(input.prixDemande) : null,
        lienAnnonce: input.lienAnnonce ?? null,
      })
      .returning();

    if (!newMark) throw new Error("insert prospect_marks returned no row");

    // d. COMMIT → la FK différée valide que newId existe bien.
    return newMark;
  });
}

// ─── Écriture : note ──────────────────────────────────────────────────────────

export async function addNote(
  db: Database,
  input: CreateNoteInput,
) {
  const [note] = await db
    .insert(prospectNotes)
    .values({
      noLot: input.noLot,
      citySlug: input.citySlug,
      authorId: input.authorId,
      body: input.body,
      mode: input.mode,
    })
    .returning();

  if (!note) throw new Error("insert prospect_notes returned no row");
  return note;
}

// ─── Écriture : batch par zone ────────────────────────────────────────────────

/**
 * Marquage de masse — 1 acte idempotent (même état final quelle que soit la
 * répétition), 1 frame SSE émise par la route.
 */
export async function batchUpsertMarks(
  db: Database,
  input: BatchMarkInput,
) {
  const results: { noLot: string; citySlug: string; markId: string }[] = [];

  for (const lotVersionId of input.lotVersionIds) {
    const meta = input.lotMeta[lotVersionId];
    if (!meta) continue;

    const mark = await upsertMark(db, {
      lotVersionId,
      noLot: meta.noLot,
      citySlug: meta.citySlug,
      dimension: input.dimension,
      statut: input.statut,
      mode: input.mode,
      authorId: input.authorId,
    });

    results.push({ noLot: meta.noLot, citySlug: meta.citySlug, markId: mark.id });
  }

  return { created: results.length, lots: results };
}
