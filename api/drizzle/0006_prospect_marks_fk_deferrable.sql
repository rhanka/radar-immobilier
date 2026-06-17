-- Migration 0006 : rend la FK prospect_marks.superseded_by DEFERRABLE INITIALLY DEFERRED.
--
-- CONTEXTE (bug LWW Inc 2) :
--   L'ordre INSERT-avant-UPDATE dans upsertMark() créait un instant où deux lignes
--   avaient superseded_by IS NULL pour le même (lot_version_id, dimension),
--   ce qui violait l'index partiel unique prospect_marks_active_uq.
--
--   Le fix service inverse l'ordre : UPDATE superseded_by=newId PUIS INSERT.
--   Mais la FK prospect_marks.superseded_by → prospect_marks.id est vérifiée
--   IMMÉDIATEMENT, or newId n'existe pas encore au moment de l'UPDATE.
--   La rendre DEFERRABLE INITIALLY DEFERRED permet de valider la FK au COMMIT,
--   après que l'INSERT a créé la ligne référencée.
--
-- Ce que cette migration fait :
--   DROP CONSTRAINT prospect_marks_superseded_by_fkey  (FK auto-générée par 0005)
--   ADD  CONSTRAINT prospect_marks_superseded_by_fkey … DEFERRABLE INITIALLY DEFERRED
--
-- L'index partiel prospect_marks_active_uq (0005) n'est PAS touché.

--> statement-breakpoint
ALTER TABLE prospect_marks
  DROP CONSTRAINT IF EXISTS prospect_marks_superseded_by_fkey;
--> statement-breakpoint
ALTER TABLE prospect_marks
  ADD CONSTRAINT prospect_marks_superseded_by_fkey
    FOREIGN KEY (superseded_by)
    REFERENCES prospect_marks(id)
    ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED;
