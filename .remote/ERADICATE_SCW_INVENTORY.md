# Inventaire des références d’infrastructure retirée

## Méthode et unité de comptage

Référence immuable : `831cad2459b6a59fde790145af5c6cf9bb3f6b72`.

Recalage 2026-09-11 : branche rebasée sur `main` `a4a2c00` (PR #671 « cutover
registry SCW→GHCR » mergée). Les hunks registre (`IMAGE_PREFIX`/`REGISTRY`,
`image:` `radar-{api,ui}` des manifests, `Makefile REGISTRY`, README registre)
sont livrés par #671 et ne font plus partie de la PR #670, dont le périmètre
restant est : stockage S3 SCW (TODO k8s), références/docs/règles/specs
neutralisées, inventaire et plan. Chaque ligne ci-dessous est portée par #670
sauf étiquette contraire (« livrée par #671 » ou « CONSERVÉE sur `main` »).

Le balayage a porté sur tous les fichiers suivis avec les motifs demandés :
`scw`, `scaleway`, `rg.fr-par.scw.cloud`, `s3.fr-par.scw.cloud`, `fr-par`,
`kapsule`, `radar-minio`, `minio`, `MINIO_`,
`radar-immobilier-docs-pocs`, `-pocs`, `sbs-default` et
`poc-979c11ad`. L’unité est une ligne textuelle unique du commit de référence;
les listes ci-dessous regroupent les numéros par fichier.

Résultat : **885 lignes**, classées sans double compte :

- **A — 366** : résidus purs supprimés ou reformulés — **339 portées par
  #670** (275 reformulées + 64 supprimées avec leurs 4 fichiers), **25 livrées
  par #671** (mergé `a4a2c00` : login, miroir et commentaires de l'ancien
  registre), **2 CONSERVÉES sur `main`** (pull secret `radar-registry-pull`
  requis par `radar-obscura`, voir B1);
- **B — 172** : ressources toujours nécessaires, remplacées seulement quand
  la cible a été vérifiée, sinon laissées en TODO (ou conservées sur décision
  owner : transport e-mail SCW TEM, voir B3) — dont **B1 registre et images :
  39 livrées par #671**, 1 conservée (`radar-obscura`), 3 docs portées par #670;
- **C — 347** : historique, émulation locale ou service encore opéré par k8s,
  laissé intact (dont les manifests MinIO `25-minio.yaml` + netpols 71/72,
  conservés jusqu'à la dernière étape de décom, voir « Séquencement — décom
  MinIO »).

Les fichiers binaires signalés par le balayage sont listés à la fin en C sans
numéro de ligne et ne sont pas inclus dans les 885 lignes textuelles.

## A — résidus supprimés ou neutralisés (366)

Actions : suppression des manifests et scripts morts; retrait du login et du
miroir de l’ancien registre (livré par #671, mergé `a4a2c00`) — le secret de
pull `radar-registry-pull` (`10-rbac.yaml`, `secrets.example.yaml`) est
CONSERVÉ sur `main` tant que `radar-obscura` tire depuis l’ancien registre
(cutover obscura = branche `feat/obscura-ghcr`, hors #670); le transport e-mail
SCW TEM est CONSERVÉ, voir B3; les manifests MinIO `25-minio.yaml` + netpols
71/72 sont CONSERVÉS, voir « Séquencement — décom MinIO »; suppression des
fausses instructions courantes; terminologie fournisseur-neutre dans le code,
les contrats et les documents actifs.

Décompte A : 339 lignes portées par #670 (275 reformulées + 64 dans les 4
fichiers supprimés), 25 livrées par #671, 2 conservées sur `main` — étiquetées
ci-dessous.

Fichiers supprimés :

- `.github/workflows/grounding-publish-prod.yml`
- `deploy/k8s/32b-reproject-etape-job.yaml`
- `scripts/mount-scw.sh`
- `scripts/umount-scw.sh`

Occurrences au commit de référence :

- `.env.example:10,12,17,21,22,26,27,28`
- `.github/workflows/build-push-images.yml:10,44,45` (commentaires cluster) ; `:4,143,158,159,160,162,167,169,176,178,235,241,1248,1253,1257,1269,1279` livrées par #671
- `.github/workflows/grounding-publish-prod.yml:1,3,4,9,10,14,16,18,19,21,23,24,25,26,55,56,57,58,59,63,98,100,101,104,105,106,129,130,149,152,153,156,157`
- `.gitignore:44,64,65`
- `Makefile:245,274` ; `:328,329` (`registry-login`) livrées par #671
- `README.md:60,64`
- `api/Dockerfile:55`
- `api/src/config.ts:27,31,38,41,42,49,60,61,64,233,251,252`
- `api/src/index.ts:20,80`
- `api/src/routes/ciblage.ts:29`
- `api/src/routes/documents.test.ts:96`
- `api/src/routes/documents.ts:16`
- `api/src/routes/graph-signals.test.ts:488`
- `api/src/routes/graph.ts:80`
- `api/src/scripts/export-designation-events.ts:54`
- `api/src/scripts/project-graph-from-s3.ts:2,4,24`
- `api/src/scripts/reconcile-167-slugs.ts:59`
- `api/src/scripts/worker-live.ts:5`
- `api/src/services/geo/provenance.ts:168`
- `api/src/services/graph/bprime-recette.fixture.ts:12,13,185`
- `api/src/services/graph/graph-store.test.ts:699,703`
- `api/src/services/graph/graph-store.ts:54,102,326`
- `api/src/services/graph/recette-replay.prod.test.ts:14,47,50`
- `api/src/services/pipeline/executor.ts:47`
- `api/src/services/sources/exploit-scrape.test.ts:361,386`
- `api/src/services/sources/exploit-scrape.ts:374,400`
- `api/src/services/sources/live-scrape.test.ts:4`
- `api/src/services/sources/live-scrape.ts:3`
- `api/src/storage/object-store.ts:63`
- `api/src/storage/s3-object-store.ts:112,317,318`
- `api/src/storage/scrape-store.test.ts:13,135,144,152,155,160,161,163,164,169,170,172,173,180,184,190,193`
- `deploy/ci/db-backup.test.sh:68`
- `deploy/grounding/Dockerfile:10`
- `deploy/k8s/00-namespace.yaml:2,8`
- `deploy/k8s/10-rbac.yaml:2` — CONSERVÉE sur `main` (`imagePullSecrets: radar-registry-pull`, requis par `radar-obscura`)
- `deploy/k8s/30-api.yaml:4,31` ; `:3` livrée par #671
- `deploy/k8s/31-graph-projection-job.yaml:1,14,23,129,158`
- `deploy/k8s/32-graph-projection-only-job.yaml:5,83,84`
- `deploy/k8s/32b-reproject-etape-job.yaml:1,4,5,8,9,11,15,17,23,31,78,95,96,99,101,103` (fichier supprimé par #670 ; `:78` avait été repointée par #671 avant suppression)
- `deploy/k8s/33-scrape-job.yaml:1,89,93`
- `deploy/k8s/33b-scrape-cities-job.yaml:83,87`
- `deploy/k8s/34-refresh-cronjob.yaml:4,9,13,113,117,217`
- `deploy/k8s/37-graphify34-apply-job.yaml:102`
- `deploy/k8s/41-grounding-citation-job.yaml:7,31,37,58,97,99`
- `deploy/k8s/50-ui.yaml:89` livrée par #671
- `deploy/k8s/60-ingress.yaml:2`
- `deploy/k8s/README.md:4` ; `:16,200` livrées par #671
- `deploy/k8s/grounding-preprod/kustomization.yaml:11` livrée par #671
- `deploy/k8s/refresh-cronjobs/kustomization.yaml:55,87,88`
- `deploy/k8s/refresh-diag/diag-refresh-job.yaml:78,91`
- `deploy/k8s/secrets.example.yaml:27,54,56,64,65,66,75` ; `:111` CONSERVÉE sur `main` (Secret `radar-registry-pull`, requis par `radar-obscura`)
- `docker-compose.yml:92`
- `docs/spec/SPEC_CONSOLIDATED_2026-07.md:130,202,227,232,312,617`
- `docs/spec/SPEC_EVOL_SCAFFOLDING.md:207,216,219,222,319,320,321,326,366,367,472`
- `docs/spec/SPEC_EVOL_SOURCE_FEASIBILITY.md:130`
- `docs/spec/SPEC_INTENT_SCAFFOLDING.md:30,60`
- `docs/spec/SPEC_PERSISTENCE_S3_FIRST.md:5,11,14,19,25,111,118,119,129,138,142`
- `docs/spec/audit-villes-sans-signal.md:26,32,258,259`
- `docs/spec/brainstorm-industrialisation-refresh-data.md:95,99,148,174,451`
- `docs/spec/cadrage-zerocopy-geo.md:183`
- `docs/spec/clarif-pv-scraping-geo.md:26,52,101,125,129,131,142,179,193,199`
- `docs/spec/data-division-immo-geo.md:123,175,231,241`
- `docs/spec/decision-tracking-structure-v2.md:140`
- `docs/spec/extraction-zone-lot-delegation.md:219,222,225,228`
- `docs/spec/grounding-pilot-mont-tremblant.md:38,56`
- `docs/spec/mcp/immo-mcp-remote-deploy.md:165`
- `docs/study/industrialisation-refresh-suivi.md:19,71,88,90,128,192`
- `packages/radar-sources/src/sources/pv-cities-hard.json:13,22,31,41,50,59,68,69,79,88,99,109,118,128,139,147,152`
- `radar/ontology/graphify-output-contract.md:6`
- `radar/ontology/ontology-profile.yaml:94`
- `radar/ontology/regraphify-directive.md:19,82,146,160,177,277`
- `rules/MASTER.md:91`
- `rules/security.md:12,13`
- `scripts/cohorte-vivier-b/METHOD.md:40`
- `scripts/cohorte-vivier-b/README.md:38`
- `scripts/cohorte-vivier-b/reproduce-cohort.ts:23`
- `scripts/gate.sh:42`
- `scripts/mount-scw.sh:2,5,8,30,42,45,47,50,51,56,63,71`
- `scripts/recette/dump-parity.py:2`
- `scripts/umount-scw.sh:2,5,8,12`
- `tools/graphify-v23/gate.sh:137,139`
- `tools/graphify-v23/preflight.sh:37,46,48,58,61,63,66,71,73,144,157`
- `tools/graphify-v23/runner-llm-desc-validation.sh:4,70,71,83,88,95,101,132,135`
- `tools/graphify-v23/runner.sh:82,90`
- `tools/grounding/README.md:12,26,39`
- `tools/grounding/drive-grounding.sh:4,10,25,91`
- `tools/grounding/gate-grounding.sh:18,129`
- `tools/grounding/publish-citation-grounding.sh:13`
- `tools/grounding/publish-verify-graph.sh:19,60`
- `tools/grounding/stage-candidate.sh:2,11,19`
- `tools/grounding/worker-grounding.sh:32`
- `ui/e2e-qa/pdf-overlay.harness.spec.ts:17`
- `ui/src/lib/signals/graph-signal-detail-client.test.ts:66`

## B — ressources nécessaires (172)

### B1 — registre et images (43 : 39 livrées par #671, 1 conservée, 3 docs #670)

Le cutover registre est **livré par #671 (mergé `a4a2c00`)** : `REGISTRY` /
`IMAGE_PREFIX` des workflows, `REGISTRY` du Makefile et toutes les lignes
`image:` `radar-api` / `radar-ui` / `radar-grounding` des manifests pointent
sur `ghcr.io/rhanka/*` sur `main`. La PR #670 ne porte plus aucun de ces hunks.
L’image `radar-obscura` n’existe pas dans GHCR : elle reste inchangée sur
`main` (avec le pull secret `radar-registry-pull`) et son cutover est porté par
la branche `feat/obscura-ghcr`, hors #670. Le contrat geo porte un placeholder
explicite en attendant son image vérifiée (#670). Le chemin hypothétique d’une
image MCP dédiée a été retiré en A.

Livrées par #671 (mergé `a4a2c00`) — 39 :

- `.github/workflows/build-push-images.yml:88,89,90,114,115,802,1025,1061,1415`
- `.github/workflows/grounding-preprod.yml:33`
- `Makefile:34`
- `deploy/k8s/30-api.yaml:133`
- `deploy/k8s/31-graph-projection-job.yaml:77,104,138`
- `deploy/k8s/32-graph-projection-only-job.yaml:57`
- `deploy/k8s/33-scrape-job.yaml:62`
- `deploy/k8s/33b-scrape-cities-job.yaml:51`
- `deploy/k8s/34-refresh-cronjob.yaml:86,196`
- `deploy/k8s/35-consistency-snapshot-cronjob.yaml:64`
- `deploy/k8s/35-consistency-snapshot-job.yaml:52`
- `deploy/k8s/35-run-geo-mapper-job.yaml:53`
- `deploy/k8s/35a-populate-geo-job.yaml:47`
- `deploy/k8s/35b-populate-geo-cronjob.yaml:50`
- `deploy/k8s/36-db-migrate-job.yaml:44`
- `deploy/k8s/37-graphify34-apply-job.yaml:68`
- `deploy/k8s/38-graphify34-emit-candidates-job.yaml:67`
- `deploy/k8s/39-export-graph-nodes-job.yaml:56`
- `deploy/k8s/40-export-gt-designation-events-job.yaml:59`
- `deploy/k8s/40-immo-mcp-http-deploy.yaml:146`
- `deploy/k8s/50-ui.yaml:92`
- `deploy/k8s/grounding-preprod/kustomization.yaml:18,35`
- `deploy/k8s/refresh-cronjobs/kustomization.yaml:16,41`
- `deploy/k8s/refresh-diag/diag-refresh-job.yaml:58`
- `deploy/k8s/refresh-diag/kustomization.yaml:8,21`

Conservée sur `main` (cutover obscura = `feat/obscura-ghcr`) — 1 :

- `deploy/k8s/35-obscura.yaml:42`

Portées par #670 (documentation du registre livré) — 3 :

- `docs/spec/SPEC_CONSOLIDATED_2026-07.md:217`
- `docs/spec/geo-contracts/contrat-jointure-immo-zones-lots.md:215`
- `docs/spec/mcp/immo-mcp-remote-deploy.md:125`

### B2 — stockage d’exécution (36)

Ces tuples endpoint/bucket/région et ces noms de clés restent inchangés dans les
manifests exécutables : aucune valeur OVH vérifiée n’a été trouvée dans le repo
ou reçue de k8s/i-infra. Chaque point d’usage porte maintenant un TODO explicite.

- `deploy/k8s/30-api.yaml:33,34`
- `deploy/k8s/32-graph-projection-only-job.yaml:88,90,92`
- `deploy/k8s/33-scrape-job.yaml:95,97,99`
- `deploy/k8s/33b-scrape-cities-job.yaml:89,91,93`
- `deploy/k8s/34-refresh-cronjob.yaml:119,121,123,224,226,228`
- `deploy/k8s/37-graphify34-apply-job.yaml:105,107,109`
- `deploy/k8s/38-graphify34-emit-candidates-job.yaml:106,108,110`
- `deploy/k8s/39-export-graph-nodes-job.yaml:118,138,140,142`
- `deploy/k8s/40-export-gt-designation-events-job.yaml:87,143,145,147`
- `deploy/k8s/41-grounding-citation-job.yaml:101,103,105,107,109`

### B3 — e-mail transactionnel (93)

**TEM SCW CONSERVÉ (décision owner 2026-09-11)** — proposition de fournisseur
de remplacement en cours (i-infra) ; retrait différé.

Le transport HTTP Scaleway Transactional Email (schéma `SCW_TEM_*`,
`resolveTemConfig`/`TemConfig` dans `config.ts`, client `mailer.ts` et ses
tests, câblage `app.ts`/`index.ts`, ConfigMap + `secretKeyRef
SCW_TEM_SECRET_KEY` de `30-api.yaml`, Secret `radar-tem-credentials` de
`secrets.example.yaml`, commentaire de `40-maildev.yaml`) est restauré à
l’identique de `831cad2` par le commit de revert de cette branche. Le mode de
repli qui consigne le lien d’invitation reste celui de `main`. Aucun nouveau
fournisseur n’a été inventé : le choix et ses paramètres viendront de la
proposition i-infra, hors dépôt, et le retrait du transport SCW n’interviendra
qu’après validation owner de cette proposition.

- `api/src/app.ts:52`
- `api/src/config.ts:201,203,205,207,208,209,210,211,212,394,395,411,414,415,416,417,422,423,425,426`
- `api/src/index.ts:50,56,57`
- `api/src/services/auth/mailer.test.ts:9,10,19,21,22,23,24,25,26,30,31,41,42,49,82`
- `api/src/services/auth/mailer.ts:3,4,6,8,12,13,14,15,16,17,21,23,25,44,48,49,50,52,53,54,73,99,102,106,133,147`
- `deploy/k8s/30-api.yaml:38,39,40,41,42,43,44,45,47,49,50,51,52,53,54,166,169,170,172,173`
- `deploy/k8s/40-maildev.yaml:4,7`
- `deploy/k8s/secrets.example.yaml:77,79,80,81,92,93`

### Valeurs B manquantes à obtenir de k8s/i-infra

- endpoint OVH Object Storage de production;
- bucket OVH pour raw/parsed/graph et décision bucket unique ou séparé;
- région OVH;
- mode `forcePathStyle`;
- noms des Secrets et mapping des clés access/secret;
- image vérifiée de `radar-obscura` (cutover porté par `feat/obscura-ghcr`,
  hors #670 ; d’ici là le pull secret `radar-registry-pull` reste sur `main`);
- image vérifiée du service geo cité par le contrat;
- proposition i-infra d’un fournisseur d’e-mail transactionnel de remplacement
  (paramètres non secrets associés) ; tant qu’elle n’est pas validée par
  l’owner, SCW TEM reste en place (B3).

## C — occurrences conservées (347)

### C1 — historique append-only ou rapports datés (141)

Ces lignes décrivent des faits datés. `.track` est append-only; les rapports et
plans archivés ne sont pas des instructions d’exploitation courantes.

- `.track/events.jsonl:6,118,167,203,205,207,209,238,239,243,414,501`
- `docs/reports/consensus/graphify-3-4-replayable-adversarial-consensus-2_2026-07-22.md:150,233,261,265`
- `docs/reports/consolidation-30-2026-07.md:31,158,159`
- `docs/reports/couts-2026-06-19_2026-07-03.md:4,5,19,31,74,78,79,143,149`
- `docs/reports/couts-2026-07-13_2026-08-09.html:26,40,61,63,76,97,98,99,106,276,279,280,283,327,390,391,394`
- `docs/reports/couts-2026-07-13_2026-08-09.md:4,11,17,19,25,29,31,33,35,90,93,94,98,140,162,163,166`
- `docs/reports/geo-handoff/graphify-3-4-replayable-execution-plan-2026-07-22-v2.md:274,289`
- `docs/reports/recette/RECETTE_HARNESS_REJEU_PROD.md:15,46,48,49,51,53,55,56,147,148,151,169,170,180,199`
- `docs/reports/recette/gold-steve-30.expected.json:4`
- `docs/spec/reports/2.3-completude-1105.md:41,98`
- `docs/spec/reports/tracking-structure-claude.md:93,181,182,186`
- `docs/spec/reports/wp1-atome-par-ville.md:10`
- `docs/spec/reports/wp3-33-anomalies.json:6`
- `docs/spec/reports/wp3-33-anomalies.md:4`
- `docs/spec/reports/wp3-mapper-recall-2026-06-28.md:31,293,294`
- `docs/spec/reports/wp6-item-subitem-map.json:767,788,795,802,816`
- `docs/spec/reports/wp6-item-wp-map.json:914,944,954,964,984`
- `docs/spec/reports/wp6-retro-hebdo.md:78`
- `docs/spec/reports/wp6-rollup.json:544,547,571,572,574`
- `docs/spec/track-report-recalage-2026-06-26.md:104,107,134,135,137`
- `docs/spec/track-report-tableau-2026-06-26.md:82,85,115,116,118`
- `plan/CDGUARD-BRANCH_ci-preflight-target-cluster.md:7,11,13,70,87`
- `plan/G34GUARD-BRANCH_fix-graphify-34-phase-a-guards.md:88,89,164`
- `plan/GRAPHIMPORT-BRANCH_fix-graph-import-normalize.md:4`
- `plan/done/00-BRANCH_chore-scaffolding-base.md:92`
- `plan/done/02-BRANCH_feat-api-skeleton-hono-postgres-s3.md:4,30,41,42,47,48,62,66,97,106,109,113`
- `plan/done/06V-BRANCH_feat-vertical-slice-valleyfield.md:20`

### C2 — émulation locale, tests et MinIO encore opéré par k8s (206)

Ces occurrences sont soit nécessaires au développement/test isolé, soit liées
au service encore présent dans le cluster et explicitement hors périmètre de
cette branche. Elles ne constituent pas une valeur de remplacement OVH.

Les manifests MinIO (`25-minio.yaml`, netpols `71-*` et `72-*`, leur entrée
`resources:` dans `deploy/k8s/kustomization.yaml` et la ligne du tableau
`deploy/k8s/README.md`) sont CONSERVÉS à l’identique de `831cad2` (revert du
2026-09-11, décision k8s + i-infra endossée conducteur) : MinIO est
load-bearing et son retrait du git est la DERNIÈRE étape de la décom (voir
« Séquencement — décom MinIO »). La règle `allow-api-to-minio` reste en C
tant que l’API servie par `831cad2` utilise le service vivant géré par k8s.

- `.claude/skills/ingest-test/SKILL.md:29,32`
- `.env.example:11,14,15,20`
- `.github/workflows/build-push-images.yml:142`
- `.github/workflows/ci.yml:48`
- `.github/workflows/grounding-preprod.yml:14,126,129`
- `Makefile:65,90,94,174,175,183,249,250,251,254,257,258,259,265,266`
- `README.md:24`
- `api/src/config.test.ts:16,17,59`
- `api/src/config.ts:26,29,30,40,62,220,234,289`
- `api/src/db/schema.ts:30`
- `api/src/index.ts:21,79`
- `api/src/routes/ciblage.test.ts:7`
- `api/src/routes/ciblage.ts:31`
- `api/src/routes/scrape-status.test.ts:7`
- `api/src/routes/sources.test.ts:10`
- `api/src/services/ciblage/ciblage-store.ts:16`
- `api/src/services/geo/provenance.test.ts:143,154,164,168`
- `api/src/services/geo/provenance.ts:161,164`
- `api/src/services/graph/project-state-to-graph.test.ts:25`
- `api/src/services/pipeline/executor.test.ts:23`
- `api/src/services/pipeline/executor.ts:49,212`
- `api/src/services/pipeline/jobs-store.ts:13`
- `api/src/services/sources/exploit-scrape.ts:396`
- `api/src/services/sources/exploitation.test.ts:35`
- `api/src/services/sources/live-scrape.ts:4`
- `api/src/services/sources/pv-seed.test.ts:31`
- `api/src/services/sources/rebuild-from-s3.test.ts:28`
- `api/src/services/sources/rebuild-from-s3.ts:197`
- `api/src/services/sources/recueil.ts:77`
- `api/src/services/sources/seed-ontology.test.ts:10`
- `api/src/storage/object-store.ts:64,82`
- `api/src/storage/s3-object-store.ts:214,319`
- `api/src/storage/scrape-store.test.ts:11,134,137,138,143,147,148,154,157,158,179,182,183,194,195,232`
- `deploy/grounding/Dockerfile:5,26`
- `deploy/k8s/25-minio.yaml:1,2,3,5,6,7,8,12,17,21,33,38,40,45,51,55,56,65,67,70,75,80,87`
- `deploy/k8s/30-api.yaml:94`
- `deploy/k8s/31-graph-projection-job.yaml:35`
- `deploy/k8s/32-graph-projection-only-job.yaml:85`
- `deploy/k8s/33-scrape-job.yaml:91,92`
- `deploy/k8s/33b-scrape-cities-job.yaml:85,86`
- `deploy/k8s/34-refresh-cronjob.yaml:115,116,220`
- `deploy/k8s/41-grounding-citation-job.yaml:9,17,19,28,29,59,87,110,111,113`
- `deploy/k8s/70-networkpolicy.yaml:98,126,129,130,131,133,134,138,143,148`
- `deploy/k8s/71-networkpolicy-graph-projection-minio-preprod.yaml:1,4,5,7,8,9,12,19,20,24,29,31,35`
- `deploy/k8s/72-networkpolicy-grounding-minio-preprod.yaml:1,4,5,14,18,23,28,33`
- `deploy/k8s/README.md:40`
- `deploy/k8s/kustomization.yaml:45`
- `deploy/k8s/41-grounding-worklist-configmap.yaml:12`
- `deploy/k8s/grounding-preprod/projection-job.preprod.yaml:4,12,13,64,66`
- `deploy/k8s/refresh-cronjobs/kustomization.yaml:56,58,61,80,89,159`
- `deploy/k8s/refresh-diag/diag-refresh-job.yaml:79,80,82,92`
- `deploy/k8s/secrets.example.yaml:71,73`
- `docker-compose.dev.yml:2,11`
- `docker-compose.yml:23,24,27,28,30,35,84,91,94,95,116`
- `docs/spec/SPEC_EVOL_SCAFFOLDING.md:335,353`
- `docs/spec/SPEC_PERSISTENCE_S3_FIRST.md:94,130,140`
- `rules/testing.md:15`
- `tools/grounding/stage-candidate.sh:4`
- `ui/src/lib/maps/geo-provenance.test.ts:71`
- `ui/src/lib/maps/geo-provenance.ts:21`
- `ui/src/lib/maps/proof-provenance-chain.test.ts:198,202,215`

### C3 — fichiers binaires signalés, non comptés

- `docs/reports/assets/fiche-lot-delson.png`
- `docs/reports/assets/preuve-pdf-mont-tremblant.png`
- `docs/reports/assets/signaux-province.png`
- `docs/reports/assets/signaux-ville-sainte-catherine.png`
- `docs/reports/livraison-2026-06-19_2026-07-03.pdf`
- `docs/spec/assets/ui-study-signaux-1440.png`
- `docs/spec/assets/ui-study-sources-1440.png`
- `docs/spec/input/carte-steve/screens/10-stecatherine-vue-globale.png`
- `docs/spec/input/carte-steve/screens/21-stecatherine-vue-satellite.png`
- `docs/spec/input/carte-steve/screens/32-delson-fiche-lot-priorite-banniere.png`
- `docs/spec/input/carte-steve/screens/41-stconstant-filtre-tod.png`
- `docs/spec/input/carte-steve/screens/50-candiac-vue-globale.png`
- `docs/spec/input/walkthrough/Capture d’écran du 2026-06-09 18-26-20.png`
- `docs/spec/input/walkthrough/Capture d’écran du 2026-06-09 18-49-09.png`
- `docs/spec/reports/study-2026-08/report.pdf`

## Séquencement — décom MinIO

Les références `radar-minio` restantes sont conservées volontairement : MinIO
OVH est load-bearing en préprod et en prod. Compte au commit de revert :
21 lignes dans les fichiers suivis hors `.remote/` (`rg radar-minio`, unité =
ligne textuelle ; le brief conducteur du 2026-09-11 en cite 27, écart de
méthode de comptage, sans effet sur la règle ci-dessous).

Décom gatée dans cet ordre : bucket OVH provisionné → objets migrés → clients
repointés. Ne pas pruner avant. Le retrait du serveur MinIO du git est la
DERNIÈRE étape.

Manifests conservés jusqu’à la dernière étape (revert du 2026-09-11, à
l’identique de `831cad2`, comptés en C2) :

- `deploy/k8s/25-minio.yaml` (StatefulSet + Service + PVC MinIO)
- `deploy/k8s/71-networkpolicy-graph-projection-minio-preprod.yaml`
- `deploy/k8s/72-networkpolicy-grounding-minio-preprod.yaml`
- entrée `- 25-minio.yaml` dans `deploy/k8s/kustomization.yaml:45` (bundle
  permanent ; sans elle, un `apply --prune` ou une re-provision retirerait le
  MinIO load-bearing — drift git/runtime)
- ligne `25-minio.yaml` du tableau `deploy/k8s/README.md:40`

Retrait = future **PR B**, gatée bucket OVH (provisionné → objets migrés →
clients repointés), hors périmètre de la PR #670. La PR #670 reste DRAFT
(hold merge) tant que le séquencement n’est pas exécuté.
