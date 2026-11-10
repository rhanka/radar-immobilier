// Physical model of immo, by REAL STORAGE (columns) with the OWNER of each schema or code
// as a badge (read on main: schema.ts, config.ts, rebuild-from-s3.ts, graph-store.ts,
// refresh-run.ts, canonical-graph-writer.ts, ogc-pull.ts, deploy/k8s/34-refresh-cronjob.yaml).
// Owner ≠ storage: engram (today @sentropic/graphify 0.18.0) is the detection and evaluation
// engine, executed inside immo jobs; sentropic owns the annotation schema whose tables are
// installed in immo's Postgres; track decisions live in the repository (.track/).

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
  job_refresh: `job_refresh {
      text job PK "radar-refresh-pv (CronJob)"
      text image "ghcr.io/rhanka/radar-api"
      text moteur "@sentropic/graphify 0.18.0"
      text ecrit "latest.json puis graph_nodes"
    }`,
  app_immo: `app_immo {
      text service PK "API radar-api + UI"
      text lit "Postgres d'immo, proxy geo"
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


// Relations of the current state: who writes and who reads.
const CURRENT_RELATIONS = `    s3_raw ||..o{ job_refresh : lit_pv
    job_refresh ||..o{ s3_graph : ecrit
    job_refresh ||..o{ graph_nodes : projette
    s3_raw ||..o| documents : projection
    graph_nodes ||..o{ graph_edges : aretes
    registre_villes ||..o{ graph_nodes : city_slug
    graph_nodes ||..o{ geo_resolutions : node_id
    geo_resolutions }o..o| zone_versions : zone
    geo_resolutions }o..o| lot_versions : lot
    geo_ogc ||..o{ zone_versions : pull_ogc
    geo_ogc ||..o{ lot_versions : pull_ogc_lots
    app_immo }o..o{ graph_nodes : lit
    prospect_notes }o--o| signals : signal_id
    prospect_notes }o--|| account_users : auteur`;

const NEW_ENTITIES = {
  s3_retours: `s3_retours {
      text cle PK "classeur de Steve, par sha256"
      text ecrit_par "port de @sentropic/annotations"
    }`,
  s3_reference_sets: `s3_reference_sets {
      text prefixe PK "préfixe privé, nom à fixer"
      text versions "éléments des versions figées"
      text runs "prédictions et résultats"
    }`,
  annotation_sources: `annotation_sources {
      uuid id PK
      text sha256 UK "fichier importé une fois"
    }`,
  annotation_revisions: `annotation_revisions {
      text content_hash PK "immuable"
      text prev_content_hash "révision précédente"
      text auteur "identité IdP (compte de Steve)"
      jsonb corps "schéma d'étiquettes du profil"
    }`,
  annotation_validations: `annotation_validations {
      uuid id PK
      text revision_hash FK "liée au hash"
      text decision "accepter, contester, rejeter…"
    }`,
  annotation_targets: `annotation_targets {
      uuid id PK
      text cible_type "signal, ville, PV, zone, lot"
      text cle "clé fournie par immo"
    }`,
  job_evaluation: `job_evaluation {
      text job PK "évaluation hors ligne"
      text moteur "engram (eval)"
      text lit "instantané haché des validées"
    }`,
  manifestes: `manifestes {
      text fichier PK "manifestes et empreintes publics"
      text label_provenance "E silver, C human_single"
    }`,
  decisions_track: `decisions_track {
      text fichier PK ".track/events.jsonl"
      text decisions "gel, promotion (attestées h2a)"
    }`,
};

const PROPOSED_RELATIONS = `${CURRENT_RELATIONS}
    s3_retours ||..|| annotation_sources : octets
    annotation_sources ||--o{ annotation_revisions : import
    app_immo ||..o{ annotation_revisions : saisie
    annotation_revisions ||--o{ annotation_validations : decide
    annotation_revisions ||--o{ annotation_targets : vise
    annotation_targets }o..o| graph_nodes : signal
    annotation_targets }o..o| documents : document
    annotation_targets }o..o| zone_versions : zone_cible
    annotation_targets }o..o| lot_versions : lot_cible
    annotation_validations }o..o{ job_evaluation : export_hache
    job_evaluation ||..o{ s3_reference_sets : ecrit_eval
    job_evaluation ||..o{ manifestes : publie
    job_evaluation }o..o| decisions_track : preuve
    decisions_track ||..o| profil_domaine : promotion
    profil_domaine ||..o{ job_refresh : profil_prompt`;

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

// Columns = real storage. Rows chosen so that related boxes sit side by side.
const LAYERS = ['Exécution (jobs et service)', 'Postgres d’immo : tables immo', 'Postgres d’immo : tables du paquet (sentropic)', 'S3 d’immo (bucket radar-immobilier-docs)', 'Service geo (PostGIS, S3 geo)', 'Dépôt git d’immo (code, profil, .track)'];
const CURRENT_PLACEMENT = {
  job_refresh: { col: 0, row: 1 }, app_immo: { col: 0, row: 3 },
  documents: { col: 1, row: 0 }, graph_nodes: { col: 1, row: 1 }, graph_edges: { col: 1, row: 2 }, geo_resolutions: { col: 1, row: 3 },
  zone_versions: { col: 1, row: 4 }, lot_versions: { col: 1, row: 5 }, account_users: { col: 1, row: 6 }, prospect_notes: { col: 1, row: 7 }, signals: { col: 1, row: 8 },
  s3_raw: { col: 3, row: 0 }, s3_graph: { col: 3, row: 1 }, s3_runs: { col: 3, row: 2 },
  geo_ogc: { col: 4, row: 4 },
  registre_villes: { col: 5, row: 1 },
};
// Owner of the schema or of the code, shown as a badge on each box.
const OWNER = {
  job_refresh: 'engram · job immo', app_immo: 'immo', documents: 'immo', graph_nodes: 'engram · immo', graph_edges: 'engram · immo', geo_resolutions: 'immo',
  zone_versions: 'immo (copie geo)', lot_versions: 'immo (copie geo)', account_users: 'immo', prospect_notes: 'immo', signals: 'immo',
  s3_raw: 'immo', s3_graph: 'engram · immo', s3_runs: 'immo', geo_ogc: 'geo', registre_villes: 'immo', profil_domaine: 'immo',
  s3_retours: 'sentropic', s3_reference_sets: 'engram', annotation_sources: 'sentropic', annotation_revisions: 'sentropic', annotation_validations: 'sentropic',
  annotation_targets: 'sentropic', job_evaluation: 'engram', manifestes: 'engram', decisions_track: 'track',
};
const LABELS = { projection: 'projection', aretes: 'arêtes', node_id: 'node_id', pull_ogc: 'copie (pull OGC)', pull_ogc_lots: 'copie (pull OGC)', signal_id: 'signal_id', auteur: 'auteur',
  lit_pv: 'lit les PV', ecrit: 'écrit latest.json', projette: 'projette', lit: 'lit', city_slug: 'city_slug', zone: 'zone', lot: 'lot',
  octets: 'octets (port)', import: 'import', saisie: 'saisie, validation', decide: 'valide / conteste', vise: '1 à N cibles', signal: 'signal : ville + id',
  document: 'PV : sha256', zone_cible: 'zone : canonical_id', lot_cible: 'lot : canonical_id', export_hache: 'export haché des validées', ecrit_eval: 'versions, runs',
  publie: 'manifestes', preuve: 'preuve', promotion: 'promotion', profil_prompt: 'profil, prompt promu' };

const CURRENT = { ...ENTITIES };
delete CURRENT.profil_domaine;

export const PHYSICAL = {
  'etat-actuel': {
    title: 'État actuel (main) : colonnes = stockage réel, badge = propriétaire du schéma ou du code',
    layers: LAYERS.filter((_, index) => index !== 2),
    placement: Object.fromEntries(Object.entries(CURRENT_PLACEMENT).map(([id, place]) => [id, { ...place, col: place.col > 2 ? place.col - 1 : place.col }])),
    existing: Object.keys(CURRENT),
    status: Object.fromEntries(Object.keys(CURRENT).map(id => [id, 'current'])),
    owner: OWNER,
    labels: LABELS, colGap: 200,
    er: er(CURRENT_RELATIONS, CURRENT),
  },
  'etat-propose': {
    title: 'Proposé : colonnes = stockage réel, badge = propriétaire ; nouveau (vert), modifié (orange), inchangé (gris), aucun supprimé',
    layers: LAYERS,
    placement: { ...CURRENT_PLACEMENT, job_evaluation: { col: 0, row: 6 },
      annotation_sources: { col: 2, row: 3 }, annotation_revisions: { col: 2, row: 4 }, annotation_validations: { col: 2, row: 5 }, annotation_targets: { col: 2, row: 6 },
      s3_retours: { col: 3, row: 3 }, s3_reference_sets: { col: 3, row: 6 },
      profil_domaine: { col: 5, row: 2 }, manifestes: { col: 5, row: 6 }, decisions_track: { col: 5, row: 7 } },
    existing: Object.keys(CURRENT),
    status: { ...Object.fromEntries(Object.keys(CURRENT).map(id => [id, 'unchanged'])), graph_nodes: 'modified', graph_edges: 'modified', prospect_notes: 'modified', account_users: 'modified', profil_domaine: 'modified',
      ...Object.fromEntries(Object.keys(NEW_ENTITIES).map(id => [id, 'new'])) },
    owner: OWNER,
    labels: LABELS, colGap: 200,
    er: er(PROPOSED_RELATIONS, { ...CURRENT, ...MODIFIED, ...NEW_ENTITIES }),
  },
};
