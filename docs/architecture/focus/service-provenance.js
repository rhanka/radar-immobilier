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
  PP_MCP: immo('api', 'Remote MCP Immo', 'Code + manifest OAuth'), PR_MCP: immo('api', 'Remote MCP Immo', 'Target role · physical binding unverified'),
  PR_DB: immo('postgres', 'PostgreSQL / PostGIS', 'Target role · physical binding TBD', 'transitions-target.md:production bindings'),
  PP_REFRESH: immo('cronjob', 'Autonomous Immo refresh', 'Proposed T1 workload · not deployed', 'refresh-018:SPEC_EVOL_REFRESH_018.md'),
  PR_REFRESH: immo('cronjob', 'Autonomous Immo refresh', 'Target role · physical binding TBD', 'transitions-target.md:production bindings'),
  PR_GRAPH: immo('s3', 'OVH Object Storage · S3', 'Target graph/corpus role · binding TBD', 'transitions-target.md:production bindings'),
  PP_RAW_OVH: immo('s3', 'OVH Object Storage · S3', 'New API raw logical role · binding TBD', 'transitions-target.md:T2'),
  PP_DOCS_OVH: immo('s3', 'OVH Object Storage · S3', 'New API documents logical role · binding TBD', 'transitions-target.md:T2'),
  PR_RAW_OVH: immo('s3', 'OVH Object Storage · S3', 'Target API raw role · binding TBD', 'transitions-target.md:T2'),
  PR_DOCS_OVH: immo('s3', 'OVH Object Storage · S3', 'Target API documents role · binding TBD', 'transitions-target.md:T2'),
  WS_IMMO: immo('workstation', 'Poste de travail · LLM', 'Outils Immo · bibliothèque Graphify', 'radar-immobilier:tools/graphify-v23/; tools/grounding/'),
  ppminio: immo('s3', 'MinIO · StatefulSet + PVC', 'Manifests du store S3 compatible'),
};
const targetCommon = {
  user: external('user', 'Utilisateur / client autorisé'), ppurl: immo('url', 'Accès HTTPS', 'Route préprod vérifiée'), prurl: immo('url', 'Accès HTTPS', 'Route prod vérifiée'),
  OVH_CLUSTER: platform('cluster', 'Cluster Kubernetes OVH', 'Plateforme partagée · état cible explicitement non déployé'),
  edge: platform('network', 'Traefik / TLS', 'Ingress, certificats et isolation partagés'),
  immo_tenant: immo('cluster', 'Tenant Immo', 'Ownership applicatif dans la plateforme partagée'), immo_pp: immo('cluster', 'Immo préproduction', 'Premier environnement de validation'), immo_pr: immo('cluster', 'Immo production', 'Cible après promotion séparée'),
  geo_tenant: geo('cluster', 'Tenant Geo', 'Ownership géographique dans la plateforme partagée'), identity_platform: sso('identity', 'Plateforme SSO'),
  pidp: sso('identity', 'SSO / OIDC'), idp: sso('identity', 'SSO / OIDC'),
  GEO_PROCESS: geo('join', 'Traitements Geo', 'Capture, normalisation et jointures en processus', 'geo:acquisition/; packages/geo/src/'),
  OVH_OBJECTS: make('s3', 'Plan objet OVH', ['radar-immobilier', 'geo', 'poc-k8s'], 'Bindings clients + exploitation plateforme', 'transitions-target.md:T2/T3'),
  geo_sources: external('document', 'Sources géographiques officielles'),
  GEO_CAPTURE: geo('document', 'Acquisition Geo', 'Capture bornée + provenance', 'geo:acquisition/'), GEO_NORMALIZE: geo('graph', 'Normalisation Geo', 'Parse/normalise avec provenance', 'geo:acquisition/; packages/geo/src/'),
  GEO_JOIN: geo('join', 'Jointure spatiale en processus', 'Parcelle ∩ zonage · pas une dépendance SQL', 'geo:packages/geo/src/zonage/lotZoneJoin.ts'), GEO_FOLD: geo('join', 'Jointures sémantiques en processus', 'Zones + règlements + lots', 'geo:acquisition/'), GEO_CONSTRAINTS: geo('map', 'Contraintes environnementales', 'Intersection en processus + état manquant', 'geo:docs/spec/SPEC_GEO_ENV_CONSTRAINTS_S9.md'),
  PV_SRC: external('document', 'PV / avis municipaux'), ZONES_SRC: external('map', 'Zonage'), REGULATIONS_SRC: external('document', 'Règlements / grilles'), LOTS_SRC: external('map', 'Cadastre / évaluation'), ENV_SRC: external('map', 'Environnement'),
  providers: external('llm', 'Fournisseurs LLM'), WS_ADMIN: immo('workstation', 'Poste optionnel', 'Enrollment / administration seulement', 'transitions-target.md:T1/T3'), TEM: immo('release', 'Scaleway TEM', 'Exception email retenue', 'decision-dossier.md:TEM exception'),
};
const stage = (id, repos = ['radar-immobilier', 'poc-k8s']) => make('check', `${id} transition`, repos, 'Stage card · changes/kept/removed/gates/evidence', 'transitions-target.md');
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
  'target-1': { ...targetCommon,
    T1_CARD: stage('T1'), T1_CHANGE: stage('T1'), T1_KEEP: stage('T1'), T1_REMOVE: stage('T1'), T1_GATES: stage('T1'), T1_EVIDENCE: stage('T1'),
    PR_OBJECT_GAP: immo('s3', 'Production object roles', 'Observed binding unavailable · no provider inferred', 'transitions-target.md:T1'),
  },
  'target-2': { ...targetCommon,
    T2_CARD: stage('T2'), T2_CHANGE: stage('T2'), T2_KEEP: stage('T2'), T2_REMOVE: stage('T2'), T2_GATES: stage('T2'), T2_EVIDENCE: stage('T2'),
    SCW_RESIDUE: immo('check', 'Final SCW executable sweep', 'Images/jobs/manual/CI/backup/bootstrap/secrets · TEM excluded', 'scw-final-sweep.md'),
  },
  'target-3': { ...targetCommon,
    T3_CARD: stage('T3', ['radar-immobilier', 'geo', 'poc-k8s']), T3_CHANGE: stage('T3', ['radar-immobilier', 'geo', 'poc-k8s']), T3_KEEP: stage('T3', ['radar-immobilier', 'geo', 'poc-k8s']), T3_REMOVE: stage('T3', ['radar-immobilier', 'geo', 'poc-k8s']), T3_GATES: stage('T3', ['radar-immobilier', 'geo', 'poc-k8s']), T3_EVIDENCE: stage('T3', ['radar-immobilier', 'geo', 'poc-k8s']),
  },
  'detail-1': {
    municipal: external('document', 'Sources municipales'),
    immo_target: immo('cronjob', 'Job Immo proposé', 'Cible non déployée'),
    llm_target: immo('llm', 'Interprétation / grounding', 'Intégration Immo de la bibliothèque Graphify'),
    acquire: immo('document', 'Collecte / parsing', 'Proposition · manifest du corpus'),
    materialize: immo('s3', 'Matérialisation S3', 'Traitement Immo · pas un nouveau bucket'),
    graphify: make('llm', 'Bibliothèque Graphify', ['graphify'], 'Intégration : radar-immobilier · cible proposée', 'graphify:PR #330; continuation-audit.md'),
    evidence: immo('check', 'Gates de preuves', 'Proposition · schéma / citation / source'),
    candidate: immo('graph', 'Candidat frais préservé', 'Manifest/hash + baseline complet'),
    publish: immo('graph', 'Publication canonique', 'Proposition · writer exclusif'),
    project: immo('postgres', 'Projection atomique', 'Proposition · même DB PP-DB'),
    post: immo('graph', 'Enrichissement déterministe 3.4', 'Candidat frais · avant publication canonique'),
    served: immo('check', 'Signal/PDF acceptance', 'Preuve métier · pas job-green'),
    credentials: make('identity', 'Opérations des identifiants', null, 'Responsabilité / contrat à décider', 'decision-dossier.md:G0 credential ownership'),
    providers: external('llm', 'Fournisseurs LLM'),
  },
};
export function provenanceFor(graphId, nodeId) {
  const value = views[graphId]?.[nodeId] ?? sharedNodes[nodeId];
  if (!value) throw Error(`Missing repository/service attribution: ${graphId}/${nodeId}`);
  return { ...value, repoLabel: `repo: ${value.repos === null ? 'à décider' : value.repos.length ? value.repos.join(' + ') : 'externe (aucun)'}` };
}
