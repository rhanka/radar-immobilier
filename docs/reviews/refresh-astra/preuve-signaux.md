# Preuve des signaux du rafraîchissement #703

## Mapping graphe → application

La source est `graph_nodes`, pas la table PostgreSQL `signals`. Un signal est
une ligne `type in ('Signal', 'DesignationEvent')`, avec `id`, `city_slug`,
`label`, `source_ref` et `props`. L'API `api/src/routes/graph-signals.ts` lit
cette projection via `getSignalNodesForCity`; elle appelle
`classifyGraphNodeVivierV2` de `api/src/services/graph/graph-store.ts` pour
chaque carte renvoyée.

L'interface est une SPA: elle ne possède pas de route par identifiant de nœud.
Le lien stable et ouvrable est donc la ville qui contient le nœud, avec la vue
B activée:

```text
https://immo-preprod.sent-tech.ca/geo/city/<citySlug>?mode=signal&filter.subset=b
https://immo.sent-tech.ca/geo/city/<citySlug>?mode=signal&filter.subset=b
```

`deploy/k8s/60-ingress.yaml` fixe l'hôte prod `immo.sent-tech.ca`. En préprod,
l'hôte demandé est `immo-preprod.sent-tech.ca`. `ui/src/lib/router/geo-route.ts`
construit `/geo/city/<citySlug>` et sérialise `filter.subset=b`; `App.svelte`
passe cette route à `SignauxMapView`, qui charge la ville. Le nœud précis est
identifié dans le tableau de preuve par son `id` (la sélection URL par `id` n'est
pas implémentée); la fiche UI le retrouve dans le flux de cette ville.

## Filtre B′ (vivier v2)

Le calcul est serveur dans `classifyGraphNodeVivierV2`, adaptateur direct de
`classifyVivierSignal` (`api/src/services/graph/vivier-v2.ts`). Les entrées sont
`type`, `category`, `label`, `description`, `etapeAnnote`, `props` et
`sourceRef`; les valeurs de `props.properties` et des références imbriquées sont
lues lorsque les colonnes projetées sont absentes.

* `zonage=oui`: `DesignationEvent`, ou catégorie de zonage (`rezonage`,
  `modification_zonage`, `changement_usage`), ou étape de zonage; une catégorie
  explicitement hors zonage est exclue.
* `residentiel=oui`: preuve résidentielle (logement, habitation, usage mixte,
  conversion vers le résidentiel), dont catégories fortes
  `developpement_residentiel`, `logement`, `logement_abordable`, `habitation`.
* R3 exclut un texte commercial/industriel/enseigne sans preuve résidentielle
  forte; R4 exclut `pôle commercial régional`. La raison servie est
  `non_residentiel_franc` (R4 est conservée comme détail dans
  `classifyBPrime`). PIIA et dérogation non résidentielles ont leurs raisons
  spécifiques.
* Une refonte ou un rezonage résidentiel indéterminé peut être visible dans le
  périmètre B, mais n'est pas **B′ qualifié**. Le compteur strict `qualified`
  exige simultanément `zonage=oui`, `residentiel=oui` et aucune exclusion
  (`packages/radar-domain/src/vivier/counts.ts`). Le script rend ces autres cas
  « B′ à confirmer » ou « exclu ».

L'étape est l'annotation valide en priorité (`avis_motion`,
`projet_reglement`, `consultation_publique`, `second_projet`, `adoption`,
`entree_vigueur`), sinon une inférence sur libellé/description. Elle informe la
vue, mais n'est pas une condition supplémentaire du compteur strict B′.

## Collecte reproductible sans API publique

`/api/graph-signals/*` est protégé: ne pas automatiser ce chemin avec un cookie
navigateur. Le manifeste `deploy/k8s/39-export-graph-nodes-job.yaml` est le
chemin de lecture prévu: il exporte les nœuds `Signal` et `DesignationEvent` en
NDJSON, projetés avec `citySlug`, `category`, `description`, `etapeAnnote`,
`props` et `sourceRef`, vers S3. Son accès DB/S3 utilise seulement les secrets
nommés `radar-db-credentials` et `radar-graph-s3-credentials`; leurs valeurs ne
sont ni requises ni exposées ici. L'API n'est donc pas nécessaire (auth API:
N-A pour cette procédure).

1. La lane k8s relève dans les logs de `radar-refresh-pv-<run>` les ids créés
   (et leurs villes si elles sont émises) et conserve le nom du job.
2. Elle obtient l'export NDJSON post-cycle par le job d'export approuvé et le
   chemin S3 affiché par ce job, sans écrire PG/S3. Si un export post-cycle est
   déjà disponible, elle le réutilise.
3. Dans un conteneur API isolé de la branche qui porte le classifieur, elle lance
   le script ci-dessous. Celui-ci filtre strictement les ids remis, réutilise
   `classifyGraphNodeVivierV2`, échoue si un id manque et écrit le tableau.
4. Elle publie les URLs produites et le tableau avec le reçu du job. Les URLs
   montrent la ville/vivier; l'id dans la première colonne est la preuve du
   nœud exact.

```bash
bash deploy/ci/prove-refresh-signals.sh /chemin/graph_nodes.ndjson "ID_1,ID_2" "https://immo-preprod.sent-tech.ca" /tmp/signaux.md
```

Pour prod, remplacer seulement l'origine par `https://immo.sent-tech.ca`.
Le test hermétique s'appuie sur
`api/src/scripts/fixtures/prove-refresh-signals.ndjson`:

```bash
bash deploy/ci/prove-refresh-signals.test.sh
```

## Observation préprod (lecture seule)

Le kubeconfig RO a été interrogé le 2026-09-17. Les lectures `ConfigMap` et
`Ingress` dans le namespace cible ont reçu `Forbidden`; aucune donnée de job ou
d'export exploitable n'a été accessible avec cette identité. L'exemple exécuté
est donc le fixture versionné: `proof-qualified` (Salaberry-de-Valleyfield) est
B′ qualifié; `proof-excluded` (Sainte-Martine) est exclu
`non_residentiel_franc`. Ce n'est pas une preuve e2e préprod; les ids du cycle
k8s restent nécessaires.
