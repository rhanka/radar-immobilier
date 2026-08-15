# SPEC_EVOL — Cartographie 3D photoréaliste au niveau zone

> **Statut** : EVOL, intention produit du propriétaire, 2026-08-14 ; décisions
> owner ratifiées après double revue modèle Sol + Fable le 2026-08-15,
> vérification domaine geo + geo-archi en cours.
> **Portée** : comportement de la vue géographique, seam commun des contrôles
> de carte et arbitrages préalables à l'implémentation.
> **Principe** : la préférence du propriétaire est une expérience de type
> Google Earth. Le périmètre du spike est ratifié, sans pré-approuver le choix
> final d'un fournisseur, d'un moteur ou d'une licence.

## 1. Contexte & intention

L'évolution demandée concerne le mode imagerie de la vue géographique :

- à l'échelle d'une zone, remplacer l'imagerie satellite 2D par une vue 3D
  photoréaliste, de type Google Earth (« Map 3D » / tuiles 3D
  photoréalistes) ;
- lorsque l'utilisateur dézoome au-dessus de cette échelle, revenir
  automatiquement à l'imagerie satellite 2D ;
- conserver en 3D les annotations du lot ou de la zone sélectionnés, comme en
  2D ;
- retirer les aplats de zonage dans les deux modes imagerie, satellite 2D et
  3D, afin que l'imagerie reste lisible.

La valeur produit est de rendre immédiatement perceptibles la volumétrie du
bâti, la forme urbaine et le contexte physique autour d'une zone, sans perdre
le lien avec le lot ou la zone en cours d'analyse. Le retour automatique à la
2D au dézoom évite le coût visuel et technique d'une scène 3D lorsque la vue
porte sur une ville ou la province.

### 1.1 État réel du dépôt revérifié au 2026-08-15

- `ui/src/lib/components/maps/GeoCityMapBase.svelte` est le socle cartographique
  partagé de Signaux et Sources/Couverture. Il initialise MapLibre GL JS
  `^5.24.0`, un fond raster OpenStreetMap et des couches GeoJSON de villes,
  zones et lots. Sa prop `basemap` ne connaît aujourd'hui que `osm` et
  `neutral-gray`, lus à l'initialisation ; ni satellite 2D ni 3D ne sont
  implémentés dans ce socle.
- Le cadrage initial du socle est `z = 7`. `SignauxMapView.svelte` cadre une
  ville à `z = 12`; le cadrage d'une zone passe par `fitBounds` avec un
  `maxZoom` par défaut de `15`, et le repli d'une géométrie dégénérée utilise
  `z = 14`.
- Le segment « Zone » est actuellement sémantique : il devient actif quand une
  zone est sélectionnée. Il n'est pas calculé à partir du zoom. Le zoom courant
  n'est reflété par le socle qu'après `load` et `moveend`, via
  `data-map-zoom`; l'API impérative `GeoCityMapApi` n'expose pas encore un flux
  de changement de caméra.
- `GeoCityMapBase.svelte` porte déjà la surface de contrôle commune : mesure en
  haut à droite, drill en haut à gauche, légendes en bas à gauche et attribution
  MapLibre en bas à droite. C'est le seam naturel de `feat/map-basemap-controls`.
- Les annotations existantes sont composées de sources/couches
  `selected-zones` et `selected-lots` : aplats, contours, exergues de sélection
  et libellés. L'état de sélection reste dans les vues parentes, notamment
  `selectionState` dans `SignauxMapView.svelte`; les préférences de libellés
  lot/zone y sont déjà persistées dans `localStorage`.
- Les autres surfaces ne sont pas équivalentes : `GeoView.svelte` consomme
  `GeoMap` de `@sentropic/geo-ui-svelte`, déclaré en `^0.1.1` dans
  `ui/package.json`; `EvaluationMapView.svelte` projette ses polygones dans un
  SVG; `CadastreMapView.svelte` est un autre wrapper MapLibre provisoire;
  `OpportunitesMapView.svelte` est une liste sans carte.

Ces constats interdisent de traiter la 3D comme un simple nouveau style
MapLibre ou comme un changement CSS. Un contrat de caméra, de couches,
d'attribution et de repli doit être commun aux moteurs retenus.

### 1.2 Direction owner G — module cartographique GEO-OWNED, DS-compliant

**Décidé (owner, après double revue modèle 2026-08-15) — vérification domaine
geo+geo-archi en cours.** La cible est un **module cartographique GEO-OWNED,
DS-compliant**. Cette décision renverse l'orientation précédente de modules
cartographiques résidant dans le design system et seulement validés par geo.
Elle interdit également un host 2D/3D bespoke durablement enfoui dans
l'application immobilière.

Les responsabilités sont réparties ainsi :

- **GEO** possède le runtime géospatial : host cartographique, CRS et
  projection, caméra normalisée, adaptateurs de renderer 2D/3D, couches et
  picking, capacités, attribution et exactitude géographique 2D/3D ;
- le **DESIGN SYSTEM** possède le chrome UI : tokens, thèmes, contrôles de
  légende et de mesure, layout responsive, accessibilité, états visuels et
  primitives d'interaction ;
- l'application **IMMO** conserve un adaptateur métier mince : sélection,
  filtres, panneaux, permissions, activation par route et politique de
  visibilité D9.

Le chrome du design system ne devient donc pas propriétaire du moteur, de la
caméra ou des couches. Réciproquement, le module geo doit consommer les
primitives et exigences du design system plutôt que recréer un système visuel
concurrent.

**Point de départ probable, après audit.** `ui/package.json` épingle
`@sentropic/geo-ui-svelte@^0.1.1`, résolu en `0.1.1` dans le lockfile, et
`ui/src/lib/components/geo/GeoView.svelte` importe son composant `GeoMap`. Le
repo geo inspecté déclare désormais la source de ce package en `0.5.0`. Cette
**dérive de version `^0.1.1` dans l'app IMMO contre `0.5.0` dans la source
geo** est le premier test de crédibilité de la capitalisation : aucune
compatibilité, publication ni aptitude 3D de `0.5.0` n'est supposée avant
audit. La base probable est `@sentropic/geo-ui-svelte` étendu, pas un nouveau
module concurrent.

**Questions bloquantes déléguées au complément design-system + geo.** Le
complément doit répondre sur preuves à ces quatre questions avant le gel du
seam v1 :

1. la montée `^0.1.1` → `0.5.0` introduit-elle des breaking changes, et quel
   est le coût réel d'upgrade de `GeoView.svelte` ?
2. l'abstraction moteur des couches est-elle réelle : `ZonesLayer`,
   `LotsLayer` et `SignalsLayer`, qui enveloppent aujourd'hui le `GeoMap`
   MapLibre dans la source `0.5.0`, sont-elles couplées à MapLibre ou prêtes
   pour un adaptateur de renderer 3D ?
3. `geo-core` expose-t-il effectivement un zoom normalisé, les garanties CRS
   nécessaires et une équivalence de caméra 2D/3D testable ? L'existence de
   types ou constantes CRS ne suffit pas à conclure sur la caméra.
4. comment lever la collision de nom entre `GeoMap` du design system,
   composant dataviz, et `GeoMap` de `@sentropic/geo-ui-svelte`, composant
   cartographique MapLibre, sans ambiguïté d'import ou de contrat ?

**Contrat esquissé côté application immobilière.** Les noms ci-dessous
décrivent des responsabilités et informations à échanger ; ils ne figent ni
l'API publique ni les frontières internes des packages geo :

| Surface du contrat | Application IMMO — adaptateur métier | Module cartographique GEO-OWNED | Design system — chrome UI |
| --- | --- | --- | --- |
| Données servies | Associe identifiants et catégories métier ; applique droits, filtres et sélection. | Consomme le contrat geo sans refetch métier lors d'une bascule ; garantit géométries, CRS/projection, provenance et transformations attendues. | Fournit les primitives visuelles et d'interaction des états de chargement, erreur et disponibilité. |
| Rendu | Exprime une intention métier indépendante de MapLibre ; ne transmet pas une expression de peinture MapLibre comme contrat portable 3D. | Rend fonds, couches et annotations via les adaptateurs 2D/3D ; possède caméra, picking, capacités, attribution et repli effectif. | Fournit tokens, thèmes, layout responsive et états visuels conformes. |
| Événements | Met à jour sélection, panneau et filtres depuis les événements normalisés. | Émet caméra, mode effectif, capacité, disponibilité, clic, sélection, focus et erreur sans inventer d'état métier. | Fournit les primitives accessibles de contrôle et de retour utilisateur. |
| Annotation lot/zone | Fournit identité sélectionnée et intentions contour, exergue, libellé et visibilité ; conserve le panneau de détail. | Garantit ancrage, projection et rendu équivalents en 2D/3D, ou signale explicitement la dégradation. | Définit les états visuels, contrastes, focus et alternatives accessibles. |
| Couches | Fournit sémantique, ordre métier, permissions et politique D9. | Déclare les renderers compatibles, applique ordre/profondeur, picking, provenance et attribution. | Rend l'indisponibilité et les contrôles de couche sans la masquer silencieusement. |
| Modes 2D/3D | Demande `map` ou `imagery`, puis `auto-3d` ou `force-2d`, et persiste seulement les choix non sensibles. | Retourne `map-2d`, `satellite-2d`, `tiles-3d` ou `fallback-2d`, avec caméra/zoom normalisés et cause fiable lorsqu'elle existe. | Porte les contrôles, libellés, états, focus et annonces accessibles correspondants. |

**Chemin de migration depuis les surfaces Svelte actuelles.** La migration est
explicite et incrémentale :

1. le complément design-system + geo audite la dérive `0.1.1` → `0.5.0`,
   répond aux quatre questions bloquantes et gèle un contrat de seam v1
   renderer-neutral ; aucune intégration UI 3D ne précède ce gel ;
2. P05 et les travaux 3D autorisés avancent en parallèle selon les deux portes
   de la section 4.2 ; P05 construit le fond satellite 2D réel et le seam UI
   auquel le runtime geo se raccorde à la seconde porte ;
3. `@sentropic/geo-ui-svelte` est étendu sous ownership geo si l'audit confirme
   ce point de départ ; `GeoCityMapBase.svelte` et `GeoView.svelte` deviennent
   les deux familles de consommateurs de la première livraison définie par D5 ;
4. les données, filtres, `selectionState`, `selectedHit`, panneaux et
   permissions restent côté IMMO ; host, caméra, modes, couches, picking,
   attribution et calcul géospatial de mesure passent dans le module geo, avec
   chrome et primitives du design system ;
5. `SourceCoverageMap.svelte`, consommateur du socle partagé, participe au
   contrat de première livraison sans activation implicite de la 3D sur sa
   route ; `EvaluationMapView.svelte` et le wrapper cadastral font l'objet de
   migrations séparées ;
6. pour chaque surface migrée, l'ancien renderer bespoke est retiré lorsque la
   parité est acceptée ; deux chemins concurrents ne sont pas maintenus
   durablement pour une même vue.

**Renvoi explicite — complément de proposition design-system + geo.** Le
complément est co-construit par design-system + geo, sous responsabilité geo
pour le runtime, et vérifié par geo + geo-archi. Il doit détailler l'API
publique, les frontières de packages, les adaptateurs de renderer, le cycle de
version/livraison et la stratégie de migration. La présente spec fixe la
résidence et la répartition de responsabilités ; elle ne prétend pas que les
capacités manquantes existent déjà.

### 1.3 Traçabilité owner

La demande initiale est tracée dans
[`SPEC_RAW_USER_REVIEW_2026-08-12.md` §5](SPEC_RAW_USER_REVIEW_2026-08-12.md#5-geographic-view) :
contrôle Carte/Satellite, conservation des annotations lot/zone sélectionnées et
retrait des aplats de zonage en mode satellite. L'extension vers une expérience
3D de type « Google Earth » est une **amende owner du 2026-08-14**. Le dépôt en
consigne la provenance comme **jugement**, et non comme verbatim, dans
[`reports/DOSSIER_DECISION_3D_MAPS_2026-08-14.md`](reports/DOSSIER_DECISION_3D_MAPS_2026-08-14.md).
Aucun transcript supplémentaire n'est inféré ou fabriqué par la présente spec.

## 2. Comportement UX cible

### 2.1 Modes et règle combinée de bascule

Le contrôle de fond de carte expose au minimum deux intentions :

1. **Carte** : fond cartographique non photographique ; aucune bascule 3D
   automatique.
2. **Imagerie automatique** : satellite 2D à l'échelle large, 3D
   photoréaliste à l'échelle zone lorsque le service est disponible.

La règle de déclenchement décidée est **combinée avec condition de cadrage** :

- passage de la satellite 2D à la 3D lorsque le zoom MapLibre équivalent atteint
  **`z >= 14,0`**, **ou** lorsqu'une zone sélectionnée sémantiquement reste
  cadrée à une échelle significative dans le viewport ;
- maintien de la 3D tant que la branche zoom reste dans sa bande d'hystérésis,
  ou tant que la zone sélectionnée reste cadrée à cette échelle significative ;
- retour à la satellite 2D lorsque le zoom atteint **`z <= 13,5`** et qu'aucune
  zone n'est sélectionnée, **ou** lors d'un dézoom franc qui fait perdre à la
  zone sélectionnée son cadrage significatif ; la sélection et son annotation
  restent alors conservées en 2D ;
- au chargement direct, 3D si le seuil zoom est atteint, ou si la condition
  sémantique **et son cadrage requis** sont satisfaits ; sinon satellite 2D, y
  compris dans la bande d'hystérésis.

L'hystérésis de `0,5` évite une alternance rapide au voisinage du seuil. Le
segment sémantique « Zone » reste piloté par la sélection, mais ne constitue
jamais un verrou 3D permanent. Le « cadrage significatif » doit être défini par
le seam v1 à partir de la visibilité de la cible, de son emprise dans le
viewport et du zoom normalisé, sans seuil inventé dans cette spec. Le seuil
`14,0` reste provisoire, cohérent avec le cadrage ville actuel à `12`, le repli
de géométrie dégénérée à `14` et les cadrages de zone jusqu'à `15`. La
calibration sur un échantillon urbain/rural réel peut introduire un **plancher
de zoom propre à la branche sémantique**, comme prévu en D2.

En 3D, un contrôle explicite et toujours atteignable **« Satellite 2D »** force
le repli sans modifier le centre, la cible sélectionnée ou le zoom logique. Le
contrôle complémentaire **« 3D automatique »** réactive la règle combinée. Ce
forçage empêche toute réactivation automatique de la 3D tant que l'utilisateur
ne rétablit pas le mode automatique.

### 2.2 Préservation des annotations et retrait des aplats

Une annotation préservée signifie, pour la zone ou le lot sélectionné :

- la même identité métier avant et après la bascule ;
- un contour ou exergue de sélection visible et non ambigu ;
- le libellé lot/zone si sa préférence d'affichage est active ;
- le même panneau de détail et le même focus dans l'état de sélection de la
  surface concernée (`selectionState`/bucket dans Signaux, `selectedHit` dans
  la route `geo`) ;
- des interactions clic/focus équivalentes lorsque le moteur 3D les supporte.

Les données GeoJSON et l'état de sélection ne sont ni rechargés ni recréés lors
d'une bascule de moteur. Ils sont projetés par un adaptateur propre au moteur
2D ou 3D. Dans le socle actuel, `GeoCityMapApi.syncGeoLayers` reçoit des
expressions de peinture MapLibre : cette signature n'est pas portable telle
quelle vers un moteur 3D et doit être séparée des données/intentions de couche.

Dans **tous** les modes imagerie :

- les couches d'aplat représentant le zonage sont masquées, y compris
  `selected-zones-fill` et toute future couche de zonage de type `fill` ;
- le choroplèthe municipal et les aplats de lots **non sélectionnés** sont
  masqués conformément à D9 ;
- les contours, exergues et libellés nécessaires à l'annotation sélectionnée
  restent visibles ;
- masquer les aplats ne signifie pas effacer les données, la sélection, les
  filtres ou la légende métier ;
- la matrice finale par mode et par état de sélection est arrêtée sur les
  premières captures réelles selon D9 ; elle ne peut pas réintroduire par
  défaut le choroplèthe ou les aplats non sélectionnés.

### 2.3 Persistance et continuité de caméra

- Le choix **Carte / Imagerie automatique** et le forçage **Satellite 2D / 3D
  automatique** sont persistés pour l'origine applicative, dans un stockage
  client non sensible. Ils survivent à un changement de vue et à un reload.
- Le mode rendu courant `2D` ou `3D` n'est pas persisté : il est dérivé du choix,
  du zoom, de la capacité du navigateur et de la disponibilité du service.
- Lors d'une bascule, le centre géographique, le zoom logique, la sélection et
  les préférences de libellés sont conservés. Le mapping entre zoom MapLibre et
  altitude, champ de vue ou empreinte au sol du moteur 3D doit définir un
  **zoom normalisé équivalent MapLibre**, déterministe dans les deux sens et
  testable. Sans cette normalisation, le seuil de retour depuis la 3D n'est pas
  implémentable de façon stable.
- Le cap et l'inclinaison 3D ne doivent pas contaminer silencieusement le retour
  2D. Leur conservation, leur remise à zéro et l'éventuel contrôle
  « Réorienter au nord » font partie de l'arbitrage moteur.

### 2.4 Accessibilité, attribution et erreurs

- Les contrôles sont des boutons ou radios natifs, atteignables au clavier,
  activables avec Entrée/Espace, avec libellés visibles et noms accessibles.
  L'état courant est exposé par `aria-pressed` ou `aria-checked` et ne repose
  pas uniquement sur une icône.
- Un changement automatique de moteur est annoncé de façon non intrusive aux
  technologies d'assistance. `prefers-reduced-motion` supprime les transitions
  animées non nécessaires ; il ne supprime pas l'accès au repli 2D.
- Le panneau de détail de la cible sélectionnée reste l'alternative textuelle
  opérable au canvas 2D/3D. La 3D ne doit pas rendre une donnée accessible
  uniquement par survol.
- L'attribution du fond actif et de ses sous-fournisseurs est visible en
  permanence, non recouverte par la légende, le contrôle de mesure ou le
  contrôle de fond. Le libellé et les liens exacts suivent le contrat du
  fournisseur retenu.
- Clé absente, refus d'authentification, quota dépassé, timeout, WebGL requis
  indisponible, chargement du moteur impossible ou zone hors couverture : la
  carte reste utilisable en satellite 2D, affiche un état bref et honnête
  **« 3D indisponible — satellite 2D affichée »**, puis permet de réessayer.
  La variante **« 3D non couverte dans cette zone »** n'est utilisée que si le
  fournisseur expose une cause de couverture distincte et fiable. Après un
  échec dur, aucune relance automatique répétée n'a lieu pendant la session ;
  une action explicite relance l'essai. Aucun de ces cas ne laisse un canvas
  vide ni un chargement infini.
- Si le **fond satellite 2D lui-même** est indisponible, le repli est le fond
  cartographique non photographique `map-2d` disponible (`osm` ou
  `neutral-gray` selon le choix P05), avec sélection et annotations conservées,
  attribution adaptée et message **« Satellite indisponible — carte
  affichée »**. La cause n'est précisée que si elle est fiable, sans boucle de
  relance automatique.

## 3. Approche technique et options réelles

### 3.1 Contraintes issues de la stack actuelle

MapLibre GL JS `5.24` est la dépendance cartographique directe du front. Il sait
rendre les sources raster/vectorielles, le terrain compatible et les couches
personnalisées, mais le dépôt ne contient ni CesiumJS, ni deck.gl, ni client
Google Maps 3D, ni adaptateur OGC 3D Tiles. Le rendu de tuiles 3D
photoréalistes exige donc un moteur ou un adaptateur supplémentaire.

Le dépôt ne définit actuellement aucune clé dédiée aux tuiles cartographiques.
La variable serveur générale liée aux modèles Google ne doit pas être réutilisée
pour les cartes. Une clé cartographique doit être séparée, limitée à l'API, au
projet de facturation et aux origines autorisées.

Aucune politique CSP applicative complète n'est observable dans le dépôt. Cela
ne prouve pas l'absence d'en-têtes au niveau de l'ingress ou de la plateforme.
Le choix du moteur doit donc produire une allowlist CSP vérifiée sur le
déploiement réel : au minimum `script-src`, `connect-src`, `img-src`, et selon
le moteur `worker-src`, WebAssembly et `blob:`.

### 3.2 Options fournisseur/moteur

#### Option A — Google Maps JavaScript API 3D

- **Intégration** : monter une scène Google 3D dans le host cartographique au
  seuil, à côté du renderer MapLibre 2D. Les expressions et couches MapLibre ne
  sont pas réutilisables directement ; zones, lots, contours et libellés doivent
  être traduits vers les primitives 3D supportées et confrontés à l'occlusion
  par le bâti.
- **Clé** : clé navigateur nécessaire et donc observable par le client. Elle
  doit être restreinte par origine et par API. Un proxy ne masque pas le script
  client et ne doit pas être supposé compatible avec les conditions de service.
- **CSP/exploitation** : domaines de script, de tuiles et de télémétrie Google à
  autoriser selon la documentation au moment de l'intégration. Le chargement
  dynamique limite le coût de bundle hors mode 3D.
- **Coût/licence/confidentialité** : facturation et quotas Google Maps Platform,
  conditions d'affichage et attribution obligatoires à instruire. Le fournisseur
  reçoit au minimum les requêtes réseau, l'adresse IP, l'origine et la zone de
  caméra demandée. Aucun identifiant utilisateur ni donnée de sélection ne doit
  être ajouté aux URL fournisseur.
- **Écart avec le dépôt** : moteur nouveau et parallèle ; intégration visuelle
  directe avec la préférence Google Earth, mais double implémentation des
  annotations et de la caméra.

#### Option B — Google Photorealistic 3D Tiles (Map Tiles API) avec CesiumJS

- **Intégration** : CesiumJS est conçu pour les 3D Tiles et peut porter la scène,
  la caméra et les overlays GeoJSON. Il faut un adaptateur
  `GeoCityMapApi`/caméra et une stratégie explicite de montage-démontage ou de
  conservation des deux canvases. Les couches MapLibre restent la voie 2D.
- **Clé** : accès client avec clé/session limitée, ou création de session et
  relais same-origin côté serveur. Le relais ne peut être retenu qu'après
  validation des règles de proxy, cache et redistribution du fournisseur ; il
  ajoute journalisation, egress et disponibilité serveur.
- **CSP/exploitation** : `connect-src` pour les tuiles et métadonnées, workers et
  assets Cesium, éventuellement `worker-src blob:` et WebAssembly. Poids du
  moteur, mémoire GPU et comportement mobile à mesurer.
- **Coût/licence/confidentialité** : coût/quota de Map Tiles API ; CesiumJS et un
  éventuel service Cesium ion ont des licences et facturations distinctes. Les
  attributions du jeu de tuiles et du service intermédiaire se cumulent.
- **Écart avec le dépôt** : moteur 3D robuste, mais nouvelle dépendance lourde et
  contrat de caméra/interaction à construire.

#### Option C — deck.gl `Tile3DLayer`, accès direct ou via un service Cesium

- **Intégration** : deck.gl peut rendre un tileset 3D et des couches GeoJSON. Il
  peut être superposé à MapLibre ou vivre dans un renderer séparé. La parité de
  caméra, le picking, la profondeur, l'occlusion et l'ordre des couches doivent
  être prouvés avec les tuiles photoréalistes visées ; une simple superposition
  2D ne suffit pas.
- **Clé** : clé/token navigateur restreint ou relais autorisé par les contrats
  respectifs. Un token Cesium et une clé Google, s'ils sont tous deux requis,
  restent deux identifiants d'accès observables et deux surfaces de quota
  distinctes.
- **CSP/exploitation** : endpoints de tuiles, workers/loaders et éventuel
  WebAssembly à autoriser. deck.gl et ses loaders ne sont pas présents dans le
  dépôt.
- **Coût/licence/confidentialité/attribution** : addition des obligations du jeu
  de données, du service de diffusion et du moteur. L'accès via un catalogue ne
  doit pas être présumé disponible ou redistribuable sans validation écrite.
- **Écart avec le dépôt** : possibilité de conserver davantage du host MapLibre,
  avec un risque d'intégration WebGL et de picking supérieur à un moteur 3D
  dédié.

#### Option D — MapLibre avec couche personnalisée et renderer 3D Tiles

- **Intégration** : MapLibre seul ne rend pas nativement le flux
  photogrammétrique Google demandé. Une `custom layer` adossée à un renderer
  3D/loader externe pourrait partager le canvas et préserver les couches
  MapLibre, à condition de synchroniser projection, profondeur, cycle de rendu
  et perte de contexte WebGL.
- **Clé/CSP** : mêmes contraintes de clé et de domaines que le fournisseur de
  tuiles, plus les workers/assets du renderer ajouté.
- **Coût/licence/confidentialité/attribution** : MapLibre ne supprime aucune
  obligation du fournisseur de données. L'attribution doit rester visible dans
  le contrôle commun.
- **Écart avec le dépôt** : meilleure continuité théorique des couches 2D, mais
  maintenance et risque technique les plus élevés tant qu'un prototype ne
  démontre pas le rendu de vraies tuiles 3D, le picking et l'occlusion.

### 3.3 Alternatives aux tuiles Google

- **Cesium ion / fournisseurs 3D Tiles** : hébergement ou diffusion d'un jeu de
  tuiles licencié, avec token, quota et attribution propres. La couverture
  photoréaliste du Québec et le droit d'usage commercial doivent être vérifiés ;
  la disponibilité d'un jeu Google dans un catalogue ne doit pas être supposée.
- **Source ouverte / diffusion auto-hébergée** : contrôle de la diffusion et
  des journaux, mais acquisition légale des images/maillages, pipeline de
  tuilage, stockage, CDN, mises à jour, attribution et coût d'exploitation
  deviennent la responsabilité du produit. Aucune source photogrammétrique
  exploitable de ce type n'est identifiée dans le dépôt pour le Québec ; ce
  constat local ne prouve pas qu'il n'en existe aucune hors dépôt.
- **MapTiler** : voie écartée du spike par décision owner du 2026-08-15. Aucun
  temps de comparaison ne lui est consacré dans le spike autorisé.

### 3.4 Spike comparatif autorisé avant arbitrage

**Décidé (owner, après double revue modèle 2026-08-15) — vérification domaine
geo+geo-archi en cours.** Le spike D1/D3 est autorisé sur les trois familles
retenues : **Google Photorealistic 3D Tiles, Cesium ion et
self-hosted/open**. MapTiler est écarté. Le comparatif ne confond pas
fournisseur de données et moteur : il est structuré sur les axes **source ×
renderer × diffusion** et n'évalue que les combinaisons juridiquement et
techniquement plausibles, sans supposer qu'une source est portable entre tous
les renderers ou canaux de diffusion.

- **Source** : jeu photogrammétrique réellement couvert, licenciable et assez
  frais pour les zones québécoises visées ;
- **renderer** : capacité à rendre la source et à satisfaire caméra, couches,
  picking, annotation et mesure via le seam v1 ;
- **diffusion** : accès direct Google, service Cesium ion ou diffusion
  self-hosted/open, avec leurs contrats, clés, quotas, attribution, cache et
  flux de données propres.

Une combinaison est éliminée dès qu'elle échoue sur la couverture ou la
licence, avant l'investissement d'intégration. La voie self-hosted/open est
donc susceptible d'être éliminée tôt si le spike ne trouve pas de source
photogrammétrique légale et suffisamment couverte au Québec ; cette élimination
reste une conclusion à prouver, pas un fait déjà acquis.

Le spike est timeboxé avec **arbitrage au plus tard le 2026-08-22**. Tout
décalage exige de consigner une nouvelle date avant de poursuivre. Pour chaque
combinaison encore plausible, il doit livrer le même dossier comparatif :

1. preuve de couverture et de rendu sur des zones réellement servies par
   l'environnement de recette ;
2. matrice des fonctionnalités : caméra, contours/libellés, picking, mesure,
   couches environnementales et couches utilisateur ;
3. prix courant, unité facturée, quotas, alertes et estimation mensuelle selon
   un scénario de démo et un scénario de production explicités ;
4. conditions de licence, cache/proxy, captures, attribution et usage
   commercial ;
5. flux de données et analyse de confidentialité ;
6. configuration de clé, restrictions, rotation, télémétrie et CSP ;
7. poids chargé, temps au premier rendu 3D, mémoire/GPU et taux de repli 2D sur
   le parc cible.

Le dossier inclut explicitement le scénario **d'un fournisseur commun à D8 et
D1**, sans en faire une préférence ni supposer qu'il est économiquement ou
contractuellement meilleur que deux fournisseurs distincts. « Sans engagement
de dépense » signifie **sans contrat ni abonnement engagé** ; un budget d'essai
plafonné reste possible s'il est approuvé et consigné avant usage, sans que la
présente spec en invente le montant.

Aucun fournisseur n'est choisi tant que ce dossier n'est pas arbitré. La
préférence Google Earth est un critère produit explicite, pas une exemption aux
contraintes ci-dessus. La réversibilité est forte au stade de la spec et du
spike seulement ; une intégration de production, une migration de renderer ou
un contrat fournisseur ne sont pas réputés également réversibles.

## 4. Impact & intégration

### 4.1 Composants réels

| Composant | Impact établi par le code actuel |
| --- | --- |
| `ui/src/lib/components/maps/GeoCityMapBase.svelte` | Seam actuel : host MapLibre, état de fond, caméra, contrôles, attribution, erreur et projection des couches. P05 doit y raccorder le contrat de mode du seam v1 ; la cible déplace le runtime géospatial dans le module GEO-OWNED et le chrome dans les primitives du design system, plutôt que de pérenniser ce composant comme host 3D bespoke. |
| `ui/src/lib/components/maps/SignauxMapView.svelte` | Porte la sélection lot/zone, le niveau sémantique, les expressions de peinture et les préférences de libellés. Il doit fournir au module geo un état métier stable, sans réinitialiser `selectionState`, les filtres ou le panneau droit ; ses expressions MapLibre ne constituent pas l'API portable. |
| `ui/src/lib/components/maps/SignauxSelPanel.svelte` | Ne rend pas la carte, mais constitue l'alternative textuelle et le miroir du focus. Son identité sélectionnée doit rester inchangée pendant la bascule. |
| `ui/src/lib/components/sources-map/SourceCoverageMap.svelte` | Second consommateur de `GeoCityMapBase` et inclus dans l'inventaire de la première livraison D5. Il reçoit le contrat commun sans activation implicite de l'imagerie ou de la 3D sur sa route. |
| `ui/src/lib/components/geo/GeoView.svelte` | La route `geo`, incluse dans D5, utilise déjà `GeoMap` de `@sentropic/geo-ui-svelte@^0.1.1`. Le repo geo déclare la source `0.5.0`, mais l'usage actuel n'expose ni basemap ni hook de renderer 3D ; upgrade et extension doivent être prouvés par le complément. |
| `ui/src/lib/components/maps/EvaluationMapView.svelte` | Carte SVG indépendante, sans zoom continu ni fond satellite. Elle n'hérite pas de la bascule 3D sans migration explicite vers le module geo et adoption du chrome du design system. |
| `ui/src/lib/components/maps/OpportunitesMapView.svelte` | Aucun canvas cartographique actuel ; pas d'impact direct. |
| `ui/src/lib/components/maps/CadastreMapView.svelte` | Wrapper MapLibre distinct et provisoire, avec URL de tuiles raster configurable. Aucun import actif de ce composant n'est trouvé dans le code courant ; il ne doit pas recevoir une seconde implémentation divergente des contrôles s'il est réactivé. |
| `ui/src/lib/components/maps/MapLegend.svelte` | Légende propre à la carte SVG d'Évaluation. Les légendes du socle partagé sont plutôt la prop `legend` et le slot `overlay-bottom-left` de `GeoCityMapBase.svelte`. |
| `ui/src/lib/components/ViewLayout.svelte` | En mode compact, les boutons de drawers occupent déjà `left-3 top-3 z-20` et, avec panneau de sélection, `right-3 top-3 z-20`, aux mêmes emplacements que le drill et la mesure du socle. Le seam des contrôles doit corriger ces collisions existantes avant d'ajouter fond, repli ou orientation. |

La notion de « vue géographique » recouvre donc plusieurs surfaces dans le
dépôt. L'implémentation doit nommer explicitement les routes couvertes et ne pas
prétendre qu'une modification de `GeoCityMapBase.svelte` modifie automatiquement
`GeoView.svelte` ou la carte SVG.

### 4.2 Parallélisme à deux portes avec P05

Le fond satellite 2D requis par le mode Imagerie **n'existe pas** dans le code
revérifié au 2026-08-15 : aucune occurrence de `satellite` n'est présente sous `ui/src`,
et `GeoCityMapBase.svelte` ne propose que `osm` et `neutral-gray`. Son
fournisseur, sa source et sa licence ne sont pas choisis. Le socle du mode
Imagerie et de chaque repli gracieux décrit dans cette spec est donc encore un
livrable à construire, pas une capacité disponible.

**Décidé (owner, après double revue modèle 2026-08-15) — vérification domaine
geo+geo-archi en cours.** La 3D avance **en parallèle** de P05
(`feat/map-basemap-controls`), sous un séquencement à deux portes. « En
parallèle » autorise le complément d'architecture, le spike D1/D3 et les preuves
renderer-neutral ; il ne supprime aucune des deux portes :

1. **Porte 1 — gel du seam v1.** Aucune intégration UI 3D ne commence avant le
   gel d'un contrat de seam v1 renderer-neutral issu du complément
   design-system + geo. Ce contrat matérialise G : runtime sous ownership geo,
   chrome conforme au design system et adaptateur IMMO mince.
2. **Porte 2 — synchronisation réelle P05.** Le parcours complet se raccorde au
   vrai fond satellite 2D et au seam effectivement livrés par P05. Il couvre le
   choix D8, la source, la licence, l'attribution, la clé/quota, le rendu
   interactif et le repli `map-2d` lorsque le satellite est indisponible.

Le développement **fournisseur-spécifique de production** ne commence qu'après
l'arbitrage du spike D1/D3 et la matérialisation de G par le complément et le
seam v1 gelé. Un prototype jetable du spike ne constitue ni une intégration UI,
ni un fond de repli, ni l'acceptation de P05. Aucun contrôle 3D local propre à
une vue ne contourne le seam.

En cas de contention de ressources, **P05 passe devant le chantier 3D**.
L'acceptation intégrée reste gated par P05 et D8 : elle exige le fond satellite
réel, son repli et le seam P05, même si les travaux amont 3D sont terminés.
Ainsi, P05 ne doit pas précéder tout travail 3D, mais il précède nécessairement
la seconde porte et l'acceptation intégrée.

Le seam commun possède :

- l'intention `map` ou `imagery`, le réglage `auto-3d` ou `force-2d` et l'état
  effectif `map-2d`, `satellite-2d`, `tiles-3d` ou `fallback-2d` ;
- le zoom/caméra normalisé et les transitions avec hystérésis ;
- l'attribution et l'état de disponibilité du fond actif ;
- les emplacements de contrôle, de légende et de mesure ;
- un contrat de capacité par couche et par renderer.

L'activation de l'imagerie/3D est opt-in par vue. L'adaptation de
`GeoCityMapBase.svelte` au contrat ne doit pas activer implicitement la 3D dans
Sources/Couverture.

Répartition sans collision à préserver :

- haut gauche : drill et messages contextuels existants ;
- groupe de contrôles carte : fond, repli 2D, orientation et mesure, dans une
  zone commune plutôt que des boutons absolus concurrents ;
- bas gauche : légendes métier empilables ;
- bas droite : attribution légale réservée et toujours visible.

Les contrôles doivent rester utilisables aux largeurs mobile et bureau, sans
recouvrir le panneau de mesure ouvert, les légendes, le détail sélectionné ou
les mentions légales. Si le moteur impose ses propres contrôles ou logos, leur
emprise fait partie du layout, pas d'un overlay que l'application peut masquer.

### 4.3 Couches environnementales et couches personnalisées

Les futures couches environnementales et couches utilisateur partagent la même
pile de rendu. Chaque couche doit déclarer au seam commun : type de géométrie,
renderer(s) supporté(s), ordre/profondeur, attribution, provenance et état de
disponibilité.

- Une couche vectorielle compatible peut être drapée ou rendue par un adaptateur
  3D, avec picking et attribution conservés.
- Une couche uniquement 2D n'est jamais masquée silencieusement : le contrôle ou
  la légende indique **« non disponible en 3D »** et offre le repli 2D.
- Une couche utilisateur ne devient pas une couche canonique ou partagée par le
  seul fait d'être rendue en 3D ; ses permissions et sa portée restent
  inchangées.
- Les aplats de zonage restent retirés en imagerie même si d'autres couches
  environnementales ou personnalisées utilisent des aplats.

Le contrôle de mesure actuel est interne au renderer MapLibre. D6 fixe pour la
3D une **distance vraie dans l'espace 3D**, et non une distance horizontale ou
simplement projetée au sol. Le calcul géospatial appartient au module geo ; le
contrôle, ses états et son aide appartiennent au chrome du design system.

Cette décision porte un risque d'implémentation explicite : les deux revues
modèle recommandaient de désactiver la mesure en 3D ou de la projeter au sol
afin d'éviter une interprétation ambiguë. Ce dissent ne retranche pas le choix
owner. Le complément doit cadrer les points d'ancrage, l'occlusion, les unités,
la distinction avec la mesure au sol, la persistance lors d'une bascule et la
façon dont l'utilisateur vérifie qu'il mesure bien un segment spatial 3D. Une
valeur ambiguë ou silencieusement projetée ne satisfait pas D6.

## 5. Critères d'acceptation

Les critères suivants sont cumulatifs. Une preuve DOM simulant un mode 3D sans
renderer ni tuile réellement rendue ne les satisfait pas.

### AC-00 — Deux portes et intégration synchronisée avec P05

- La porte 1 est prouvée par un contrat de seam v1 renderer-neutral gelé, issu
  du complément design-system + geo et conforme à G ; aucune intégration UI 3D
  ne la précède.
- Le fournisseur-spécifique de production ne commence qu'après arbitrage du
  spike D1/D3 et gel de ce seam. Les prototypes jetables du spike sont
  distingués du code de production.
- À la porte 2, P05 a livré le seam réel et choisi/documenté D8 ; de vraies
  tuiles satellite sont rendues dans une vue couverte et leur indisponibilité
  replie sur `map-2d` avec l'état prévu.
- Le parcours 2D↔3D intégré consomme ce fond et ce seam réels. En cas de
  contention documentée, P05 a priorité ; aucun contrôle propre à une vue ne
  contourne les portes.

### AC-01 — Machine d'état de la règle combinée

- En Imagerie automatique sans zone sélectionnée, un chargement à `z = 13,99`
  rend la satellite 2D et un chargement à `z = 14,00` demande la 3D.
- Depuis la 2D, la 3D s'active à `z >= 14,00` ou dès qu'une zone est
  sélectionnée sémantiquement **et** cadrée à une échelle significative, y
  compris sous ce seuil si le plancher sémantique calibré le permet.
- Depuis la 3D, sans zone sélectionnée, `z = 13,51` conserve la 3D et
  `z = 13,50` revient en 2D. Avec une zone sélectionnée, la branche sémantique
  maintient la 3D seulement tant que son cadrage reste significatif ; un
  dézoom franc revient en 2D sans désélectionner ni perdre l'annotation.
- En Carte ou en Satellite 2D forcée, aucun zoom ne déclenche de requête 3D.
- Les tests couvrent le chargement direct, la molette/pincement, les commandes
  `flyTo`/`fitBounds`, la sélection/désélection de zone sur l'échantillon
  urbain/rural, le plancher sémantique retenu et les mouvements rapides de part
  et d'autre du seuil.

### AC-02 — Continuité de sélection et de caméra

- Dans un scénario avec une zone réellement servie et sélectionnée, puis dans
  un scénario distinct avec un lot réellement servi et sélectionné, la bascule
  2D→3D→2D conserve l'identifiant, le focus du panneau, les filtres et les
  préférences de libellés. Le critère ne suppose pas une sélection simultanée
  zone+lot, incompatible avec le bucket exclusif actuel.
- Le centre cible reste dans une tolérance documentée et le zoom logique ne
  saute pas hors de la bande attendue. Aucun refetch de données métier n'est
  causé uniquement par le changement de renderer.
- Le contour/exergue et le libellé activé de la cible sont visibles dans les
  deux renderers, y compris devant le relief ou le bâti ; le picking de la cible
  ouvre le même détail lorsque cette interaction est annoncée disponible.

### AC-03 — Imagerie sans aplats de zonage

- En satellite 2D et en 3D, aucune couche d'aplat de zonage ne couvre
  l'imagerie. Le test inspecte l'état effectif des couches et une capture du
  canvas.
- Le choroplèthe municipal et les aplats de lots non sélectionnés sont masqués.
  Les contours/exergues/libellés de la cible restent présents. Le passage en
  Carte restaure les aplats selon les filtres et opacités précédents.
- La matrice finale D9 est appliquée et testée séparément par mode et état sur
  les premières captures réelles ; aucun comportement implicite n'est accepté.

### AC-04 — Persistance et contrôle explicite

- Les choix de fond et de repli survivent à un reload et à une navigation entre
  vues couvertes, sans persister de clé, d'identifiant métier ou d'URL de tuile.
- Le bouton Satellite 2D produit un repli immédiat sans désélection ni mouvement
  de caméra ; la 3D ne revient pas avant l'action explicite 3D automatique.

### AC-05 — Dégradation honnête

- Clé absente, clé refusée, réponse 404 de couverture, quota/429, timeout,
  erreur réseau, perte de contexte WebGL et navigateur sans capacité requise
  sont testés séparément.
- Chaque cas aboutit à une satellite 2D interactive, un message visible et
  accessible, une action Réessayer quand elle est utile, et aucune boucle de
  requêtes. L'absence de clé en CI est un scénario de repli normal.
- L'indisponibilité du fond satellite lui-même aboutit séparément à un fond
  `map-2d` interactif, sélection et annotations conservées, attribution
  correcte et message « Satellite indisponible — carte affichée ».
- Lorsque le fournisseur distingue de façon fiable le hors-couverture, l'UI dit
  « 3D non couverte dans cette zone ». Sans signal fiable, elle reste sur le
  message générique « 3D indisponible » et n'invente pas la cause.

### AC-06 — Attribution, sécurité et confidentialité

- Les captures de chaque mode montrent l'attribution exacte, lisible et non
  recouverte. Un test de layout vérifie les quatre coins avec légende et panneau
  de mesure ouverts.
- La clé client, si cette option est retenue, est distincte des clés LLM,
  restreinte par API/origine et surveillée par quota ; aucune clé serveur
  secrète n'est intégrée au bundle.
- Les journaux et requêtes fournisseur ne contiennent ni identité utilisateur,
  ni contenu de panneau, ni identifiant de lot/zone ajouté par l'application.
- La CSP de production est testée sans wildcard global ; aucun domaine n'est
  ajouté sans justification du moteur retenu.

### AC-07 — Accessibilité et responsive

- Tout le parcours Carte → Imagerie automatique → Satellite 2D → 3D automatique
  → Réessayer est réalisable au clavier, avec focus visible, nom et état annoncés.
- À `390 × 844` et `1280 × 720`, contrôles, légendes, mesure, détail et
  attribution ne se chevauchent pas et restent atteignables.
- Avec mouvement réduit, la bascule est immédiate ou faiblement animée et
  n'empêche aucune fonction.
- En 3D, le contrôle de mesure annonce explicitement une distance dans l'espace
  3D, rend ses points d'ancrage vérifiables et ne substitue jamais en silence
  une distance horizontale ou projetée au sol. Les cas d'occlusion et de
  bascule 2D↔3D sont testés conformément au cadrage D6.

### AC-08 — Preuve de rendu non contournable

La recette fournit, pour au moins une zone et un lot réellement servis :

1. une capture satellite 2D dézoomée ;
2. une capture 3D photoréaliste au-dessus du seuil, même cible sélectionnée ;
3. une capture 3D sans aplats de zonage, annotation et attribution visibles ;
4. une capture de chaque repli clé absente et hors couverture, puis du repli
   `map-2d` lorsque le satellite 2D est indisponible ;
5. une trace associant mode effectif, zoom normalisé, identifiants de renderer,
   requête de tileset réussie et absence de refetch métier.

La preuve utilise le fournisseur/licence de recette réellement retenu et
n'expose aucune clé. Des mocks restent requis pour les erreurs déterministes,
mais ne remplacent pas les captures de vraies tuiles 3D.

### AC-09 — Compatibilité future des couches partagées

- Une fixture contractuelle de couche environnementale ou personnalisée
  déclarée compatible 3D conserve rendu, picking, provenance et attribution
  dans la scène. Une recette sur couche réelle devient obligatoire dès qu'une
  telle couche existe dans la livraison.
- Une couche déclarée 2D-only produit l'état « non disponible en 3D » et un
  chemin de repli ; elle ne disparaît jamais sans explication.
- L'ordre des couches garantit que l'annotation sélectionnée et les mentions
  légales restent lisibles.

## 6. Décisions, arbitrages ouverts, séquencement / dissents

### D1 — Fournisseur de l'imagerie 3D

- **Décidé (owner, après double revue modèle 2026-08-15) — vérification domaine
  geo+geo-archi en cours.** Le spike fournisseur est autorisé sur **Google
  Photorealistic 3D Tiles, Cesium ion et self-hosted/open**. MapTiler est
  écarté. Il est structuré par source × renderer × diffusion, applique
  l'élimination anticipée couverture/licence et passe en arbitrage au plus tard
  le 2026-08-22 selon la section 3.4.
- **Préférence produit** : rendu Google Earth / Google Photorealistic 3D Tiles.
- **Arbitrage restant** : choisir sur preuves parmi les combinaisons encore
  viables ; l'autorisation du spike n'emporte aucun choix final de fournisseur.
- **À décider sur preuves** : couverture réelle au Québec, qualité, fraîcheur,
  droits commerciaux, coût/quota, confidentialité, attribution et sortie de
  fournisseur. Le scénario d'un fournisseur commun à D8 et D1 est inclus.
- **Dépense** : aucun contrat ni abonnement n'est autorisé par cette décision ;
  un budget d'essai plafonné peut être approuvé et consigné séparément.

### D2 — Règle combinée de bascule

- **Décidé (owner, après double revue modèle 2026-08-15) — vérification domaine
  geo+geo-archi en cours.** Règle combinée avec entrée en 3D à **`z >= 14,0`
  provisoire** ou quand une zone sélectionnée reste cadrée à une échelle
  significative. La sélection seule ne verrouille jamais la 3D.
- **Sortie** : sans sélection, l'hystérésis provisoire sort à `z <= 13,5` ; avec
  sélection, un dézoom franc qui rend son cadrage non significatif revient en
  satellite 2D tout en conservant annotation, panneau, filtres et identité.
- **Calibration requise** : éprouver la règle et ses valeurs sur un échantillon
  urbain/rural réel. La calibration peut introduire un plancher de zoom sur la
  branche sémantique et doit définir le cadrage significatif sans remplacer
  implicitement la règle combinée par un seuil unique.
- **Dissent conservé** : un seuil unique serait plus simple et prédictible,
  mais cadrerait mal certaines zones rurales ou très étendues; la branche
  sémantique couvre ce cas au prix d'une machine d'état plus complexe.

### D3 — Moteur de rendu

- **Décidé (owner, après double revue modèle 2026-08-15) — vérification domaine
  geo+geo-archi en cours.** Le même spike D1 instruit le renderer sur la matrice
  source × renderer × diffusion, sans le préjuger et sans inclure MapTiler.
- **Google Maps JS 3D** : proximité de l'expérience préférée, moteur parallèle
  et annotations à réimplémenter.
- **CesiumJS** : support 3D Tiles dédié, coût de bundle et contrat de caméra à
  intégrer.
- **deck.gl** : overlays flexibles, risque de profondeur/picking à prouver.
- **MapLibre + custom layer** : continuité du socle, complexité technique la
  plus élevée.

Le choix dépend du prototype comparatif de section 3.4, pas d'une préférence
d'implémentation.

### D4 — Clé client ou relais serveur

- **Client** : architecture plus directe ; clé observable, donc restrictions
  d'origine/API, quotas et rotation obligatoires.
- **Relais** : secret potentiellement mieux isolé et politique centralisée ;
  coût d'egress, disponibilité, logs, cache et conformité contractuelle à
  valider. Un relais interdit par la licence est exclu.

### D5 — Surfaces cartographiques couvertes

**Décidé (owner, après double revue modèle 2026-08-15) — vérification domaine
geo+geo-archi en cours.** La première livraison couvre **les consommateurs de
`GeoCityMapBase.svelte` et la route `geo`/`GeoView.svelte`**. L'activation de
l'imagerie et de la 3D demeure explicite par route ; l'inclusion de
`SourceCoverageMap.svelte` dans le contrat ne l'active pas implicitement.

Comme réduction de risque, le **build de cette première livraison est délégué
à une passe 5.6 Sol max**. Cette délégation ne change ni les deux portes D10,
ni les critères AC-00–AC-09, ni l'ownership G. La carte SVG et le wrapper
cadastral provisoire restent hors de cette première livraison et ne justifient
pas une architecture bespoke concurrente.

### D6 — Mesure et caméra 3D

**Décidé (owner, après double revue modèle 2026-08-15) — vérification domaine
geo+geo-archi en cours.** La mesure en 3D est une **distance vraie dans l'espace
3D**, pas une distance horizontale ni une projection au sol.

**Risque d'implémentation conservé.** Les deux revues modèle recommandaient de
désactiver la mesure ou de la projeter au sol pour éviter l'ambiguïté
d'interprétation. Le choix owner n'est pas retranché : points d'ancrage,
occlusion, unités, aide, persistance pendant la bascule et validation par le
renderer doivent être cadrés et prouvés. Plage d'inclinaison, cap initial et
commande de remise au nord restent à instruire avec le contrat caméra.

### D7 — Politique des couches non compatibles 3D

À trancher par catégorie de couche : adaptation 3D, maintien 2D forcé, ou
indisponibilité déclarée. Les couches environnementales et utilisateur ne
doivent pas imposer chacune leur propre renderer ou leur propre légende.

### D8 — Fournisseur du fond satellite 2D

- **Décidé (owner, après double revue modèle 2026-08-15) — vérification domaine
  geo+geo-archi en cours.** Le fournisseur du fond satellite 2D est décidé dans
  le spike de section 3.4, avec échéance de livraison dans P05.
- **État vérifié** : aucun fond satellite n'existe sous `ui/src` et aucun
  fournisseur n'est choisi. Le raster OSM actuel, y compris sa variante
  `neutral-gray`, n'est pas ce fond de repli.
- **Critères** : le choix applique les mêmes axes économiques et juridiques que
  D1 — couverture Québec, qualité/fraîcheur, droits commerciaux et de capture,
  attribution, coût/quota, confidentialité, clé/CSP, cache/proxy et sortie de
  fournisseur.
- **Scénarios** : le fournisseur satellite 2D peut différer de D1 ; le scénario
  d'un fournisseur commun D8+D1 est comparé sans couplage supposé.
- **Repli** : si le satellite est indisponible, le mode effectif devient
  `map-2d` sur un fond non photographique disponible, avec sélection,
  annotations et attribution conservées, message honnête et sans boucle de
  relance.

### D9 — Choroplèthe municipal et aplats de lots en mode imagerie

**Décidé (owner, après double revue modèle 2026-08-15) — vérification domaine
geo+geo-archi en cours.** En mode imagerie, le choroplèthe municipal et les
aplats de lots **non sélectionnés** sont masqués. Le contour, l'exergue et le
libellé actif de la cible sélectionnée restent visibles ; les données,
permissions, filtres et sélections ne sont pas supprimés.

La matrice finale par mode et par état est arrêtée sur les premières captures
réelles. Cette validation précise notamment le traitement visuel de la cible
sans réintroduire silencieusement le choroplèthe ou les aplats non sélectionnés.
La politique est contractuelle et testée dans AC-03.

### D10 — Parallélisme à deux portes et priorité P05

**Décidé (owner, après double revue modèle 2026-08-15) — vérification domaine
geo+geo-archi en cours.** La 3D avance en parallèle de P05 selon deux portes :

1. aucun travail d'intégration UI avant le gel du seam v1 renderer-neutral issu
   du complément design-system + geo ;
2. synchronisation finale sur le vrai fond satellite 2D et le seam P05.

Le développement fournisseur-spécifique de production commence seulement
après arbitrage du spike D1/D3 et matérialisation de G. En cas de contention,
P05 a priorité. L'acceptation intégrée reste gated par P05/D8 et AC-00 ; la 3D
ne duplique ni sélecteur de fond, ni attribution, ni gestion
d'indisponibilité.

## 7. Hors périmètre & inconnues

### 7.1 Hors périmètre de cette évolution

- contrat, abonnement, licence de production ou dépense non plafonnée ; le
  budget d'essai plafonné prévu par D1 reste possible après approbation séparée ;
- implémentation, ajout de dépendance, variable d'environnement, proxy, CSP ou
  configuration de déploiement ;
- acquisition photogrammétrique, génération ou maintenance de tuiles 3D ;
- extrusion des règles de zonage, simulation de gabarits constructibles, ombres,
  ensoleillement, visite guidée, réalité augmentée ou édition 3D ;
- migration implicite de toutes les cartes historiques vers un moteur unique ;
- architecture interne détaillée du module cartographique GEO-OWNED et de ses
  adaptateurs, déléguée au complément design-system + geo dans les limites G ;
- modification du modèle métier, des données de lot/zone, du scoring ou des
  permissions de couches utilisateur ;
- définition d'un prix fournisseur à partir d'un tarif non figé dans le dépôt.

### 7.2 Inconnues non vérifiables dans le dépôt

- couverture, résolution et fraîcheur de la 3D photoréaliste pour les zones
  québécoises visées ;
- tarifs, quotas, crédits, conditions commerciales et textes d'attribution en
  vigueur au moment de l'implémentation ;
- droit de proxy, cache, capture de recette et redistribution pour chaque
  fournisseur ;
- projet de facturation, clé cartographique, restrictions d'origine et budget
  autorisés ;
- CSP et en-têtes réellement appliqués en production hors de ce dépôt ;
- breaking changes et coût de montée de `@sentropic/geo-ui-svelte` `0.1.1` vers
  la source `0.5.0`, abstraction renderer de ses couches et aptitude 3D ;
- exposition effective par `geo-core` d'un zoom normalisé, garanties CRS et
  équivalence caméra 2D/3D répondant au seam v1 ;
- performance GPU, consommation mémoire, accessibilité native et compatibilité
  navigateur sur le parc utilisateur réel ;
- détails d'ancrage, d'occlusion et de persistance de la mesure spatiale 3D
  décidée en D6 ;
- disponibilité effective des futures couches environnementales et
  personnalisées au moment de la livraison 3D.

Ces inconnues doivent être levées par les preuves appropriées — complément
design-system + geo, calibration urbain/rural et spike D1/D3/D8 — avant le
développement fournisseur-spécifique de production. Le contrat produit ferme
déjà la résidence G, le périmètre D5, la continuité de sélection, les retraits
D9, la mesure spatiale D6, les replis et les deux portes D10. Le fournisseur 3D,
le renderer, la clé et le fournisseur satellite D8 restent à arbitrer sur les
preuves du spike, sans rouvrir ces décisions owner.
