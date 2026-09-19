// Contenu des cartes du dossier de décision v2 « Sauvegardes et PRA d'ensemble
// immo + geo » (PR #712 et rhanka/geo#390, carte #698).
// Le gabarit, la géométrie et le routage viennent de la chaîne existante
// (`docs/architecture/focus`), qui importe elle-même le kit h2a monté en /kit.
// Ici : uniquement le contenu des trois scènes et le contrôle de contrat.
import { roleIsShort } from '../../../../architecture/focus/scene-metadata.js';

const EVIDENCE = new Set(['observed', 'declared', 'historical', 'dormant', 'unknown', 'external']);
const RUNTIME = new Set(['active', 'suspended', 'dormant', 'manual', 'retained', 'unknown', 'not-applicable']);

// Légende des états, rendue par la page (Scenes.svelte) :
//   active          existant, en service
//   dormant         livré dans la branche, non actif
//   suspended       provisionné mais gelé (en attente de D2)
//   not-applicable  n'existe pas encore, ou étape pas encore faite
//   manual          hors cluster, entre les mains du propriétaire
export const STATES = {
  active: 'existant, en service',
  dormant: 'livré dans la PR, non actif',
  suspended: 'provisionné mais gelé (D2)',
  'not-applicable': "n'existe pas encore, pas encore fait",
  manual: 'hors cluster, chez le propriétaire',
};

const IMMO = ['radar-immobilier'];
const GEO = ['geo'];
const A = (repo, kind, evidenceClass, runtimeState, icon, spec) => ({
  card: 'A', kind, repo: [...repo].sort(), evidenceClass, runtimeState, icon,
  code: spec.code ?? '', role: spec.role ?? '', name: spec.name ?? '', detail: spec.detail ?? '',
});
const BOX = (repo, evidenceClass, runtimeState, spec) => ({
  card: 'box', kind: 'cluster', repo: [...repo].sort(), evidenceClass, runtimeState, icon: 'cluster',
  code: spec.code ?? '', role: '', name: spec.name ?? '', detail: '',
});
const e = (evidenceClass, runtimeState) => ({ evidenceClass, runtimeState });
const LIVRE = ['declared', 'dormant'], GELE = ['declared', 'suspended'], ABSENT = ['declared', 'not-applicable'];
const EN_SERVICE = ['observed', 'active'];
const card = (repo, kind, state, icon, spec) => A(repo, kind, state[0], state[1], icon, spec);

const scenes = {
  // Scène 1 — architecture des sauvegardes, immo et geo ensemble. Sources :
  // sections 2, 3 et 5 du dossier, plan immo, plan geo, agrément k8s.
  'architecture-sauvegardes': {
    nodes: {
      IMMO_PP: BOX(IMMO, 'observed', 'active', { code: 'NS-PP', name: 'Immo · préproduction' }),
      PG_PP: card(IMMO, 'database', EN_SERVICE, 'postgres',
        { code: 'PG-PP', role: 'Base · préprod', name: 'PostGIS 16 · radar-postgres', detail: '950 MiB · PVC 5 Gi' }),
      CJ_PP: card(IMMO, 'cronjob', LIVRE, 'cronjob',
        { code: 'CJ-PP', role: 'CronJob · préprod', name: 'radar-db-backup · LIVRÉ', detail: '02:15 et 14:15 UTC · non actif' }),
      EPH_PP: card(IMMO, 'job', LIVRE, 'check',
        { code: 'EPH', role: 'Restauration · test', name: 'PostgreSQL jetable, socket', detail: 'sans PVC source · jamais lancée' }),

      IMMO_PR: BOX(IMMO, 'observed', 'active', { code: 'NS-PR', name: 'Immo · production' }),
      PG_PR: card(IMMO, 'database', EN_SERVICE, 'postgres',
        { code: 'PG-PR', role: 'Base · prod', name: 'PostGIS 16 · 1 002 MiB', detail: 'PVC 5 Gi · en service' }),
      CJ_PR: card(IMMO, 'cronjob', LIVRE, 'cronjob',
        { code: 'CJ-PR', role: 'CronJob · prod', name: 'radar-db-backup · LIVRÉ', detail: 'activé à la fusion · non actif' }),
      QUOTA: card(IMMO, 'quota', ['declared', 'active'], 'identity',
        { code: 'QUOTA', role: 'Quota · prod', name: '~768 Mi de marge', detail: '640 Mi au pic · à mesurer (R2)' }),

      S3_IMMO: BOX(IMMO, 'declared', 'suspended', { code: 'S3', name: 'S3 OVH bhs · immo' }),
      B_PP: card(IMMO, 'store', GELE, 's3',
        { code: 'B-PP', role: 'Bucket · préprod', name: 'radar-immobilier-backups-preprod', detail: 'recréé avec verrou · GELÉ' }),
      B_PR: card(IMMO, 'store', ABSENT, 's3',
        { code: 'B-PR', role: 'Bucket · prod', name: 'radar-immobilier-backups', detail: 'verrou à la création · GO prod' }),
      PFX: card(IMMO, 'prefix', LIVRE, 'graph',
        { code: 'PFX', role: 'Préfixes · jeux', name: 'sets/ · verified/ · exercises/', detail: "reçus signés par l'écrivain (B1)" }),
      LOCK: card(IMMO, 'lock', GELE, 'identity',
        { code: 'LOCK', role: "Verrou · d'objet", name: 'mode et durée : décision D2', detail: 'aucune rétention par défaut (B2)' }),
      LC: card(IMMO, 'retention', LIVRE, 'unknown',
        { code: 'LC', role: 'Cycle · de vie', name: 'versions non courantes 35 j', detail: 'ne couvre pas sets/ (G4)' }),

      IDS: BOX(IMMO, 'declared', 'suspended', { code: 'IDS', name: 'Identités S3' }),
      ID_W: card(IMMO, 'identity', GELE, 'identity',
        { code: 'ID-W', role: 'Identité · écrivain', name: 'dépôt seul', detail: 'ni lecture ni suppression (B1–B3)' }),
      ID_R: card(IMMO, 'identity', GELE, 'identity',
        { code: 'ID-R', role: 'Identité · lecteur', name: 'lecture seule', detail: 'ni écriture ni suppression' }),
      ID_P: card(IMMO, 'identity', GELE, 'identity',
        { code: 'ID-P', role: 'Identité · purgeur', name: 'seul à supprimer', detail: 'objet courant, pas les versions' }),
      ID_ADM: card(IMMO, 'identity', ['declared', 'manual'], 'workstation',
        { code: 'ID-ADM', role: 'Clés · propriétaire', name: 'admin S3 + jeton API OVH', detail: 'hors cluster · à réduire (R1)' }),

      SURV: BOX(IMMO, 'declared', 'dormant', { code: 'SURV', name: 'Surveillance' }),
      FRESH: card(IMMO, 'cronjob', LIVRE, 'cronjob',
        { code: 'FRESH', role: 'Fraîcheur · horaire', name: 'reçus vérifiés, seuil 24 h', detail: "alerte dès l'activation (G2)" }),
      ACL: card(IMMO, 'check', LIVRE, 'check',
        { code: 'EXPO', role: 'Exposition · bucket', name: 'ACL privée vérifiée à :45', detail: 'objets non couverts (D5)' }),
      ALERT: card(IMMO, 'alert', LIVRE, 'user',
        { code: 'ALERT', role: 'Alerte · astreinte', name: 'règle Prometheus immo', detail: 'livraison non prouvée (R3)' }),

      GEO: BOX(GEO, 'declared', 'not-applicable', { code: 'GEO', name: 'Geo · geo#390' }),
      GEO_SRC: card(GEO, 'store', EN_SERVICE, 's3',
        { code: 'GEO-SRC', role: 'Bucket · geo', name: 'sentropic-geo · 48,9 GB', detail: 'versionnement non confirmé (D3)' }),
      GEO_IRR: card(GEO, 'prefix', EN_SERVICE, 'graph',
        { code: 'IRR', role: 'Préfixes · geo', name: 'grilles 44 obj. · raw/ vide', detail: 'adressés par contenu · sans gel' }),
      GEO_COPY: card(GEO, 'job', ABSENT, 'cronjob',
        { code: 'COPY', role: 'Job · copie', name: 'S3 vers S3, idempotente', detail: "n'existe pas · à armer" }),
      GEO_DST: card(GEO, 'store', ABSENT, 's3',
        { code: 'GEO-PRA', role: 'Bucket · reprise', name: 'sentropic-geo-pra · bhs', detail: 'verrou et région : D2, D4' }),
    },
    edges: {
      'PG_PP|CJ_PP|même transaction': e(...LIVRE),
      'CJ_PP|B_PP|dépôt · écrivain': e(...LIVRE),
      'B_PP|EPH_PP|lecture · lecteur': e(...LIVRE),
      'PG_PR|CJ_PR|même transaction': e(...LIVRE),
      'CJ_PR|B_PR|dépôt · non activé': e(...ABSENT),
      'B_PP|FRESH|reçus vérifiés': e(...LIVRE),
      'FRESH|ALERT|échec = alerte': e(...LIVRE),
      "LOCK|LC|prime sur l'expiration": e(...GELE),
      'GEO_SRC|GEO_COPY|lecture seule': e(...ABSENT),
      'GEO_COPY|GEO_DST|écriture sans suppression': e(...ABSENT),
    },
  },

  // Scène 2 — la séquence de bout en bout (section 7). Seule l'étape S-3 est livrée.
  'sequence-bout-en-bout': {
    nodes: {
      SAVE: BOX(IMMO, 'declared', 'not-applicable', { code: 'SAVE', name: 'Sauvegarde · un cycle' }),
      C1: card(IMMO, 'step', ABSENT, 'api', { code: 'S-1', role: 'Coordinateur · immo', name: 'Identifiant commun + T0', detail: 'preuve : T0 dans chaque manifeste' }),
      C2: card(IMMO, 'step', ABSENT, 'network', { code: 'S-2', role: 'Coordinateur · immo', name: 'Gel immo seul, drainage', detail: 'preuve : accusés des écrivains' }),
      C3: card(IMMO, 'step', LIVRE, 'postgres', { code: 'S-3', role: 'CronJob · immo', name: 'pg_dump --snapshot + comptes', detail: 'preuve : manifeste et SHA-256' }),
      C4: card(IMMO, 'step', ABSENT, 'document', { code: 'S-4', role: 'Coordinateur · immo', name: 'Copie des objets immo', detail: 'preuve : clé, version, SHA-256' }),
      C5: card(GEO, 'step', ABSENT, 's3', { code: 'S-5', role: 'Job · geo', name: 'Copie geo sans gel', detail: "preuve : SHA-256 = nom d'objet" }),
      C6: card(IMMO, 'step', ABSENT, 'check', { code: 'S-6', role: 'Coordinateur · immo', name: 'Marqueur commun en dernier', detail: 'preuve : empreintes des manifestes' }),
      C7: card(IMMO, 'step', ABSENT, 'release', { code: 'S-7', role: 'Coordinateur · immo', name: 'Dégel des écritures', detail: 'preuve : durée du gel mesurée' }),

      REST: BOX(IMMO, 'declared', 'not-applicable', { code: 'REST', name: 'Restauration · inverse' }),
      R1: card(IMMO, 'step', ABSENT, 'user', { code: 'R-1', role: 'Astreinte · immo', name: "Choix d'un cycle complet", detail: 'preuve : marqueur + reçus' }),
      R2: card(IMMO, 'step', ABSENT, 'cluster', { code: 'R-2', role: 'Lane k8s', name: 'Environnement vide', detail: 'preuve : secrets du coffre' }),
      R3: card(GEO, 'step', ABSENT, 'map', { code: 'R-3', role: 'Lane · geo', name: 'Irremplaçables puis exports', detail: 'preuve : SHA-256 = nom' }),
      R4: card(IMMO, 'step', ABSENT, 'document', { code: 'R-4', role: 'Lane · immo', name: 'Objets immo du même cycle', detail: 'preuve : références fermées' }),
      R5: card(IMMO, 'step', ABSENT, 'postgres', { code: 'R-5', role: 'Lane · immo', name: 'PostgreSQL neuf + rôles', detail: 'preuve : comptes exacts (G3)' }),
      R6: card(IMMO, 'step', ABSENT, 'web', { code: 'R-6', role: 'Owner · GO', name: "Réouverture de l'API", detail: 'preuve : durée = RTO réel' }),
    },
    edges: {
      'C1|C2|cycle alloué': e(...ABSENT),
      'C2|C3|écrivains drainés': e(...ABSENT),
      'C3|C4|dump vérifié': e(...ABSENT),
      'C4|C5|objets inventoriés': e(...ABSENT),
      'C5|C6|inventaire réconcilié': e(...ABSENT),
      'C6|C7|marqueur publié': e(...ABSENT),
      'C7|R1|cycle complet disponible': e(...ABSENT),
      'R1|R2|cycle retenu': e(...ABSENT),
      'R2|R3|environnement prêt': e(...ABSENT),
      'R3|R4|exports geo prêts': e(...ABSENT),
      'R4|R5|références fermées': e(...ABSENT),
      'R5|R6|comptes exacts': e(...ABSENT),
    },
  },

  // Scène 3 — mise en service (section 8) : acteur, garde-fou, et preuve de
  // sortie portée par l'arête sortante. Rien n'est engagé.
  'mise-en-service': {
    nodes: {
      AVANT: BOX(IMMO, 'declared', 'not-applicable', { code: 'AVANT', name: 'Avant fusion · preuve' }),
      M1: card(IMMO, 'step', ABSENT, 'api', { code: 'M-1', role: 'Lane · reprise', name: 'Corriger B1–B5, G2–G5', detail: 'garde : revue contradictoire' }),
      M2: card(IMMO, 'step', ABSENT, 'user', { code: 'M-2', role: 'Owner · D2', name: 'Verrou : mode et durée', detail: 'garde : conformité irréversible' }),
      M3: card(IMMO, 'step', ABSENT, 'workstation', { code: 'M-3', role: 'Owner · commande', name: 'Provisionner la préprod', detail: 'garde : GO + préflight lecture' }),
      M4: card(IMMO, 'step', ABSENT, 'cronjob', { code: 'M-4', role: 'Lane k8s', name: 'Sauvegarde de preuve', detail: 'garde : image épinglée (digest)' }),
      M5: card(IMMO, 'step', ABSENT, 'postgres', { code: 'M-5', role: 'Lane k8s', name: 'Restauration depuis S3', detail: 'garde : instance éphémère' }),
      M6: card(IMMO, 'step', ABSENT, 'user', { code: 'M-6', role: 'Lane k8s', name: "Livraison de l'alerte", detail: 'garde : contrôleur arrêté (R3)' }),
      M7: card(GEO, 'step', ABSENT, 'map', { code: 'M-7', role: 'Lane · geo', name: 'Preuve geo appariée', detail: 'garde : même cycle (R4)' }),
      M8: card(IMMO, 'step', ABSENT, 'identity', { code: 'M-8', role: 'Owner · GO direct', name: 'Provisionner la prod', detail: 'garde : PRA_PRODUCTION_GO' }),
      M9: card(IMMO, 'step', ABSENT, 'check', { code: 'M-9', role: 'Lane k8s', name: 'Quota et droits prod', detail: 'garde : describe quota, can-i' }),

      FUSION: BOX(IMMO, 'declared', 'not-applicable', { code: 'FUSION', name: 'Fusion · activation' }),
      F1: card(IMMO, 'step', ABSENT, 'release', { code: 'F-1', role: 'Owner · D1', name: 'Fusion #712 + geo#390', detail: 'garde : preuves M-4 à M-9' }),
      F2: card(IMMO, 'step', ABSENT, 'cluster', { code: 'F-2', role: 'Owner · GO prod', name: 'Activer préprod + prod', detail: 'garde : fraîcheur suspendue' }),

      APRES: BOX(IMMO, 'declared', 'not-applicable', { code: 'APRES', name: 'Après activation' }),
      A1: card(IMMO, 'step', ABSENT, 'cronjob', { code: 'A-1', role: 'Lane k8s', name: 'Premiers Jobs manuels', detail: "garde : observés jusqu'au reçu" }),
      A2: card(IMMO, 'step', ABSENT, 'check', { code: 'A-2', role: 'Lane k8s', name: 'Réactiver la fraîcheur', detail: 'garde : après les deux reçus' }),
      A3: card(IMMO, 'step', ABSENT, 'document', { code: 'A-3', role: 'Conducteur', name: 'Compte rendu sur #698', detail: 'preuve : commentaire de carte' }),
    },
    edges: {
      'M1|M2|revue sans bloquant': e(...ABSENT),
      'M2|M3|mode et durée écrits': e(...ABSENT),
      'M3|M4|sonde verte': e(...ABSENT),
      'M4|M5|reçu vérifié': e(...ABSENT),
      'M5|M6|comptes exacts · durée': e(...ABSENT),
      'M6|M7|alerte reçue': e(...ABSENT),
      'M7|M8|inventaire geo': e(...ABSENT),
      'M8|M9|sonde prod verte': e(...ABSENT),
      'M9|F1|marge et droits relevés': e(...ABSENT),
      'F1|F2|deux PR fusionnées': e(...ABSENT),
      'F2|A1|deux namespaces appliqués': e(...ABSENT),
      'A1|A2|deux reçus vérifiés': e(...ABSENT),
      'A2|A3|fraîcheur verte': e(...ABSENT),
    },
  },
};

export const sceneIds = Object.keys(scenes);

// Même contrat que la chaîne d'architecture : aucun nœud ni arête en trop ou
// manquant des deux côtés, états fermés, gabarit unique A' (ou conteneur).
export function metadataFor(graph) {
  const scene = scenes[graph.id];
  if (!scene) throw Error(`missing scene metadata ${graph.id}`);
  const actualNodes = new Set([...graph.groups, ...graph.nodes].map(item => item.id));
  const expectedNodes = new Set(Object.keys(scene.nodes));
  for (const id of actualNodes) if (!expectedNodes.has(id)) throw Error(`${graph.id}: missing node metadata ${id}`);
  for (const id of expectedNodes) if (!actualNodes.has(id)) throw Error(`${graph.id}: extra node metadata ${id}`);
  const groupIds = new Set(graph.groups.map(group => group.id));
  const edges = {};
  for (const edge of graph.edges) {
    const key = `${edge.source}|${edge.target}|${edge.label}`, value = scene.edges[key];
    if (!value) throw Error(`${graph.id}: missing edge metadata ${key}`);
    edges[edge.id] = value;
  }
  if (Object.keys(edges).length !== Object.keys(scene.edges).length) throw Error(`${graph.id}: extra edge metadata`);
  for (const value of [...Object.values(scene.nodes), ...Object.values(edges)]) {
    if (!EVIDENCE.has(value.evidenceClass) || !RUNTIME.has(value.runtimeState)) throw Error(`${graph.id}: invalid closed state`);
  }
  for (const [id, value] of Object.entries(scene.nodes)) {
    const isGroup = groupIds.has(id);
    if (isGroup !== (value.card === 'box')) throw Error(`${graph.id}/${id}: container and template disagree`);
    if (value.card === 'box') {
      if (value.role) throw Error(`${graph.id}/${id}: a container carries no role title`);
      continue;
    }
    if (value.card !== 'A') throw Error(`${graph.id}/${id}: unknown card template ${value.card}`);
    if (!value.code || !value.role || !value.name || !value.detail) throw Error(`${graph.id}/${id}: card needs code, role, name and detail`);
    if (value.name.includes(value.code)) throw Error(`${graph.id}/${id}: code repeated inside the name`);
    if (!roleIsShort(value.role)) throw Error(`${graph.id}/${id}: role title "${value.role}" is not two-by-two short`);
  }
  return { nodes: scene.nodes, edges };
}

export function decorateGraph(graph) {
  const metadata = metadataFor(graph);
  for (const item of [...graph.groups, ...graph.nodes]) item.metadata = metadata.nodes[item.id];
  for (const edge of graph.edges) edge.metadata = metadata.edges[edge.id];
  return graph;
}
