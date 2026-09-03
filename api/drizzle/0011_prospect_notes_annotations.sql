-- Migration 0011 — Annotations §2 : cutover ADDITIF de prospect_notes.
--
-- Contrat d'ancre i-arch#1 (docs/spec/SPEC_CONTRAT_ANCRE_ANNOTATIONS_v1.md,
-- amendé 9cae991) — Option A team-shared mono-client :
--   - target_type ∈ {lot, signal} (zone différée). DEFAULT 'lot' → 0 backfill :
--     les lignes 0005 existantes deviennent 'lot' via le DEFAULT (aucun UPDATE).
--   - signal_id → signals(id) ON DELETE SET NULL (JAMAIS CASCADE) : signals.id est
--     un UUID volatile (re-scrape ⇒ nouvel id, cascade-delete si le document
--     disparaît), donc l'ancre signal DÉGRADE en NULL au lieu de perdre la note
--     (§3.1 durabilité). `signal_id NOT NULL au create` est une règle APPLICATIVE
--     (zod/service), PAS un CHECK — pour que le SET NULL ne viole jamais rien.
--   - tenant_id TEXT DEFAULT 'default' : scoping forward-looking INERTE (mono-client ;
--     aucune isolation active, aucune table clients, aucune FK ; TEXT délibéré §3.3).
--   - updated_at TIMESTAMPTZ NULLABLE, 0 default : NULL = jamais éditée,
--     IS NOT NULL = éditée (vrai 0-backfill, les lignes existantes restent NULL).
--   - deleted_at TIMESTAMPTZ NULLABLE : soft-delete (NULL = active), jamais de DELETE
--     physique. La lecture filtre deleted_at IS NULL.
--
-- Additive, 0 backfill, 0 perte : ré-appliquable au-dessus du journal 0010.

--> statement-breakpoint
CREATE TYPE "prospect_note_target" AS ENUM ('lot', 'signal');

--> statement-breakpoint
ALTER TABLE "prospect_notes"
  ADD COLUMN "target_type" "prospect_note_target" NOT NULL DEFAULT 'lot',
  ADD COLUMN "signal_id"   uuid REFERENCES "signals"("id") ON DELETE SET NULL,
  ADD COLUMN "tenant_id"   text NOT NULL DEFAULT 'default',
  ADD COLUMN "updated_at"  timestamptz,
  ADD COLUMN "deleted_at"  timestamptz;

--> statement-breakpoint
-- no_lot/city_slug deviennent conditionnels selon target_type (cf. CHECK).
ALTER TABLE "prospect_notes" ALTER COLUMN "no_lot"    DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "prospect_notes" ALTER COLUMN "city_slug" DROP NOT NULL;

--> statement-breakpoint
-- Cohérence ancre ↔ target_type (branche signal INCONDITIONNELLE : le
-- ON DELETE SET NULL de signal_id ne doit jamais violer le CHECK — cf. §3.1) :
--   lot    → no_lot + city_slug NOT NULL
--   signal → aucune exigence DB (signal_id-au-create enforce en zod/service)
ALTER TABLE "prospect_notes" ADD CONSTRAINT "chk_prospect_notes_anchor" CHECK (
  ("target_type" = 'lot' AND "no_lot" IS NOT NULL AND "city_slug" IS NOT NULL)
  OR ("target_type" = 'signal')
);

--> statement-breakpoint
CREATE INDEX "prospect_notes_signal_idx" ON "prospect_notes" ("signal_id");
--> statement-breakpoint
CREATE INDEX "prospect_notes_tenant_idx" ON "prospect_notes" ("tenant_id");
--> statement-breakpoint
-- Filtrage des notes actives (lecture), scoping forward-looking inclus.
CREATE INDEX "prospect_notes_active_idx" ON "prospect_notes" ("tenant_id", "deleted_at")
  WHERE "deleted_at" IS NULL;
