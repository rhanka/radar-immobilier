# SPEC EVOL — Frontière geo/immo et graphify 3.4 phase B

**Statut :** proposition à ratifier — 2026-07-26
**Autorité :** la règle du propriétaire ci-dessous prime les documents antérieurs.
**Portée :** architecture cible et phase B seulement ; les phases 0 et A livrées par la PR #424 ne sont pas respécifiées.

## 1. Décision structurante

`geo` est l'unique référentiel de données : acquisition, scraping, octets bruts, OCR/texte dérivé, stockage, versions, preuve et citabilité. `immo` porte la sémantique métier : détection avis de motion → règlement → zonage, ontologie temporelle, `Signal`, `DesignationEvent`, vivier et scoring. `immo` consomme les contrats publiés par `geo`, sans recopier le référentiel ni devenir une seconde source de vérité.

### Architecture normative en dix lignes

1. `geo` découvre les sources municipales et exécute tous les scrapers, y compris PV, avis publics et règlements.
2. `geo` archive les octets bruts de façon immuable et adressée par contenu, avec horodatage, URL, empreinte et statut d'acquisition.
3. `geo` produit OCR/texte, localisateurs page/segment et preuves citables ; ces dérivés restent des données de référence.
4. `geo` publie des manifestes versionnés et des artefacts dédiés, dont 4a ; il n'écrit jamais dans `graph_nodes`.
5. `immo` lit ces manifestes et objets en lecture seule ; il ne rescrape pas et ne maintient pas un corpus brut concurrent.
6. `immo` transforme un `InputSet` geo figé en assertions métier citées et en relations temporelles.
7. `immo` possède le graphe sémantique, le projecteur atomique, le vivier, les filtres, le scoring et leur historique.
8. Une vue composée conserve les identités et provenances geo ; elle ajoute une surcouche immo sans fusionner les autorités.
9. `geo Zone.usage_dominant` décrit une zone ; `immo Signal.usage_dominant` décrit le dossier détecté : aucune copie implicite entre eux.
10. Tout échange traverse un contrat versionné, haché, rejouable et observable ; aucun accès croisé à une table privée.

## 2. État réel et dette de migration

- Aujourd'hui `ProcesVerbauxGenericAdapter` scrape les PV dans `packages/radar-sources`, `recueil.ts` archive avant extraction, puis `exploit-scrape.ts` lit le bucket immo `radar-immobilier-docs-pocs` sur `s3.fr-par.scw.cloud`. C'est un état non conforme, pas un précédent architectural.
- `ogc-pull.ts` copie encore lots, zones et géométries geo dans les tables immo ; les routes geo sont hybrides (proxy, repli PostgreSQL, jointures locales). Cette copie doit être retirée selon le contrat zéro-copie.
- `scanHabitationSignals` est appelé par le parseur, mais `pv-mentions.ts` ignore `habitationSegments` : le scan PV-complet n'alimente donc pas la projection sémantique.
- `tools/graphify-v23` transforme un baseline en baseline ; `InputSet` ne fait que définir/valider un contrat. Aucun producteur raw → schéma 3.4 ni binaire `graphify run` n'existe.
- Production immo : 7 221 nœuds `Signal`/`DesignationEvent`, 724 villes, 5 618 `category=NULL`, 20 `instrument`, zéro `usage_dominant`, zéro `effet_densifiant`, zéro `etapes_historique`, `ontology_version` vide.
- Geo couvre déjà `Zone.usage_dominant` pour 710/1 106 villes et proof v2 pour 36/1 106. Sur 141 collections B′ servies, 7 effets sont connus et 126 inconnus, dont 117 sans norme pliée donc sans delta calculable : l'abstention et le namespacing sont obligatoires.
- L'artefact geo 4a est séparé, à `s3://sentropic-geo/exports/immo/artefact-4a-delta-grille/v1/latest.json`, joint par `{city_slug, zone_ref_canon_v1, reglement_number}`. Cette séparation protège le projecteur snapshot destructif d'immo.

La migration ne doit pas recopier le corpus. `geo` doit soit reprendre l'autorité logique/IAM du corpus adressé par contenu existant, soit publier un manifeste geo qui le référence jusqu'à migration. Le canal physique définitif reste à confirmer avec l'équipe geo.

## 3. Contrats geo → immo

Le contrat documentaire minimal est un manifeste immuable contenant `manifest_version`, identifiant de source, ville, URL canonique, date de collecte, type MIME, taille, `sha256`, clé d'objet, version OCR/extraction documentaire, texte ou clé de texte, localisateurs citables, droits/rétention et tombstones. Un pointeur publié atomiquement désigne le manifeste courant ; les exécutions immo épinglent sa version et son hash. Geo possède OCR, texte et localisateurs ; le « parsing » immo désigne uniquement segmentation, extraction et rapprochement sémantiques, sans seconde représentation textuelle durable.

Le contrat géospatial conserve les identités geo (`zone_ref_canon_v1`, lots, règlements), les géométries et preuves. L'artefact 4a fournit les deltas factuels. Immo résout les dossiers vers ces identités et dérive la qualification métier du signal ; il ne recalcule pas un delta à partir de champs plats incomplets. Une DTO composée nomme explicitement `zone_usage_dominant` et `signal_usage_dominant`.

## 4. Documents à corriger, sans correction dans ce chantier

| Document(s) | Contradiction ou retard | Correction proposée |
|---|---|---|
| `data-division-immo-geo.md`, `clarif-pv-scraping-geo.md` | Attribuent scraping PV, stockage brut et « hard scraping » à immo. | Transférer R/A à geo ; immo devient C pour le brut et R/A pour l'extraction sémantique. Marquer l'ancien découpage supersédé. |
| `PLAN_REVERSAL_IMMO_GEO_2026-07.md` | Réduit geo à la donnée cartographique. | Étendre le référentiel geo à toute matière première documentaire ; conserver les overlays métier/UI côté immo. |
| `decision-tracking-structure-v1.md`, `wpa-fronta-data-geo-transfer.md`, `reports/wp1-data-state.md` et rapports `tracking-structure-*` | Répètent l'acquisition PV/YouTube/Obscura côté immo. | Corriger les RACI normatifs ; étiqueter les rapports historiques comme constats non normatifs. |
| `SPEC_PERSISTENCE_S3_FIRST.md`, `SPEC_PLAN_SCRAPING.md`, `SPEC_REORIENTATION_GRAND_FILET.md`, `brainstorm-industrialisation-refresh-data.md` | Définissent un corpus brut et des scrapers immo. | Les convertir en dette de migration et faire pointer les consommateurs vers le manifeste geo. |
| `cadrage-zerocopy-geo.md`, `cadrage-zones-lots-acquisition.md` | Le premier est limité aux primitives ; le second autorise un repli de scrapers dans immo. | Étendre le zéro-copie aux documents, actualiser les canaux et supprimer tout repli d'acquisition immo. |
| `cadrage-geo-integration-mapper.md`, `geo-detail-schema-mapping.md` | Font construire/copier la matière geo par immo. | Garder le mapper sémantique immo, supprimer la copie et composer deux espaces de noms/provenances. |
| `SPEC_EVOL_FILTRAGE_VIVIER_v2.md` §§2,4 | Compte ancien, ambiguïté d'usage et frontière 4a insuffisante. | Passer à 5 618 NULL, préciser l'usage du `Signal`, l'InputSet geo et la jointure 4a ; noter 0/A déjà faits. |
| Plans/consensus graphify du 22 juillet | Décrivent geo comme « proof-only » et interdisent delta/effect. | Conserver les décisions de replay, remplacer cette limite par la consommation de 4a sans écriture geo dans le graphe. |
| `SPEC_CONSOLIDATED_2026-07.md` | Limite l'acquisition geo au cadastre/rôle/adresses. | Répercuter la frontière normative documentaire et géospatiale. |
| `SPEC_ARTEFACT_4A_DELTA_GRILLE.md` | Fichier absent. | Créer le contrat versionné : schéma, cardinalité, inconnus, preuve, publication atomique et compatibilité. |
| `rules/MASTER.md`, `rules/sources.md` et ordre de lecture | Aucune frontière n'est chargée ; stockage/scraping et runtime sont décrits comme immo. | Installer le candidat en `rules/geo-immo-boundary.md`, l'ajouter à l'ordre obligatoire, puis attribuer le runtime/source contract à geo sans repli immo. |

## 5. Graphify 3.4 — phase B

### Entrée et matérialisation

Un producteur manquant construit un `InputSet` canonique depuis le manifeste raw geo épinglé par URI/version/hash, jamais depuis `graph_nodes` ni depuis un `latest.json` mouvant. L'actuel `graphify-inputset/v1`, lié à `runs/{source}/{runId}/manifest.jsonl` immo, doit devenir un `v2` geo ou recevoir un adaptateur sans perte qui conserve la référence geo originale sans fabriquer de manifeste immo. Le producteur résout les objets, vérifie les hashes, enregistre versions de segmentation/extracteur/prompts/modèles et produit des segments stables (`document_sha + locator + span_hash`). Full et incrémental reconstruisent un InputSet complet et appellent le même matérialiseur pur.

La chaîne est obligatoirement `InputSet geo → graphe sémantique raw-derived → fonction pure phase A → enrichissement phase B → shadow`. Le script PR #424 qui lit `graph_nodes` et écrit `latest.json` est un outil de migration, pas un producteur de B ; seule sa logique pure est réutilisée, avec golden d'équivalence aux sorties A acceptées.

Le scan PV-complet #368 doit transmettre chaque `habitationSegment` au générateur de candidats, au rapprochement dossier/règlement/zone et au matérialiseur. L'ancien triplet `reglementNumbers/changementZonage/zoneRefs` reste un indice, pas la seule voie. Chaque document et segment finit dans un registre `retained | deduplicated | excluded-with-reason` ; une absence de disposition bloque le run. Les goldens couvrent point secondaire, annexe, positif, négatif, distracteur et absence de citation.

### Sorties obligatoires

- Les 5 618 `Signal`/`DesignationEvent` concernés ont une `category` non nulle dans `immo-signal-category/v1` : `rezonage`, `modification_zonage`, `changement_usage`, `derogation`, `derogation_mineure`, `piia`, `ppcmoi`, `usage_conditionnel`, `lotissement`, `subdivision`, `densification`, `zone_agricole`, `cptaq`, `patrimoine`, `contrainte_reglementaire`, `autre`. Ce schéma doit vivre dans `radar-domain`; `GEO_CATEGORY_MAPPING` n'est que son miroir de présentation. L'abstention est `autre` + `category_needs_review=true`, jamais `NULL`.
- Chaque `Signal` possède `usage_dominant ∈ {residentiel, commercial, industriel, mixte, institutionnel, agricole, autre, inconnu}`, avec confiance, méthode et références. Ce champ ne reçoit jamais la valeur homonyme d'une `Zone`.
- `etapes_historique` est une liste unique des étapes observées pour le dossier, triée par date d'événement, rang canonique d'étape, puis hash de preuve ; les preuves restent dans les références/manifestes. Phase B ne redéfinit pas l'`etape` produite en phase A.
- Le vocabulaire et le rang des étapes sont ceux de `vivierEtapeSchema`/`stageOrder` dans `packages/radar-domain/src/vivier/vivier-v2.ts`; tout changement exige une version d'ontologie.
- Phase B conserve l'`immo Signal.effet_densifiant=inconnu` posé en A. L'intégration 4a est un lot distinct après ratification de son schéma et du mapping delta → effet ; elle devra produire une assertion immo référencée, jamais copier silencieusement `geo Zone.effet_densifiant`.
- `dossier_business_key/v1` vaut `{city_slug, reglement_number_normalized}` ou, sans numéro, `{city_slug, document_sha, locator, candidate_kind}`. Ce repli sépare prudemment les documents, force la revue et seul un merge du patch log peut agréger leur historique. Le mapping gelé conserve les IDs existants ; les nouveaux gardent les recettes mention `mention:<type>:<tuple-normalisé>`, canonique `<type>::<city_slug>::<terme-primaire-normalisé>`, Signal UUID de `signal:<canonicalDesignationEventId>:<kind>`. Collision de dossiers bloque ; alias/merge garde l'ID survivant. Horloge, run ID et sortie LLM sont exclus.

Dans le snapshot, les champs normatifs vivent sous `node.properties` : `category`, `category_source ∈ {deterministic,llm,abstention}`, `category_confidence ∈ [0,1]`, `category_evidence_refs: string[]`, `category_needs_review: boolean`; sur `Signal` seulement, `usage_dominant`, `usage_dominant_source` avec le même enum, `usage_dominant_confidence ∈ [0,1]`, `usage_dominant_evidence_refs: string[]`, `usage_dominant_needs_review: boolean`; puis `etapes_historique` selon l'enum ci-dessus. Le graphe porte `ontology_version="2.3"` et le manifeste `graphify_pass="3.4"`.

### Déterministe et LLM

Sont déterministes : membership/hashes, segmentation, citations, identifiants, références explicites, dates/étapes, regroupement par dossier, tri/déduplication, règles lexicales non ambiguës et abstention par preuve insuffisante. Un LLM ne traite que les candidats ambigus/non résolus, dans un appel structuré par dossier pour proposer ensemble catégorie et usage du signal à partir d'extraits cités. Il ne crée ni fait ni identifiant. Panne fournisseur, hors-schéma ou citation invalide bloque la publication ; seule une proposition valide qui conclut à l'insuffisance peut produire une abstention. Chaque proposition/validation est un reçu CAS immuable indexé par hashes du candidat, des extraits, du prompt, du modèle et des paramètres ; un replay réutilise le reçu ratifié sans appel live.

Audit du snapshot actuel, hors nouveaux candidats du full scan : parmi 5 618 catégories NULL, 2 724 ont exactement une famille lexicale candidate, 469 plusieurs et 2 425 aucune ; 2 894 est le plancher théorique du pool LLM si chaque candidat univoque passe la preuve, 5 618 le plafond de ce seul snapshot. Sur 7 221 nœuds audités pour l'usage, 1 674 ont une famille, 232 plusieurs et 5 315 aucune ; cela inclut les `DesignationEvent`, pas seulement les écritures `Signal`. Le seul volume autorisant le batch vient du préflight post-InputSet, scan et rapprochement : appels par type, tokens, modèle, prompt, coût maximal et taux d'abstention.

### Compatibilité du filtre A

Remplir `category` ne doit pas modifier le filtre A legacy `z|m|p`. Avant B, un manifeste pré-3.4 fige pour chaque état URL les business keys/IDs ordonnés, compteurs, clés de tri/tie-breaks et comportement URL. La projection 3.4 conserve cette membership dans un overlay legacy protégé, indépendant des nouvelles catégories ; aucun calcul 3.4 ne la recrée. Full, incrémental, projection et UI produisent chacun un reçu comparé au manifeste ; toute divergence est NO-GO et le rollback restaure la projection legacy gelée.

### Publication et critères d'acceptation

Le run écrit un graphe/manifeste shadow immuable avec la tuple complète `{inputsetHash, patchLogHash, geoManifestHash, legacyFilterAManifestHash, legacyIdMappingHash, parser, materializer, ontology, llmProposalHashes}`, puis projette le snapshot dans un namespace PostgreSQL versionné par `selection_hash`, sans toucher l'actif. Le manifeste Filter A et le mapping `business_key → id` sont des entrées obligatoires, rehashées avant build ; absence ou mismatch bloque build et activation. Après readback et gates, une transaction CAS change l'unique activation `{selection_hash, projection_id, manifest_uri, manifest_hash}`. Tous les accès directs à `latest.json` sont migrés vers ce sélecteur ; un fichier latest éventuel est un miroir post-commit sans autorité.

Acceptation : (1) replay raw geo → 3.4 sans baseline graphe ni appel LLM live si reçus présents ; (2) même tuple/reçus ⇒ mêmes IDs, arêtes, ordre et fingerprint protégé ; (3) full et incrémental convergent après ajouts, modifications et tombstones ; (4) `jq '[.nodes[] | select((.type=="Signal" or .type=="DesignationEvent") and (.properties.category == null))] | length'` vaut `0`, le schéma valide enum/provenance/revue et le gate SQL vérifie `props->'properties'` ; (5) zéro perte phase 0, golden A équivalent, reçus filtre A tous verts ; (6) citations geo résolubles, registre #368 complet, aucune écriture par geo dans `graph_nodes` ; (7) aucun lecteur n'observe deux versions, échec avant activation sans effet, rollback CAS vers un état validé.

## 6. Non établi et question exacte à `claude:geo`

N'ont pas pu être établis dans ce dépôt : le bucket/préfixe et l'IAM définitifs du corpus PV sous autorité geo ; le schéma du manifeste raw et des localisateurs OCR ; la stratégie sans duplication pour reprendre `radar-immobilier-docs-pocs` ; le schéma complet, la cardinalité, les tombstones et la publication atomique de 4a. Le nombre d'appels LLM par dossier reste également inconnu avant production de l'InputSet. La réponse geo ratifiée bloque l'implémentation du producteur raw, mais pas la ratification de cette architecture.

> `claude:geo`, la décision propriétaire établit que geo a l'autorité de référence sur l'acquisition, les octets bruts, l'OCR/texte, la preuve et la citabilité des PV/avis/règlements actuellement archivés par immo. Quel contrat exact publierez-vous en lecture seule pour immo : bucket/préfixes ou API, schéma et version du manifeste, clés/hashes/localisateurs de citation, IAM, rétention/tombstones, SLA de fraîcheur, et plan de reprise sans duplication de `radar-immobilier-docs-pocs` ? Pour l'artefact 4a, fournissez aussi le schéma complet, l'unicité/cardinalité de `{city_slug, zone_ref_canon_v1, reglement_number}`, la sémantique des inconnus, les preuves, le versionnage et le protocole de publication atomique du pointeur `latest.json`.
