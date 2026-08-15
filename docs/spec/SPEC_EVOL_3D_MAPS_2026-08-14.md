# SPEC_EVOL — Cartographie 3D photoréaliste au niveau zone

> **Statut** : EVOL, intention produit du propriétaire, 2026-08-14.
> **Portée** : comportement de la vue géographique, seam commun des contrôles
> de carte et arbitrages préalables à l'implémentation.
> **Principe** : la préférence du propriétaire est une expérience de type
> Google Earth. Elle ne pré-approuve ni fournisseur, ni moteur, ni licence.

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

### 1.1 État réel du dépôt au 2026-08-14

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

### 1.2 Direction owner — modules cartographiques du design system validés par geo

**Décision owner.** Les vues cartographiques, y compris cette vue 3D, doivent
être capitalisées dans des **modules UI cartographiques du design system
`sent-tech-design-system`, validés par geo**. La cible n'est ni une
capitalisation UI autonome sous ownership geo, ni une implémentation 2D/3D
bespoke enfouie dans l'application immobilière. Le design system porte les
cartographiques réutilisables; geo valide leur correction géographique et
domaine — CRS/projection, rendu des zones et lots, exactitude 2D/3D et
annotations — et fournit le contrat de données et de serving geo. L'application
immobilière consomme ces modules et ce contrat tout en conservant l'autorité sur
son état métier. Les spikes et choix de renderer évaluent cette cible commune,
pas une exception locale à l'application immobilière.

**Point de départ vérifié, statut architectural ouvert.** `ui/package.json`
déclare `@sentropic/geo-ui-svelte@^0.1.1` et
`ui/src/lib/components/geo/GeoView.svelte` en importe le composant `GeoMap`.
Cette vue lui transmet aujourd'hui une `FeatureCollection` unifiée, un rendu
`choropleth`, des catégories, une légende, une intention de `fitBounds` et un
callback de sélection. `@sentropic/geo-ui-svelte` est donc le point de départ à
évaluer. Il reste explicitement ouvert de décider s'il demeure sous ownership
geo ou entre dans le design system; ni son aptitude actuelle à la 3D ni son
architecture future ne peuvent être déduites de cet usage.

**Contrat esquissé côté application immobilière.** Les noms ci-dessous décrivent
des responsabilités et des informations à échanger; ils ne figent ni l'API
publique, les frontières de packages ni l'ownership final du point de départ :

| Surface du contrat | Application immobilière — consommatrice | Modules UI du design system | Geo — contrat et validation |
| --- | --- | --- | --- |
| Données servies | Consomme le contrat geo, associe les identifiants et catégories métier et applique les droits, filtres et états de sélection dont elle reste responsable. | Accepte les données du contrat sans imposer un refetch métier lors d'une bascule de renderer. | Fournit le contrat de données/serving geo et valide géométries, CRS/projection, provenance spatiale et transformations attendues. |
| Rendu | Exprime une intention de vue et de style métier indépendante de MapLibre; elle ne transmet pas une expression de peinture MapLibre comme contrat portable 3D. | Rend le fond, les couches, la caméra, les contrôles, l'attribution, les capacités et le repli selon le renderer disponible. | Valide la correction du rendu géographique, notamment zones/lots et équivalence spatiale 2D/3D. |
| Événements | Reçoit les changements de caméra, de mode effectif, de capacité, de disponibilité et les interactions sur une cible; met à jour sélection, panneau et filtres. | Émet des événements de caméra et de mode normalisés ainsi que clic, sélection, focus et erreur sans inventer d'état métier. | Valide les sémantiques spatiales et les normalisations nécessaires au contrat geo. |
| Annotation lot/zone | Fournit l'identité sélectionnée et les intentions contour, exergue, libellé et visibilité; conserve l'autorité sur le panneau de détail. | Représente l'annotation de façon équivalente en 2D et 3D selon ses capacités et signale explicitement toute dégradation. | Valide l'exactitude géographique de l'annotation, de son ancrage et de sa projection en 2D/3D. |
| Couches | Consomme les couches servies et fournit leur sémantique, leur ordre métier et leur politique de visibilité applicative. | Déclare les renderers compatibles, applique l'ordre/profondeur et rend visible l'indisponibilité d'une couche plutôt que de la masquer silencieusement. | Fournit les exigences geo de géométrie, provenance, attribution et compatibilité de serving. |
| Modes 2D/3D | Demande `map` ou `imagery`, puis `auto-3d` ou `force-2d`, et persiste seulement les choix utilisateur non sensibles. | Retourne l'état effectif `map-2d`, `satellite-2d`, `tiles-3d` ou `fallback-2d`, avec caméra/zoom normalisés et cause de repli fiable lorsqu'elle existe. | Valide l'équivalence géographique des caméras, projections et annotations entre modes. |

**Chemin de migration depuis les surfaces Svelte actuelles.** La migration est
explicite et incrémentale, sans prétendre qu'un changement d'une surface migre
automatiquement les autres :

1. P05 construit le fond satellite 2D réel et le seam commun des contrôles
   décrit en section 4.2 pendant que le développement 3D avance en parallèle;
   les comportements actuels de caméra, sélection, couches, mesure, légende et
   attribution de `GeoCityMapBase.svelte` restent des exigences de parité au
   point de synchronisation d'intégration.
2. Après le complément de proposition design-system + geo, les modules UI
   cartographiques sont étendus à partir du point de départ `GeoMap` selon
   l'ownership qui y sera décidé; `GeoView.svelte`, déjà consommateur, sert de
   point de validation du contrat de données et d'événements, sans être
   considéré comme déjà compatible 3D.
3. `GeoCityMapBase.svelte` et `SignauxMapView.svelte` migrent par frontière :
   les données, filtres, `selectionState` et panneaux restent côté immobilier;
   le host cartographique, la caméra, les modes, les contrôles et la projection
   des couches passent dans les modules UI du design system, sous contrat et
   validation geo, après preuve de parité. `SourceCoverageMap.svelte`,
   consommateur du même socle, est traité dans ce même inventaire de
   compatibilité sans activation implicite de la 3D.
4. `EvaluationMapView.svelte` fait l'objet d'une migration séparée depuis son
   SVG, avec parité de sélection, de rendu des lots/zones et d'accessibilité
   démontrée avant bascule. Son existence ne justifie pas un second moteur 3D
   propre à l'application.
5. Pour chaque surface migrée, l'ancien renderer bespoke est retiré lorsque la
   parité est acceptée; la migration ne maintient pas durablement deux chemins
   concurrents pour la même vue.

**Renvoi explicite — complément de proposition design-system + geo.**
L'architecture détaillée des modules UI cartographiques du design system est
déléguée à un **COMPLÉMENT DE PROPOSITION** co-construit par la **lane
design-system + geo**, avec validation geo, puis revu par
**geo-archi + 5.6 Sol + Fable 5**. Ce complément doit notamment détailler
l'API publique, les frontières et ownerships de packages — y compris le statut de
`@sentropic/geo-ui-svelte` —, les adaptateurs de renderer, le cycle de
version/livraison et la stratégie de migration. La présente spec fixe la
direction owner et le contrat attendu côté immobilier, avec les contraintes UX
et les preuves d'acceptation; elle ne tranche pas l'architecture des modules du
design system.

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

La règle de déclenchement décidée est **combinée** :

- passage de la satellite 2D à la 3D lorsque le zoom MapLibre équivalent atteint
  **`z >= 14,0`**, **ou** lorsqu'une zone est sélectionnée sémantiquement ;
- maintien de la 3D tant que la sélection sémantique de zone reste active, ou
  dans la bande d'hystérésis du déclencheur par zoom ;
- retour à la satellite 2D lorsque le zoom atteint **`z <= 13,5`** et qu'aucune
  zone n'est sélectionnée ;
- au chargement direct, 3D si l'une des deux conditions d'entrée est satisfaite,
  sinon satellite 2D, y compris dans la bande d'hystérésis.

L'hystérésis de `0,5` évite une alternance rapide au voisinage du seuil. Le
segment sémantique « Zone » reste piloté par la sélection : il constitue le
second déclencheur de la 3D, sans falsifier le zoom courant ni provoquer de saut
de caméra. Le seuil `14,0` reste cohérent avec le cadrage ville actuel à `12`,
le repli de géométrie dégénérée à `14` et les cadrages de zone jusqu'à `15`;
la règle combinée et ses valeurs doivent être calibrées sur un échantillon
urbain/rural réel comme prévu en D2.

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
- les contours, exergues et libellés nécessaires à l'annotation sélectionnée
  restent visibles ;
- masquer les aplats ne signifie pas effacer les données, la sélection, les
  filtres ou la légende métier ;
- la demande owner tranche le retrait des aplats de zonage, mais pas le devenir
  des aplats de lots ni du choroplèthe municipal. Cet arbitrage UX est élevé en
  décision D9 : aucune de ces couches ne doit hériter silencieusement du
  comportement Carte ou disparaître sans politique explicite.

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
- **MapTiler** : fonds, terrain et bâtiments 3D possibles selon offre et
  couverture. Ce n'est pas automatiquement un équivalent photogrammétrique à
  Google Earth ; la qualité, la fraîcheur et la couverture au niveau zone
  doivent être comparées sur un échantillon réel.
- **Tuiles 3D auto-hébergées** : contrôle de la diffusion et des journaux, mais
  acquisition légale des images/maillages, pipeline de tuilage, stockage, CDN,
  mises à jour, attribution et coût d'exploitation deviennent la responsabilité
  du produit. Aucune source exploitable de ce type n'est identifiée dans le
  dépôt.

### 3.4 Spike comparatif autorisé avant arbitrage

Le spike comparatif autorisé par D1 et D3 confronte quatre voies : **Google
direct, Cesium, MapTiler et tuiles auto-hébergées**. Il est chiffré sur une base
homogène et n'autorise aucun engagement de dépense. Pour chaque voie, il doit
livrer le même dossier comparatif :

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

Aucun fournisseur n'est choisi tant que ce dossier n'est pas arbitré. La
préférence Google Earth est un critère produit explicite, pas une exemption aux
contraintes ci-dessus.

## 4. Impact & intégration

### 4.1 Composants réels

| Composant | Impact établi par le code actuel |
| --- | --- |
| `ui/src/lib/components/maps/GeoCityMapBase.svelte` | Seam actuel : host MapLibre, état de fond, caméra, contrôles, attribution, erreur et projection des couches. P05 doit y stabiliser le contrat de mode; la cible porte ces capacités dans les modules UI cartographiques du design system, sous contrat et validation geo, plutôt que de pérenniser ce composant comme host 3D bespoke. |
| `ui/src/lib/components/maps/SignauxMapView.svelte` | Porte la sélection lot/zone, le niveau sémantique, les expressions de peinture et les préférences de libellés. Il doit fournir aux modules UI du design system un état stable conforme au contrat geo, sans réinitialiser `selectionState`, les filtres ou le panneau droit; ses expressions MapLibre ne constituent pas l'API portable. |
| `ui/src/lib/components/maps/SignauxSelPanel.svelte` | Ne rend pas la carte, mais constitue l'alternative textuelle et le miroir du focus. Son identité sélectionnée doit rester inchangée pendant la bascule. |
| `ui/src/lib/components/sources-map/SourceCoverageMap.svelte` | Second consommateur de `GeoCityMapBase`. Il héritera du contrat commun si l'imagerie y est activée ; la portée produit de la 3D sur Sources/Couverture reste à trancher. |
| `ui/src/lib/components/geo/GeoView.svelte` | La route `geo` utilise déjà `GeoMap` de `@sentropic/geo-ui-svelte`, point de départ vérifié de la capitalisation. Son usage actuel n'expose ni basemap ni hook de renderer 3D; le complément design-system + geo doit décider son ownership et détailler son évolution. Aucune compatibilité 3D ne peut être affirmée depuis le dépôt. |
| `ui/src/lib/components/maps/EvaluationMapView.svelte` | Carte SVG indépendante, sans zoom continu ni fond satellite. Elle n'hérite pas de la bascule 3D sans migration explicite vers les modules UI du design system et validation geo. |
| `ui/src/lib/components/maps/OpportunitesMapView.svelte` | Aucun canvas cartographique actuel ; pas d'impact direct. |
| `ui/src/lib/components/maps/CadastreMapView.svelte` | Wrapper MapLibre distinct et provisoire, avec URL de tuiles raster configurable. Aucun import actif de ce composant n'est trouvé dans le code courant ; il ne doit pas recevoir une seconde implémentation divergente des contrôles s'il est réactivé. |
| `ui/src/lib/components/maps/MapLegend.svelte` | Légende propre à la carte SVG d'Évaluation. Les légendes du socle partagé sont plutôt la prop `legend` et le slot `overlay-bottom-left` de `GeoCityMapBase.svelte`. |
| `ui/src/lib/components/ViewLayout.svelte` | En mode compact, les boutons de drawers occupent déjà `left-3 top-3 z-20` et, avec panneau de sélection, `right-3 top-3 z-20`, aux mêmes emplacements que le drill et la mesure du socle. Le seam des contrôles doit corriger ces collisions existantes avant d'ajouter fond, repli ou orientation. |

La notion de « vue géographique » recouvre donc plusieurs surfaces dans le
dépôt. L'implémentation doit nommer explicitement les routes couvertes et ne pas
prétendre qu'une modification de `GeoCityMapBase.svelte` modifie automatiquement
`GeoView.svelte` ou la carte SVG.

### 4.2 Développement parallèle et point de synchronisation avec P05

Le fond satellite 2D requis par le mode Imagerie **n'existe pas** dans le code
au 2026-08-14 : aucune occurrence de `satellite` n'est présente sous `ui/src`,
et `GeoCityMapBase.svelte` ne propose que `osm` et `neutral-gray`. Son
fournisseur, sa source et sa licence ne sont pas choisis. Le socle du mode
Imagerie et de chaque repli gracieux décrit dans cette spec est donc encore un
livrable à construire, pas une capacité disponible.

Le développement de la 3D avance **en parallèle** de P05
(`feat/map-basemap-controls`). L'absence actuelle du fond satellite ne bloque
pas le chantier 3D en amont. En revanche, le fond satellite 2D livré par P05
reste le prérequis fonctionnel du mode Imagerie en 2D et de tout repli gracieux.
P05 et la 3D ont donc un **point de synchronisation d'intégration** : le
comportement 2D↔3D complet et le repli gracieux ne peuvent être finalisés et
acceptés qu'une fois les éléments suivants disponibles :

1. le choix du fournisseur du fond satellite 2D, sa source, sa licence, son
   attribution, son modèle de clé/quota et sa politique d'indisponibilité ;
2. un fond satellite 2D réellement rendu et interactif, y compris le scénario
   de tuiles indisponibles ;
3. le seam commun des contrôles de carte, de l'attribution, des légendes, de la
   mesure et des états de disponibilité auquel la 3D se raccorde au point de
   synchronisation.

Le spike comparatif fournisseur/moteur autorisé par D1 et D3, ainsi que le
développement 3D, peuvent avancer avant ce point de synchronisation. Ils ne
constituent toutefois ni un fond de repli ni l'acceptation de P05 et
n'autorisent pas à implémenter un contrôle 3D local dans l'application.

La 3D complète le futur contrôle partagé de fond de carte ; elle ne doit pas
créer un bouton local propre à une seule vue. P05 stabilise ce seam sur les
surfaces actuelles pendant que la 3D est développée; leur raccord se fait au
point de synchronisation. Le portage dans les modules UI du design system,
sous contrat et validation geo, suit le complément de proposition
design-system + geo. Ce séquencement ne préjuge pas de leur architecture
interne. Le seam commun possède :

- l'intention `map` ou `imagery`, le réglage `auto-3d` ou `force-2d` et l'état
  effectif `map-2d`, `satellite-2d`, `tiles-3d` ou `fallback-2d` ;
- le zoom/caméra normalisé et les transitions avec hystérésis ;
- l'attribution et l'état de disponibilité du fond actif ;
- les emplacements de contrôle, de légende et de mesure ;
- un contrat de capacité par couche et par renderer.

L'activation de l'imagerie/3D est opt-in par vue. L'ajout du contrat dans
`GeoCityMapBase.svelte` ne doit pas activer implicitement la 3D dans
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

Le contrôle de mesure actuel est interne au renderer MapLibre. Sa sémantique en
3D — distance horizontale, distance au sol ou segment 3D — et sa persistance
pendant une bascule doivent être décidées. Tant qu'une mesure 3D équivalente
n'est pas validée, le contrôle est désactivé avec une raison accessible ou
propose le repli 2D ; il ne doit pas produire une valeur ambiguë.

## 5. Critères d'acceptation

Les critères suivants sont cumulatifs. Une preuve DOM simulant un mode 3D sans
renderer ni tuile réellement rendue ne les satisfait pas.

### AC-00 — Intégration synchronisée avec P05

- P05 a choisi et documenté le fournisseur du fond satellite 2D conformément à
  D8, et rend de vraies tuiles satellite dans une vue couverte.
- Le passage Carte/Satellite 2D, l'attribution et le repli sur indisponibilité
  sont acceptés sur le seam commun des contrôles au point de synchronisation;
  le parcours 2D↔3D complet et son repli gracieux consomment ce fond réel.
- Le développement 3D peut commencer et avancer avant cette intégration. Son
  acceptation intégrée exige le fond satellite et le seam livrés par P05; aucun
  contrôle 3D propre à une vue ne les contourne.

### AC-01 — Machine d'état de la règle combinée

- En Imagerie automatique sans zone sélectionnée, un chargement à `z = 13,99`
  rend la satellite 2D et un chargement à `z = 14,00` demande la 3D.
- Depuis la 2D, la 3D s'active à `z >= 14,00` ou dès qu'une zone est
  sélectionnée sémantiquement, y compris sous ce seuil.
- Depuis la 3D, sans zone sélectionnée, `z = 13,51` conserve la 3D et
  `z = 13,50` revient en 2D; avec une zone sélectionnée, la branche sémantique
  maintient la 3D sans modifier la caméra.
- En Carte ou en Satellite 2D forcée, aucun zoom ne déclenche de requête 3D.
- Les tests couvrent le chargement direct, la molette/pincement, les commandes
  `flyTo`/`fitBounds`, la sélection/désélection de zone sur l'échantillon
  urbain/rural et les mouvements rapides de part et d'autre du seuil.

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
- Les contours/exergues/libellés de sélection restent présents. Le passage en
  Carte restaure les aplats selon les filtres et opacités précédents.
- La politique issue de D9 est appliquée et testée séparément au choroplèthe
  municipal et aux aplats de lots en satellite 2D et en 3D; aucun comportement
  implicite n'est accepté.

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

### AC-08 — Preuve de rendu non contournable

La recette fournit, pour au moins une zone et un lot réellement servis :

1. une capture satellite 2D dézoomée ;
2. une capture 3D photoréaliste au-dessus du seuil, même cible sélectionnée ;
3. une capture 3D sans aplats de zonage, annotation et attribution visibles ;
4. une capture de chaque repli clé absente et hors couverture ;
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

- **Préférence produit** : rendu Google Earth / Google Photorealistic 3D Tiles.
- **Orientation owner (2026-08-14), à ratifier APRÈS double revue geo + geo-archi** : un spike comparatif chiffré est autorisé entre
  Google direct, Cesium, MapTiler et des tuiles auto-hébergées, sans engagement
  de dépense. Cette autorisation n'emporte aucun choix de fournisseur.
- **Arbitrage restant** : choisir sur preuves entre les quatre voies comparées.
- **À décider sur preuves** : couverture réelle au Québec, qualité, fraîcheur,
  droits commerciaux, coût/quota, confidentialité, attribution et sortie de
  fournisseur.

### D2 — Règle combinée de bascule

- **Orientation owner (2026-08-14), à ratifier APRÈS double revue geo + geo-archi** : règle combinée avec entrée en 3D à
  **`z >= 14,0` ou sur sélection sémantique d'une zone**. Sans sélection de
  zone, la sortie par zoom reste `z <= 13,5`; la branche sémantique ne modifie
  pas silencieusement le zoom ni la caméra.
- **Calibration requise** : éprouver la règle et ses valeurs sur un échantillon
  urbain/rural réel, puis documenter le résultat sans remplacer implicitement
  la règle combinée par un seuil unique.
- **Dissent conservé** : un seuil unique serait plus simple et prédictible,
  mais cadrerait mal certaines zones rurales ou très étendues; la branche
  sémantique couvre ce cas au prix d'une activation 3D possible sous le seuil.

### D3 — Moteur de rendu

- **Orientation owner (2026-08-14), à ratifier APRÈS double revue geo + geo-archi** : le même spike comparatif chiffré est autorisé
  sur les voies Google direct, Cesium, MapTiler et auto-hébergée, sans
  engagement de dépense. Il instruit le choix du moteur sans le préjuger.
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

Le dépôt a un socle MapLibre partagé, une route `geo` sur une primitive externe,
une carte SVG et deux wrappers historiques. Il faut décider si la première
livraison couvre :

1. les consommateurs de `GeoCityMapBase.svelte` seulement ;
2. la route `geo` seulement ;
3. une convergence préalable de ces surfaces.

La décision doit éviter deux contrôles de fond incompatibles et préciser le
devenir de la carte SVG et du wrapper cadastral provisoire. Quelle que soit la
première surface livrée, la direction vers les modules UI cartographiques du
design system, sous contrat et validation geo, est fixée par la section 1.2;
D5 n'autorise pas une seconde architecture cartographique bespoke.

### D6 — Mesure et caméra 3D

À trancher : distance horizontale ou au sol, disponibilité de l'outil en 3D,
conservation d'une mesure lors de la bascule, plage d'inclinaison, cap initial et
commande de remise au nord. Une mesure ambiguë est moins acceptable qu'un
contrôle désactivé avec explication.

### D7 — Politique des couches non compatibles 3D

À trancher par catégorie de couche : adaptation 3D, maintien 2D forcé, ou
indisponibilité déclarée. Les couches environnementales et utilisateur ne
doivent pas imposer chacune leur propre renderer ou leur propre légende.

### D8 — Fournisseur du fond satellite 2D

- **État vérifié** : aucun fond satellite n'existe sous `ui/src` et aucun
  fournisseur n'est choisi. Le raster OSM actuel, y compris sa variante
  `neutral-gray`, n'est pas ce fond de repli.
- **Décision attendue dans P05** : choisir la source et le fournisseur du fond
  satellite 2D lui-même. Le choix doit être instruit sur la couverture réelle
  au Québec, la qualité/fraîcheur, les droits commerciaux et de capture,
  l'attribution, le coût/quota, la confidentialité, la clé/CSP et le
  comportement en cas de tuiles indisponibles.
- **Indépendance** : le fournisseur satellite 2D peut différer du fournisseur
  3D. Aucun couplage commercial ou technique entre D8 et D1 ne doit être
  supposé sans preuve.

### D9 — Choroplèthe municipal et aplats de lots en mode imagerie

La demande owner retire explicitement les aplats de zonage et conserve
l'annotation de la cible; elle ne tranche pas ces deux autres rendus. Une
comparaison UX sur captures réelles doit décider, séparément pour la satellite
2D et la 3D :

1. si le choroplèthe municipal est masqué, simplifié ou rendu avec une opacité
   propre au mode imagerie ;
2. si les aplats de lots sont masqués, limités à la cible sélectionnée ou rendus
   avec une opacité propre, tout en conservant au minimum le contour/exergue et
   le libellé actif de la sélection.

La décision doit privilégier la lisibilité de l'imagerie sans faire passer une
couche masquée pour une donnée absente. Elle est contractuelle et testable dans
AC-03, pas laissée comme une inconnue d'implémentation.

### D10 — Développement parallèle + point de synchronisation d'intégration

**Orientation owner (2026-08-14), à ratifier APRÈS double revue geo + geo-archi** : le développement 3D avance en parallèle de P05
(`feat/map-basemap-controls`). Le fond satellite 2D, son fournisseur D8 et le
seam commun livrés par P05 restent les prérequis fonctionnels du mode Imagerie
2D, du repli gracieux et de l'acceptation du parcours 2D↔3D complet. AC-00 est
donc un critère de synchronisation d'intégration, pas un bloqueur amont du
chantier 3D. Au raccord, la 3D consomme ce seam et ce repli réel; elle ne
duplique ni le sélecteur de fond, ni l'attribution, ni la gestion
d'indisponibilité.

## 7. Hors périmètre & inconnues

### 7.1 Hors périmètre de cette évolution

- achat de licence, création de compte fournisseur ou engagement de dépense ;
- implémentation, ajout de dépendance, variable d'environnement, proxy, CSP ou
  configuration de déploiement ;
- acquisition photogrammétrique, génération ou maintenance de tuiles 3D ;
- extrusion des règles de zonage, simulation de gabarits constructibles, ombres,
  ensoleillement, visite guidée, réalité augmentée ou édition 3D ;
- migration implicite de toutes les cartes historiques vers un moteur unique ;
- architecture détaillée des modules UI cartographiques du design system et
  ownership final de `@sentropic/geo-ui-svelte`, délégués au complément de
  proposition design-system + geo ;
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
- capacités d'extension 3D de `@sentropic/geo-ui-svelte` au-delà de l'API
  consommée par `GeoView.svelte`, et décision de le maintenir sous ownership
  geo ou de l'intégrer au design system ;
- performance GPU, consommation mémoire, accessibilité native et compatibilité
  navigateur sur le parc utilisateur réel ;
- route exacte désignée par « vue géographique » parmi les surfaces actuelles ;
- comportement final de la mesure en mode imagerie ;
- disponibilité effective des futures couches environnementales et
  personnalisées au moment de la livraison 3D.

Ces inconnues doivent être levées par les preuves appropriées — dont le spike
comparatif pour les options fournisseur/moteur — et une décision du propriétaire
avant planification d'implémentation. Jusqu'alors, le contrat produit ferme le
comportement de repli, la continuité de sélection, le retrait des aplats de
zonage et l'exigence de preuve. Le fournisseur satellite 2D et la politique du
choroplèthe/des aplats de lots restent ouverts dans D8 et D9. Le fournisseur
3D, le moteur et la clé restent à arbitrer sur preuves; D2 fixe la règle
combinée à calibrer, et D10 fixe le développement parallèle avec un point de
synchronisation d'intégration.
