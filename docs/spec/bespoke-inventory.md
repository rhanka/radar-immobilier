# Inventaire des composants bespoke — rail Signaux (immo)

But : viser un rail **100 % DS-natif** (zéro Tailwind/CSS bespoke, zéro couleur hex en dur, zéro override). Inventaire élément par élément de `ui/src/lib/components/maps/SignauxRail.svelte`, pour mapping DS (NavSystem). **17 éléments — tous UI-pur (aucun applicatif-spécifique dans CE rail)** ; les widgets applicatifs (éditeur de zones, export CSV, carte deck.gl) sont dans d'AUTRES vues, pas ici.

| # | Bespoke | Rôle (1 ligne) | Nature | Implémentation actuelle | DS cible souhaité |
|---|---|---|---|---|---|
| 1 | Kicker rail | sur-titre « SIGNAUX · VILLES » | UI-pur | `<span class="rail-kicker">` + CSS (uppercase, letter-spacing) | token/typo **Overline** |
| 2 | Bouton refresh | action « actualiser » | UI-pur | `<button>` Tailwind + icône **lucide** | **IconButton** (ghost) + jeu d'icônes DS |
| 3 | Ligne compteur | « N signaux · M villes » | UI-pur | `<div>` Tailwind + `<span font-semibold>` | **Text/Stat** tokens |
| 4 | En-tête de section + chevron | section repliable « Signaux »/« Villes » | UI-pur | `<details class="rail-section-acc">` + chevron ▸ CSS (Collapsible #209 PERDU dans un merge) | **NavSection / Collapsible** |
| 5 | Titre de section | libellé de section | UI-pur | `<span class="rail-section-title">` CSS | prop `title` NavSection + Overline |
| 6 | Case à cocher | toggle de filtre | UI-pur | `<input type=checkbox class="rail-type-checkbox">` (13px, accent-color) | **Checkbox** DS |
| 7 | Rangée de filtre | case + label + description + badge | UI-pur | `<label class="rail-type-row">` flex + hover CSS | **Checkbox avec description + slot trailing** (ou NavActionStack item) |
| 8 | Label + sous-label | « Multifamilial 4+ » / « nb unités ≥ 4… » | UI-pur | `rail-row-label` / `rail-row-sublabel` CSS | label + **description/helper** du Checkbox |
| 9 | Badge filtre (compteur) | pastille comptage par axe | UI-pur | `<span class="axis-badge axis-badge--zonage/dimension/anticipation">` **3 hex en dur** (sky/yellow/green-100) | **Badge/Tag tonal** (par token, pas hex) |
| 10 | Champ recherche | filtrer les villes | UI-pur | `<Search>` **DS** (déjà natif ✅) | OK — vérifier 0 override |
| 11 | Sous-accordéon ville | déplier le détail d'une ville | UI-pur | `<details class="ws-acc">` + chevron ▸ `::before` | **NavDisclosureItem / Collapsible** |
| 12 | Pastille statut (dot) | indicateur coloré par densité de signaux | UI-pur | `<span class="rail-swatch" style="background-color:{hex calculé}">` | **Dot / StatusIndicator** tonal (mapper la couleur → tones) |
| 13 | Ligne ville | nom + MRC + badge | UI-pur | `rail-row-label` + `rail-row-sublabel` | **NavItem / ListItem** (titre+description+trailing) |
| 14 | Badge compteur ville | nb signaux de la ville | UI-pur | `<Badge tone="warning" class="rail-row-count">` (**DS overridé**) | **Badge** DS **sans** override |
| 15 | Compteur « 0 » | état zéro | UI-pur | `<span class="rail-row-count text-slate-300">0</span>` (pas un Badge) | **Badge** tone neutre (cohérence) |
| 16 | Conteneur rail + scroll | shell + zone scrollable | UI-pur | `.rail`/`.rail-body` flex CSS + scrollbar native + `scrollbar-gutter` | **NavShell / SideNav + ScrollArea** |
| 17 | Séparateurs | bordures inter-sections/lignes | UI-pur | `border-b border-slate-100`, `divide-y divide-slate-50` | **Divider** / tokens de bordure |

## Dettes liées
- **Collapsible #209 perdu** dans un merge (#194/#201 ont ré-amené l'ancien `<details>`) → à re-migrer.
- **Couleurs hex en dur** : badges filtre (#9), pastille (#12), couleurs de densité — à remplacer par tokens/tones DS.
- **lucide** (#2) hors DS — à neutraliser ou adopter un jeu d'icônes DS.

## En attente DS (déjà publié vs à créer)
- Publiés : Accordion/Collapsible, SideNav, Tabs(Snippet), Drawer(bottom), Modal, Popover(hover), Timeline, Badge, Search, Card.
- À créer (consensus NavSystem) : NavShell/NavItem/NavSection/NavDisclosureItem/DetailPanel, **Checkbox-avec-description**, **Badge compteur tonal**, **Dot/StatusIndicator**, **IconButton**, **Overline**, **Divider**, + **Legend** (choroplèthe) + **MapPopup** (carte).
