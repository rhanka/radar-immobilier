# SPEC (brute) — Réorientation « Grand filet » : radar de changement de zonage, carte-first, multi-villes

> Statut : **intention / cadrage**, issu du walkthrough Steve × Fabien × Mathieu (enregistrement
> `docs/spec/input/walkthrough/…Recording.mp4`, transcrit Voxtral → `walkthrough-transcript.md`,
> graphe `…/.graphify/`). À affiner avant implémentation. Rédigé par l'assistant (orientation incluse).
> Réf. visuelle : les screenshots de l'app Claude de Steve dans `docs/spec/input/walkthrough/*.png`.

## 0. Pivot en une phrase
Passer d'un **radar profond 2 villes (Beauharnois-Salaberry) centré ontologie/réconciliation** à un
**radar « grand filet » multi-villes, *procès-verbaux-centric*, *carte-first*, centré sur le
CHANGEMENT DE ZONAGE** — en **réutilisant** tout le socle déjà construit.

## 1. Décisions du walkthrough (faisant foi)
1. **Opportunité n°1 = changement de zonage** repéré dans les **procès-verbaux** de conseil municipal
   (non ambigu, plus forte valeur ; rare ~1/2-3 ans/ville mais énorme : zonage change → multifamilial
   autorisé → terrains affectés connus).
2. **Déclencheur = avis de motion** (mot-clé légal précédant l'adoption d'un règlement) → capter le
   **n° de règlement** (ex. 3835) comme **entité à suivre** ; l'adoption arrive à M+1..5.
3. **Phase 1 = « grand filet »** : scraper **procès-verbaux** sur le **territoire le plus large**
   (rayon 50 km MTL → extensible QC), **mensuel**, **à partir d'aujourd'hui** (back-fill optionnel
   trimestre/année). Time-boxé ; mesurer blocage (captcha) + % villes couvertes ; sinon → pêche ciblée.
4. **Avis publics** (annonce avant/après PV) + **vidéos YouTube des séances** (~15 j d'avance) = sources
   d'anticipation.
5. **La carte devient l'interface** : maille ville d'abord (« où y a-t-il des news »), zoom zone→lot ensuite.
6. **Différé / secondaire** : dérogations mineures + PPCMOI (bruit, signaux faibles précurseurs à garder
   en note) ; extraction fine des polygones de zone (semi-manuel 1-2 villes pilotes ; PDF / tuiles
   propriétaires GoAzimut/PG Solutions = dur).
7. **Sources clés** : **Rôle d'évaluation foncière** standardisé QC (Données Québec : cadastre, géoloc,
   nb logements, superficie, façade, profondeur) ; **Grille de zonage** (PDF publié avec le changement) =
   critères (façade/profondeur/étages) → filtrer les lots éligibles **à la demande** (pas a priori).
8. **Méthode** : opportunisme IA — l'IA pêche le max ; la difficulté est liée à ce que l'IA arrive à faire ;
   le rôle de Fabien = **industrialiser** autour. **Double front** : grand filet (large, sans carte) +
   vertical profond 1-2 villes (avec géo) pour sédimenter et **prouver que l'IA fait les liens**.
9. **Next** : Steve fournit sa carte interactive + 2 PV Saint-Damase (calibration des signaux positifs).

## 2. Décisions/ajustements de Fabien (post-walkthrough)
- **(a) Garde confirmé.** graphify = bon, **incl. téléchargement vidéos YouTube + transcrits**. Ajouter
  probablement une **graph DB ou une table graphe** à sentropic/immo (persistance du graphe ontologique).
- **(b) Pivot confirmé.**
- **(c) Captcha → contournement via Obscura ASSUMÉ** pour **identifier les propriétaires de lot** le cas
  échéant (rôle foncier public, rate-limité). *Note assistant : à cadrer (ToS/usage légitime de prospection,
  PII Loi 25 — nom propriétaire = donnée publique du rôle ; rester rate-limité et traçable). Capacité
  secondaire, activable à la demande.*

## 3. Réutilisé (socle aligné — ne pas jeter)
- **Ontologie + modèle bitemporel** (Zone/Lot/Bylaw/DesignationEvent/Valuation/Adresse) : « avis de motion
  → n° règlement à suivre → adoption » **est déjà** un `DesignationEvent` + `Bylaw` entité-à-suivre.
- **Pipeline ciblage → recueil → exploitation** + jobs (ossature d'industrialisation).
- **graphify** (réconciliation/dédup multi-sources + extraction concepts depuis PV/vidéos).
- Adapters **rôle MAMH (Données Québec)**, **règlements/grilles**, avis-publics, Adresses Québec.

## 4. Architecture cible (work packages)

### FRONT A — Grand filet (priorité)

#### WP A.1 — Visualisation géographique-centrique (carte-first)
Référence : screenshots de l'app Claude de Steve. **Bandeau haut conservé** pour switcher les vues.
Continuum de maille **Québec → ville → zone → lot**. Vues :
- **Signaux** (maille **Québec/villes**) : sur la carte, nb d'opportunités (changements de zonage) **par
  ville sur 6 mois glissants**. Clic ville → **liste des changements de zonage**.
- **Opportunités** (maille **ville/zones**) : clic sur une zone d'opportunité → zoom.
- **Évaluation** (maille **zone/lots**) : qualifier les **lots** selon les **grilles de zonage**.
- **Sources** (maille **Québec**, *maturité du recueil*) : villes **shapées en GeoJSON coloriées par
  maturité**. Clic ville → **liste des données recueillies** : site web identifié · procès-verbaux
  scrappés/graphifiés (avec **concepts ontologiques**) · avis · conseils municipaux YouTube
  téléchargés/transcrits/graphifiés · zonages/îlots/propriétaires (qualité **PDF vs GeoJSON**, statut
  scrappé / non).

#### WP A.2 — Data (identification progressive « easy first »)
- **2.x** : identification **progressive de toutes les données** en partant de la **liste des villes**,
  mode **« easy first »** (prioriser open-data / GeoJSON / PV non-captcha).
- **4 agents Claude 4.8 de background**, **lancés via `remote`**, en charge de **purger une todo permanente**,
  pour **construire les jobs de scraping** (téléchargement direct **ou Obscura**), **avec mise à jour `track`**.

#### WP A.3 — Infrastructure data & agents
`remote` (orchestration agents) · **suivi backlog** · **structures de données** (dont **graph DB / table
graphe**, cf. remarque a) · **UI de gestion** (dont **chat-ui**).

### FRONT B — Vertical profond géo (zone→lot)
- On **identifie d'abord dans WP A.2** les **sources GeoJSON** par ville (zone et lot).
- On **priorise les villes** cumulant **opportunités < 6 mois × lots en GeoJSON** (forte densité de signaux
  récents ET données géo exploitables) → vertical end-to-end zonage→grille→lots éligibles→carte interactive,
  pour **prouver que l'IA fait les liens** (critère de décision de Steve).

## 5. Différé / hors-scope immédiat
Dérogations mineures / PPCMOI (signaux faibles précurseurs, en note) · extraction fine polygones de zone
(hors villes pilotes B) · identification propriétaire = secondaire (cf. c).

## 6. Orientation assistant (préco)
- **Maille unique** : les 4 vues = un seul continuum de zoom (Québec→ville→zone→lot) sur une carte GeoJSON ;
  réutiliser le `CiblagePlan` pour piloter le périmètre (rayon/villes).
- **Graph DB** : commencer **léger** — réutiliser la sortie `graph.json` de graphify + une **table graphe
  Postgres** (nodes/edges) avant d'introduire une graph DB dédiée ; décider à l'échelle.
- **Règle de détection cœur** : `avis_de_motion(n° règlement) → suivi → adoption` comme pattern de premier
  niveau (haute précision), avant tout NLP profond.
- **Ordre** : démarrer **WP A.1 (maille-carte signaux/sources) + WP A.2 (easy-first data, 4 agents remote)**
  en parallèle ; **WP A.3** en support ; **WP B** une fois les sources GeoJSON identifiées par A.2.
