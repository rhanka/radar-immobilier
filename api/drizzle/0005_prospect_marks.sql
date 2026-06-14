-- Migration 0005: marquage d'équipe Steve — modèle de données Inc 1.
--
-- Tables créées :
--   prospect_marks              — marquages append-only par lot + dimension (pipeline | marche)
--   prospect_notes              — notes libres append-only par lot, multi-auteurs
--   prospect_contacts           — couche CRM/PII séparée : informations de contact propriétaire
--   prospect_contact_access_log — journal d'accès à la couche PII (Loi 25)
--
-- Finalité documentée (Loi 25, art. 12) :
--   prospect_contacts contient des données personnelles (nom propriétaire) collectées
--   dans le cadre d'activités de prospection immobilière pour rachat de terrains.
--   Finalité : prise de contact ciblée, suivi de négociation. Accès restreint aux
--   membres autorisés de l'équipe, journalisé dans prospect_contact_access_log.
--   Durée de conservation : à définir dans la politique de confidentialité de l'équipe.
--
-- Décisions de modélisation :
--   • Deux dimensions orthogonales (pipeline ⊥ marche) via colonne dimension + statut unifié.
--     Une CHECK garantit la cohérence dimension→statut. Ce choix est plus propre que deux
--     colonnes de statut séparées car l'unicité de chaîne se formule naturellement sur
--     (lot_version_id, dimension), et les deux dimensions peuvent coexister sur un même lot.
--   • append-only + supersedes : un marquage n'est jamais mis à jour — on insère une
--     nouvelle ligne avec supersedes = id du précédent. Le serveur stampe superseded_by sur
--     l'ancien en transaction (Inc 2). Contrainte d'unicité de chaîne active :
--     UNIQUE(lot_version_id, dimension) WHERE superseded_by IS NULL.
--   • mode real | simulation : les imports Steve seront en simulation (Inc 4).
--   • Auteur : FK vers account_users (équipe unique, pas de table teams/rôles pour l'instant).
--   • Ancrage : lot_version_id → lot_versions.id (bitemporel principal) ;
--     no_lot + city_slug sont dénormalisés pour requêtes sans jointure bitemporale.

--> statement-breakpoint
CREATE TYPE prospect_dimension AS ENUM ('pipeline', 'marche');
--> statement-breakpoint
CREATE TYPE prospect_statut AS ENUM ('favori', 'ecarte', 'sollicite', 'lettre_envoyee', 'en_vente');
--> statement-breakpoint
CREATE TYPE prospect_mode AS ENUM ('real', 'simulation');

--> statement-breakpoint
CREATE TABLE prospect_marks (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Ancrage bitemporel : lot_version_id est la FK bitemporale principale.
  -- no_lot + city_slug dénormalisés pour requêtes sans jointure bitemporale.
  lot_version_id    UUID        NOT NULL REFERENCES lot_versions(id) ON DELETE RESTRICT,
  no_lot            TEXT        NOT NULL,   -- Cadastre QC (dénormalisé)
  city_slug         TEXT        NOT NULL,   -- (dénormalisé)

  -- Deux dimensions orthogonales
  dimension         prospect_dimension NOT NULL,

  -- Statut unifié ; cohérence dimension↔statut garantie par CHECK ci-dessous.
  -- pipeline : favori | ecarte | sollicite | lettre_envoyee
  -- marche   : en_vente
  statut            prospect_statut NOT NULL,

  -- mode : real = saisie manuelle équipe, simulation = import Steve (Inc 4)
  mode              prospect_mode NOT NULL DEFAULT 'real',

  -- Auteur (équipe unique, FK account_users)
  author_id         UUID        NOT NULL REFERENCES account_users(id) ON DELETE RESTRICT,

  -- Chaîne append-only : supersedes pointe vers le marquage remplacé (même dimension)
  supersedes        UUID        REFERENCES prospect_marks(id) ON DELETE RESTRICT,
  -- superseded_by est stamped en transaction par le serveur (Inc 2)
  superseded_by     UUID        REFERENCES prospect_marks(id) ON DELETE RESTRICT,

  -- Données métier dimension marche (nullable pour dimension pipeline)
  prix_demande      NUMERIC(14,2),
  lien_annonce      TEXT,

  -- Horodatage immuable (jamais mis à jour)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Cohérence dimension ↔ statut :
  --   pipeline : favori | ecarte | sollicite | lettre_envoyee
  --   marche   : en_vente
  CONSTRAINT chk_prospect_marks_dimension_statut CHECK (
    (dimension = 'pipeline' AND statut IN ('favori', 'ecarte', 'sollicite', 'lettre_envoyee'))
    OR
    (dimension = 'marche' AND statut = 'en_vente')
  ),
  -- Données marché uniquement sur dimension marche
  CONSTRAINT chk_prospect_marks_marche_fields CHECK (
    dimension = 'marche' OR (prix_demande IS NULL AND lien_annonce IS NULL)
  )
);
--> statement-breakpoint

-- Unicité de chaîne active : au plus un marquage actif par (lot_version, dimension)
-- "actif" = non supersedé. Calculé server-side en transaction (Inc 2).
CREATE UNIQUE INDEX prospect_marks_active_uq
  ON prospect_marks (lot_version_id, dimension)
  WHERE superseded_by IS NULL;
--> statement-breakpoint

CREATE INDEX prospect_marks_lot_idx     ON prospect_marks (lot_version_id);
CREATE INDEX prospect_marks_nolot_idx   ON prospect_marks (no_lot);
CREATE INDEX prospect_marks_author_idx  ON prospect_marks (author_id);
CREATE INDEX prospect_marks_mode_idx    ON prospect_marks (mode);
CREATE INDEX prospect_marks_statut_idx  ON prospect_marks (statut);

--> statement-breakpoint
-- Notes append-only multi-auteurs par lot.
-- Jamais mises à jour : une nouvelle ligne par nouvelle note.
-- Ancrage sur no_lot + city_slug (les notes ne nécessitent pas de FK bitemporale stricte).
CREATE TABLE prospect_notes (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Ancrage lot (dénormalisé pour requêtes simples)
  no_lot        TEXT        NOT NULL,
  city_slug     TEXT        NOT NULL,

  -- Auteur
  author_id     UUID        NOT NULL REFERENCES account_users(id) ON DELETE RESTRICT,

  -- Contenu libre
  body          TEXT        NOT NULL CHECK (char_length(body) > 0),

  -- mode cohérent avec les marques
  mode          prospect_mode NOT NULL DEFAULT 'real',

  -- Horodatage immuable
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
--> statement-breakpoint

CREATE INDEX prospect_notes_lot_idx    ON prospect_notes (no_lot, city_slug);
CREATE INDEX prospect_notes_author_idx ON prospect_notes (author_id);

--> statement-breakpoint
-- ============================================================================
-- Couche CRM/PII séparée — données personnelles propriétaire (Loi 25).
--
-- FINALITÉ DOCUMENTÉE : prospection immobilière pour rachat de terrains.
-- Les informations de contact propriétaire (nom, téléphone, courriel, adresse)
-- sont collectées uniquement à des fins de prise de contact directe dans le cadre
-- du dossier de prospection. Accès journalisé dans prospect_contact_access_log.
--
-- INVARIANT ONTOLOGIQUE : le nom du propriétaire NE DOIT PAS apparaître dans le
-- graphe public (graph_nodes / graph_edges) ni dans prospect_marks. Il vit
-- UNIQUEMENT dans cette table. L'invariant "owner = non-disponible" côté ontologie
-- est maintenu.
--
-- Append-only : une nouvelle ligne à chaque mise à jour des infos de contact.
-- supersedes/superseded_by assurent la traçabilité de la chaîne de versions.
-- ============================================================================
CREATE TABLE prospect_contacts (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Ancrage lot (dénormalisé ; pas de FK bitemporale — le contact peut survivre
  -- à la rotation de lot_versions)
  no_lot        TEXT        NOT NULL,
  city_slug     TEXT        NOT NULL,

  -- Données personnelles propriétaire (PII Loi 25) — tous champs nullable :
  -- on ne collecte que ce qu'on a effectivement obtenu.
  proprietaire_nom      TEXT,   -- nom complet ou raison sociale
  proprietaire_tel      TEXT,   -- téléphone de contact
  proprietaire_courriel TEXT,   -- courriel de contact
  proprietaire_adresse  TEXT,   -- adresse postale si connue

  -- Source de l'information (ex. 'role-foncier', 'contact-direct', 'reference')
  source_info   TEXT,

  -- Auteur de la saisie
  author_id     UUID        NOT NULL REFERENCES account_users(id) ON DELETE RESTRICT,

  -- Append-only : supersedes pointe vers la ligne précédente pour ce lot
  supersedes        UUID    REFERENCES prospect_contacts(id) ON DELETE RESTRICT,
  superseded_by     UUID    REFERENCES prospect_contacts(id) ON DELETE RESTRICT,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
--> statement-breakpoint

-- Unicité de chaîne active pour les contacts
CREATE UNIQUE INDEX prospect_contacts_active_uq
  ON prospect_contacts (no_lot, city_slug)
  WHERE superseded_by IS NULL;
--> statement-breakpoint

CREATE INDEX prospect_contacts_lot_idx    ON prospect_contacts (no_lot, city_slug);
CREATE INDEX prospect_contacts_author_idx ON prospect_contacts (author_id);

--> statement-breakpoint
-- ============================================================================
-- Journal d'accès à la couche PII (Loi 25 — principe de traçabilité).
--
-- Chaque consultation des données PII (prospect_contacts) est enregistrée ici.
-- Le logging applicatif (Inc 2) écrira dans cette table via middleware ;
-- la structure est prête dès Inc 1.
-- ============================================================================
CREATE TABLE prospect_contact_access_log (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Quelle fiche PII a été consultée
  contact_id    UUID        NOT NULL REFERENCES prospect_contacts(id) ON DELETE RESTRICT,

  -- Qui a accédé
  accessor_id   UUID        NOT NULL REFERENCES account_users(id) ON DELETE RESTRICT,

  -- Nature de l'accès (ex. 'view', 'export', 'api')
  action        TEXT        NOT NULL DEFAULT 'view',

  -- Horodatage précis
  accessed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Contexte applicatif optionnel (IP, user-agent, session, endpoint)
  context       JSONB       NOT NULL DEFAULT '{}'
);
--> statement-breakpoint

CREATE INDEX prospect_contact_access_log_contact_idx  ON prospect_contact_access_log (contact_id);
CREATE INDEX prospect_contact_access_log_accessor_idx ON prospect_contact_access_log (accessor_id);
CREATE INDEX prospect_contact_access_log_at_idx       ON prospect_contact_access_log (accessed_at);
