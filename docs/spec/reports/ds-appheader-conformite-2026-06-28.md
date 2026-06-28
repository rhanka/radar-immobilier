# Conformité Header Radar vs `AppHeader` DS — état 2026-06-28

> Passe **lecture + rapport** (aucune modif produit, aucune branche, aucun commit).
> Objectif : établir l'écart EXACT entre le header actuel et le composant canonique
> du design system `@sentropic/design-system-svelte@^0.34.62`, et le plan de
> conformité minimal. Fait suite à `gap-analysis-appheader.md` (état 0.34.57).

## TL;DR

Le header **utilise déjà `AppHeader`** et a **corrigé les 3 deltas** du rapport
0.34.57 (nav centrée, bloc marque par props, barre d'actions en pills). Ce n'est
donc **pas** « le mauvais composant ». Les écarts restants sont :

1. **Un conflit non résolu `navAlign` ↔ dropdown Admin** : le fichier courant est
   sur `navAlign="center"`, ce qui **re-casse l'ancrage du `MenuPopover` Admin**
   (bug ~325px déjà corrigé puis ré-ouvert — voir §3 G2). **BLOQUANT.**
2. Le DS expose un **chrome de plus haut niveau, `AppChrome`** (ce que rend le
   site DS : barre 5rem sticky + blur + sélecteurs thème/langue en dropdown +
   tiroir structuré). Le header actuel **n'utilise pas `AppChrome`** mais
   ré-assemble `AppHeader` + contrôles maison. Si « nouveau format » = le rendu
   du site DS, **la cible est `AppChrome`**, et elle est **bloquée par le modèle
   de nav Radar** (voir §3 G7).
3. Les contrôles **langue** et **thème** sont **maison et non fonctionnels**
   (cosmétiques, déconnectés de `ThemeProvider` / d'un i18n réel).

---

## 1. Header actuel

| Élément | Valeur |
| --- | --- |
| Fichier | `ui/src/lib/components/TopNav.svelte` |
| Test | `ui/src/lib/components/TopNav.test.ts` (jsdom, 9 cas) |
| Montage | `ui/src/App.svelte` L169 : `<TopNav {activeView} onSelect onLogout {authState} />`, dans `<ThemeProvider theme={sentTechTheme}>` (L149) |
| DS pin | `ui/package.json` L21 : `@sentropic/design-system-svelte: "^0.34.62"` |
| Asset logo | `ui/public/radar-logo.svg` (891 o) |

**Ce qui est canonique (bon usage `AppHeader`) :**

- Importe et utilise `<AppHeader>` avec les snippets `nav` / `actions` / `drawer`.
- Marque par **props** : `brandMode="full"` + `brandName="Radar"` +
  `productName="immobilier"` + `logoSrc="/radar-logo.svg"` → rend le bloc
  canonique `st-appHeader__brand` (plus de snippet `logo` maison, plus de CSS
  `.topnav-brand*`). ✅ conforme à la décision DS.
- `navAlign="center"` (le delta visuel n°1 du rapport 0.34.57 est traité… mais
  voir §3 G2 pour l'effet de bord).
- Liens de nav via la **classe utilitaire publiée** `st-appHeader__navLink` +
  `aria-current="page"`. ✅
- Contrôles utilitaires via la **classe publiée** `st-appHeader__control` (pills). ✅
- Burger + tiroir : `compact` / `menuOpen` / `onMenuToggle` / `drawer` **natifs**
  d'`AppHeader`. ✅ (le `compact` est piloté par `matchMedia(max-width:767px)`.)
- `IdentityMenu` DS (mode `compact`) câblé sur le store auth réel + `onLogout`.

**Ce qui reste maison :**

- Contrôle **langue** : `<button class="st-appHeader__control">` qui **flippe juste
  le label FR/EN** (état local `lang`, aucun i18n branché).
- Contrôle **thème** : `<button>` Soleil/Lune qui pose `document.documentElement
  .dataset.theme` directement — **non relié à `ThemeProvider`**.
- **Tiroir mobile** : CSS maison `.topnav-drawer*` (un commentaire référence à tort
  `st-appChrome__drawer`, qui appartient à `AppChrome`, pas à `AppHeader`).
- Pont `<button>` → nav DS : classe maison `.topnav-navbtn` (neutralise les
  défauts du bouton ; la nav Radar est SPA, sans `href`).
- Menu **Admin** (outils internes, gaté `isAdmin`) : déclencheur en
  `st-appHeader__navLink` + `MenuPopover` + `Menu` DS.

---

## 2. `AppHeader` DS attendu (0.34.62)

Deux primitives de chrome coexistent dans le package.

### 2.1 `AppHeader` — primitive bas niveau (ce que Radar utilise)

`AppHeaderProps` (source : `dist/AppHeader.svelte`) :

| Prop | Type | Rôle |
| --- | --- | --- |
| `brandName`, `productName`, `logoSrc`, `logoAlt`, `brandHref`, `brandLabel` | `string` | Bloc marque canonique `st-appHeader__brand` |
| `brandMode` | `"icon" \| "full"` | `icon` (défaut) = image seule ; `full` = logo + nom + sous-titre |
| `logo` | `Snippet` | Override total de la marque (prioritaire sur les props) |
| `nav`, `actions`, `drawer` | `Snippet` | Zones de contenu |
| `navAlign` | `"start" \| "center"` | `center` ⇒ `position:absolute; transform:translateX(-50%)` sur `.st-appHeader__nav` |
| `compact`, `menuOpen`, `onMenuToggle`, `menuLabel`, `drawerId` | — | Burger + tiroir **pilotés par le consommateur** (pas de matchMedia interne) |

Classes utilitaires **publiées** (en `:global`, donc disponibles sans import CSS
dédié dès qu'`AppHeader` est importé) : `st-appHeader__navLink` (lien soulignné +
état actif), `st-appHeader__control` (pill thème/langue/icône).

### 2.2 `AppChrome` — chrome complet (ce que rend le **site DS**)

`AppChrome` **enveloppe `AppHeader`** et fournit clé-en-main, en **props
déclaratives** (source : `dist/AppChrome.svelte`) :

| Prop | Type | Fournit |
| --- | --- | --- |
| `nav` | `AppChromeNavItem[]` = `{ label, href, active? }` | Liens nav **href-only** + état actif |
| `themes` + `theme` + `onThemeChange` | sélecteur **dropdown** de thème |
| `colorMode` + `onColorModeChange` | toggle **light/dark/auto** (cycle) |
| `locale` + `onLocaleChange` | sélecteur **dropdown** langue FR/EN (✓ actif) |
| `githubHref` | lien GitHub |
| `identity` | `Snippet` | zone identité (IdentityMenu…) |
| `extraSelectors` | `Snippet` | contrôles additionnels |
| `mobileMenuOpen` + `onMobileMenuToggle` | tiroir mobile **structuré** + media-query CSS @767px (pas de matchMedia JS) |

Différences de **rendu** vs `AppHeader` nu : barre **5rem** (vs 3.5rem),
`position:sticky; top:0`, fond `backdrop-filter: blur(8px)`, `max-width:none`,
padding 1.5rem, sélecteurs thème/langue **en dropdown avec coche** ✓, tiroir
`st-appChrome__drawer` complet. **C'est la signature visuelle « site DS ».**

> Limite structurelle d'`AppChrome` : `nav` est **href-only**, sans slot de
> **dropdown de nav** ni mode **bouton/SPA**. Voir §3 G7 — c'est le blocage.

---

## 3. Tableau des écarts atomiques

Légende effort : **S** ≤ ½ j · **M** ~1 j · **L** ≥ 2 j / décision produit.
Classe : **A** = à corriger ; **B** = ne pas copier (spécifique site DS) ;
**DS** = manque côté design system.

| # | Aspect | Canon DS | Header actuel | Écart | Classe | Effort |
| --- | --- | --- | --- | --- | --- | --- |
| G1 | Composant chrome | `AppHeader` (ou `AppChrome`) | `AppHeader` | Bon composant ✅ | A | — |
| **G2** | **`navAlign` ↔ dropdown Admin** | popup ancré correctement | `navAlign="center"` ⇒ `transform` sur le nav devient le **containing block** ; `MenuPopover` (positionné en coords **document** `rect.right + scrollX`, `position:absolute`, non porté en `body`) se décale **~325px**. Corrigé en `start` par PR #297 (mergée) puis **ré-ouvert** par le fichier courant en `center`. | **Fort — fonctionnel, admin** | A | S→M |
| G3 | Contrôle **thème** | `AppChrome.colorMode` (light/dark/auto) **ou** switch relié à `ThemeProvider` | `<button>` maison qui pose `data-theme` sur `<html>`, **non relié** à `ThemeProvider theme={sentTechTheme}` | Moyen — toggle **cosmétique/inopérant** | A | M |
| G4 | Contrôle **langue** | `LanguageToggle` DS **ou** `AppChrome.locale` | `<button>` maison qui flippe le label, **aucun i18n** | Moyen — toggle **cosmétique** | A | M |
| G5 | **Tiroir** mobile | tiroir DS (`AppHeader.drawer` natif, ou `st-appChrome__drawer`) | structure OK (`drawer` natif) mais **CSS `.topnav-drawer*` maison** + commentaire pointant `st-appChrome__drawer` (mauvaise provenance) | Faible | A | S |
| G6 | Mécanisme **compact** | `AppHeader` : piloté par le conso (OK) ; `AppChrome` : **media-query CSS** | `matchMedia(767px)` **JS** dans `onMount` (oblige à mocker `matchMedia` en test) | Faible (légitime pour `AppHeader`) | A/DS | S |
| **G7** | **Modèle de nav** | `AppChrome.nav` = **href-only**, **sans dropdown ni mode bouton** | Radar = **boutons SPA** (`onSelect`) + **dropdown Admin** gaté rôle (`MenuPopover`+`Menu`) | **Bloque l'adoption d'`AppChrome`** | DS | L |
| G8 | Pont bouton-nav | (DS sans `NavItem` bouton) | `.topnav-navbtn` neutralise les défauts du `<button>` | Faible — acceptable, documenté | DS | — |
| G9 | Marque | props + `brandMode="full"` | `brandMode="full"` + props ✅ | Aucun (corrigé par dd77752) | A | — |
| G10 | Recherche / framework / sélecteur produit | présents (site DS) | absents | Ne **pas** copier (contenu site doc) | B | — |
| G11 | Hauteur / sticky / blur | `AppChrome` : 5rem sticky + blur | `AppHeader` : 3.5rem, non sticky | Visuel — **seulement si** cible = `AppChrome` | A (cond.) | L |

---

## 4. Plan de conformité minimal

Deux scénarios, selon ce que « nouveau format AppHeader » veut dire pour le
principal. **Préco : Scénario A** (corrige le bloquant, faible risque), puis
arbitrer le Scénario B en décision produit.

### Scénario A — Rester sur `AppHeader`, lever les écarts fonctionnels *(préco)*

Maintient l'architecture actuelle (compatible nav SPA + dropdown Admin) et solde
les défauts réels :

1. **G2 (BLOQUANT)** — Résoudre le conflit `navAlign` ↔ popover Admin. Deux options :
   - **A2a (préco, garde la nav centrée)** : porter le `MenuPopover` Admin en
     `body` (teleport/portal) **ou** lui passer une ancre en coordonnées
     *viewport* cohérentes avec un containing block transformé. Si le DS ne porte
     pas le popover en `body`, demander la feature (cf. G7/DS).
   - **A2b (repli sûr)** : revenir à `navAlign="start"` (comme PR #297 mergée).
     Ancrage correct, **zéro custo**, au prix de la nav alignée à gauche.
2. **G3** — Relier le toggle thème à `ThemeProvider` (ou retirer le bouton si le
   produit n'est pas multi-thème), au lieu de poser `data-theme` à la main.
3. **G4** — Soit brancher un vrai i18n, soit remplacer le bouton par
   `LanguageToggle` DS, soit retirer le contrôle s'il n'est pas fonctionnel.
4. **G5** — Aligner le tiroir sur les classes DS réellement publiées par
   `AppHeader` et corriger le commentaire `st-appChrome__drawer` erroné.
5. **G6** — Optionnel : documenter que `compact` JS est l'usage `AppHeader`
   attendu (le DS ne fournit pas de bascule CSS pour `AppHeader` nu).

### Scénario B — Adopter `AppChrome` (rendu « site DS ») *(bloqué, décision)*

Donne d'office la barre 5rem sticky + blur + sélecteurs dropdown + tiroir
structuré, **zéro CSS maison**. **Bloqué par G7** :

- `AppChrome.nav` est **href-only** → la nav SPA Radar (`onSelect`) et surtout le
  **dropdown Admin** (gaté rôle) **n'ont pas de place** dans `AppChrome`.
- Prérequis : feature DS (`NavItem` mode bouton/SPA + slot dropdown de nav, ou un
  `nav` en `Snippet` dans `AppChrome`), **ou** accepter de perdre le dropdown
  Admin / le passer dans `extraSelectors`. → **décision produit + dépendance DS.**

**Points de risque transverses :**
- Le repo a **plusieurs branches/worktrees header** divergentes (`feat/appheader-ds`
  courant = `center`/`full` ; `fix/header-ds-dropdown` #297 mergée = `start`/`icon`).
  Risque de **régression en va-et-vient** sur `navAlign`/`brandMode`. **Figer la
  décision G2 avant tout merge.**
- **Aucun `import ".../styles.css"`** dans `ui/src` : les classes `st-*` arrivent
  via les `<style>` scopés/`:global` des composants importés. Conserver cet
  invariant si on ajoute `AppChrome` (ses styles viennent de son propre `<style>`).

---

## 5. Critères d'acceptation (testables)

QA = **comportement rendu** (Playwright authentifié), pas grep de bundle.

1. **G2 / Admin** : connecté **admin**, clic « Admin » ⇒ le panneau « Outils
   internes » est ancré **sous le déclencheur** (écart horizontal ≤ ~8px du bord
   gauche du bouton), **à toutes largeurs** (≥1280, 1024, 768). *Non régression
   du bug ~325px.*
2. **Marque** : à 1440px, le header montre **« Radar »** (poids 760) + sous-titre
   **« immobilier »** (poids 650) + le logo carré 2rem (`brandMode="full"`).
3. **Nav** : `navAlign` retenu cohérent avec le rendu (centré **ou** gauche) ;
   item actif souligné via `st-appHeader__navLink[aria-current="page"]`.
4. **G3 thème** : le toggle modifie réellement le thème servi par `ThemeProvider`
   (tokens `--st-*` mis à jour), **ou** le contrôle est retiré.
5. **G4 langue** : le toggle change une chaîne i18n observable, **ou** le contrôle
   est retiré (pas de bouton décoratif).
6. **Mobile** (≤767px) : burger natif `AppHeader`, tiroir ouvrable, items + identité
   accessibles, **aucun débordement** viewport.
7. `make verify --category unit` vert (dont `TopNav.test.ts`) ; **0** classe maison
   ré-stylant `st-appHeader__navLink` / `__control` ; **0** hex brut (tokens `--st-*`).

---

## Annexe — sources lues

- `ui/src/lib/components/TopNav.svelte`, `TopNav.test.ts`, `ui/src/App.svelte`
- `node_modules/@sentropic/design-system-svelte/dist/AppHeader.svelte(.d.ts)`
- `node_modules/@sentropic/design-system-svelte/dist/AppChrome.svelte(.d.ts)`
- `node_modules/@sentropic/design-system-svelte/dist/LanguageToggle.svelte.d.ts`,
  `IdentityMenu.svelte.d.ts`, `MenuPopover.svelte(.d.ts)`
- `docs/spec/gap-analysis-appheader.md`, `docs/spec/audit-ds-realignement.md`,
  `docs/spec/ds-api-gaps.md`
- Worktree `/.worktrees/header-296-dropdown` (PR #297, `navAlign="start"`),
  PRs #296 / #297 / #286 / #275 (gh)

*Document d'analyse — aucune modification de code applicatif dans cette passe.*
