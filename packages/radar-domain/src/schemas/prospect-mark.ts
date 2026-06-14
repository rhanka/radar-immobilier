import { z } from "zod";

/**
 * Marquage d'équipe Steve — schémas Zod (Inc 1, SPEC_EVOL_INTEGRATION_CARTE_STEVE §4.1).
 *
 * Modélisation dimension/statut :
 *   Deux dimensions orthogonales (pipeline ⊥ marche) + statut unifié.
 *   Un lot peut avoir un marquage actif dans chacune des deux dimensions
 *   simultanément (ex. "favori" en pipeline ET "en_vente" en marche).
 *   La cohérence dimension↔statut est garantie par une CHECK SQL + le type
 *   discriminé ProspectMarkInput ci-dessous.
 */

// ─── Enums ────────────────────────────────────────────────────────────────────

/** Deux dimensions orthogonales. */
export const ProspectDimension = z.enum(["pipeline", "marche"]);
export type ProspectDimensionT = z.infer<typeof ProspectDimension>;

/**
 * Statuts de la dimension pipeline.
 * Ordre du funnel : favori → sollicite → lettre_envoyee ; ecarte = sortie.
 */
export const ProspectStatutPipeline = z.enum([
  "favori",
  "ecarte",
  "sollicite",
  "lettre_envoyee",
]);
export type ProspectStatutPipelineT = z.infer<typeof ProspectStatutPipeline>;

/** Statut de la dimension marche (valeur unique). */
export const ProspectStatutMarche = z.enum(["en_vente"]);
export type ProspectStatutMarcheT = z.infer<typeof ProspectStatutMarche>;

/** Union de tous les statuts possibles (pour désérialisation générique). */
export const ProspectStatut = z.union([ProspectStatutPipeline, ProspectStatutMarche]);
export type ProspectStatutT = z.infer<typeof ProspectStatut>;

/** Mode d'origine du marquage. */
export const ProspectMode = z.enum(["real", "simulation"]);
export type ProspectModeT = z.infer<typeof ProspectMode>;

// ─── Marquage persisté (lu depuis la base) ───────────────────────────────────

/** Marquage complet tel que stocké en base (append-only). */
export const ProspectMark = z.object({
  id: z.string().uuid(),

  lotVersionId: z.string().uuid(),
  noLot: z.string().min(1),
  citySlug: z.string().min(1),

  dimension: ProspectDimension,
  statut: ProspectStatut,
  mode: ProspectMode,

  authorId: z.string().uuid(),

  supersedes: z.string().uuid().nullable().optional(),
  supersededBy: z.string().uuid().nullable().optional(),

  // Champs marché (null pour dimension pipeline)
  prixDemande: z.string().nullable().optional(),  // NUMERIC sérialisé en string par pg
  lienAnnonce: z.string().url().nullable().optional(),

  createdAt: z.string().min(4),
});
export type ProspectMarkT = z.infer<typeof ProspectMark>;

// ─── Input discriminé (saisie utilisateur) ────────────────────────────────────

/**
 * Input pour créer un marquage dimension pipeline.
 * Les champs marché (prix_demande, lien_annonce) sont interdits.
 */
export const ProspectMarkPipelineInput = z.object({
  lotVersionId: z.string().uuid(),
  noLot: z.string().min(1),
  citySlug: z.string().min(1),
  dimension: z.literal("pipeline"),
  statut: ProspectStatutPipeline,
  mode: ProspectMode.default("real"),
  authorId: z.string().uuid(),
  supersedes: z.string().uuid().optional(),
});
export type ProspectMarkPipelineInputT = z.infer<typeof ProspectMarkPipelineInput>;

/**
 * Input pour créer un marquage dimension marche.
 * Statut fixé à "en_vente". Prix et lien optionnels mais typés.
 */
export const ProspectMarkMarcheInput = z.object({
  lotVersionId: z.string().uuid(),
  noLot: z.string().min(1),
  citySlug: z.string().min(1),
  dimension: z.literal("marche"),
  statut: z.literal("en_vente"),
  mode: ProspectMode.default("real"),
  authorId: z.string().uuid(),
  supersedes: z.string().uuid().optional(),
  prixDemande: z.number().positive().optional(),
  lienAnnonce: z.string().url().optional(),
});
export type ProspectMarkMarcheInputT = z.infer<typeof ProspectMarkMarcheInput>;

/** Union discriminée des deux inputs. */
export const ProspectMarkInput = z.discriminatedUnion("dimension", [
  ProspectMarkPipelineInput,
  ProspectMarkMarcheInput,
]);
export type ProspectMarkInputT = z.infer<typeof ProspectMarkInput>;

// ─── Notes ────────────────────────────────────────────────────────────────────

/** Note persistée (append-only, immuable une fois insérée). */
export const ProspectNote = z.object({
  id: z.string().uuid(),
  noLot: z.string().min(1),
  citySlug: z.string().min(1),
  authorId: z.string().uuid(),
  body: z.string().min(1).max(10_000),
  mode: ProspectMode,
  createdAt: z.string().min(4),
});
export type ProspectNoteT = z.infer<typeof ProspectNote>;

/** Input pour créer une note. */
export const ProspectNoteInput = z.object({
  noLot: z.string().min(1),
  citySlug: z.string().min(1),
  authorId: z.string().uuid(),
  body: z.string().min(1).max(10_000),
  mode: ProspectMode.default("real"),
});
export type ProspectNoteInputT = z.infer<typeof ProspectNoteInput>;

// ─── Contacts PII (couche CRM séparée, Loi 25) ────────────────────────────────

/**
 * Contact propriétaire persisté (PII Loi 25).
 * Append-only : chaque mise à jour insère une nouvelle ligne.
 *
 * AVERTISSEMENT : ces données sont soumises à la Loi 25 (QC).
 * Ne jamais les inclure dans des réponses API publiques sans contrôle d'accès.
 * Tout accès doit être journalisé dans prospect_contact_access_log.
 */
export const ProspectContact = z.object({
  id: z.string().uuid(),
  noLot: z.string().min(1),
  citySlug: z.string().min(1),

  // PII — collecte minimale
  proprietaireNom: z.string().max(500).nullable().optional(),
  proprietaireTel: z.string().max(50).nullable().optional(),
  proprietaireCourriel: z.string().email().nullable().optional(),
  proprietaireAdresse: z.string().max(1000).nullable().optional(),

  sourceInfo: z.string().max(200).nullable().optional(),

  authorId: z.string().uuid(),
  supersedes: z.string().uuid().nullable().optional(),
  supersededBy: z.string().uuid().nullable().optional(),
  createdAt: z.string().min(4),
});
export type ProspectContactT = z.infer<typeof ProspectContact>;

/** Input de création / mise à jour d'un contact (insère toujours une nouvelle ligne). */
export const ProspectContactInput = z.object({
  noLot: z.string().min(1),
  citySlug: z.string().min(1),
  proprietaireNom: z.string().max(500).optional(),
  proprietaireTel: z.string().max(50).optional(),
  proprietaireCourriel: z.string().email().optional(),
  proprietaireAdresse: z.string().max(1000).optional(),
  sourceInfo: z.string().max(200).optional(),
  authorId: z.string().uuid(),
  supersedes: z.string().uuid().optional(),
});
export type ProspectContactInputT = z.infer<typeof ProspectContactInput>;

// ─── Journal d'accès PII ─────────────────────────────────────────────────────

/** Entrée de journal d'accès à la couche PII. */
export const ProspectContactAccessLogEntry = z.object({
  id: z.string().uuid(),
  contactId: z.string().uuid(),
  accessorId: z.string().uuid(),
  action: z.string().min(1).max(50).default("view"),
  accessedAt: z.string().min(4),
  context: z.record(z.unknown()).default({}),
});
export type ProspectContactAccessLogEntryT = z.infer<typeof ProspectContactAccessLogEntry>;
