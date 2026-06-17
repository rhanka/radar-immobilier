# Rapport DS API Gaps — Radar Immobilier UI

Date : 2026-06-15 (mis à jour)
Branche : `feat/ds-gaps-round2b`
Auteur : rhanka
Contexte : migration DS round 2 — gaps débloqués par `@sentropic/design-system-svelte@0.34.44`

Ce rapport recense les cas d'usage UI, leur statut après le bump 0.34.44, et les cas
restants en attente DS.

---

## Gap 1 — `Tabs` : contenu riche (Snippet Svelte) non supporté

**Statut : RÉSOLU en v0.34.43** ✓

**API livrée :**
```ts
interface TabItem {
  value: string;
  label: string;
  content: string | Snippet;   // ← Snippet désormais supporté
  disabled?: boolean;
}
```

**Migrations réalisées :** aucune migration possible pour les composants affectés.

**Composants restés bespoke avec justification :**
- `ConsoleView` : rail latéral vertical avec icônes Lucide — le DS Tabs impose une
  tablist horizontale. Layout 2-colonnes (nav|contenu) incompatible avec le composant
  Tabs DS qui gère son propre layout intégré.
- `ReconciliationView` : onglets avec icônes Lucide dans les labels (`TabItem.label`
  est `string`-only) ; switcher dans le `<header>`, contenu dans `<main>` — découplage
  spatial incompatible avec Tabs DS.
- `SourceReviewShell` : switcher dans header avec bouton "Retour" adjacent ; layout
  `xl:grid-cols` dans `<main>` — incompatible avec le conteneur panneau Tabs DS.

**Note pour le DS :** Un `label: Snippet` dans TabItem (ou slot `label-icon`) permettrait
de migrer ReconciliationView et ConsoleView.

---

## Gap 2 — `Drawer` : pattern bottom-sheet mobile (side="bottom") non supporté

**Statut : RÉSOLU en v0.34.44** ✓

**API livrée :**
```ts
side?: "left" | "right" | "bottom";  // bottom disponible
```

**Migration réalisée :**
- `maps/LotFichePanel.svelte` : le mobile bespoke (bottom-sheet fixe DIV) est remplacé
  par `<Drawer side="bottom" bind:open={drawerOpen} ...>` avec `{#snippet children()}`.
  Le desktop reste `<Card class="hidden md:block">`. Wrapper `<div class="md:hidden">`
  pour n'activer le Drawer que sur mobile.

---

## Gap 3 — `Modal` : z-index non configurable, fond non customisable

**Statut : PARTIELLEMENT RÉSOLU en v0.34.44**

**API livrée :**
- `dismissible?: boolean` — ✓ résolu
- `zIndex?: number` — ✓ résolu
- `children/footer: Snippet` — ✓ résolu

**Migration non réalisée pour TourOverlay :**
- `tour/TourOverlay.svelte` : **gardé bespoke** pour deux raisons cumulées :
  1. Fond amber custom (`bg-amber-50`) — le DS Modal applique un backdrop sombre
     non configurable par prop ; surcharge CSS trop fragile.
  2. TourOverlay est en syntaxe Svelte 4 (`export let`, `on:click`) — migration DS
     implique une réécriture complète en Svelte 5 (hors scope round 2).
  Le composant est fonctionnel : `role="dialog"`, `aria-modal="true"`, navigation
  clavier (Esc/←/→), focus trap.

**Reste ouvert pour DS :** Prop `backdropClass` ou `backdropColor` pour customiser le fond.

---

## Gap 4 — `StructuredList` : timeline chronologique non supportée

**Statut : EN ATTENTE DS** — inchangé

**Composant affecté :** `opportunity/DossierCard.svelte` (section timeline)

**Cas d'usage :** Chronologie des preuves d'une opportunité foncière — liste ordonnée
avec point de connexion vertical (`border-l`), date et label par entrée.

**API actuelle (`StructuredListItem`) :**
```ts
interface StructuredListItem {
  key: string;
  value: string | Snippet;  // clé-valeur
}
```

**API manquante :** Composant `Timeline` DS avec :
- Items ordonnés avec marqueur visuel (bullet/dot + ligne verticale)
- Champ `date` distinct du label
- Support du contenu mixte (date, type de phase, label)

**Contournement actuel :** Timeline bespoke `<ol class="relative border-l border-slate-200 pl-4 space-y-3">`
avec `<span class="absolute -left-[1.125rem] ...">` pour le bullet.

---

## Gap 5 — `Popover` : déclencheur hover/focus (pas click) non géré en interne

**Statut : RÉSOLU en v0.34.44** ✓

**API livrée :**
```ts
openOn?: "manual" | "hover";  // "hover" = survol + focus clavier
```

**Migrations réalisées :**
- `scoring/GrillesView.svelte` : `open={hoveredKey === key}` + 4 event handlers manuels
  supprimés → `openOn="hover"` natif. `hoveredKey` state et `hoverKey()` helper retirés.
- `opportunity/DossierCard.svelte` : `open={hoveredAxis === axis}` + 4 event handlers
  supprimés → `openOn="hover"` natif. `hoveredAxis` state retiré.

---

## Résumé

| Gap | Composant DS | Statut | Version | Note |
|-----|-------------|--------|---------|------|
| G1 | `Tabs` | Résolu mais migrations limitées | 0.34.43 | `content: Snippet` livré ; `label: Snippet` manquant bloque ConsoleView/Reconciliation/SourceReview |
| G2 | `Drawer` | **RÉSOLU** | 0.34.44 | LotFichePanel mobile migré vers Drawer bottom |
| G3 | `Modal` | Partiellement résolu | 0.34.44 | `dismissible`+`zIndex` livrés ; fond custom + Svelte 4 bloquent TourOverlay |
| G4 | aucun | En attente DS | — | Composant `Timeline` DS manquant |
| G5 | `Popover` | **RÉSOLU** | 0.34.44 | GrillesView + DossierCard simplifiés avec `openOn="hover"` |

---

*Mise à jour par l'agent feat/ds-gaps-round2b — 2026-06-15*
