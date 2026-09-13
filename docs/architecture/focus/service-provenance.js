// Repository responsibility, not proof of deployment or third-party provisioning.
// Evidence revisions and role semantics: ../service-provenance.md.
const make = (icon, service, repos, role, evidence) => ({ icon, service, repos, role, evidence });
const immo = (icon, service, role = 'Code + manifests', evidence = 'radar-immobilier:deploy/k8s/') => make(icon, service, ['radar-immobilier'], role, evidence);
const geo = (icon, service, role = 'Code + manifests', evidence = 'geo:deploy/k8s/') => make(icon, service, ['geo'], role, evidence);
const external = (icon, service) => make(icon, service, [], 'Externe · aucun repo générateur', 'architecture.md:external sources / user / provider');
const platform = (icon, service, role) => make(icon, service, ['poc-k8s'], role, 'poc-k8s:platform/overlays/ovh/; tenants/');
const sso = (icon, service) => make(icon, service, ['sentropic'], 'Code / manifests SSO', 'sentropic:deploy/k8s/base/35-auth-idp.yaml; 20-postgres.yaml');
const shared = (icon, service, role) => make(icon, service, ['radar-immobilier', 'geo'], role, 'radar-immobilier:.github/workflows/; geo:deploy/k8s/preprod/README.md');
const sharedNodes = {
  PP_UI: immo('web', 'Frontend web'), PR_UI: immo('web', 'Frontend web'),
  PP_API: immo('api', 'API Immo'), PR_API: immo('api', 'API Immo'),
  PP_DB: immo('postgres', 'PostgreSQL / PostGIS', 'Manifest DB + schéma Immo'),
  PP_RAW: immo('s3', 'S3 compatible · MinIO', 'Binding API · contenu non inventorié', 'radar-immobilier:api/src/config.ts; deploy/k8s/25-minio.yaml'),
  PP_DOCS: immo('s3', 'S3 compatible · MinIO', 'Binding dérivé · writer non vérifié', 'radar-immobilier:api/src/config.ts; api/src/routes/documents.ts'),
  PP_GRAPH: immo('s3', 'OVH Object Storage · S3', 'Configuration cliente · création hors audit', 'radar-immobilier:deploy/k8s/refresh-cronjobs/kustomization.yaml'),
  PP_SCRAPE: immo('cronjob', 'Kubernetes CronJob · collecte'),
  PP_PROJECT: immo('cronjob', 'Kubernetes CronJob · projection'),
  PP_GEO: geo('api', 'API Geo · OGC'), GEO_API: geo('api', 'API Geo · OGC'),
  GEO_DB: geo('postgres', 'PostgreSQL / PostGIS', 'Manifest DB · lien API non démontré'),
  GEO_S3: geo('s3', 'OVH Object Storage · S3', 'Configuration cliente · création hors audit', 'geo:acquisition/config/s3-target.json'),
  PP_GEO_S3: geo('s3', 'OVH Object Storage · S3', 'Configuration cliente · création hors audit', 'geo:deploy/k8s/overlays/preprod/patch-serving.yaml'),
  WS_IMMO: immo('workstation', 'Poste de travail · LLM', 'Outils Immo · bibliothèque Graphify', 'radar-immobilier:tools/graphify-v23/; tools/grounding/'),
  ppminio: immo('s3', 'MinIO · StatefulSet + PVC', 'Manifests du store S3 compatible'),
};
const views = {
  'asis-1': {
    user: external('user', 'Utilisateur / navigateur'),
    ppurl: immo('url', 'Accès HTTPS', 'Routage ingress · DNS externe'),
    prurl: immo('url', 'Accès HTTPS', 'Routage ingress · DNS externe'),
    cloud: platform('cluster', 'Cluster Kubernetes', 'Plateforme partagée · OVH'),
    edge: platform('network', 'Traefik / TLS', 'Ingress et certificats partagés'),
    preprod: platform('cluster', 'Enveloppe préproduction', 'Namespaces · workloads attribués dans les boîtes'),
    prod: platform('cluster', 'Enveloppe production', 'Namespaces · état Immo interne non audité'),
    pidp: sso('identity', 'SSO / OIDC'), idp: sso('identity', 'SSO / OIDC'),
    pidb: sso('postgres', 'PostgreSQL · SSO'), idb: sso('postgres', 'PostgreSQL · SSO'),
    prodgap: immo('unknown', 'Inventaire production manquant', 'Responsabilité Immo · runtime inconnu'),
  },
  'asis-2': {
    websites: external('document', 'Sources municipales'), provider: external('llm', 'Fournisseur LLM'),
    immo: immo('graph', 'Chaîne PV → Signaux', 'Les quatre étapes appartiennent à Immo'),
    deterministic: immo('cluster', 'Workloads Kubernetes Immo', 'Manifests Immo · plateforme poc-k8s'),
  },
  'asis-3': {
    sources: external('document', 'Sources géographiques'), pv: external('document', 'PV / avis municipaux'),
    zones: external('map', 'Zonage'), rules: external('document', 'Règlements / grilles'),
    lots: external('map', 'Cadastre / évaluation'), env: external('map', 'Environnement'),
    processing: geo('graph', 'Traitements Geo', 'Runners + Jobs bornés', 'geo:acquisition/; packages/geo/src/'),
    capture: geo('document', 'Acquisition', 'Runners de capture', 'geo:acquisition/'),
    normalize: geo('graph', 'Normalisation', 'Parseurs + provenance', 'geo:acquisition/; packages/geo/src/'),
    join: geo('join', 'Jointure spatiale', 'Calcul parcelle ∩ zonage', 'geo:packages/geo/src/zonage/lotZoneJoin.ts'),
    fold: geo('join', 'Jointures sémantiques', 'Zones + normes + lots', 'geo:acquisition/src/_immo-lots-norms-join-probe.ts'),
    constraints: geo('map', 'Contraintes environnementales', 'Normalisation + intersection', 'geo:docs/spec/SPEC_GEO_ENV_CONSTRAINTS_S9.md'),
    local: geo('workstation', 'Poste de travail · extraction', 'Outils Geo · assistance OCR / vision / LLM', 'geo:acquisition/'),
    geoprod: shared('cluster', 'Vue Geo production / corpus partagé', 'Composants Immo consommateurs indiqués séparément'),
    geopreprod: shared('cluster', 'Vue Geo préproduction', 'Composants Immo consommateurs indiqués séparément'),
    sync: geo('release', 'Job de synchronisation', 'Contrôle cohérence + index API', 'geo:deploy/k8s/preprod/geo-api-preprod-sync-job.yaml'),
    site: geo('web', 'Catalogue web · GitHub Pages'),
  },
  'asis-4': {
    operator: external('user', 'Opérateur'),
    ci: shared('release', 'GitHub Actions / GHCR', 'Workflows applicatifs · services externes'),
    pp: shared('cluster', 'Déploiement préproduction', 'Images + manifests applicatifs'),
    acceptance: shared('check', 'Validation de version', 'Checks des repos · décision humaine'),
    promote: shared('release', 'Promotion contrôlée', 'Workflows applicatifs · approbation humaine'),
    prod: shared('cluster', 'Déploiement production', 'Images + manifests · état Immo non audité'),
    refresh: shared('release', 'Copie de données', 'Immo : PG · Geo : normalized/'),
    corpus: external('document', 'Corpus municipal'),
    scrape: immo('cronjob', 'Acquisition Immo'), local: sharedNodes.WS_IMMO,
    projection: immo('graph', 'Publication / projection', 'Outils + worker Immo'),
    appdata: immo('postgres', 'Données applicatives', 'PG + Signaux servis'),
    interim: immo('postgres', 'Flux PG déterministe', 'Types minuscules · non servis comme Signal'),
  },
  'target-1': {
    municipal: external('document', 'Sources municipales'),
    immo_target: immo('cronjob', 'Job Immo proposé', 'Cible non déployée'),
    llm_target: immo('llm', 'Interprétation / grounding', 'Intégration Immo de la bibliothèque Graphify'),
    acquire: immo('document', 'Collecte / parsing', 'Proposition · manifest du corpus'),
    materialize: immo('s3', 'Matérialisation S3', 'Traitement Immo · pas un nouveau bucket'),
    graphify: make('llm', 'Bibliothèque Graphify', ['graphify'], 'Intégration : radar-immobilier · cible proposée', 'graphify:PR #330; continuation-audit.md'),
    evidence: immo('check', 'Gates de preuves', 'Proposition · schéma / citation / source'),
    publish: immo('graph', 'Publication canonique', 'Proposition · writer exclusif'),
    project: immo('postgres', 'Projection atomique', 'Proposition · même DB PP-DB'),
    post: immo('graph', '3.4 EMIT / APPLY', 'Outils Immo · reprise depuis PG'),
    credentials: make('identity', 'Opérations des identifiants', null, 'Responsabilité / contrat à décider', 'decision-dossier.md:G0 credential ownership'),
    providers: external('llm', 'Fournisseurs LLM'),
  },
};
export function provenanceFor(graphId, nodeId) {
  const value = views[graphId]?.[nodeId] ?? sharedNodes[nodeId];
  if (!value) throw Error(`Missing repository/service attribution: ${graphId}/${nodeId}`);
  return { ...value, repoLabel: `repo: ${value.repos === null ? 'à décider' : value.repos.length ? value.repos.join(' + ') : 'externe (aucun)'}` };
}
