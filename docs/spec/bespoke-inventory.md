# Inventaire des composants bespoke — rail Signaux (immo)

But : viser un rail **100 % DS-natif** (zéro Tailwind/CSS bespoke, zéro couleur hex en dur, zéro override). Inventaire élément par élément de `ui/src/lib/components/maps/SignauxRail.svelte`, pour mapping DS (NavSystem). **17 éléments — tous UI-pur (aucun applicatif-spécifique dans CE rail)** ; les widgets applicatifs (éditeur de zones, export CSV, carte deck.gl) sont dans d'AUTRES vues, pas ici.

| # | Bespoke | Rôle (1 ligne) | Nature | Implémentation actuelle | DS cible souhaité | Vague 1 |
|---|---|---|---|---|---|---|
| 1 | Kicker rail | sur-titre « SIGNAUX · VILLES » | UI-pur | ~~`<span class="rail-kicker">` + CSS (uppercase, letter-spacing)~~ | token/typo **Overline** | ✅ RÉSOLU — `<Overline as="span">` (0.34.47+) |
| 2 | Bouton refresh | action « actualiser » | UI-pur | ~~`<button>` Tailwind + icône **lucide**~~ | **IconButton** (ghost) + jeu d'icônes DS | ✅ RÉSOLU — `<IconButton size="sm" variant="ghost">` + SVG inline (0 lucide) |
| 3 | Ligne compteur | « N signaux · M villes » | UI-pur | `<div>` tokens CSS + spans | **Text/Stat** tokens | ✅ RÉSOLU — tokens `var(--st-semantic-*)` (0 hex) |
| 4 | En-tête de section + chevron | section repliable « Signaux »/« Villes » | UI-pur | `<details class="rail-section-acc">` + chevron ▸ CSS | **NavSection / Collapsible** | ⏳ ATTEND Vague 2/3 (NavSection) |
| 5 | Titre de section | libellé de section | UI-pur | ~~`<span class="rail-section-title">` CSS~~ | prop `title` NavSection + Overline | ✅ RÉSOLU — `<Overline as="span">` dans le `<summary>` |
| 6 | Case à cocher | toggle de filtre | UI-pur | ~~`<input type=checkbox class="rail-type-checkbox">` (13px, accent-color)~~ | **Checkbox** DS | ✅ RÉSOLU — `<Checkbox label=… checked=… onchange=…>` |
| 7 | Rangée de filtre | case + label + description + badge | UI-pur | ~~`<label class="rail-type-row">` flex + hover CSS~~ | **Checkbox avec description + slot trailing** | ✅ RÉSOLU — `Checkbox` DS avec `description` + `{#snippet trailing()}` |
| 8 | Label + sous-label | « Multifamilial 4+ » / « nb unités ≥ 4… » | UI-pur | ~~`rail-row-label` / `rail-row-sublabel` CSS bespoke~~ | label + **description/helper** du Checkbox | ✅ RÉSOLU — prop `description` de `Checkbox` DS |
| 9 | Badge filtre (compteur) | pastille comptage par axe | UI-pur | ~~`<span class="axis-badge axis-badge--zonage/dimension/anticipation">` **3 hex en dur**~~ | **Badge/Tag tonal** (par token) | ✅ RÉSOLU — `<Badge tone="info/warning/success" size="sm">` (0 hex) |
| 10 | Champ recherche | filtrer les villes | UI-pur | `<Search>` DS (déjà natif) | OK — ajouter prop `fluid` | ✅ RÉSOLU — `<Search fluid …>` remplit le rail |
| 11 | Sous-accordéon ville | déplier le détail d'une ville | UI-pur | `<details class="ws-acc">` + chevron ▸ `::before` | **NavDisclosureItem / Collapsible** | ⏳ ATTEND Vague 2/3 (NavDisclosureItem) |
| 12 | Pastille statut (dot) | indicateur coloré par densité de signaux | UI-pur | ~~`<span class="rail-swatch" style="background-color:{hex calculé}">` signalColor()~~ | **StatusDot** tonal | ✅ RÉSOLU — `<StatusDot tone={signalTone(count)}>` · 0→neutral · ≤5→warning · >5→error |
| 13 | Ligne ville | nom + MRC + badge | UI-pur | `rail-row-label` + `rail-row-sublabel` CSS tokens | **NavItem / ListItem** | ⏳ ATTEND Vague 2/3 (NavItem) |
| 14 | Badge compteur ville | nb signaux de la ville | UI-pur | ~~`<Badge tone="warning" class="rail-row-count">` (DS overridé)~~ | **Badge** DS **sans** override | ✅ RÉSOLU — `<Badge tone="warning" size="sm">` sans classe override |
| 15 | Compteur « 0 » | état zéro | UI-pur | ~~`<span class="rail-row-count text-slate-300">0</span>` (pas un Badge)~~ | **Badge** tone neutre (cohérence) | ✅ RÉSOLU — `<Badge tone="neutral" size="sm">0</Badge>` |
| 16 | Conteneur rail + scroll | shell + zone scrollable | UI-pur | `.rail`/`.rail-body` flex CSS + scrollbar native | **NavShell / SideNav + ScrollArea** | ⏳ ATTEND Vague 2/3 (NavShell) |
| 17 | Séparateurs | bordures inter-sections/lignes | UI-pur | ~~`border-b border-slate-100`, `divide-y divide-slate-50`~~ | **Divider** / tokens de bordure | ✅ RÉSOLU — `<Divider>` après compteur ; tokens `var(--st-semantic-border-subtle)` |

## Vague 1 — Résumé (DS 0.34.47+, PR feat/rail-ds-vague1)

**RÉSOLUS (#1,2,5,6,7,8,9,10,12,14,15,17)** — 0 hex en dur, 0 override composant DS, 0 icône lucide, 0 checkbox/search bespoke.

Mapping tone :
- Badge zonage → `tone="info"` (axe primaire)
- Badge multifamilial → `tone="warning"` (axe dimension)
- Badge précoce → `tone="success"` (axe anticipation)
- StatusDot ville → `tone="neutral"` (0 signal) / `tone="warning"` (1–5) / `tone="error"` (>5)
- Badge ville → `tone="warning"` (>0) / `tone="neutral"` (=0)

## En attente Vague 2/3 (#4, #11, #13, #16)
- **#4** : `<details class="rail-section-acc">` → NavSection / Collapsible (NavSystem)
- **#11** : `<details class="ws-acc">` → NavDisclosureItem / Collapsible
- **#13** : `.rail-row-label` + `.rail-row-sublabel` → NavItem / ListItem
- **#16** : `.rail` / `.rail-body` shell → NavShell / SideNav + ScrollArea

## Dettes liées
- ~~**Collapsible #209 perdu**~~ → reste `<details>` en attendant NavSection/NavItem Vague 2/3.
- ~~**Couleurs hex en dur**~~ : tous remplacés par tokens DS ou tones (Vague 1).
- ~~**lucide**~~ (#2) : retiré ; SVG inline dans `IconButton` DS.
- **typeColor palette** (#type-couleur) : reste en `color=` prop arbitraire de `StatusDot` (palette 12 couleurs non mappable sur 5 tones). Acceptable Vague 1 — `StatusDot.color` est une prop DS officielle, pas un hex bespoke.

## En attente DS (déjà publiés vs à créer)
- Publiés : Accordion/Collapsible, SideNav, Tabs(Snippet), Drawer(bottom), Modal, Popover(hover), Timeline, Badge, Search, Card, **Checkbox, IconButton, Overline, StatusDot, Divider** (0.34.47+).
- À créer (consensus NavSystem) : NavShell/NavItem/NavSection/NavDisclosureItem/DetailPanel + **Legend** (choroplèthe) + **MapPopup** (carte).
