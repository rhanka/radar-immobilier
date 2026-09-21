// Contenu des cartes du dossier « Sauvegardes et PRA » PRA v3 (spec
// SPEC_PRA_V3_2026-09-19 réconciliée, carte #698).
// Le gabarit, la géométrie et le routage viennent de la chaîne existante
// (`docs/architecture/focus`), qui importe elle-même le kit h2a monté en /kit.
// Ici : uniquement le contenu des trois scènes et le contrôle de contrat.
import { roleIsShort } from '../../../../architecture/focus/scene-metadata.js';

const EVIDENCE = new Set(['observed', 'declared', 'historical', 'dormant', 'unknown', 'external']);
const RUNTIME = new Set(['active', 'suspended', 'dormant', 'manual', 'retained', 'unknown', 'not-applicable']);

// Légende des états, rendue par la page (Scenes.svelte) :
//   active          existant, en service
//   dormant         livré, non actif
//   suspended       prévu, non activé (aucune carte v3 ; état conservé pour le contrat)
//   not-applicable  n'existe pas encore, ou étape pas encore faite ; « absent » motivé (ARCH-5)
//   manual          hors cluster, entre les mains du propriétaire
//   retained        reconstructible depuis la production : aucune donnée irremplaçable
//   unknown         case vide : état réel non relevé
export const STATES = {
  active: 'existant, en service',
  dormant: 'livré, non actif',
  suspended: 'prévu, non activé',
  'not-applicable': "n'existe pas encore, pas encore fait ; absent motivé",
  manual: 'hors cluster, chez le propriétaire',
  retained: 'reconstructible depuis la production : aucune donnée irremplaçable',
  unknown: 'case vide : état réel non relevé',
};

const IMMO = ['radar-immobilier'];
const GEO = ['geo'];
// Conteneur qui groupe des cartes des deux dépôts : son en-tête porte les deux.
const IMMO_GEO = ['radar-immobilier', 'geo'];
const K8S = ['poc-k8s'];
const A = (repo, kind, evidenceClass, runtimeState, icon, spec) => ({
  card: 'A', kind, repo: [...repo].sort(), evidenceClass, runtimeState, icon,
  code: spec.code ?? '', role: spec.role ?? '', name: spec.name ?? '', detail: spec.detail ?? '',
});
const BOX = (repo, evidenceClass, runtimeState, spec) => ({
  card: 'box', kind: 'cluster', repo: [...repo].sort(), evidenceClass, runtimeState, icon: 'cluster',
  code: spec.code ?? '', role: '', name: spec.name ?? '', detail: '',
});
const e = (evidenceClass, runtimeState) => ({ evidenceClass, runtimeState });
const LIVRE = ['declared', 'dormant'], ABSENT = ['declared', 'not-applicable'];
const EN_SERVICE = ['observed', 'active'];
const card = (repo, kind, state, icon, spec) => A(repo, kind, state[0], state[1], icon, spec);

const scenes = {
  // Scène 1 — architecture symétrique préprod / prod (spec §12.1), mise en page
  // **imposée par l'owner** (DOSSIER_PRA_V3_LAYOUT_SPEC, 2026-09-20) : une case
  // UTILISATEUR au nord, une boîte ADMINISTRATION ET COFFRE au sud, et entre les
  // deux une bande de cinq colonnes, de l'ouest vers l'est —
  //   1. GitHub seul (workflows et alertes émises par GitHub), verticale ;
  //   2. hors GitHub (courriel TEM Scaleway, DNS Cloudflare), verticale ;
  //   3. le cluster k8s : immo au nord (préprod ouest, prod est), geo au centre
  //      (préprod ouest, prod est), plateforme partagée au sud ;
  //   4. les buckets OVH : immo au nord (préprod nord-nord, prod nord-sud), geo au
  //      centre (préprod centre-nord, prod centre-sud), clés tout au sud ;
  //   5. la réplication en autre région OVH, verticale.
  // Trois niveaux de conteneurs dans le cluster (cluster → tenant → environnement),
  // convention reprise telle quelle de la chaîne d'architecture (`OVH_CLUSTER` >
  // `immo_tenant` > `immo_pp` / `immo_pr`), et le même schéma côté buckets
  // (`BUCKETS_OVH` > `S3_IMMO` > `S3_IMMO_PP` / `S3_IMMO_PR`).
  // Les six zones Z1–Z6 restent la taxonomie de contenu de la section 4 : elles ne
  // sont plus six boîtes à plat, elles sont réparties sur les colonnes du plan.
  // Le plan est tenu sur le rendu : ELK layered place par le flux et non par les
  // points cardinaux, donc le placement ne le lui demande pas — il pose les blocs
  // racine à des coordonnées calculées à partir des tailles que les sous-placements
  // renvoient, et à l'intérieur de chaque bloc l'ordre imposé est tenu par le
  // placement semi-interactif d'ELK, qui garde le routage (elk-layout.mjs, mode
  // `frame` et FRAME_PLAN). Contrôlé par le test « le plan de l'owner tenu sur le
  // rendu, bloc par bloc » ; voir l'annexe D du dossier.
  // Rangées immo R1–R9 et geo G1–G7 en paires préprod/prod ; cas « absent »
  // motivés ; clés (§9.4), acteurs, alertes. Sources : sections 4, 7, 9, 10.
  'architecture-sauvegardes': {
    nodes: {
      // Nord — l'utilisateur, hors cluster. Même convention que le dossier
      // d'architecture d'ensemble (`A_USER` : « Navigateur », « accès web · hors cluster »).
      USER: card(IMMO_GEO, 'actor', ['external', 'active'], 'user',
        { code: 'USER', role: 'Navigateur', name: 'Navigateur utilisateur', detail: 'accès web · hors cluster' }),

      // Colonne 1 — pilotage : hors GitHub au-dessus, GitHub en dessous (owner :
      // « place gh en dessous de hors gh »). Le conteneur empile les deux zones.
      Z_GHX: BOX(IMMO_GEO, 'observed', 'active', { code: 'Z4-6', name: 'Pilotage · GitHub et hors GitHub' }),
      // GitHub seul (Z4) : ce que GitHub exécute et ce que GitHub émet.
      GH_PILOTAGE: BOX(IMMO_GEO, 'observed', 'active', { code: 'Z4', name: 'GitHub · workflows et alertes' }),
      GHA: card(IMMO_GEO, 'workflow', ABSENT, 'api',
        { code: 'GHA-PRA', role: 'Workflow · PRA', name: 'pra.yml + watch · À CRÉER', detail: 'env preprod/prod/dr/watch' }),
      GHA_CD: card(IMMO_GEO, 'workflow', EN_SERVICE, 'release',
        { code: 'GHA-CD', role: 'Workflow · CD', name: 'deploy · promote · rollback', detail: 'immo + geo · armés' }),
      ALT_GH: card(IMMO_GEO, 'alert', ABSENT, 'check',
        { code: 'ALT-GH', role: 'Alerte · ticket', name: 'pra-alert + /ack · À CRÉER', detail: 'accusé §9 · Q6' }),

      // Colonne 2 — hors GitHub (Z6) : les fournisseurs tiers, nettement séparés.
      HORS_GH: BOX(IMMO_GEO, 'observed', 'active', { code: 'Z6', name: 'Hors GitHub · courriel et DNS' }),
      ALT_TEM: card(IMMO_GEO, 'alert', LIVRE, 'document',
        { code: 'ALT-TEM', role: 'Alerte · courriel', name: 'TEM Scaleway · PRÊT', detail: 'second canal · Q6' }),
      CF_LE: card(IMMO_GEO, 'dns', EN_SERVICE, 'network',
        { code: 'CF-LE', role: 'DNS · Cloudflare', name: 'sent-tech.ca · DNS-01', detail: 'A manuels · jeton scellé' }),

      // Centre — LE cluster (Z1), CHAQUE tenant, et dans chaque tenant sa préprod et sa prod.
      OVH_CLUSTER: BOX(IMMO_GEO, 'observed', 'active', { code: 'Z1', name: 'Cluster MKS poc-ca' }),
      immo_tenant: BOX(IMMO, 'observed', 'active', { code: 'T-IMMO', name: 'Tenant immo' }),
      immo_pp: BOX(IMMO, 'observed', 'active', { code: 'IMMO-PP', name: 'Préproduction' }),
      PG_PP: card(IMMO, 'database', EN_SERVICE, 'postgres',
        { code: 'R1-PP', role: 'Base · préprod', name: 'PostGIS 16 · 950 MiB', detail: 'PVC 5 Gi · en service' }),
      CJ_PP: card(IMMO, 'cronjob', LIVRE, 'cronjob',
        { code: 'R3-PP', role: 'CronJob · préprod', name: 'radar-db-backup · LIVRÉ', detail: '02:15 et 14:15 UTC · non actif' }),
      FH_PP: card(IMMO, 'cronjob', LIVRE, 'cronjob',
        { code: 'R4-PP', role: 'Fraîcheur · préprod', name: 'état status/ · LIVRÉ', detail: 'seuil 14 h · non actif' }),
      CL_PP: card(IMMO, 'database', ABSENT, 'postgres',
        { code: 'R8-PP', role: 'Clone · préprod', name: 'radar_pre_<sha> · PROPOSÉ', detail: 'coupure complète · E5' }),
      KR_PP: card(IMMO, 'store', ['unknown', 'unknown'], 'unknown',
        { code: 'R9-PP', role: 'Keyring · préprod', name: 'PVC refresh · À CONFIRMER', detail: 'lane k8s · case vide' }),
      immo_pr: BOX(IMMO, 'observed', 'active', { code: 'IMMO-PR', name: 'Production' }),
      PG_PR: card(IMMO, 'database', EN_SERVICE, 'postgres',
        { code: 'R1-PR', role: 'Base · prod', name: 'PostGIS 16 · 1 002 MiB', detail: 'dernier point 8 j · RPO ouvert' }),
      CJ_PR: card(IMMO, 'cronjob', LIVRE, 'cronjob',
        { code: 'R3-PR', role: 'CronJob · prod', name: 'radar-db-backup · LIVRÉ', detail: 'Q0 pour activer · non actif' }),
      FH_PR: card(IMMO, 'cronjob', LIVRE, 'cronjob',
        { code: 'R4-PR', role: 'Fraîcheur · prod', name: 'état status/ · LIVRÉ', detail: 'lu par le veilleur · Q6' }),
      CL_PR: card(IMMO, 'database', ABSENT, 'postgres',
        { code: 'R8-PR', role: 'Clone · prod', name: 'radar_pre_<sha> · PROPOSÉ', detail: 'renommage < 5 min · F20' }),
      KR_PR: card(IMMO, 'store', EN_SERVICE, 'document',
        { code: 'R9-PR', role: 'Keyring · prod', name: 'PVC 1 Gi · amorcé', detail: 'reconstructible ? · lane immo' }),
      geo_tenant: BOX(GEO, 'observed', 'active', { code: 'T-GEO', name: 'Tenant geo' }),
      geo_pp: BOX(GEO, 'observed', 'active', { code: 'GEO-PP', name: 'Préproduction' }),
      GA_PP: card(GEO, 'service', LIVRE, 'api',
        { code: 'G1-PP', role: 'Service · préprod', name: 'geo-api-preprod · 1 pod', detail: 'manifestes brouillon · 14/09' }),
      GP_PP: card(GEO, 'database', ABSENT, 'postgres',
        { code: 'G4-PP', role: 'PostGIS · absent', name: 'rien · MOTIF §4', detail: "n'existe qu'en prod · G4" }),
      GS_PP: card(GEO, 'job', EN_SERVICE, 'cronjob',
        { code: 'G6-JOB', role: 'Sync · préprod', name: 'preprod-sync · sens unique', detail: 'prod → préprod · S8' }),
      geo_pr: BOX(GEO, 'observed', 'active', { code: 'GEO-PR', name: 'Production' }),
      GA_PR: card(GEO, 'service', EN_SERVICE, 'api',
        { code: 'G1-PR', role: 'Service · prod', name: 'geo-api · en service', detail: 'servi à nginx immo' }),
      GP_PR: card(GEO, 'database', EN_SERVICE, 'postgres',
        { code: 'G4-PR', role: 'PostGIS · prod', name: 'PostGIS · 139 MiB', detail: 'hors chemin servi · re-dérivable' }),
      GC_PR: card(GEO, 'job', ABSENT, 'cronjob',
        { code: 'G5-CPY', role: 'Copie · geo', name: 'S3 vers S3 · PRÉVU', detail: 'plan geo · non livré' }),
      PLATEFORME: BOX(K8S, 'observed', 'active', { code: 'Z1-PLAT', name: 'Plateforme partagée' }),
      PF: card(K8S, 'platform', EN_SERVICE, 'cluster',
        { code: 'PLAT', role: 'Plateforme · cluster', name: 'scellés · cert · Traefik', detail: 'KEDA · bootstrap écrit' }),
      IDP: card(IMMO_GEO, 'service', EN_SERVICE, 'identity',
        { code: 'IDP', role: 'IdP · dépendance', name: 'auth.sent-tech.ca · REQUIS', detail: 'hors budget RTO · Q15' }),
      K_SEAL: card(K8S, 'secret', EN_SERVICE, 'identity',
        { code: 'K-SEAL', role: 'Clé · scellés', name: '2 clés · AUCUN EXPORT', detail: 'rotation ~22/09 · Q10' }),

      // Colonne 4 — les buckets OVH (Z2) : immo au nord, geo au centre, clés au sud.
      BUCKETS_OVH: BOX(IMMO_GEO, 'observed', 'active', { code: 'Z2', name: 'Buckets OVH' }),
      S3_IMMO: BOX(IMMO, 'observed', 'active', { code: 'S3-IMMO', name: 'S3 immo' }),
      S3_IMMO_PP: BOX(IMMO, 'observed', 'active', { code: 'S3-IMMO-PP', name: 'S3 immo préprod' }),
      OBJ_PP: card(IMMO, 'store', EN_SERVICE, 'graph',
        { code: 'R2-PP', role: 'Objets · préprod', name: 'RAW dédié + graph-preprod', detail: 'nom RAW inconnu · S2' }),
      BK_PP: card(IMMO, 'store', ['unknown', 'unknown'], 'unknown',
        { code: 'R5-PP', role: 'Bucket · préprod', name: 'backups-preprod · INCONNU', detail: 'créé ? verrouillé ? · §16' }),
      PRE_PP: card(IMMO, 'store', EN_SERVICE, 'graph',
        { code: 'R7-PP', role: 'Dump · préprod', name: 'pgbackup-preprod · ARMÉ', detail: 'push main · dump gzip' }),
      S3_IMMO_PR: BOX(IMMO, 'observed', 'active', { code: 'S3-IMMO-PR', name: 'S3 immo prod' }),
      OBJ_PR: card(IMMO, 'store', EN_SERVICE, 'graph',
        { code: 'R2-PR', role: 'Objets · prod', name: 'docs · 59 017 objets', detail: '12,53 Go · versionnement ?' }),
      BK_PR: card(IMMO, 'store', ['unknown', 'unknown'], 'unknown',
        { code: 'R5-PR', role: 'Bucket · prod', name: 'backups · INCONNU', detail: 'créé ? verrouillé ? · §16' }),
      PRE_PR: card(IMMO, 'store', EN_SERVICE, 'graph',
        { code: 'R7-PR', role: 'Dump · prod', name: 'pgbackup · ARMÉ', detail: 'tag v* · 6 min 54 s' }),
      S3_GEO: BOX(GEO, 'observed', 'active', { code: 'S3-GEO', name: 'S3 geo' }),
      S3_GEO_PP: BOX(GEO, 'observed', 'active', { code: 'S3-GEO-PP', name: 'S3 geo préprod' }),
      GB_PP: card(GEO, 'store', ['declared', 'retained'], 'graph',
        { code: 'G2-PP', role: 'Bucket · préprod', name: 'geo-preprod · normalized/', detail: 'aucune donnée irremplaçable' }),
      // Rôle raccourci : « Irremplaçables · absents » mesurait 392 px pour 358 px
      // de place et se tronquait (contrôle Chromium du gabarit).
      GI_PP: card(GEO, 'prefix', ABSENT, 'graph',
        { code: 'G3-PP', role: 'Irremplaçables · rien', name: 'aucun · MOTIF §4', detail: 'tout vient de la prod · G3' }),
      G5_PP: card(GEO, 'store', ABSENT, 'graph',
        { code: 'G5-PP', role: 'Reprise · absente', name: 'rien · MOTIF §4', detail: 'rien à protéger · G5' }),
      S3_GEO_PR: BOX(GEO, 'observed', 'active', { code: 'S3-GEO-PR', name: 'S3 geo prod' }),
      GB_PR: card(GEO, 'store', EN_SERVICE, 'graph',
        { code: 'G2-PR', role: 'Bucket · prod', name: 'sentropic-geo · 48,94 Go', detail: '45 378 objets · 29/07' }),
      GI_PR: card(GEO, 'prefix', EN_SERVICE, 'graph',
        { code: 'G3-PR', role: 'Irremplaçables · prod', name: 'grilles 44 obj. · raw/', detail: 'adressés par contenu · G3' }),
      GD_PR: card(GEO, 'store', ABSENT, 'graph',
        { code: 'G5-BKT', role: 'Reprise · bucket', name: 'sentropic-geo-pra · PRÉVU', detail: 'verrou et région · Q7 Q8' }),
      GS_PR: card(GEO, 'store', EN_SERVICE, 'graph',
        { code: 'G6-SRC', role: 'Sync · source', name: 'normalized/ · SOURCE', detail: 'lu par preprod-sync · G6' }),
      CLES_S3: BOX(IMMO_GEO, 'declared', 'manual', { code: 'S3-CLES', name: 'Clés S3' }),
      K_S3: card(IMMO_GEO, 'secret', ['declared', 'manual'], 'identity',
        { code: 'K-S3', role: 'Clés · S3', name: 'données + PRA 7/env', detail: '.env local · à coffrer' }),
      // Colonne 5 — la réplication en autre région OVH (Z3), verticale, à l'est de l'est.
      EXT_REGION: BOX(IMMO_GEO, 'declared', 'not-applicable', { code: 'Z3', name: 'Autre région OVH' }),
      R6_PP: card(IMMO, 'store', ABSENT, 'graph',
        { code: 'R6-PP', role: 'Réplique · absente', name: 'rien · MOTIF §4', detail: 'quotidien seul · Q5b' }),
      R6_PR: card(IMMO, 'store', ABSENT, 'graph',
        { code: 'R6-PR', role: 'Réplique · prod', name: 'bucket réplique · PROPOSÉ', detail: 'mêmes paliers · Q8 · E7a' }),
      GR_PP: card(GEO, 'store', ABSENT, 'graph',
        { code: 'G7-PP', role: 'Réplique · absente', name: 'rien · MOTIF §4', detail: 'pas de réplique PP · G7' }),
      GR_PR: card(GEO, 'store', ABSENT, 'graph',
        { code: 'G7-PR', role: 'Réplique · geo', name: 'réplique geo · PROPOSÉE', detail: 'selon contrat · Q14' }),
      OPT_HORS: card(IMMO_GEO, 'option', ABSENT, 'url',
        { code: 'OPT-HORS', role: 'Option · hors OVH', name: 'autre carte · NON CONÇUE', detail: 'V38 · à confirmer' }),

      // Sud — l'administration du cluster et le coffre (Z5). La face est tenue par le
      // cadre : cette boîte est posée sous le cluster, l'utilisateur au-dessus.
      SUD_ADMIN: BOX(IMMO_GEO, 'declared', 'manual', { code: 'SUD', name: 'Administration et coffre' }),
      OWNER: card(IMMO_GEO, 'actor', ['declared', 'manual'], 'user',
        { code: 'OWNER', role: 'Acteur · owner', name: 'déclenche · approuve · acquitte', detail: 'détient coffre + clé age' }),
      ADMIN: card(IMMO_GEO, 'actor', ['declared', 'manual'], 'user',
        { code: 'ADMIN', role: 'Acteur · admin', name: 'admin cluster · RÔLE', detail: 'tenu par owner · §2.1' }),
      K_VAULT: card(IMMO_GEO, 'secret', ABSENT, 'identity',
        { code: 'K-VAULT', role: 'Clé · coffre', name: 'sops + age · À CRÉER', detail: 'source unique · §8.4' }),
      K_OVH: card(IMMO_GEO, 'secret', ['declared', 'manual'], 'identity',
        { code: 'K-OVH', role: 'Clé · OVH', name: 'jeton API · PROJET ENTIER', detail: '~/.ovh.conf · risque F16' }),
    },
    edges: {
      'USER|PF|accès web · Traefik': e(...EN_SERVICE),
      'USER|IDP|connexion · IdP': e(...EN_SERVICE),
      'CJ_PP|BK_PP|dépôt · écrivain': e(...LIVRE),
      'CJ_PR|BK_PR|dépôt · écrivain': e(...LIVRE),
      'BK_PR|CJ_PR|lecture · vérifie': e(...LIVRE),
      'BK_PP|FH_PP|reçus · vérifiés': e(...LIVRE),
      'BK_PR|FH_PR|reçus · vérifiés': e(...LIVRE),
      'FH_PP|GHA|état · watcher': e(...ABSENT),
      'FH_PR|GHA|état · watcher': e(...ABSENT),
      'GHA|ALT_GH|ticket · alerte': e(...ABSENT),
      'GHA|ALT_TEM|courriel · TEM': e(...ABSENT),
      'ALT_GH|OWNER|accusé · ack': e(...ABSENT),
      'BK_PR|R6_PR|réplique · E7a': e(...ABSENT),
      'OWNER|GHA|déclenche · b': e(...ABSENT),
      'GHA|PF|rebuild · tofu': e(...ABSENT),
      'GHA|CF_LE|DNS · certificats': e(...ABSENT),
      'GHA_CD|PRE_PP|push · dump+clone': e(...EN_SERVICE),
      'GHA_CD|PRE_PR|tag · dump+clone': e(...EN_SERVICE),
      'K_VAULT|GHA|synchronise · secrets': e(...ABSENT),
      'K_SEAL|PF|déchiffre · scellés': e(...EN_SERVICE),
      'K_S3|OBJ_PR|lit · copie N2': e(...EN_SERVICE),
      'K_OVH|PF|provisionne · MKS': e(...EN_SERVICE),
      'GB_PR|GS_PP|lit · lecture seule': e(...EN_SERVICE),
      'GS_PP|GB_PP|normalized/ · idempotent': e(...EN_SERVICE),
      'GC_PR|GD_PR|copie · idempotente': e(...ABSENT),
      'ADMIN|PF|actes · cluster': e(...EN_SERVICE),
    },
  },

  // Scène 2 — les déclencheurs et la reprise (spec §7, §12.3). P-a, P-bi, P-bii,
  // P-biii : déclencheur et exécutant réels à chaque étape ; contenu BPMN P1–P9
  // en section 5, rendu bpmn-js en attente (section 13). Source : section 5.
  'sequence-bout-en-bout': {
    nodes: {
      DECL: BOX(IMMO_GEO, 'declared', 'not-applicable', { code: 'DECL', name: 'Déclencheurs · demande et plan' }),
      D_OWNER: card(IMMO_GEO, 'step', ['declared', 'manual'], 'user',
        { code: 'D-OWN', role: 'Acteur · owner', name: 'demande restauration b', detail: 'preuve : dispatch pra.yml' }),
      D_GHA: card(IMMO_GEO, 'step', ABSENT, 'api',
        { code: 'D-GHA', role: 'Workflow · PRA', name: 'pra.yml dispatch paramétré', detail: 'preuve : plan + G8 + reçu' }),
      D_AUTO: card(IMMO, 'step', ABSENT, 'release',
        { code: 'D-AUTO', role: 'Trigger · auto', name: 'passage auto restreint', detail: 'preuve : Q12 + Q1 tranchées' }),
      D_PLAN: card(IMMO_GEO, 'step', ABSENT, 'document',
        { code: 'D-PLAN', role: 'Plan · garde-fous', name: 'plan + G1-G10 + confirm', detail: 'preuve : plan dans le reçu' }),

      PASSAGE: BOX(IMMO_GEO, 'declared', 'not-applicable', { code: 'P-A', name: 'P-a · passage en préprod' }),
      A_STOP: card(IMMO, 'step', ABSENT, 'cluster',
        { code: 'A-STOP', role: 'Étape · arrêt', name: 'arrêt écrivains préprod', detail: 'preuve : G7 accusés' }),
      A_SEC: card(IMMO, 'step', ABSENT, 'check',
        { code: 'A-SEC', role: 'Étape · sécurité', name: 'point sécurité N1', detail: 'preuve : réf G5 au reçu' }),
      A_DB: card(IMMO, 'step', ABSENT, 'postgres',
        { code: 'A-DB', role: 'Étape · base', name: 'restore-into base préprod', detail: 'preuve : comptes manifeste' }),
      A_MIG: card(IMMO, 'step', ABSENT, 'release',
        { code: 'A-MIG', role: 'Étape · migration', name: 'test migration iso-mig', detail: 'preuve : migrations + durées' }),
      A_OBJ: card(IMMO, 'step', ABSENT, 'graph',
        { code: 'A-OBJ', role: 'Étape · objets', name: 'miroir objets serveur', detail: 'preuve : extras supprimés' }),
      A_GO: card(IMMO, 'step', ABSENT, 'web',
        { code: 'A-GO', role: 'Étape · reçu', name: 'fermeture + reçu E4', detail: 'preuve : G3 + /health + sha' }),

      SINISTRE: BOX(IMMO_GEO, 'declared', 'not-applicable', { code: 'P-BI', name: 'P-bi · crash complet cluster' }),
      B_TFU: card(IMMO_GEO, 'step', ABSENT, 'cluster',
        { code: 'B-TFU', role: 'Étape · tofu', name: 'cluster neuf + pool', detail: 'preuve : sortie tofu T2' }),
      B_PLAT: card(K8S, 'step', ABSENT, 'network',
        { code: 'B-PLAT', role: 'Étape · plateforme', name: 'plateforme + clés Q10', detail: 'preuve : contrôleurs prêts' }),
      B_TEN: card(IMMO_GEO, 'step', ABSENT, 'identity',
        { code: 'B-TEN', role: 'Étape · tenants', name: 'enveloppes + kubeconfigs', detail: 'preuve : noms seulement' }),
      B_DNS: card(IMMO_GEO, 'step', ABSENT, 'web',
        { code: 'B-DNS', role: 'Étape · DNS', name: 'DNS + certificats DNS-01', detail: 'preuve : certificat servi' }),
      B_DATA: card(IMMO, 'step', ABSENT, 'postgres',
        { code: 'B-DATA', role: 'Étape · données', name: 'restore-into + keyring', detail: 'preuve : comptes + G4' }),
      B_APP: card(IMMO_GEO, 'step', ABSENT, 'check',
        { code: 'B-APP', role: 'Étape · reçu', name: 'apps + GO + reçu E1', detail: 'preuve : sha + durée totale' }),

      REPRISE: BOX(IMMO_GEO, 'declared', 'not-applicable', { code: 'P-BII', name: 'P-bii et P-biii · restaurations' }),
      R_SCOPE: card(IMMO_GEO, 'step', ABSENT, 'document',
        { code: 'R-SCOPE', role: 'Étape · scope', name: 'scope + point + régime', detail: 'preuve : G1 G2 G4 verts' }),
      R_GEO: card(GEO, 'step', ABSENT, 'map',
        { code: 'R-GEO', role: 'Étape · geo', name: "geo d'abord + exports", detail: 'preuve : SHA-256 = nom' }),
      R_IMMO: card(IMMO, 'step', ABSENT, 'graph',
        { code: 'R-IMMO', role: 'Étape · immo', name: 'objets puis base', detail: 'preuve : références fermées' }),
      R_GARD: card(IMMO_GEO, 'step', ABSENT, 'check',
        { code: 'R-GARD', role: 'Étape · reçu', name: 'G3 + reçu E2 E3', detail: 'preuve : égalités ou refus' }),
    },
    edges: {
      'D_OWNER|D_GHA|demande · b': e(...ABSENT),
      'D_GHA|D_PLAN|plan · G8+confirm': e(...ABSENT),
      'D_AUTO|D_PLAN|cycle · Q12': e(...ABSENT),
      'D_PLAN|A_STOP|go · P-a': e(...ABSENT),
      'A_STOP|A_SEC|écrivains · arrêtés': e(...ABSENT),
      'A_SEC|A_DB|point · sécurité': e(...ABSENT),
      'A_DB|A_MIG|base · restaurée': e(...ABSENT),
      'A_MIG|A_OBJ|régime · iso-mig': e(...ABSENT),
      'A_OBJ|A_GO|objets · miroir': e(...ABSENT),
      'D_PLAN|B_TFU|go · P-bi': e(...ABSENT),
      'B_TFU|B_PLAT|cluster · neuf': e(...ABSENT),
      'B_PLAT|B_TEN|plateforme · clés': e(...ABSENT),
      'B_TEN|B_DNS|tenants · kubeconfigs': e(...ABSENT),
      'B_DNS|B_DATA|DNS · certificats': e(...ABSENT),
      'B_DATA|B_APP|données · restaurées': e(...ABSENT),
      'D_PLAN|R_SCOPE|go · P-bii-biii': e(...ABSENT),
      'R_SCOPE|R_GEO|scope · T0': e(...ABSENT),
      "R_GEO|R_IMMO|geo · d'abord": e(...ABSENT),
      'R_IMMO|R_GARD|immo · ensuite': e(...ABSENT),
    },
  },

  // Scène 3 — mesures conservatoires, lots et exercices (spec §15, §17, §7.7).
  // Lot 0 d'abord (A1 + Q0), puis les lots 1–6, puis les preuves E1–E9.
  // Source : sections 11 et 12 du dossier.
  'mise-en-service': {
    nodes: {
      URGENCE: BOX(IMMO_GEO, 'declared', 'not-applicable', { code: 'LOT0', name: 'Lot 0 · avant toute réponse' }),
      A1_KEYS: card(K8S, 'step', ['declared', 'manual'], 'identity',
        { code: 'A1', role: 'Action · clés', name: 'export clés avant rotation', detail: 'garde : compte vaut 2 · F1' }),
      Q0_GO: card(IMMO, 'step', ABSENT, 'check',
        { code: 'Q0', role: 'Décision · GO', name: 'activation intérimaire prod', detail: 'garde : GO owner · 35 j 7/4/2' }),

      LOTS: BOX(IMMO_GEO, 'declared', 'not-applicable', { code: 'LOTS', name: 'Lots 1 à 6 · questions' }),
      L1: card(IMMO_GEO, 'question', ABSENT, 'document',
        { code: 'L1', role: 'Lot · Q1-Q4', name: 'passages de ton texte', detail: 'garde : aucune recommandation' }),
      L2: card(IMMO_GEO, 'question', ABSENT, 'document',
        { code: 'L2', role: 'Lot · paliers', name: 'Q5 Q5b Q6 Q7', detail: 'garde : décompte + canal + verrou' }),
      L3: card(IMMO_GEO, 'question', ABSENT, 'document',
        { code: 'L3', role: 'Lot · région', name: 'Q8 Q9 Q10 Q12', detail: 'garde : réplique + clés + trigger' }),
      L4: card(IMMO_GEO, 'question', ABSENT, 'document',
        { code: 'L4', role: 'Lot · périmètre', name: 'Q13 Q14 Q15 Q16', detail: 'garde : geo + IdP + clusters' }),
      L5: card(IMMO_GEO, 'question', ABSENT, 'document',
        { code: 'L5', role: 'Lot · risque', name: 'Q17 Q18 Q19 Q20', detail: 'garde : miroir + chrono + coût' }),
      L6: card(IMMO_GEO, 'question', ABSENT, 'document',
        { code: 'L6', role: 'Lot · copies', name: 'Q21 Q22 Q23', detail: 'garde : outil + persistance + etc' }),

      PREUVES: BOX(IMMO_GEO, 'declared', 'not-applicable', { code: 'EX', name: 'Exercices E1 à E9 · preuves' }),
      E1: card(IMMO_GEO, 'exercise', ABSENT, 'check',
        { code: 'E1', role: 'Preuve · E1', name: 'reconstruction < 2 h', detail: 'garde : chrono + destruction' }),
      E2: card(IMMO_GEO, 'exercise', ABSENT, 'check',
        { code: 'E2', role: 'Preuve · E2', name: 'préprod récupère prod', detail: 'garde : égalités strictes' }),
      E3: card(IMMO_GEO, 'exercise', ABSENT, 'check',
        { code: 'E3', role: 'Preuve · E3', name: 'partielles + un refus', detail: 'garde : reçu par périmètre' }),
      E4: card(IMMO, 'exercise', ABSENT, 'check',
        { code: 'E4', role: 'Preuve · E4', name: 'passage iso + migration', detail: 'garde : deux reçus' }),
      E5: card(IMMO, 'exercise', ABSENT, 'check',
        { code: 'E5', role: 'Preuve · E5', name: 'retour N1 < 5 min', detail: 'garde : clone inclus' }),
      E6: card(IMMO_GEO, 'exercise', ABSENT, 'check',
        { code: 'E6', role: 'Preuve · E6', name: 'rejoué par pra.sh', detail: 'garde : sans GitHub' }),
      E7: card(IMMO_GEO, 'exercise', ABSENT, 'check',
        { code: 'E7', role: 'Preuve · E7', name: 'garde sans IA', detail: 'garde : refus mesurés' }),
      E8: card(IMMO_GEO, 'exercise', ABSENT, 'user',
        { code: 'E8', role: 'Preuve · E8', name: 'alertes + accusés', detail: 'garde : tickets + courriels' }),
      E9: card(IMMO_GEO, 'exercise', ABSENT, 'check',
        { code: 'E9', role: 'Preuve · E9', name: 'depuis la réplique', detail: 'garde : au moins la base' }),
    },
    edges: {
      'A1_KEYS|Q0_GO|clés · exportées': e(...ABSENT),
      'Q0_GO|L1|prod · activée': e(...ABSENT),
      'L1|L2|lot · répondu': e(...ABSENT),
      'L2|L3|lot · répondu': e(...ABSENT),
      'L3|L4|lot · répondu': e(...ABSENT),
      'L4|L5|lot · répondu': e(...ABSENT),
      'L5|L6|lot · répondu': e(...ABSENT),
      'L6|E1|spec · EVOL': e(...ABSENT),
      'E1|E2|E1 · reçu': e(...ABSENT),
      'E2|E3|E2 · reçu': e(...ABSENT),
      'E3|E4|E3 · reçu': e(...ABSENT),
      'E4|E5|E4 · reçu': e(...ABSENT),
      'E5|E6|E5 · reçu': e(...ABSENT),
      'E6|E7|E6 · reçu': e(...ABSENT),
      'E7|E8|E7 · reçu': e(...ABSENT),
      'E8|E9|E8 · reçu': e(...ABSENT),
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
