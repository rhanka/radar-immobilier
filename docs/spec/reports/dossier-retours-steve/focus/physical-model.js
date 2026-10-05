// Physical model of immo (Postgres + S3) and of the geo service, read on main (schema.ts,
// rebuild-from-s3.ts, ogc-pull.ts, geo-collections.ts, graph-store.ts): the current state
// and the proposed state of §6.0. Boxes are tables (immo PG), key prefixes (immo S3) or
// the geo OGC API; a status per box says what the proposal does with it.

const ENTITIES = {
  s3_raw: `s3_raw {
      text cle PK "raw/proces-verbaux-<ville>/cas/<sha>.pdf"
      text index "raw/pv-index/cas/<sha>.<ext>"
      json sidecar "*.meta.json : url, dates, ville"
    }`,
  s3_graph: `s3_graph {
      text cle PK "graph/<ville>/latest.json"
      text historique "graph/<ville>/history/…"
    }`,
  s3_runs: `s3_runs {
      text runs PK "runs/<source>/<runId>/manifest.jsonl"
      text refresh "refresh/018/<ville>/runs/…"
      text etat "state/<ville>/<source>.json"
    }`,
  registre_villes: `registre_villes {
      text city_slug PK "1 106 municipalités, JSON du code"
      text mrc "homonymes suffixés par la MRC"
    }`,
  documents: `documents {
      uuid id PK
      text s3_key "clé raw/…/cas/<sha>"
      text sha256 "empreinte du PV"
      jsonb extracted
    }`,
  graph_nodes: `graph_nodes {
      text id PK "signal-…, event-…, muni-…"
      text type "Signal, DesignationEvent…"
      text city_slug
      text source_ref "clé S3 du document"
    }`,
  graph_edges: `graph_edges {
      uuid id PK
      text src_id "→ graph_nodes.id, sans FK"
      text dst_id "→ graph_nodes.id, sans FK"
    }`,
  signals: `signals {
      uuid id PK "aucune écriture sur main"
    }`,
  zone_versions: `zone_versions {
      uuid id PK
      text canonical_id "ogc:zones:<ville>:<code>"
      text city_slug
    }`,
  lot_versions: `lot_versions {
      uuid id PK
      text canonical_id "ogc:lots:<ville>:<no_lot>"
      text no_lot
    }`,
  geo_resolutions: `geo_resolutions {
      uuid id PK
      text node_id "Signal ou DesignationEvent"
      text target_id "canonical_id zone ou lot"
    }`,
  account_users: `account_users {
      uuid id PK "comptes de l'équipe"
    }`,
  prospect_notes: `prospect_notes {
      uuid id PK
      uuid signal_id FK "UUID, cassé (B0)"
    }`,
  geo_ogc: `geo_ogc {
      text zonage PK "qc-zonage-<ville>"
      text lots "qc-lots-<ville>"
      text evenements "qc-zoning-events-<ville>"
    }`,
};

const CURRENT_RELATIONS = `    s3_raw ||..o| documents : projection
    s3_graph ||..o{ graph_nodes : projection
    graph_nodes ||..o{ graph_edges : aretes
    registre_villes ||..o{ graph_nodes : city_slug
    graph_nodes ||..o{ geo_resolutions : node_id
    geo_resolutions }o..o| zone_versions : zone
    geo_resolutions }o..o| lot_versions : lot
    geo_ogc ||..o{ zone_versions : pull_ogc
    geo_ogc ||..o{ lot_versions : pull_ogc_lots
    prospect_notes }o--o| signals : signal_id
    prospect_notes }o--|| account_users : auteur`;

// Proposed objects, each with its owner (synthèse sentropic + engram, §2, §6.1): sentropic
// (@sentropic/annotations, tables in the host database through its ./pg adapter, bytes in
// the host object store through a port), engram (frozen reference sets, runs), track
// (freeze and promotion decisions), immo (domain profile + its data).
const NEW_ENTITIES = {
  s3_retours: `s3_retours {
      text cle PK "classeur de Steve, par sha256"
      text ecrit_par "port de @sentropic/annotations"
    }`,
  annotation_sources: `annotation_sources {
      uuid id PK "sentropic"
      text sha256 UK "fichier importé une fois"
    }`,
  annotation_revisions: `annotation_revisions {
      text content_hash PK "sentropic, immuable"
      text prev_content_hash "version précédente"
      text auteur "identité IdP sentropic"
      jsonb corps "schéma d'étiquettes du profil immo"
    }`,
  annotation_validations: `annotation_validations {
      uuid id PK "sentropic"
      text revision_hash FK "liée au hash"
      text decision "accepter, contester, rejeter…"
    }`,
  annotation_targets: `annotation_targets {
      uuid id PK "sentropic"
      text cible_type "signal, ville, PV, zone, lot"
      text cle "clé du domaine immo"
    }`,
  reference_set_versions: `reference_set_versions {
      text id PK "engram : ReferenceSet@version"
      text label_provenance "E silver, C human_single"
      text partitions "dev / test scellé"
      text manifest_sha256
    }`,
  eval_runs: `eval_runs {
      text run_id PK "engram, hors ligne"
      text candidat "profil + prompt + modèle"
      text resultat "métriques, garde de promotion"
    }`,
  decisions_track: `decisions_track {
      text id PK "track : gel, promotion"
      text attestation "signée par h2a"
    }`,
};

const PROPOSED_RELATIONS = `${CURRENT_RELATIONS}
    s3_retours ||..|| annotation_sources : octets
    annotation_sources ||--o{ annotation_revisions : import
    annotation_revisions ||--o{ annotation_validations : decide
    annotation_revisions ||--o{ annotation_targets : vise
    annotation_targets }o..o| graph_nodes : signal
    annotation_targets }o..o| registre_villes : ville
    annotation_targets }o..o| documents : document
    annotation_targets }o..o| zone_versions : zone_cible
    annotation_targets }o..o| lot_versions : lot_cible
    annotation_validations }o..o{ reference_set_versions : export_hache
    profil_domaine ||..o{ reference_set_versions : schema
    reference_set_versions ||--o{ eval_runs : mesure
    eval_runs }o..o| decisions_track : preuve
    decisions_track ||..o| profil_domaine : promotion`;

// What the proposal changes inside the modified boxes.
const MODIFIED = {
  graph_nodes: `graph_nodes {
      text city_slug PK "clé (city_slug, id), #812"
      text id PK "signal-…, event-…, muni-…"
      text type "Signal, DesignationEvent…"
      text source_ref "clé S3 du document"
    }`,
  graph_edges: `graph_edges {
      uuid id PK
      text src_id "+ ville du nœud (#812)"
      text dst_id "+ ville du nœud (#812)"
    }`,
  prospect_notes: `prospect_notes {
      uuid id PK
      text signal_cle "ville + id texte (B0)"
    }`,
  account_users: `account_users {
      uuid id PK "+ compte de Steve (D5)"
      text sub "sujet IdP sentropic"
    }`,
  profil_domaine: `profil_domaine {
      text fichier PK "radar/ontology/ontology-profile.yaml"
      text etiquettes "+ verdicts, motifs, critères, sens"
      text promotion "+ règle D13"
    }`,
};

const er = (relations, entities) => `erDiagram\n${relations}\n${Object.values(entities).map(text => `    ${text}`).join('\n')}`;

const CURRENT_PLACEMENT = {
  s3_raw: { col: 0, row: 0 }, s3_graph: { col: 0, row: 1 }, s3_runs: { col: 0, row: 2 },
  documents: { col: 1, row: 0 }, graph_nodes: { col: 1, row: 1 }, graph_edges: { col: 1, row: 2 }, registre_villes: { col: 1, row: 3 },
  geo_resolutions: { col: 2, row: 1 }, prospect_notes: { col: 2, row: 2 }, signals: { col: 2, row: 3 }, account_users: { col: 2, row: 4 },
  zone_versions: { col: 3, row: 0 }, lot_versions: { col: 3, row: 1 }, geo_ogc: { col: 3, row: 3 },
};
const LABELS = { projection: 'projection', aretes: 'arêtes', node_id: 'node_id', pull_ogc: 'copie (pull OGC)', pull_ogc_lots: 'copie (pull OGC)', signal_id: 'signal_id', auteur: 'auteur',
  octets: 'octets (port)', import: 'import', decide: 'valide / conteste', vise: '1 à N cibles', export_hache: 'export haché des validées', schema: 'schéma d’étiquettes', mesure: 'runs', preuve: 'preuve', promotion: 'promotion (prompt)', signal: 'signal : ville + id', ville: 'ville : city_slug',
  document: 'PV : sha256', zone_cible: 'zone : canonical_id', lot_cible: 'lot : canonical_id', fige: 'gèle', zone: 'zone', lot: 'lot', city_slug: 'city_slug' };

export const PHYSICAL = {
  'etat-actuel': {
    title: 'État actuel (main) : immo S3, immo Postgres, service geo',
    layers: ['immo · S3 (source de vérité)', 'immo · Postgres : documents, graphe', 'immo · Postgres : géo, comptes, notes', 'géo copiée et service geo'],
    placement: CURRENT_PLACEMENT,
    existing: Object.keys(ENTITIES),
    status: Object.fromEntries(Object.keys(ENTITIES).map(id => [id, 'current'])),
    labels: LABELS, colGap: 200,
    er: er(CURRENT_RELATIONS, ENTITIES),
  },
  'etat-propose': {
    title: 'Proposé, par propriétaire : nouveau (vert), modifié (orange), inchangé (gris), aucun supprimé',
    layers: ['immo · S3', 'immo · Postgres : documents, graphe, profil', 'immo · Postgres : géo, comptes, notes', 'géo copiée et service geo', 'sentropic · @sentropic/annotations (dans le PG d’immo)', 'engram et track · hors ligne'],
    placement: { ...CURRENT_PLACEMENT, s3_retours: { col: 0, row: 3 }, profil_domaine: { col: 1, row: 4 },
      annotation_sources: { col: 4, row: 0 }, annotation_revisions: { col: 4, row: 1 }, annotation_validations: { col: 4, row: 2 }, annotation_targets: { col: 4, row: 3 },
      reference_set_versions: { col: 5, row: 1 }, eval_runs: { col: 5, row: 2 }, decisions_track: { col: 5, row: 3 } },
    existing: Object.keys(ENTITIES),
    status: { ...Object.fromEntries(Object.keys(ENTITIES).map(id => [id, 'unchanged'])), graph_nodes: 'modified', graph_edges: 'modified', prospect_notes: 'modified', account_users: 'modified', profil_domaine: 'modified',
      ...Object.fromEntries(Object.keys(NEW_ENTITIES).map(id => [id, 'new'])) },
    labels: LABELS, colGap: 200,
    er: er(PROPOSED_RELATIONS, { ...ENTITIES, ...MODIFIED, ...NEW_ENTITIES }),
  },
};
