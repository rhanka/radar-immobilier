const EVIDENCE = new Set(['observed', 'declared', 'historical', 'dormant', 'unknown', 'external']);
const RUNTIME = new Set(['active', 'suspended', 'dormant', 'manual', 'retained', 'unknown', 'not-applicable']);

// One single card template, ratified by the owner (v10).
//   A — 5 lines: icône (haute comme les deux premières lignes) + code · rôle
//       court en gras · nom · un détail métier · séparateur · repo.
//       Aucune ligne de statut : l'exception se dit dans le détail.
//   box — container (cluster, namespace, poste) : titre + repo, sans statut.
// `code` is carried once, on line 1, and never repeated inside `name`.
const card = (template, repo, kind, evidenceClass, runtimeState, icon, spec) => ({
  card: template, kind, repo: [...repo].sort(), evidenceClass, runtimeState, icon,
  code: spec.code ?? '', role: spec.role ?? '', name: spec.name ?? '', detail: spec.detail ?? '',
});
const e = (evidenceClass, runtimeState) => ({ evidenceClass, runtimeState });
const A = (repo, kind, evidence, runtime, icon, spec) => card('A', repo, kind, evidence, runtime, icon, spec);
const BOX = (repo, evidence, runtime, spec) => card('box', repo, 'cluster', evidence, runtime, 'cluster', spec);
const IMMO = ['radar-immobilier'], GEO = ['geo'], PLATFORM = ['poc-k8s'], SSO = ['sentropic'], EXT = ['external'];

// Shared spine of the codex-13-sept baseline: Traefik, the Immo chain, the SSO
// platform and the Geo services, in their single-environment July/August shape.
const hostingSpine = (evidence, runtime) => ({
  A_USER: A(EXT, 'actor', 'external', 'not-applicable', 'user',
    { code: 'USER', role: 'Navigateur', name: 'Navigateur utilisateur', detail: 'accès web · hors cluster' }),
  A_EDGE: A(PLATFORM, 'network', evidence, runtime, 'network',
    { code: 'EDGE', role: 'Réseau · entrée', name: 'Load balancer → Traefik', detail: 'TLS · routage des hôtes' }),
  A_UI: A(IMMO, 'service', evidence, runtime, 'web',
    { code: 'UI', role: 'Interface · web', name: 'radar-ui', detail: 'route / · immo.sent-tech.ca' }),
  A_API: A(IMMO, 'service', evidence, runtime, 'api',
    { code: 'API', role: 'API · production', name: 'radar-api', detail: 'route /api · lecture PDF' }),
  A_DB: A(IMMO, 'store', evidence, runtime, 'postgres',
    { code: 'DB', role: 'Base · production', name: 'radar-postgres', detail: 'PostgreSQL · PostGIS' }),
  A_SCRAPE: A(IMMO, 'schedule', evidence, runtime, 'cronjob',
    { code: 'SCRAPE', role: 'CronJob · collecte', name: 'radar-refresh-scrape', detail: '03:17 UTC · étapes 1 et 2' }),
  A_PROJECT: A(IMMO, 'schedule', evidence, runtime, 'cronjob',
    { code: 'PROJECT', role: 'CronJob · projection', name: 'radar-refresh-projection', detail: '04:30 UTC · étape 4' }),
  A_SSO: A(SSO, 'service', evidence, runtime, 'identity',
    { code: 'IDP', role: 'Identité · OIDC', name: 'sentropic · auth-idp', detail: 'redirection login · JWKS' }),
  A_SSO_DB: A(SSO, 'store', evidence, runtime, 'postgres',
    { code: 'SSO-DB', role: 'Base · SSO', name: 'PostgreSQL SSO', detail: 'sessions et comptes' }),
  A_GEO: A(GEO, 'service', evidence, runtime, 'api',
    { code: 'GEO-API', role: 'API · géographie', name: 'geo-api · geo', detail: 'OGC · couches et tuiles' }),
  A_GEO_DB: A(GEO, 'store', evidence, runtime, 'postgres',
    { code: 'GEO-DB', role: 'Base · géographie', name: 'geo / postgis', detail: 'PostgreSQL · PostGIS' }),
});

const hostingSpineEdges = (evidence, runtime) => ({
  'A_USER|A_URL|': e(evidence, runtime),
  'A_URL|A_EDGE|': e(evidence, runtime),
  'A_USER|A_SSO|Redirection login': e(evidence, runtime),
  'A_EDGE|A_UI|': e(evidence, runtime),
  'A_UI|A_API|/api': e(evidence, runtime),
  'A_API|A_DB|SQL': e(evidence, runtime),
  'A_API|A_RAW|objets RAW': e(evidence, runtime),
  'A_API|A_DOCS|documents dérivés': e(evidence, runtime),
  'A_MINIO|A_RAW|bucket sur PVC': e(evidence, runtime),
  'A_MINIO|A_DOCS|bucket sur PVC': e(evidence, runtime),
  'A_SCRAPE|A_RAW|étapes 1 et 2': e(evidence, runtime),
  'A_SCRAPE|A_GRAPH_S3|corpus et graphe': e(evidence, runtime),
  'A_GRAPH_S3|A_PROJECT|': e(evidence, runtime),
  'A_PROJECT|A_DB|étape 4 · upsert': e(evidence, runtime),
  'A_WS|A_GRAPH_S3|étape 3 · Graphify local': e(evidence, 'manual'),
  'A_API|A_DOCS_S3|lecture PDF source': e(evidence, runtime),
  'A_API|A_SSO|OIDC / JWKS': e(evidence, runtime),
  'A_SSO|A_SSO_DB|sessions': e(evidence, runtime),
  'A_UI|A_GEO|OGC': e(evidence, runtime),
  'A_GEO|A_GEO_DB|SQL': e(evidence, runtime),
  'A_GEO|A_GEO_S3|lecture produits': e(evidence, runtime),
  'A_API|A_TEM|courriel transactionnel': e(evidence, 'retained'),
});

const scenes = {
  'hosting-july-2026': {
    nodes: {
      ...hostingSpine('historical', 'active'),
      A_URL: A(IMMO, 'endpoint', 'historical', 'active', 'url',
        { code: 'URL', role: 'Route · production', name: 'immo.sent-tech.ca', detail: 'route publique · TLS' }),
      A_SCW: BOX(PLATFORM, 'historical', 'active', { code: 'SCW', name: 'cluster Scaleway' }),
      A_PROD: BOX(IMMO, 'historical', 'active', { code: 'PROD', name: 'namespaces production' }),
      A_MINIO: A(IMMO, 'store', 'historical', 'active', 's3',
        { code: 'MINIO', role: 'Stockage · interne', name: 'radar-minio · PVC', detail: 'stockage objet interne · PVC' }),
      A_RAW: A(IMMO, 'store', 'historical', 'active', 's3',
        { code: 'RAW', role: 'Bucket · raw', name: 'radar-immobilier-raw', detail: 'état API · objets bruts' }),
      A_DOCS: A(IMMO, 'store', 'historical', 'active', 's3',
        { code: 'DOCS', role: 'Bucket · documents', name: 'radar-immobilier-docs', detail: 'documents dérivés' }),
      A_SCWREG: A(IMMO, 'registry', 'historical', 'active', 'release',
        { code: 'SCW-REG', role: "Registre d'images", name: 'registre Scaleway', detail: 'images applicatives' }),
      A_GRAPH_S3: A(IMMO, 'store', 'historical', 'active', 's3',
        { code: 'GRAPH', role: 'Bucket · graphe', name: 'graph (Scaleway)', detail: 'corpus et graphe' }),
      A_DOCS_S3: A(IMMO, 'store', 'historical', 'active', 's3',
        { code: 'DOCS-POCS', role: 'Bucket · docs', name: 'docs-pocs (Scaleway)', detail: 'source canonique PDF' }),
      A_GEO_S3: A(GEO, 'store', 'historical', 'active', 's3',
        { code: 'GEO-S3', role: 'Bucket · géo', name: 'sentropic-geo (SCW)', detail: 'corpus et produits' }),
      A_WS: A(IMMO, 'workstation', 'historical', 'manual', 'workstation',
        { code: 'WS-IMMO', role: 'Poste · manuel', name: 'poste opérateur', detail: 'Graphify local · étape 3' }),
      A_TEM: A(IMMO, 'exception', 'historical', 'retained', 'release',
        { code: 'SCW-TEM', role: 'Courriel · exception', name: 'Scaleway TEM', detail: 'transactionnel · seule exception' }),
    },
    edges: {
      ...hostingSpineEdges('historical', 'active'),
      'A_SCWREG|A_API|images': e('historical', 'active'),
      'A_SCWREG|A_UI|images': e('historical', 'active'),
      'A_SCWREG|A_GEO|images': e('historical', 'active'),
    },
  },
  'hosting-august-20260810': {
    nodes: {
      ...hostingSpine('historical', 'active'),
      A_URL: A(IMMO, 'endpoint', 'historical', 'active', 'url',
        { code: 'URL', role: 'Route · production', name: 'immo.sent-tech.ca', detail: 'route publique · TLS' }),
      A_OVH: BOX(PLATFORM, 'historical', 'active', { code: 'OVH', name: 'cluster poc-ca' }),
      A_PROD: BOX(IMMO, 'historical', 'active', { code: 'PROD', name: 'namespaces production' }),
      A_MINIO: A(IMMO, 'store', 'historical', 'active', 's3',
        { code: 'MINIO', role: 'Stockage · interne', name: 'radar-minio · PVC', detail: 'stockage objet interne · PVC' }),
      A_RAW: A(IMMO, 'store', 'historical', 'active', 's3',
        { code: 'RAW', role: 'Bucket · raw', name: 'radar-immobilier-raw', detail: 'état API · objets bruts' }),
      A_DOCS: A(IMMO, 'store', 'historical', 'active', 's3',
        { code: 'DOCS', role: 'Bucket · documents', name: 'radar-immobilier-docs', detail: 'documents dérivés' }),
      A_REG: A(IMMO, 'registry', 'unknown', 'unknown', 'release',
        { code: 'REG', role: "Registre d'images", name: 'registre applicatif', detail: 'bascule SCW → GHCR' }),
      A_GRAPH_S3: A(IMMO, 'store', 'historical', 'active', 's3',
        { code: 'GRAPH', role: 'Bucket · graphe', name: 'graph (OVH S3)', detail: 'corpus et graphe' }),
      A_DOCS_S3: A(IMMO, 'store', 'historical', 'active', 's3',
        { code: 'DOCS-POCS', role: 'Bucket · docs', name: 'docs-pocs (Scaleway)', detail: 'source canonique PDF' }),
      A_GEO_S3: A(GEO, 'store', 'historical', 'active', 's3',
        { code: 'GEO-S3', role: 'Bucket · géo', name: 'sentropic-geo (OVH)', detail: 'corpus et produits' }),
      A_WS: A(IMMO, 'workstation', 'historical', 'manual', 'workstation',
        { code: 'WS-IMMO', role: 'Poste · manuel', name: 'poste opérateur', detail: 'Graphify local · étape 3' }),
      A_TEM: A(IMMO, 'exception', 'historical', 'retained', 'release',
        { code: 'SCW-TEM', role: 'Courriel · exception', name: 'Scaleway TEM', detail: 'transactionnel · seule exception' }),
    },
    edges: {
      ...hostingSpineEdges('historical', 'active'),
      'A_REG|A_API|images': e('unknown', 'unknown'),
      'A_REG|A_UI|images': e('unknown', 'unknown'),
      'A_REG|A_GEO|images': e('unknown', 'unknown'),
    },
  },
  'hosting-today-20260913': {
    nodes: {
      A_USER: A(EXT, 'actor', 'external', 'not-applicable', 'user',
        { code: 'USER', role: 'Navigateur', name: 'Navigateur utilisateur', detail: 'accès web · hors cluster' }),
      A_PP_URL: A(IMMO, 'endpoint', 'observed', 'active', 'url',
        { code: 'PP-URL', role: 'Route · préprod', name: 'preprod.immo.sent-tech.ca', detail: 'route préprod · TLS' }),
      A_URL: A(IMMO, 'endpoint', 'observed', 'active', 'url',
        { code: 'URL', role: 'Route · production', name: 'immo.sent-tech.ca', detail: 'route publique · TLS' }),
      A_OVH: BOX(PLATFORM, 'observed', 'active', { code: 'OVH', name: 'cluster poc-ca · 1 r2-15' }),
      A_EDGE: A(PLATFORM, 'network', 'observed', 'active', 'network',
        { code: 'EDGE', role: 'Réseau · entrée', name: 'Load balancer → Traefik', detail: 'TLS · deux hôtes servis' }),
      A_PREPROD: BOX(IMMO, 'observed', 'active', { code: 'PP', name: 'namespaces préproduction' }),
      A_PP_UI: A(IMMO, 'service', 'observed', 'active', 'web',
        { code: 'PP-UI', role: 'Interface · préprod', name: 'radar-ui', detail: 'route / · préproduction' }),
      A_PP_API: A(IMMO, 'service', 'observed', 'active', 'api',
        { code: 'PP-API', role: 'API · préproduction', name: 'radar-api', detail: 'route /api · préprod' }),
      A_PP_DB: A(IMMO, 'store', 'observed', 'active', 'postgres',
        { code: 'PP-DB', role: 'Base · préprod', name: 'radar-postgres', detail: 'PostgreSQL · PostGIS' }),
      A_PP_SCRAPE: A(IMMO, 'schedule', 'observed', 'active', 'cronjob',
        { code: 'PP-SCRAPE', role: 'CronJob · collecte', name: 'radar-refresh-scrape', detail: '03:17 UTC · étapes 1 et 2' }),
      A_PP_PROJECT: A(IMMO, 'schedule', 'observed', 'active', 'cronjob',
        { code: 'PP-PROJECT', role: 'CronJob · projection', name: 'radar-refresh-projection', detail: '04:30 UTC · étape 4' }),
      A_PP_SSO: A(SSO, 'service', 'observed', 'active', 'identity',
        { code: 'PP-IDP', role: 'Identité · préprod', name: 'sentropic-preprod · auth-idp', detail: 'login et JWKS préprod' }),
      A_PP_SSO_DB: A(SSO, 'store', 'observed', 'active', 'postgres',
        { code: 'PP-SSO-DB', role: 'Base · SSO préprod', name: 'PostgreSQL SSO', detail: 'sessions préprod' }),
      A_PP_GEO: A(GEO, 'service', 'observed', 'active', 'api',
        { code: 'PP-GEO', role: 'API · géographie', name: 'geo-api · geo-preprod', detail: 'OGC · préproduction' }),
      A_PROD: BOX(IMMO, 'observed', 'active', { code: 'PR', name: 'namespaces production' }),
      A_PR_UI: A(IMMO, 'service', 'observed', 'active', 'web',
        { code: 'PR-UI', role: 'Interface · production', name: 'radar-ui', detail: 'route / · immo.sent-tech.ca' }),
      A_PR_API: A(IMMO, 'service', 'observed', 'active', 'api',
        { code: 'PR-API', role: 'API · production', name: 'radar-api', detail: 'route /api · production' }),
      A_PR_DB: A(IMMO, 'store', 'observed', 'active', 'postgres',
        { code: 'PR-DB', role: 'Base · production', name: 'radar-postgres', detail: 'PostgreSQL · PostGIS' }),
      A_PR_REFRESH: A(IMMO, 'schedule', 'declared', 'dormant', 'cronjob',
        { code: 'PR-REFRESH', role: 'CronJob · production', name: 'refresh production', detail: 'dormant · gaté par PR #682' }),
      A_SSO: A(SSO, 'service', 'observed', 'active', 'identity',
        { code: 'IDP', role: 'Identité · OIDC', name: 'sentropic · auth-idp', detail: 'redirection login · JWKS' }),
      A_SSO_DB: A(SSO, 'store', 'observed', 'active', 'postgres',
        { code: 'PR-SSO-DB', role: 'Base · SSO prod', name: 'PostgreSQL SSO', detail: 'sessions production' }),
      A_GEO: A(GEO, 'service', 'observed', 'active', 'api',
        { code: 'GEO-API', role: 'API · géographie', name: 'geo-api · geo', detail: 'OGC · couches et tuiles' }),
      A_GEO_DB: A(GEO, 'store', 'observed', 'active', 'postgres',
        { code: 'GEO-DB', role: 'Base · géographie', name: 'geo / postgis', detail: 'PostgreSQL · PostGIS' }),
      A_GHCR: A(IMMO, 'registry', 'observed', 'active', 'release',
        { code: 'GHCR', role: "Registre d'images", name: 'registres applicatifs', detail: 'images de conteneur' }),
      A_PP_RAW: A(IMMO, 'store', 'observed', 'active', 's3',
        { code: 'PP-RAW-OVH', role: 'Bucket · raw', name: 'raw préprod', detail: 'OVH S3 · objets bruts' }),
      A_PP_S3: A(IMMO, 'store', 'observed', 'active', 's3',
        { code: 'PP-DOCS-OVH', role: 'Bucket · documents', name: 'docs préprod', detail: 'OVH S3 · 59 017 clés' }),
      A_PP_GRAPH: A(IMMO, 'store', 'observed', 'active', 's3',
        { code: 'PP-GRAPH', role: 'Bucket · graphe', name: 'graph-preprod', detail: 'OVH S3 · corpus graphe' }),
      A_PR_RAW: A(IMMO, 'store', 'observed', 'active', 's3',
        { code: 'PR-RAW-OVH', role: 'Bucket · raw', name: 'raw production', detail: 'OVH S3 · objets bruts' }),
      A_PR_S3: A(IMMO, 'store', 'observed', 'active', 's3',
        { code: 'PR-DOCS-OVH', role: 'Bucket S3 · docs prod', name: 'docs production', detail: 'OVH S3 · 59 017 clés' }),
      A_PP_GEO_S3: A(GEO, 'store', 'observed', 'active', 's3',
        { code: 'PP-GEO-S3', role: 'Bucket · géo', name: 'geo-preprod', detail: 'OVH S3 · copie service' }),
      A_GEO_S3: A(GEO, 'store', 'observed', 'active', 's3',
        { code: 'GEO-S3', role: 'Bucket · géo', name: 'sentropic-geo', detail: 'OVH S3 · produits geo' }),
      A_WS: A(IMMO, 'workstation', 'observed', 'manual', 'workstation',
        { code: 'WS-ADMIN', role: 'Poste · administration', name: 'poste opérateur', detail: 'sans exécution LLM' }),
      A_TEM: A(IMMO, 'exception', 'observed', 'retained', 'release',
        { code: 'SCW-TEM', role: 'Courriel · exception', name: 'Scaleway TEM', detail: 'transactionnel · seule exception' }),
    },
    edges: {
      'A_USER|A_PP_URL|': e('observed', 'active'),
      'A_USER|A_URL|': e('observed', 'active'),
      'A_PP_URL|A_EDGE|': e('observed', 'active'),
      'A_URL|A_EDGE|': e('observed', 'active'),
      'A_USER|A_SSO|Redirection login': e('observed', 'active'),
      'A_EDGE|A_PP_UI|': e('observed', 'active'),
      'A_EDGE|A_PR_UI|': e('observed', 'active'),
      'A_PP_UI|A_PP_API|/api': e('observed', 'active'),
      'A_PP_API|A_PP_DB|SQL': e('observed', 'active'),
      'A_PP_API|A_PP_RAW|objets RAW': e('observed', 'active'),
      'A_PP_API|A_PP_S3|documents canoniques': e('observed', 'active'),
      'A_PP_SCRAPE|A_PP_GRAPH|étapes 1 et 2': e('observed', 'active'),
      'A_PP_GRAPH|A_PP_PROJECT|': e('observed', 'active'),
      'A_PP_PROJECT|A_PP_DB|étape 4 · upsert': e('observed', 'active'),
      'A_PP_API|A_PP_SSO|OIDC / JWKS': e('observed', 'active'),
      'A_PP_SSO|A_PP_SSO_DB|sessions': e('observed', 'active'),
      'A_PP_UI|A_PP_GEO|OGC': e('observed', 'active'),
      'A_PP_GEO|A_PP_GEO_S3|lecture produits': e('observed', 'active'),
      'A_PR_UI|A_PR_API|/api': e('observed', 'active'),
      'A_PR_API|A_PR_DB|SQL': e('observed', 'active'),
      'A_PR_API|A_PR_RAW|objets RAW': e('observed', 'active'),
      'A_PR_API|A_PR_S3|documents canoniques': e('observed', 'active'),
      'A_PR_REFRESH|A_PR_DB|étapes 1 à 4': e('declared', 'dormant'),
      'A_PR_API|A_SSO|OIDC / JWKS': e('observed', 'active'),
      'A_SSO|A_SSO_DB|sessions': e('observed', 'active'),
      'A_PR_UI|A_GEO|OGC': e('observed', 'active'),
      'A_GEO|A_GEO_DB|SQL': e('observed', 'active'),
      'A_GEO|A_GEO_S3|lecture produits': e('observed', 'active'),
      'A_GHCR|A_PP_API|images': e('observed', 'active'),
      'A_GHCR|A_PR_API|images': e('observed', 'active'),
      'A_GHCR|A_GEO|images': e('observed', 'active'),
      'A_WS|A_PP_API|administration': e('declared', 'manual'),
      'A_PR_API|A_TEM|courriel transactionnel': e('observed', 'retained'),
    },
  },
  'pipeline-before-20260810': {
    nodes: {
      B_CITY: A(EXT, 'source', 'external', 'not-applicable', 'document',
        { code: 'CITY', role: 'Source · amont', name: 'Sources municipales', detail: 'PV publiés · amont' }),
      B_WORKSTATION: BOX(IMMO, 'historical', 'manual', { code: 'WS-OPS', name: 'poste opérateur' }),
      B_OPS: A(IMMO, 'workstation', 'historical', 'manual', 'workstation',
        { code: 'WS-OPS', role: 'Poste · manuel', name: 'Graphify 2.3 en local', detail: 'collecte · extraction · projection' }),
      B_OPERATOR: A(EXT, 'actor', 'external', 'manual', 'user',
        { code: 'OPER', role: 'Acteur · humain', name: 'Opérateur', detail: 'pilote à la main' }),
      B_EXTRACT: A(IMMO, 'process', 'historical', 'manual', 'llm',
        { code: 'WS-EXTRACT', role: 'Étape 3 · extraction', name: 'Graphify 2.3 local', detail: 'appels LLM du poste' }),
      B_KEYS: A(IMMO, 'identity', 'historical', 'manual', 'identity',
        { code: 'WS-KEYS', role: 'Secrets · locaux', name: 'Clés LLM du poste', detail: 'hors cluster · locales' }),
      B_OVH: BOX(PLATFORM, 'historical', 'active', { code: 'OVH', name: 'cluster poc-ca' }),
      B_EDGE: A(PLATFORM, 'network', 'historical', 'active', 'network',
        { code: 'EDGE', role: 'Réseau · entrée', name: 'Load balancer → Traefik', detail: 'TLS · routage des hôtes' }),
      B_PROD: BOX(IMMO, 'historical', 'active', { code: 'PR', name: 'namespaces production' }),
      B_COLLECT: A(IMMO, 'process', 'historical', 'manual', 'document',
        { code: 'STEP-1', role: 'Étape 1 · collecte', name: 'collecte in-cluster', detail: 'lancée depuis le poste' }),
      B_PARSE: A(IMMO, 'process', 'historical', 'manual', 'document',
        { code: 'STEP-2', role: 'Étape 2 · parse', name: 'parse / exploit', detail: 'in-cluster · enchaînée' }),
      B_PROJECT: A(IMMO, 'process', 'historical', 'manual', 'graph',
        { code: 'STEP-4', role: 'Étape 4 · projection', name: 'projection manuelle', detail: 'upsert lancé du poste' }),
      B_DB: A(IMMO, 'store', 'historical', 'active', 'postgres',
        { code: 'DB', role: 'Base · graphe', name: 'PostgreSQL graphe', detail: 'graphe servi' }),
      B_API: A(IMMO, 'service', 'historical', 'active', 'api',
        { code: 'API', role: 'API · production', name: 'radar-api', detail: 'sert le graphe à l’UI' }),
      B_UI: A(IMMO, 'service', 'historical', 'active', 'web',
        { code: 'UI', role: 'Interface · web', name: 'radar-ui', detail: 'route / · immo.sent-tech.ca' }),
      B_CORPUS: A(IMMO, 'store', 'historical', 'manual', 'document',
        { code: 'CORPUS', role: 'Corpus · preuves', name: 'Corpus PV', detail: 'CAS / parsed' }),
      B_GRAPH: A(IMMO, 'store', 'historical', 'manual', 'graph',
        { code: 'GRAPH', role: 'Artefact · graphe', name: 'Contrat de graphe', detail: 'publié à l’étape 3' }),
      B_PROVIDERS: A(EXT, 'service', 'external', 'manual', 'llm',
        { code: 'LLM', role: 'Fournisseurs · LLM', name: 'Fournisseurs de modèles', detail: 'appelés du poste' }),
      B_SCHEDULE: A(IMMO, 'schedule', 'historical', 'manual', 'cronjob',
        { code: 'SCHED', role: 'Planification · absente', name: 'automatisation', detail: 'déclarée · jamais lancée' }),
      B_USER: A(EXT, 'actor', 'external', 'not-applicable', 'user',
        { code: 'USER', role: 'Navigateur', name: 'Navigateur utilisateur', detail: 'accès web · hors cluster' }),
      B_TEM: A(IMMO, 'exception', 'historical', 'retained', 'release',
        { code: 'SCW-TEM', role: 'Courriel · exception', name: 'Scaleway TEM', detail: 'transactionnel · seule exception' }),
    },
    edges: {
      'B_CITY|B_COLLECT|': e('historical', 'manual'),
      'B_COLLECT|B_PARSE|': e('historical', 'manual'),
      'B_PARSE|B_CORPUS|': e('historical', 'manual'),
      'B_OPERATOR|B_OPS|pilotage': e('historical', 'manual'),
      'B_OPS|B_EXTRACT|étape 3 sur le poste': e('historical', 'manual'),
      'B_CORPUS|B_EXTRACT|lecture des preuves': e('historical', 'manual'),
      'B_KEYS|B_EXTRACT|': e('historical', 'manual'),
      'B_EXTRACT|B_PROVIDERS|appels depuis le poste': e('historical', 'manual'),
      'B_EXTRACT|B_GRAPH|graphe validé': e('historical', 'manual'),
      'B_GRAPH|B_PROJECT|': e('historical', 'manual'),
      'B_OPS|B_COLLECT|lancement manuel': e('historical', 'manual'),
      'B_OPS|B_PROJECT|lancement manuel': e('historical', 'manual'),
      'B_PROJECT|B_DB|upsert atomique': e('historical', 'manual'),
      'B_DB|B_API|': e('historical', 'active'),
      'B_API|B_UI|': e('historical', 'active'),
      'B_EDGE|B_UI|': e('historical', 'active'),
      'B_UI|B_USER|immo.sent-tech.ca': e('historical', 'active'),
      'B_SCHEDULE|B_COLLECT|déclaré seulement': e('declared', 'manual'),
      'B_SCHEDULE|B_PROJECT|déclaré seulement': e('declared', 'manual'),
    },
  },
  'pipeline-after-20260913': {
    nodes: {
      B_CITY: A(EXT, 'source', 'external', 'not-applicable', 'document',
        { code: 'CITY', role: 'Source · amont', name: 'Sources municipales', detail: 'PV publiés · amont' }),
      B_OVH: BOX(PLATFORM, 'observed', 'active', { code: 'OVH', name: 'cluster poc-ca' }),
      B_EDGE: A(PLATFORM, 'network', 'observed', 'active', 'network',
        { code: 'EDGE', role: 'Réseau · entrée', name: 'Load balancer → Traefik', detail: 'TLS · routage des hôtes' }),
      B_PREPROD: BOX(IMMO, 'observed', 'active', { code: 'PP', name: 'namespaces préproduction' }),
      B_CRON: A(IMMO, 'schedule', 'observed', 'active', 'cronjob',
        { code: 'CRON', role: 'CronJob · planifié', name: 'radar-refresh-pv', detail: '05:17 UTC · étapes 1 à 4' }),
      B_DRIVER: A(IMMO, 'process', 'observed', 'active', 'cronjob',
        { code: 'DRIVER', role: 'Pilote · autonome', name: 'run in-cluster', detail: 'enchaîne les 4 étapes' }),
      B_COLLECT: A(IMMO, 'process', 'observed', 'active', 'document',
        { code: 'STEP-1', role: 'Étape 1 · collecte', name: 'collecte intégrée', detail: 'déclenchée par le CronJob' }),
      B_PARSE: A(IMMO, 'process', 'observed', 'active', 'document',
        { code: 'STEP-2', role: 'Étape 2 · parse', name: 'parse / exploit', detail: 'in-cluster · enchaînée' }),
      B_GRAPHIFY: A(IMMO, 'process', 'observed', 'active', 'graph',
        { code: 'STEP-3', role: 'Étape 3 · extraction', name: 'Graphify 0.18.0', detail: 'bibliothèque in-process' }),
      B_MESH: A(IMMO, 'process', 'observed', 'active', 'llm',
        { code: 'MESH', role: 'Modèles · in-process', name: 'llm-mesh 0.19.1', detail: 'appels depuis le cluster' }),
      B_VALIDATE: A(IMMO, 'process', 'observed', 'active', 'check',
        { code: 'CHECK', role: 'Contrôle · qualité', name: 'validation Signal / PDF', detail: 'refus avant projection' }),
      B_PROJECT: A(IMMO, 'process', 'observed', 'active', 'graph',
        { code: 'STEP-4', role: 'Étape 4 · projection', name: 'projection atomique', detail: 'upsert sans interruption' }),
      B_KEYRING: A(IMMO, 'identity', 'observed', 'active', 'identity',
        { code: 'KEYRING', role: 'Secrets · cluster', name: 'Keyring radar', detail: 'secrets chiffrés' }),
      B_DB: A(IMMO, 'store', 'observed', 'active', 'postgres',
        { code: 'DB', role: 'Base · graphe', name: 'PostgreSQL graphe', detail: 'graphe servi' }),
      B_API: A(IMMO, 'service', 'observed', 'active', 'api',
        { code: 'API', role: 'API · production', name: 'radar-api', detail: 'sert le graphe à l’UI' }),
      B_UI: A(IMMO, 'service', 'observed', 'active', 'web',
        { code: 'UI', role: 'Interface · web', name: 'radar-ui', detail: 'route / · immo.sent-tech.ca' }),
      B_PROD: BOX(IMMO, 'dormant', 'dormant', { code: 'PR', name: 'namespaces production' }),
      B_PROMOTION: A(IMMO, 'decision', 'dormant', 'dormant', 'check',
        { code: 'PROMO', role: 'Décision · promotion', name: 'PR #682', detail: 'promotion non faite' }),
      B_PROD_CRON: A(IMMO, 'schedule', 'dormant', 'dormant', 'cronjob',
        { code: 'PROD-CRON', role: 'CronJob · production', name: 'refresh production', detail: 'dormant · gaté par PR #682' }),
      B_CORPUS: A(IMMO, 'store', 'observed', 'active', 'document',
        { code: 'CORPUS', role: 'Corpus · preuves', name: 'Corpus PV durable', detail: 'CAS / parsed' }),
      B_GRAPH: A(IMMO, 'store', 'observed', 'active', 'graph',
        { code: 'GRAPH', role: 'Artefact · graphe', name: 'Graphe canonique', detail: 'publié après contrôle' }),
      B_PROVIDERS: A(EXT, 'service', 'external', 'active', 'llm',
        { code: 'LLM', role: 'Fournisseurs · LLM', name: 'Fournisseurs de modèles', detail: 'appelés du cluster' }),
      B_WS: A(IMMO, 'workstation', 'observed', 'manual', 'workstation',
        { code: 'WS-ADMIN', role: 'Poste · administration', name: 'poste opérateur', detail: 'aucune étape · enrôlement' }),
      B_USER: A(EXT, 'actor', 'external', 'not-applicable', 'user',
        { code: 'USER', role: 'Navigateur', name: 'Navigateur utilisateur', detail: 'accès web · hors cluster' }),
      B_TEM: A(IMMO, 'exception', 'observed', 'retained', 'release',
        { code: 'SCW-TEM', role: 'Courriel · exception', name: 'Scaleway TEM', detail: 'transactionnel · seule exception' }),
    },
    edges: {
      'B_CRON|B_DRIVER|': e('observed', 'active'),
      'B_DRIVER|B_COLLECT|': e('observed', 'active'),
      'B_CITY|B_COLLECT|': e('observed', 'active'),
      'B_COLLECT|B_PARSE|': e('observed', 'active'),
      'B_PARSE|B_CORPUS|': e('observed', 'active'),
      'B_DRIVER|B_GRAPHIFY|': e('observed', 'active'),
      'B_CORPUS|B_GRAPHIFY|lecture des preuves': e('observed', 'active'),
      'B_GRAPHIFY|B_MESH|': e('observed', 'active'),
      'B_KEYRING|B_MESH|': e('observed', 'active'),
      'B_MESH|B_PROVIDERS|appels in-cluster': e('observed', 'active'),
      'B_MESH|B_VALIDATE|': e('observed', 'active'),
      'B_VALIDATE|B_GRAPH|graphe validé': e('observed', 'active'),
      'B_GRAPH|B_PROJECT|': e('observed', 'active'),
      'B_PROJECT|B_DB|upsert atomique': e('observed', 'active'),
      'B_DB|B_API|': e('observed', 'active'),
      'B_API|B_UI|': e('observed', 'active'),
      'B_EDGE|B_UI|': e('observed', 'active'),
      'B_UI|B_USER|immo.sent-tech.ca': e('observed', 'active'),
      'B_PROMOTION|B_PROD_CRON|promotion non effectuée': e('dormant', 'dormant'),
      'B_WS|B_KEYRING|enrôlement seulement': e('declared', 'manual'),
    },
  },
};

const TEMPLATES = new Set(['A', 'box']);
// A role title stays short: at most two segments around `·`, at most two words
// per segment — « Base · préprod », « Bucket S3 · docs prod », « Navigateur ».
export const roleSegments = role => role.split('·').map(part => part.trim()).filter(Boolean);
export const roleIsShort = role => {
  const segments = roleSegments(role);
  return segments.length > 0 && segments.length <= 2 && segments.every(part => part.split(/\s+/).length <= 2);
};

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
  // The card contract is checked at the source, before any layout runs.
  for (const [id, value] of Object.entries(scene.nodes)) {
    if (!TEMPLATES.has(value.card)) throw Error(`${graph.id}/${id}: unknown card template ${value.card}`);
    const isGroup = groupIds.has(id);
    if (isGroup !== (value.card === 'box')) throw Error(`${graph.id}/${id}: container and template disagree`);
    if (value.card === 'box') {
      if (value.role) throw Error(`${graph.id}/${id}: a container carries no role title`);
      continue;
    }
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
