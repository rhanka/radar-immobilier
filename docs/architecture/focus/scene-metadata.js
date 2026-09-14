import { edgeId } from './parse-mermaid.mjs';

const EVIDENCE = new Set(['observed', 'declared', 'historical', 'dormant', 'unknown', 'external']);
const RUNTIME = new Set(['active', 'suspended', 'dormant', 'manual', 'retained', 'unknown', 'not-applicable']);
const m = (kind, repo, evidenceClass, runtimeState, icon, role) => ({ kind, repo: [...repo].sort(), evidenceClass, runtimeState, icon, role });
const e = (evidenceClass, runtimeState) => ({ evidenceClass, runtimeState });
const ext = (kind, icon, role, runtime = 'not-applicable') => m(kind, ['external'], 'external', runtime, icon, role);
const immo = (kind, evidence, runtime, icon, role) => m(kind, ['radar-immobilier'], evidence, runtime, icon, role);
const geo = (kind, evidence, runtime, icon, role) => m(kind, ['geo'], evidence, runtime, icon, role);
const platform = (kind, evidence, runtime, icon, role) => m(kind, ['poc-k8s'], evidence, runtime, icon, role);
const sso = (kind, evidence, runtime, icon, role) => m(kind, ['sentropic'], evidence, runtime, icon, role);

const scenes = {
  'storage-before-20260809': {
    nodes: {
      A_USER: ext('actor', 'user', 'Accès utilisateur'),
      A_URL: immo('endpoint', 'declared', 'unknown', 'url', 'Route applicative déclarée'),
      A_CLOUD: platform('cluster', 'declared', 'unknown', 'cluster', 'Topologie de plateforme déclarée'),
      A_EDGE: platform('network', 'declared', 'unknown', 'network', 'Ingress et TLS déclarés'),
      A_IMMO: immo('cluster', 'declared', 'unknown', 'cluster', 'Périmètre applicatif déclaré'),
      A_UI: immo('service', 'declared', 'unknown', 'web', 'Interface déclarée'),
      A_API: immo('service', 'declared', 'unknown', 'api', 'API déclarée'),
      A_DB: immo('store', 'declared', 'unknown', 'postgres', 'Base déclarée'),
      A_MINIO: immo('store', 'declared', 'unknown', 's3', 'Objet/PVC déclaré'),
      A_CLIENTS: immo('service', 'declared', 'suspended', 'api', 'Clients stockage déclarés'),
      A_SSO: sso('service', 'declared', 'unknown', 'identity', 'Identité déclarée'),
      A_GEO: geo('service', 'declared', 'unknown', 'api', 'Dépendance Geo déclarée'),
      A_CAPACITY: platform('note', 'observed', 'active', 'check', 'Capacité observée seulement'),
      A_GEOS3: geo('store', 'declared', 'unknown', 's3', 'Stockage Geo déclaré'),
      A_SCWGRAPH: immo('store', 'declared', 'suspended', 's3', 'Coordonnées graph déclarées'),
      A_SCWDOCS: immo('store', 'declared', 'unknown', 's3', 'Contrat scrape déclaré'),
      A_SCWREG: immo('registry', 'declared', 'unknown', 'release', 'Registre déclaré'),
      A_GHCR: immo('registry', 'declared', 'unknown', 'release', 'Miroir best-effort déclaré'),
      A_TEM: immo('exception', 'declared', 'retained', 'release', 'Exception email résiduelle'),
    },
    edges: {
      'A_USER|A_URL|Declared public route': e('declared', 'unknown'),
      'A_UI|A_API|Declared /api': e('declared', 'unknown'), 'A_API|A_DB|Declared SQL': e('declared', 'unknown'),
      'A_API|A_MINIO|Declared API object binding': e('declared', 'unknown'), 'A_EDGE|A_UI|Declared ingress': e('declared', 'unknown'),
      'A_EDGE|A_SSO|Declared ingress': e('declared', 'unknown'), 'A_UI|A_GEO|Declared OGC collections': e('declared', 'unknown'),
      'A_API|A_SSO|Declared OIDC / JWKS': e('declared', 'unknown'), 'A_URL|A_EDGE|Declared ingress route': e('declared', 'unknown'),
      'A_USER|A_SSO|Declared login redirects': e('declared', 'unknown'), 'A_GEO|A_GEOS3|Declared client binding': e('declared', 'unknown'),
      'A_CLIENTS|A_SCWGRAPH|Declared graph binding; suspended': e('declared', 'suspended'),
      'A_CLIENTS|A_SCWDOCS|Declared scrape contract; secret not audited': e('declared', 'unknown'),
      'A_SCWREG|A_API|Declared image source': e('declared', 'unknown'), 'A_SCWREG|A_UI|Declared image source': e('declared', 'unknown'),
      'A_SCWREG|A_GHCR|Declared best-effort mirror; success unknown': e('declared', 'unknown'),
      'A_API|A_TEM|Transactional email · declared': e('declared', 'retained'),
    },
  },
  'storage-after-20260913': {
    nodes: {
      A_USER: ext('actor', 'user', 'Accès utilisateur'), A_URL: immo('endpoint', 'observed', 'active', 'url', 'Route production'),
      A_CLOUD: platform('cluster', 'observed', 'active', 'cluster', 'Plateforme production'), A_EDGE: platform('network', 'observed', 'active', 'network', 'Ingress/TLS'),
      A_IMMO: immo('cluster', 'observed', 'active', 'cluster', 'Périmètre applicatif'), A_UI: immo('service', 'observed', 'active', 'web', 'Interface'),
      A_API: immo('service', 'observed', 'active', 'api', 'API'), A_DB: immo('store', 'declared', 'active', 'postgres', 'Base applicative'),
      A_CLIENTS: immo('service', 'observed', 'active', 'api', 'Clients OVH'), A_SSO: sso('service', 'observed', 'active', 'identity', 'Identité'),
      A_GEO: geo('service', 'observed', 'active', 'api', 'Dépendance stable'), A_GEOS3: geo('store', 'historical', 'active', 's3', 'Stockage Geo inchangé'),
      A_DOCS: immo('store', 'observed', 'active', 's3', 'Store canonique OVH'), A_GHCR: immo('registry', 'declared', 'active', 'release', 'Registre intégré'),
      A_TEM: immo('exception', 'observed', 'retained', 'release', 'Exception email résiduelle'),
    },
    edges: {
      'A_USER|A_URL|': e('observed', 'active'), 'A_UI|A_API|/api': e('observed', 'active'), 'A_API|A_DB|SQL': e('declared', 'active'),
      'A_EDGE|A_UI|': e('observed', 'active'), 'A_EDGE|A_SSO|': e('observed', 'active'), 'A_UI|A_GEO|OGC collections': e('observed', 'active'),
      'A_API|A_SSO|OIDC / JWKS': e('observed', 'active'), 'A_URL|A_EDGE|': e('observed', 'active'),
      'A_USER|A_SSO|Login redirects': e('observed', 'active'), 'A_GEO|A_GEOS3|': e('historical', 'active'),
      'A_API|A_DOCS|Dedicated S3 binding; rolled out': e('observed', 'active'),
      'A_CLIENTS|A_DOCS|GRAPH / SCRAPE coordinates observed': e('observed', 'active'),
      'A_GHCR|A_API|Integrated image source': e('declared', 'active'), 'A_GHCR|A_UI|Integrated image source': e('declared', 'active'),
      'A_API|A_TEM|Transactional email · retained': e('observed', 'retained'),
    },
  },
  'refresh-before-20260809': {
    nodes: {
      B_CITY: ext('source', 'document', 'Sources municipales'), B_COLLECT: immo('process', 'historical', 'manual', 'document', 'Collecte manuelle'),
      B_CORPUS: immo('store', 'historical', 'manual', 'document', 'Corpus fonctionnel'), B_WORKSTATION: immo('cluster', 'historical', 'manual', 'workstation', 'Poste opérateur'),
      B_OPERATOR: ext('actor', 'user', 'Opérateur', 'manual'), B_EXTRACT: immo('process', 'historical', 'manual', 'llm', 'Agents Graphify'),
      B_GRAPH: immo('store', 'historical', 'manual', 'graph', 'Contrat de graphe publié'), B_CLOUD: platform('cluster', 'declared', 'active', 'cluster', 'Production Immo'),
      B_PROJECT: immo('process', 'historical', 'manual', 'graph', 'Projection manuelle'), B_DB: immo('store', 'declared', 'active', 'postgres', 'Graphe servi'),
      B_SCHEDULE: immo('schedule', 'declared', 'suspended', 'cronjob', 'CronJobs suspendus'), B_API: immo('service', 'declared', 'active', 'api', 'API'),
      B_UI: immo('service', 'declared', 'active', 'web', 'Interface'), B_USER: ext('actor', 'user', 'Navigateur'),
      B_TEM: immo('exception', 'historical', 'retained', 'release', 'Exception transverse'),
    },
    edges: {
      'B_CITY|B_COLLECT|': e('historical', 'manual'), 'B_COLLECT|B_CORPUS|': e('historical', 'manual'),
      'B_OPERATOR|B_EXTRACT|': e('historical', 'manual'), 'B_CORPUS|B_EXTRACT|Read source evidence': e('historical', 'manual'),
      'B_EXTRACT|B_GRAPH|Validated graph output': e('historical', 'manual'), 'B_PROJECT|B_DB|Atomic upsert': e('historical', 'manual'),
      'B_DB|B_API|': e('declared', 'active'), 'B_API|B_UI|': e('declared', 'active'), 'B_GRAPH|B_PROJECT|': e('historical', 'manual'),
      'B_OPERATOR|B_PROJECT|Manual launch; no scheduled success inferred': e('historical', 'manual'),
      'B_SCHEDULE|B_COLLECT|Declared only': e('declared', 'suspended'), 'B_SCHEDULE|B_PROJECT|Declared only': e('declared', 'suspended'),
      'B_UI|B_USER|immo.sent-tech.ca': e('declared', 'active'),
    },
  },
  'refresh-after-20260913': {
    nodes: {
      B_CITY: ext('source', 'document', 'Sources municipales'), B_CORPUS: immo('store', 'dormant', 'dormant', 'document', 'Corpus durable neutre'),
      B_WORKSTATION: immo('cluster', 'observed', 'manual', 'workstation', 'Administration seulement'), B_OPERATOR: ext('actor', 'user', 'Enrôlement', 'manual'),
      B_IDENTITY: immo('identity', 'dormant', 'dormant', 'identity', 'Identité workload'), B_CLOUD: platform('cluster', 'declared', 'active', 'cluster', 'Production Immo'),
      B_REFRESH: immo('cluster', 'dormant', 'dormant', 'cluster', 'Sous-flux dormant'), B_CRON: immo('schedule', 'dormant', 'dormant', 'cronjob', 'CronJob gated'),
      B_DRIVER: immo('process', 'dormant', 'dormant', 'cronjob', 'Run causal'), B_COLLECT: immo('process', 'dormant', 'dormant', 'document', 'Collecte intégrée'),
      B_EXTRACT: immo('process', 'dormant', 'dormant', 'llm', 'Librairies intégrées'), B_VALIDATE: immo('process', 'dormant', 'dormant', 'check', 'Validation Signal/PDF'),
      B_PROJECT: immo('process', 'dormant', 'dormant', 'graph', 'Projection atomique'), B_DB: immo('store', 'declared', 'active', 'postgres', 'Graphe servi'),
      B_API: immo('service', 'declared', 'active', 'api', 'API'), B_UI: immo('service', 'declared', 'active', 'web', 'Interface'),
      B_MODEL: immo('decision', 'unknown', 'unknown', 'llm', 'Modèle à ratifier M1'), B_GRAPH: immo('store', 'dormant', 'dormant', 'graph', 'Graphe canonique neutre'),
      B_USER: ext('actor', 'user', 'Navigateur'), B_TEM: immo('exception', 'observed', 'retained', 'release', 'Exception transverse'),
    },
    edges: {
      'B_OPERATOR|B_IDENTITY|': e('dormant', 'dormant'), 'B_CRON|B_DRIVER|': e('dormant', 'dormant'),
      'B_DRIVER|B_EXTRACT|': e('dormant', 'dormant'), 'B_EXTRACT|B_VALIDATE|': e('dormant', 'dormant'),
      'B_PROJECT|B_DB|': e('dormant', 'dormant'), 'B_DB|B_API|': e('declared', 'active'), 'B_API|B_UI|': e('declared', 'active'),
      'B_CITY|B_COLLECT|': e('dormant', 'dormant'), 'B_COLLECT|B_CORPUS|': e('dormant', 'dormant'),
      'B_DRIVER|B_COLLECT|': e('dormant', 'dormant'), 'B_CORPUS|B_EXTRACT|': e('dormant', 'dormant'),
      'B_IDENTITY|B_EXTRACT|': e('dormant', 'dormant'), 'B_EXTRACT|B_MODEL|': e('unknown', 'unknown'),
      'B_VALIDATE|B_GRAPH|': e('dormant', 'dormant'), 'B_GRAPH|B_PROJECT|': e('dormant', 'dormant'),
      'B_UI|B_USER|immo.sent-tech.ca': e('declared', 'active'),
    },
  },
};

export function metadataFor(graph) {
  const scene = scenes[graph.id];
  if (!scene) throw Error(`missing scene metadata ${graph.id}`);
  const actualNodes = new Set([...graph.groups, ...graph.nodes].map(item => item.id));
  const expectedNodes = new Set(Object.keys(scene.nodes));
  for (const id of actualNodes) if (!expectedNodes.has(id)) throw Error(`${graph.id}: missing node metadata ${id}`);
  for (const id of expectedNodes) if (!actualNodes.has(id)) throw Error(`${graph.id}: extra node metadata ${id}`);
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
  return { nodes: scene.nodes, edges };
}

export function decorateGraph(graph) {
  const metadata = metadataFor(graph);
  for (const item of [...graph.groups, ...graph.nodes]) item.metadata = metadata.nodes[item.id];
  for (const edge of graph.edges) edge.metadata = metadata.edges[edge.id];
  return graph;
}
