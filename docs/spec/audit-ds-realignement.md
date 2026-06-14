# Audit DS — Réalignement Design System (Radar Immobilier UI)

Date : 2026-06-14
Branche : `chore/ds-realignement`
Auteur : rhanka
Contexte : consensus #57 — 100 % des composants UI doivent être natifs `@sentropic/design-system-svelte`.

---

## 1. Composants DS disponibles (v0.7.0)

Le package `@sentropic/design-system-svelte@0.7.0` exporte 55 composants :

Accordion, Alert, AspectRatio, Badge, Breadcrumb, Button, Card, Checkbox, CodeSnippet, Combobox, ContentSwitcher, CopyButton, DataTable, DatePicker, Drawer, Dropdown, EmptyState, FileUploader, Form, FormGroup, Header, InlineLoading, Input, Link, LoadingState, Menu, Modal, MultiSelect, NumberInput, OverflowMenu, Pagination, PaginationNav, PasswordInput, Popover, ProgressBar, ProgressIndicator, Radio, Search, Select, SideNav, SkeletonText, Slider, StructuredList, Switch, Table, Tabs, Tag, ThemeProvider, Textarea, TileGroup, Toast, Toggle, Toggletip, Tooltip, UnorderedList.

Composants DS pertinents pour le realignement : Header (deja utilise), SideNav (present v0.7), Accordion, Button, Search, Badge, Tooltip, Popover, Modal, Card, Drawer.

Composants DS non encore publies (backlog geo/DS team) : `Legend` (choroplethe), `MapPopup`, `GeoMap`.

---

## 2. Inventaire des composants UI — etat DS

### Etats
- OK : Natif DS — composant DS importe et utilise correctement
- A  : Bespoke a migrer — logique maison reproductible avec primitives DS existantes
- W  : En attente DS — depend d'un composant DS non publie (backlog)
- X  : Hors perimetre — fichier du rail Signaux (agent concurrent)

### 2.1 Chrome / AppShell

| Composant | Fichier | Etat | Notes |
|---|---|---|---|
| ThemeProvider wrapper | `App.svelte` | OK | `ThemeProvider` + `sentTechTheme` — conforme |
| TopNav | `TopNav.svelte` | OK | `Header` DS, snippets Svelte 5, nav + actions |
| TopBar (alternatif) | `TopBar.svelte` | A | `Header` DS present mais barre de recherche inline Tailwind brut — migrer vers `Search` DS |
| ViewLayout | `ViewLayout.svelte` | A | Gabarit maison — conserver jusqu'a publication d'un `AppShell` DS ; bug min-h-0 corrige dans ce PR |
| App.svelte (shell global) | `App.svelte` | A | `div.flex.h-screen.flex-col` Tailwind — pas d'`AppShell` DS publie, acceptable par defaut |

### 2.2 Vues cartographiques

| Composant | Fichier | Etat | Notes |
|---|---|---|---|
| SignauxMapView | `maps/SignauxMapView.svelte` | X | Rail Signaux — ne pas toucher |
| SignauxRail | `maps/SignauxRail.svelte` | X | Agent concurrent |
| SignauxSelPanel | `maps/SignauxSelPanel.svelte` | X | Agent concurrent |
| EvaluationMapView | `maps/EvaluationMapView.svelte` | A | `Badge` + `Alert` DS OK, legende inline non epinglee (voir bug S3) |
| OpportunitesMapView | `maps/OpportunitesMapView.svelte` | A | `Badge` + `Alert` DS OK, helpers couleur bespoke (`scoreTone`) — candidat tokens DS |
| CadastreMapView | `maps/CadastreMapView.svelte` | A | `Badge` + `Alert` DS, layout bespoke |
| LotFichePanel | `maps/LotFichePanel.svelte` | A | Uniquement `Badge` DS, layout sticky bespoke — candidat `Drawer`/`Card` DS |

### 2.3 Legendes et bulles

| Composant | Fichier | Etat | Notes |
|---|---|---|---|
| Legende choroplethe Signaux | inline `SignauxMapView` slot `controls-footer` | X | Hors perimetre (rail) |
| Legende Steve/Evaluation | inline `EvaluationMapView` | W | Depend `Legend` DS backlog — a extraire en composant local |
| Bulle/tooltip score | `scoring/ScoreHover.svelte` | A | Bespoke pure Tailwind — migrer vers `Popover` ou `Tooltip` DS |
| Tour overlay / bulle guidee | `tour/TourOverlay.svelte` | A | Bespoke pure Tailwind — candidat `Modal` DS |

### 2.4 Composants fonctionnels — Opportunites

| Composant | Fichier | Etat | Notes |
|---|---|---|---|
| OpportunityFunnel | `opportunity/OpportunityFunnel.svelte` | A | Kanban bespoke — colonnes candidat `Card` DS |
| PhaseColumn | `opportunity/PhaseColumn.svelte` | A | Liste ordonnee bespoke ; `overflow-y-auto` manuel |
| DossierCard | `opportunity/DossierCard.svelte` | A | `Badge` + `Alert` DS, layout grille bespoke, timeline custom |
| BenchmarkComparison | `comparison/BenchmarkComparison.svelte` | A | A auditer |

### 2.5 Composants fonctionnels — Scoring

| Composant | Fichier | Etat | Notes |
|---|---|---|---|
| GrillesView | `scoring/GrillesView.svelte` | A | Divers DS, layout bespoke |
| ScoreHover | `scoring/ScoreHover.svelte` | A | Priorite haute — tooltip pur Tailwind, 0 composant DS |

### 2.6 Vues secondaires

| Composant | Fichier | Etat | Notes |
|---|---|---|---|
| SignalsT1View | `signals/SignalsT1View.svelte` | A | `Badge`, `Button`, `EmptyState` DS, layout bespoke |
| SignalRow | `signals/SignalRow.svelte` | A | `Badge` DS, reste Tailwind |
| ReconciliationView | `reconciliation/ReconciliationView.svelte` | A | Divers DS, layout bespoke |
| CityGraphView | `reconciliation/CityGraphView.svelte` | A | Layout custom graphe, peu migrable |
| SourcesMapView | `sources-map/SourcesMapView.svelte` | A | stickyControlsFooter (legende) — beneficie du fix ViewLayout |
| CityDetailPanel | `sources-map/CityDetailPanel.svelte` | A | `Badge` DS, panneau bespoke |
| AdminView | `admin/AdminView.svelte` | A | A auditer |
| OnboardingView | `onboarding/OnboardingView.svelte` | A | Divers DS |
| ConsoleView + tabs | `console/` | A | Tabs maison — candidat `Tabs` DS |
| BacklogView | `backlog/BacklogView.svelte` | A | Divers DS |
| CoordinationView | `coordination/CoordinationView.svelte` | A | Divers DS |
| SourceReviewShell | `source-review/SourceReviewShell.svelte` | A | Shell bespoke |
| PendingView / RejectedView | `auth/` | A | Bespoke, candidat `EmptyState` DS |
| TourOverlay | `tour/TourOverlay.svelte` | A | Bespoke 100% Tailwind, candidat `Modal` DS |
| ChatWidgetHost | `chat/ChatWidgetHost.svelte` | OK | `@sentropic/chat-ui` — conforme |
| RadarChatPanel | `RadarChatPanel.svelte` | OK | `@sentropic/chat-ui` — conforme |

### Resume

| Etat | Nb composants |
|---|---|
| OK Natif DS | 5 |
| A Bespoke a migrer | 29 |
| W En attente DS backlog | 2 (Legend, GeoMap) |
| X Hors perimetre (rail) | 3 |

---

## 3. Bug de sizing de la legende — Diagnostic

### Symptome signale

« Legende non visible en bas du menu gauche » — la legende choroplethe de `SignauxMapView`
et `SourcesMapView` disparait ou est coupee.

### Cause racine

`ViewLayout.svelte` implemente correctement le mecanisme `stickyControlsFooter` (prop booleenne
+ slot `controls-footer` epingle via `flex-col` + `shrink-0`). Le bug survient car l'`<aside>`
controls n'a pas `min-h-0` dans une chaine flex imbriquee.

Chemin de rendu (branche `stickyControlsFooter`) :

```
App.svelte
  div.flex.h-screen.flex-col.overflow-hidden   <- hauteur fixe h-screen
    TopNav (Header DS)
    Vue active (SignauxMapView / SourcesMapView)
      ViewLayout (stickyControlsFooter=true)
        div.flex.min-h-0.flex-1.overflow-auto
          div.flex.h-full.w-full
            aside.flex.flex-col               <- BUG : min-h-0 manquant
              div.flex-1.overflow-y-auto      <- contenu defilable
              div.shrink-0                    <- controls-footer (legende)
```

Un conteneur `flex-col` sans `min-h-0` prend sa hauteur intrinseque plutot qu'etre contraint
par le parent. Le `div.flex-1.overflow-y-auto` interieur absorbe tout l'espace, poussant
le `div.shrink-0` (legende) hors du viewport.

### Correctif

Ajouter `min-h-0` sur l'`<aside>` en mode `stickyControlsFooter` dans `ViewLayout.svelte`.

Avant (ligne 64) :
```
<aside class="{controlsWidth} shrink-0 border-r border-slate-200 bg-white flex flex-col">
```
Apres :
```
<aside class="{controlsWidth} shrink-0 border-r border-slate-200 bg-white flex flex-col min-h-0">
```

### Qui porte le correctif

`ViewLayout.svelte` est hors perimetre rail Signaux — correctif applique dans ce PR (voir S6).
Les deux consommateurs (`SignauxMapView` et `SourcesMapView`) beneficient du fix automatiquement
sans modifier aucun fichier du rail.

---

## 4. Reflexion menus lateraux

### Structure actuelle

```
App.svelte (div.flex.h-screen.flex-col)
  TopNav (Header DS)
  Vue active
    ViewLayout
      aside controls (gauche, w-72..w-80)   -- rail gauche
        contenu defilable
        [controls-footer] legende epinglee (si stickyControlsFooter)
      main carte / contenu
      aside sel (droite, w-80)              -- panneau selection
```

Rail gauche Signaux (`SignauxRail`) : accordeon de villes triees par comptage de signaux,
filtre de recherche (`Search` DS), badges (`Badge` DS), mais structure d'accordeon en
Tailwind brut (pas le composant `Accordion` DS v0.7).

Rails autres vues : chaque vue gere son propre rail dans le slot `controls` de `ViewLayout`,
sans pattern unifie.

### Problemes identifies

1. Accordeon bespoke dans `SignauxRail` : divs Tailwind imbriquees — `Accordion` DS disponible
   v0.7 non utilise.
2. `SideNav` DS disponible v0.7 mais non utilise — les rails sont des `<aside>` Tailwind
   independants par vue.
3. Sizing/scroll : `overflow-y-auto` direct sur l'`<aside>` en mode non-sticky ; en mode sticky
   le scroll est sur un `div.flex-1` interieur — coherent mais non standardise entre vues.
4. Largeur variable : `w-72` (defaut ViewLayout) vs `w-80` (SignauxMapView, SourcesMapView).

### Recommandations cibles

| Aspect | Recommandation | Priorite |
|---|---|---|
| Sticky footer legende | Mecanisme `stickyControlsFooter` correct — conserver ; bug min-h-0 corrige | Immediat (ce PR) |
| Largeur rail | Standardiser a `w-80` via prop `controlsWidth` — deja parametrable | Sans code additionnel |
| Accordeon Signaux | Migrer `SignauxRail` vers `Accordion` DS | Moyen (rail, agent concurrent) |
| SideNav DS | Wrapper rails dans `SideNav` DS pour vues avec navigation multiple | Faible (apres GeoMap Phase 2) |
| Pattern tabs/accordeon hors rail | `ConsoleView` tabs -> `Tabs` DS ; `SourceReviewShell` -> `Card` DS | Moyen (Phase 1) |

---

## 5. Plan de realignement sequence

### Phase 0 — Correctifs surs imme diats (ce PR)

| Action | Fichier | Risque | Critere done |
|---|---|---|---|
| Fix `min-h-0` legende (FAIT) | `ViewLayout.svelte` | Nul | Legende visible en bas dans Signaux + Sources |

Migrations prevues Phase 0 mais reportees (voir S6.2 pour raisons) :
- `ScoreHover` -> `Popover`/`Tooltip` DS
- `TourOverlay` -> `Modal` DS
- Barre recherche `TopBar` -> `Search` DS

### Phase 1 — Composants fonctionnels (sprint court, ~1 semaine)

| Action | Fichier | Dependance | Notes |
|---|---|---|---|
| `LotFichePanel` -> `Drawer` DS (mobile) + `Card` DS (desktop) | `maps/LotFichePanel.svelte` | Aucune | Hors perimetre rail |
| `EvaluationMapView` legende -> composant `MapLegend.svelte` local | `maps/EvaluationMapView.svelte` | Aucune | Prepare migration vers `Legend` DS backlog |
| `OpportunitesMapView` helpers couleur -> tokens `--st-semantic-*` | `maps/OpportunitesMapView.svelte` | Tokens DS publies | |
| `ConsoleView` tabs -> `Tabs` DS | `console/ConsoleView.svelte` | Aucune | |
| `DossierCard` timeline -> `StructuredList` DS | `opportunity/DossierCard.svelte` | Aucune | |
| `PendingView`/`RejectedView` -> `EmptyState` DS | `auth/` | Aucune | Trivial |
| `ScoreHover` -> `Tooltip`/`Popover` DS | `scoring/ScoreHover.svelte` | Verifier API DS | |
| `TourOverlay` -> `Modal` DS + keyboard | `tour/TourOverlay.svelte` | Verifier z-index DS | |
| Barre recherche `TopBar` -> `Search` DS | `TopBar.svelte` | Aucune | |

### Phase 2 — Composants complexes (sprint moyen, ~2 semaines)

| Action | Dependance | Notes |
|---|---|---|
| `SignauxRail` accordeon -> `Accordion` DS | Coordonner avec agent rail | |
| `OpportunityFunnel` colonnes -> `Card` DS | Aucune | |
| `SourceReviewShell` -> `Card` + `Tabs` DS | Aucune | |
| `CityDetailPanel` -> `Card` DS | Aucune | |
| `SignalsT1View` layout -> `DataTable` ou `StructuredList` DS | Aucune | |

### Phase 3 — Dependances DS backlog (horizon 4-8 semaines)

| Action | Dependance | Notes |
|---|---|---|
| Legendes choroplethe -> `Legend` DS | DS team (backlog confirme geo) | Remplace legendes inline |
| Bulles/popups carte -> `MapPopup` DS | DS team backlog | |
| `SignauxMapView` carte -> `GeoMap` (`@sentropic/geo-ui-svelte`) | geo — Phase 2 | Gros refactor |
| `EvaluationMapView` carte -> `GeoMap` DS | geo — Phase 2 | Idem |
| Rail navigation global -> `SideNav` DS | Apres GeoMap Phase 2 | Structure AppShell finale |

### Criteres de done globaux

- `make typecheck` : 0 erreur
- `make lint` : 0 warning
- Build UI Vite : 0 erreur
- 0 composant Tailwind-brut-pur pour des UI primitives couvertes par le DS v0.7
- Tout composant de legende/bulle/panneau : soit natif DS, soit composant local avec TODO trackee vers DS backlog

---

## 6. Corrections appliquees dans ce PR

### 6.1 Fix bug legende — `ViewLayout.svelte`

Ajout de `min-h-0` sur l'`<aside>` en mode `stickyControlsFooter`.

Fichier : `ui/src/lib/components/ViewLayout.svelte`, ligne 64.

Avant :
```
<aside class="{controlsWidth} shrink-0 border-r border-slate-200 bg-white flex flex-col">
```
Apres :
```
<aside class="{controlsWidth} shrink-0 border-r border-slate-200 bg-white flex flex-col min-h-0">
```

Impact : legende choroplethe toujours visible pour `SignauxMapView` et `SourcesMapView`,
sans modifier aucun fichier du rail Signaux.

### 6.2 Migrations non appliquees dans ce PR — justification

`ScoreHover` -> `Popover`/`Tooltip` DS : consomme par `DossierCard` via positioning absolu
bespoke (`absolute bottom-full left-0`). Migration necessit e validation que l'API `Popover` DS
supporte ce cas de declenchement sur hover de cellule de grille. Risque de regression visuelle.
Inclus Phase 1 avec validation prealable.

`TourOverlay` -> `Modal` DS : utilise `z-index: 9000` et steps Svelte 5 custom. Migration
necessite verification que le DS Modal supporte : (a) z-index configurable >= 9000,
(b) steps multi-etapes avec navigation clavier (Esc/ArrowLeft/ArrowRight),
(c) fond semi-transparent custom. Inclus Phase 1 apres verification API Modal DS.

Barre recherche `TopBar` : `TopBar.svelte` est potentiellement deprecie (navigation principale
via `TopNav`). Clarifier l'usage avant d'investir dans la migration.

---

*Genere par l'agent chore/ds-realignement — 2026-06-14*
