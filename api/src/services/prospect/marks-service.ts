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
import { and, desc, eq, isNull } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import {
  accountUsers,
  prospectMarks,
  prospectNotes,
} from "../../db/schema.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ProspectDimension = "pipeline" | "marche";
export type ProspectStatut = "favori" | "ecarte" | "sollicite" | "lettre_envoyee" | "en_vente";
export type ProspectMode = "real" | "simulation";
export type ProspectNoteTarget = "lot" | "signal";

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
  targetType?: ProspectNoteTarget; // défaut 'lot' (back-compat notes 0005)
  noLot?: string | null;
  citySlug?: string | null;
  signalId?: string | null;
  authorId: string;
  body: string;
  mode: ProspectMode;
  tenantId?: string; // scoping forward-looking inerte (défaut 'default')
}

/** Ancre de lecture des annotations actives (contrat §6.2). */
export type NoteAnchor =
  | { targetType: "lot"; noLot: string; citySlug: string }
  | { targetType: "signal"; signalId: string };

/** Résultat d'une mutation author-only (édition / suppression). */
export type NoteMutationResult =
  | { status: "ok"; note: typeof prospectNotes.$inferSelect }
  | { status: "not_found" }
  | { status: "forbidden" };

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
        isNull(prospectNotes.deletedAt),
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
      targetType: input.targetType ?? "lot",
      noLot: input.noLot ?? null,
      citySlug: input.citySlug ?? null,
      signalId: input.signalId ?? null,
      authorId: input.authorId,
      body: input.body,
      mode: input.mode,
      tenantId: input.tenantId ?? "default",
    })
    .returning();

  if (!note) throw new Error("insert prospect_notes returned no row");
  return note;
}

/**
 * Édition IN-PLACE (contrat §4) — author-only. Corrige/précise le corps ;
 * `created_at` reste immuable, `updated_at` avance. Résultat discriminé pour que
 * la route mappe 200 / 403 (autre auteur) / 404 (absente ou déjà supprimée).
 */
export async function editNote(
  db: Database,
  id: string,
  authorId: string,
  body: string,
): Promise<NoteMutationResult> {
  const [existing] = await db
    .select()
    .from(prospectNotes)
    .where(eq(prospectNotes.id, id))
    .limit(1);
  if (!existing || existing.deletedAt) return { status: "not_found" };
  if (existing.authorId !== authorId) return { status: "forbidden" };

  const [updated] = await db
    .update(prospectNotes)
    .set({ body, updatedAt: new Date() })
    .where(eq(prospectNotes.id, id))
    .returning();
  if (!updated) throw new Error("update prospect_notes returned no row");
  return { status: "ok", note: updated };
}

/**
 * Suppression SOFT (contrat §4) — author-only. Stampe `deleted_at` ; jamais de
 * DELETE physique. La note devient invisible en lecture (deleted_at IS NULL).
 */
export async function softDeleteNote(
  db: Database,
  id: string,
  authorId: string,
): Promise<NoteMutationResult> {
  const [existing] = await db
    .select()
    .from(prospectNotes)
    .where(eq(prospectNotes.id, id))
    .limit(1);
  if (!existing || existing.deletedAt) return { status: "not_found" };
  if (existing.authorId !== authorId) return { status: "forbidden" };

  const [updated] = await db
    .update(prospectNotes)
    .set({ deletedAt: new Date() })
    .where(eq(prospectNotes.id, id))
    .returning();
  if (!updated) throw new Error("soft-delete prospect_notes returned no row");
  return { status: "ok", note: updated };
}

/**
 * Lecture unifiée des annotations ACTIVES d'une ancre (lot ou signal), §6.2 —
 * attribuées (author id + nom/email via account_users), triées created_at desc.
 * Aucun filtre tenant en v1 (mono-client, §3.3).
 */
export async function listNotes(db: Database, anchor: NoteAnchor) {
  const anchorWhere =
    anchor.targetType === "lot"
      ? and(
          eq(prospectNotes.noLot, anchor.noLot),
          eq(prospectNotes.citySlug, anchor.citySlug),
        )
      : eq(prospectNotes.signalId, anchor.signalId);

  return db
    .select({
      id: prospectNotes.id,
      targetType: prospectNotes.targetType,
      noLot: prospectNotes.noLot,
      citySlug: prospectNotes.citySlug,
      signalId: prospectNotes.signalId,
      body: prospectNotes.body,
      mode: prospectNotes.mode,
      createdAt: prospectNotes.createdAt,
      updatedAt: prospectNotes.updatedAt,
      authorId: prospectNotes.authorId,
      authorName: accountUsers.name,
      authorEmail: accountUsers.email,
    })
    .from(prospectNotes)
    .innerJoin(accountUsers, eq(prospectNotes.authorId, accountUsers.id))
    .where(and(anchorWhere, isNull(prospectNotes.deletedAt)))
    .orderBy(desc(prospectNotes.createdAt));
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
