# Rapport DS API Gaps — Radar Immobilier UI

Date : 2026-06-14
Branche : `chore/ds-finalisation-2`
Auteur : rhanka
Contexte : migration DS Phase 1 reliquat + Phase 2 hors rail (#63)

Ce rapport recense les cas d'usage UI non couverts par `@sentropic/design-system-svelte@0.7.0`,
constatés lors de la tentative de migration de chaque composant vers le DS natif.
Il est destiné à l'équipe DS pour priorisation du backlog.

---

## Gap 1 — `Tabs` : contenu riche (Snippet Svelte) non supporté

**Composant affecté :** `console/ConsoleView.svelte`, `reconciliation/ReconciliationView.svelte`, `source-review/SourceReviewShell.svelte`

**Cas d'usage :** Système d'onglets dont chaque panneau contient un composant Svelte complet
(ex. `QualificationTab`, `DeepDiveTab`, `CityGraphView`, `MrcGraphView`).

**API actuelle (`TabItem`) :**
```ts
interface TabItem {
  value: string;
  label: string;
  content: string;   // ← string seulement
  disabled?: boolean;
}
```

**API manquante :** `content` devrait accepter un `Snippet` (ou équivalent Svelte 5) pour
permettre du contenu arbitraire par onglet, pas seulement du texte.

**Contournement actuel :** Tab switcher bespoke (liste de boutons dans rail gauche pour
ConsoleView, `<nav>` avec boutons pour ReconciliationView, `div.inline-flex` pour SourceReviewShell).
Tous préservent `aria-current`, focus, keyboard.

**Impact :** 3 composants restent bespoke pour leur système de navigation par onglets.

---

## Gap 2 — `Drawer` : pattern bottom-sheet mobile (side="bottom") non supporté

**Composant affecté :** `maps/LotFichePanel.svelte`

**Cas d'usage :** Sur mobile (<768px), le panneau fiche lot doit s'afficher comme un
bottom-sheet fixe (position fixed, bottom-0, 55vh, `rounded-t-2xl`).

**API actuelle (`DrawerProps.side`) :**
```ts
side?: "left" | "right";  // bottom non disponible
```

**API manquante :** `side="bottom"` pour un panneau glissant depuis le bas, style bottom-sheet
mobile (hauteur partielle, border-radius en haut).

**Contournement actuel :** Panneau mobile bespoke (`fixed bottom-0 left-0 right-0`)
masqué sur desktop (`md:hidden`) ; `Card` DS utilisé sur desktop (`hidden md:block`).

**Impact :** LotFichePanel partiellement migré — desktop utilise `Card` DS,
mobile reste bespoke.

---

## Gap 3 — `Modal` : z-index non configurable, fond non customisable

**Composant affecté :** `tour/TourOverlay.svelte`

**Cas d'usage :** Overlay de visite guidée qui doit passer au-dessus de la carte Mapbox
(z-index requis : 9000+). Fond semi-transparent amber custom.

**API actuelle :**
- `z-index` du backdrop : `var(--st-component-overlay-zIndex, 90)` — non configurable via props
- Fond : `var(--st-semantic-surface-overlay)` — non customisable
- Navigation multi-étapes : aucun slot step / aucune prop `currentStep/totalSteps`
- Boutons navigation (Précédent/Passer/Suivant) : non supportés dans le footer par défaut

**API manquante :**
1. Prop `zIndex?: number` pour override le z-index du backdrop
2. Slot ou prop pour le fond (permettre amber/custom)
3. Slot `steps` ou props `currentStep/totalSteps` pour navigation multi-étapes
4. Footer pré-câblé pour navigation (Précédent/Suivant/Fermer)

**Contournement actuel :** TourOverlay reste bespoke (Svelte 4, `export let`, `on:click`).
Il implémente correctement `role="dialog"`, `aria-modal="true"`, navigation clavier
(Esc/ArrowLeft/ArrowRight), focus trap manuel.

**Impact :** TourOverlay non migré — a11y et keyboard déjà conformes en bespoke.

---

## Gap 4 — `StructuredList` : timeline chronologique non supportée

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

**Impact :** Timeline DossierCard reste bespoke — fonctionnel et accessible,
mais sans cohérence visuelle DS.

---

## Gap 5 — `Popover` : déclencheur hover/focus (pas click) non géré en interne

**Composant affecté :** `scoring/ScoreHover.svelte` (usage dans DossierCard + GrillesView)

**Cas d'usage :** Popover de détail d'axe de score affiché au survol/focus d'une cellule.

**API actuelle :** `open` est contrôlé de l'extérieur (`open?: boolean`) — correct,
mais le composant n'inclut pas de gestion interne du hover/focus sur le trigger.

**Statut :** **Migré** avec pattern `open={hoveredAxis === axis}` + events
`on:mouseenter`/`on:mouseleave`/`on:focusin`/`on:focusout` sur le trigger snippet.
Fonctionnel et accessible.

**Note pour le DS :** Ajouter un mode `trigger="hover"` ou `trigger="focus"` natif
réduirait le boilerplate côté consommateur.

---

## Résumé

| Gap | Composant DS | Cas manquant | Sévérité |
|-----|-------------|--------------|----------|
| G1 | `Tabs` | `content: Snippet` (contenu riche par onglet) | Haute — bloque 3 composants |
| G2 | `Drawer` | `side="bottom"` (bottom-sheet mobile) | Moyenne — 1 composant partiellement migré |
| G3 | `Modal` | `zIndex` prop, fond custom, navigation multi-étapes | Haute — 1 composant non migré |
| G4 | aucun | Composant `Timeline` DS manquant | Moyenne — 1 section bespoke |
| G5 | `Popover` | Mode hover/focus natif (nice-to-have) | Faible — contournable |

---

*Généré par l'agent chore/ds-finalisation-2 — 2026-06-14*
