# Analyse d'écart — Header Radar vs `AppHeader` canonique du Design System

> Passe d'**analyse seulement** (lecture + documentation). Aucun code applicatif
> n'est modifié ici. Objectif : produire un constat d'écart **honnête et
> structurel** (pas seulement « tokens »), après le mécontentement légitime sur
> le header livré (#268) qui ne ressemble pas au header canonique du site DS.

## 0. Méthode & sources lues

| Source | Chemin / URL | Version |
| --- | --- | --- |
| Composant canonique `AppHeader` | `.claude/worktrees/agent-a9cd1b2e2328ed50f/node_modules/@sentropic/design-system-svelte/dist/AppHeader.svelte` | DS svelte **0.34.57** (= pin exact de `ui/package.json`) |
| Composant `Header` (primitive bas niveau) | `…/dist/Header.svelte` | 0.34.57 |
| Wrapper canonique `AppChrome` (chrome complet du site DS) | `sent-tech-design-system/packages/components-svelte/dist/AppChrome.svelte` | repo DS `svelte-v0.34.58` |
| Usage canonique de référence | `sent-tech-design-system/apps/docs/src/routes/components/header/+page.svelte` | — |
| Header Radar livré | `ui/src/lib/components/TopNav.svelte` (working tree) | — |
| Site DS rendu | `https://design-system.sent-tech.ca` (audit DS skill = **0 finding**) | — |

> ⚠️ **Piège rencontré (à connaître)** : il existe plusieurs installs de
> `@sentropic/design-system-svelte` sur la box (0.7.0 dans `tmp/…`, 0.34.42→0.34.57
> dans les worktrees). Le `tmp/wp4-exploitation` est en **0.7.0** et n'a **pas**
> d'`AppHeader`. La référence canonique correcte est **0.34.57** (ce que `ui/`
> consomme), où `AppHeader` ET `Header` coexistent. Toute analyse faite contre
> 0.7.0 serait fausse.

---

## 1. VERDICT — Radar utilise-t-il vraiment `AppHeader` ?

**OUI — `TopNav.svelte` (working tree) importe et utilise bien `AppHeader`** :
`import { AppHeader } from "@sentropic/design-system-svelte"` puis `<AppHeader …>`
avec les snippets `logo` / `nav` / `actions` / `drawer`, en mode `compact`
piloté par `matchMedia`. Ce n'est **plus** la réimplémentation `Header`-primitive
+ flex maison.

**MAIS l'usage n'est pas FIDÈLE.** L'écart visible que le principal constate
(« nav à gauche, pas de barre d'actions canonique, marque maison ») vient de
**3 décisions d'usage non conformes**, pas du choix de composant :

1. **`navAlign` non passé → défaut `"start"` (nav à gauche)**, alors que le site
   DS rend la nav **centrée** (`navAlign="center"`). C'est LE delta visuel n°1.
2. **Bloc marque réimplémenté en CSS maison** (snippet `logo` +
   `.topnav-brand/.topnav-logo/.topnav-brandname`) au lieu des props
   `brandName`/`productName`/`logoSrc` qui rendent le bloc canonique
   `st-appHeader__brand`. Les props `brandName="Radar" productName="immobilier"`
   sont **passées mais ignorées** (le snippet `logo` a priorité par contrat).
3. **Barre d'actions réduite à `IdentityMenu`** : aucun contrôle utilitaire
   canonique (`st-appHeader__control` : thème / mode clair-sombre / langue),
   alors que la barre de droite est une signature visuelle forte du chrome DS.

> Donc : **bon composant, mauvais réglage**. Le correctif est une mise en
> conformité de l'usage (props + `navAlign` + contrôles), **pas** une réécriture.

### Note importante sur « 0 finding »

L'audit `sent-tech-design` (lint statique jsdom) **ne peut pas** détecter cet
écart : il vérifie hex bruts / tokens / a11y, **jamais** « as-tu utilisé
`AppHeader` avec `navAlign` et le bloc marque canonique ». Un header
structurellement faux passe donc « 0 finding » légitimement. **C'est l'origine
des passes précédentes qui ont annoncé 0 finding alors que le rendu était
faux.** Voir §4.

---

## 2. ANATOMIE DU CANON — ce que `AppHeader` (0.34.57) offre

Contrat (props publiques `AppHeaderProps`) :

- **Marque par props** : `brandName`, `productName`, `logoSrc`, `logoAlt`,
  `brandHref`, `brandLabel` → rendent le bloc `st-appHeader__brand`
  (`__brandMark` 2rem carré + `__brandCopy` → `__brandName` poids **760** /
  `__brandProduct` `text-secondary` poids **650**). Le commentaire du contrat est
  explicite : produire ce bloc « **sans dupliquer de CSS côté consommateur** ».
- **Snippet `logo`** : override total (prioritaire sur les props marque).
- **Snippet `nav`** : rendu dans `<nav class="st-appHeader__nav">` ;
  **classe utilitaire publiée `st-appHeader__navLink`** pour chaque lien (pill
  soulignée, état actif `[aria-current="page"]` → `border-bottom-color:
  var(--st-semantic-border-interactive)` + `color: text-primary` + poids 650).
- **`navAlign: "start" | "center"`** : `"center"` → nav en `position:absolute;
  left:50%; transform:translateX(-50%)` (centrage absolu, signature du site DS).
- **Snippet `actions`** : barre de droite `st-appHeader__actions`
  (`gap: --st-spacing-3`) ; classe publiée **`st-appHeader__control`** pour les
  pills utilitaires (thème / langue / icône — hauteur 2.25rem, bordure subtile).
- **Responsive natif** : `compact` (burger à droite) + `menuOpen` + `drawer`
  (tiroir `st-appHeader__drawer` `min(22rem,85vw)` + scrim). 100 % DS.
- **Hauteur / fond / bordure** : `st-appHeader__bar` height
  `var(--st-component-appHeader-height, 3.5rem)`, `max-width: 80rem`, fond
  `--st-semantic-surface-default`, `border-bottom --st-semantic-border-subtle`.

Wrapper supérieur **`AppChrome`** (ce que le site DS rend réellement) : enveloppe
`AppHeader` et fournit clé-en-main les contrôles thème / mode couleur / langue /
recherche en `st-appHeader__control`, plus le tiroir mobile structuré. C'est la
piste « zéro CSS maison » la plus fidèle (voir §5).

---

## 3. ANALYSE D'ÉCART ASPECT PAR ASPECT

Légende : **A** = structure/style de l'AppHeader que Radar **DOIT** respecter ;
**B** = contenu **spécifique au site DS** que Radar **ne doit PAS** copier
(Radar est un produit, pas le site de doc du DS).

### 3.1 Bloc logo / marque — **(A)**

- **Canon** : props `brandName`/`productName`/`logoSrc` → `st-appHeader__brand`
  (carré 2rem + nom poids 760 + sous-titre poids 650), CSS DS, aucune duplication.
- **Radar** : snippet `logo` maison reconstruisant le bloc en CSS local
  (`.topnav-logo` carré 2rem `--st-semantic-action-primary` + glyphe `Radio`,
  `.topnav-brandname` poids 760, `.topnav-brandproduct` poids 650). Les props
  `brandName/productName` sont passées mais **inertes** (snippet prioritaire).
- **Delta** : duplication de CSS exactement déconseillée par le contrat ; risque
  de dérive (toute évolution du bloc DS ne se propagera pas).
- **Correctif** : supprimer le snippet `logo` et le CSS `.topnav-brand*` ;
  passer `brandName="Radar"`, `productName="immobilier"`, et `logoSrc` (un asset
  carré Radar). Si le glyphe `Radio` est non négociable comme marque, le mettre
  **dans** `logoSrc` (SVG) plutôt qu'en snippet maison.

### 3.2 Placement / alignement de la nav — **(A)** — *delta visuel n°1*

- **Canon site DS** : nav **centrée** (`navAlign="center"`).
- **Radar** : `navAlign` **absent** → défaut `"start"` → nav collée à gauche,
  `flex:1`, qui pousse les actions à droite. = exactement « nav gauche » constaté.
- **Delta** : non-conformité d'alignement, perçue immédiatement à l'œil.
- **Correctif** : `<AppHeader navAlign="center" …>` (1 prop). *Décision à acter :
  centrer comme le site DS, ou assumer `start` pour un produit ? Préco : centrer,
  c'est la signature demandée.*

### 3.3 Style d'état actif — **(A)** — déjà conforme

- **Canon** : `st-appHeader__navLink[aria-current="page"]` → soulignement
  `border-bottom: 2px` couleur `--st-semantic-border-interactive`, poids 650.
- **Radar** : utilise la **classe publiée** `st-appHeader__navLink` +
  `aria-current="page"`. ✅ Conforme. Pont `<button>` (`.topnav-navbtn`) neutralise
  juste les défauts du bouton (nav SPA sans href) sans re-styler — acceptable,
  bien documenté dans le fichier.
- **Delta** : nul (sous réserve que le re-style soit vraiment à zéro).
- **Note** : le DS gagnerait un `NavItem`/`navLink` pilotable en mode bouton
  (sans `href`) pour supprimer ce pont — **gap DS**, pas un bug Radar.

### 3.4 Typographie / poids / casse des items nav — **(A)** — conforme

- Hérités de `st-appHeader__navLink` (0.875rem, poids 500→650 actif, casse
  naturelle). Radar n'override pas. ✅

### 3.5 Hauteur / densité / paddings — **(A)** — conforme

- 100 % `st-appHeader__bar` (height 3.5rem, max-width 80rem, padding
  `--st-spacing-4`). Radar ne touche pas la barre. ✅

### 3.6 Barre d'actions à droite — **(A pour la forme / B pour certains items)**

- **Canon site DS** : `st-appHeader__actions` avec pills `st-appHeader__control` :
  recherche docs, **sélecteur framework Svelte/React**, **sélecteur produit**,
  **toggle thème**, **toggle mode clair/sombre**, **langue FR/EN**, icône compte.
- **Radar** : uniquement `<IdentityMenu>`. Pas de pill `st-appHeader__control`.
- **Distinction A/B** :
  - **(B) NE PAS copier** : recherche **docs**, sélecteur **framework**
    (Svelte/React), sélecteur **produit** → spécifiques au site de doc DS.
  - **(A) à considérer** : **toggle langue FR/EN** et **toggle thème / mode
    clair-sombre** sont du chrome **générique** ; un produit FR/EN bilingue et
    multi-thème devrait les exposer en `st-appHeader__control`. Au minimum, la
    **forme** (pills `st-appHeader__control`, `IdentityMenu` à l'extrême droite)
    doit matcher.
- **Delta** : barre d'actions appauvrie + non stylée en pills DS.
- **Correctif** : garder `IdentityMenu` à droite ; ajouter, si pertinent
  produit, `LanguageToggle` (exporté par le DS) et un toggle thème en
  `st-appHeader__control`. **Ne pas** ajouter recherche-docs/framework/produit.

### 3.7 Drawer / responsive mobile — **(A)** — globalement conforme

- **Canon** : `compact` + `drawer` natifs (`st-appHeader__drawer`, scrim).
- **Radar** : utilise `compact`/`menuOpen`/`drawer` natifs ✅. Mais le **contenu**
  du tiroir réintroduit du CSS maison (`.topnav-drawer*`) et un commentaire
  référence `st-appChrome__drawer` (classe d'`AppChrome`, pas d'`AppHeader`) →
  léger mélange de provenances.
- **Delta** : faible ; à surveiller (cohérence des classes drawer).
- **Correctif** : aligner les sections drawer sur les classes DS réellement
  publiées par `AppHeader` (ou adopter `AppChrome` qui fournit le drawer complet).

### 3.8 Tokens vs valeurs en dur — **(A)** — conforme

- Le CSS maison Radar lit exclusivement des tokens `--st-*` (aucun hex brut).
  C'est pourquoi l'audit DS = 0 finding. ✅ Mais « tokens propres » **≠**
  « structure conforme » — d'où le malentendu des passes précédentes.

### 3.9 Vrai `AppHeader` ou réimplémentation ? — **(A)**

- **Vrai `AppHeader`** pour conteneur/barre/hauteur/bordure/fond/responsive
  (✅, zéro layout bespoke). **Réimplémentation partielle** pour le **bloc
  marque** (3.1) et un **CSS drawer** maison (3.7). Donc : usage authentique mais
  **incomplet** côté marque + actions + alignement.

---

## 4. SKILL `sent-tech-design` — findings + version

### Commandes exécutées (engine `@sentropic/design-system-skills` **0.3.2**)

| Cible | Commande | Résultat |
| --- | --- | --- |
| Site DS canonique | `audit https://design-system.sent-tech.ca` | **0 finding** (high:0 medium:0 low:0), exit 0 |
| Snapshot HTML du header Radar | `audit <snapshot>.html` | **0 finding**, exit 0 |
| Snapshot HTML du header Radar | `check <snapshot> --human` | **score 100/100**, charge:low, a11y:none |

**Findings high/medium/low : AUCUN, sur les deux cibles.**

### Interprétation — pourquoi 0 finding est TROMPEUR ici

Le linter `audit` est un **lint statique jsdom à ~7 règles** centré sur :
couleurs **hex brutes** vs tokens `--st-*`, piles de polices, a11y de base
(inputs sans label, images sans alt, contrôles inaccessibles, niveaux de
titres). Il **n'a aucune règle de fidélité structurelle** : ni « composant
`AppHeader` utilisé », ni « `navAlign`/centrage », ni « bloc marque canonique »,
ni « barre d'actions ». La commande `fidelity` ne compare que des primitives
(Button/Input/Select/Link/Card/Tabs vs DSFR/Carbon), **pas** `AppHeader`.

➡️ **Conclusion outillage** : l'écart constaté est **hors de portée** du skill
DS actuel. « 0 finding » est exact ET non rassurant. Le contrôle de fidélité du
chrome doit se faire par **revue visuelle** + **lecture du contrat AppHeader**
(ce document), pas par le linter.

### Version du skill — à jour ?

- Engine résolu : `sent-tech-design-system/packages/skills` → **0.3.2** (build
  `dist/cli.js` présent et fonctionnel). Repo DS au tag `svelte-v0.34.58-5-g…`.
- `npm view @sentropic/design-system-skills version` renvoie **0.1.0** (dernière
  **publiée** sur le registre) : l'engine local **0.3.2** est donc **en avance**
  sur npm (build interne monorepo). Aucune version > 0.3.2 trouvée localement.
- Le paquet `@sentropic/design-system-skills` **n'est pas installé** dans l'arbre
  Radar (seul l'engine source du repo DS est utilisé via le wrapper du skill).

> 🚩 **À CONFIRMER PAR `claude:design-system`** (h2a DOWN, ping live impossible) :
> 1. Le build engine **0.3.2** est-il bien le dernier (vs un 0.3.x plus récent
>    non poussé sur cette box) ?
> 2. Existe-t-il une **règle de fidélité de chrome / AppHeader** prévue ou
>    récente dans le skill (audit:visual ?) qui détecterait `navAlign`/bloc
>    marque/barre d'actions ? Si oui, la lancer change le verdict outillage.
> 3. Le pattern canonique recommandé est-il **`AppHeader` + props** ou carrément
>    **`AppChrome`** pour un produit ? (cf. §5).

---

## 5. PLAN DE CORRECTION PRIORISÉ (passe suivante — PAS faite ici)

Ordonné par impact visuel / effort. Tout en `TopNav.svelte` (et assets).

1. **P0 — Centrer la nav** : passer `navAlign="center"` à `<AppHeader>`.
   *(1 prop ; supprime le delta visuel n°1 « nav à gauche ».)*
2. **P0 — Bloc marque canonique** : supprimer le snippet `logo` + tout le CSS
   `.topnav-brand/.topnav-logo/.topnav-brandcopy/.topnav-brandname/.topnav-brandproduct` ;
   utiliser `brandName="Radar" productName="immobilier" logoSrc="<svg carré Radar>"`.
   *(Rend le bloc `st-appHeader__brand` ; zéro CSS dupliqué ; lève l'incohérence
   « props passées mais ignorées ».)*
3. **P1 — Barre d'actions en pills DS** : conserver `IdentityMenu` à l'extrême
   droite ; ajouter en `st-appHeader__control` un **toggle thème/mode** et, si le
   produit est bilingue, un **`LanguageToggle`** DS. **Ne pas** ajouter
   recherche-docs / sélecteur framework / sélecteur produit (contenu site DS).
4. **P1 — Décider `AppHeader` vs `AppChrome`** : si l'on veut thème+langue+drawer
   clé-en-main sans CSS maison, **adopter `AppChrome`** (il enveloppe `AppHeader`
   et fournit les contrôles + le tiroir canoniques). Préco : évaluer `AppChrome`
   d'abord — c'est la voie « zéro bespoke ».
5. **P2 — Drawer mobile** : aligner les sections du tiroir sur les classes DS
   réellement publiées (ou laisser `AppChrome` les fournir) ; retirer la
   référence erronée à `st-appChrome__drawer` si on reste sur `AppHeader` nu.
6. **P2 — Pont `<button>` nav** : remonter au DS le besoin d'un `NavItem`/navLink
   pilotable en mode bouton (sans `href`) pour supprimer `.topnav-navbtn`.
7. **P3 — Validation** : revue **visuelle** côte-à-côte vs `https://design-system.sent-tech.ca`
   (le skill ne couvre pas la fidélité chrome — cf. §4) + confirmation
   `claude:design-system` des 3 points 🚩 du §4.

---

## 6. Tableau d'écart synthétique

| Aspect | Canon `AppHeader` (site DS) | Header Radar livré | Écart | Classe |
| --- | --- | --- | --- | --- |
| Composant | `AppHeader` (props + snippets) | `AppHeader` ✅ | Aucun (bon composant) | A |
| Alignement nav | **centré** (`navAlign="center"`) | `start` (défaut, **à gauche**) | **Fort** (visuel n°1) | A |
| Bloc marque | props → `st-appHeader__brand` | snippet `logo` + CSS maison ; props inertes | **Fort** (CSS dupliqué) | A |
| État actif nav | `st-appHeader__navLink[aria-current]` | idem (classe publiée) ✅ | Aucun | A |
| Typo / poids nav | hérité DS | hérité DS ✅ | Aucun | A |
| Hauteur / densité | `st-appHeader__bar` 3.5rem | idem ✅ | Aucun | A |
| Barre d'actions | pills `st-appHeader__control` (thème/langue/compte) | `IdentityMenu` seul | **Moyen** (forme + chrome générique) | A (+ B pour items site DS) |
| Recherche / framework / produit | présents (site DS) | absents | — (ne PAS copier) | **B** |
| Drawer mobile | `compact`+`drawer` natifs | natifs ✅ mais CSS drawer maison | Faible | A |
| Tokens vs hard-codé | tokens `--st-*` | tokens `--st-*` ✅ (0 hex) | Aucun | A |

---

*Document d'analyse — aucune modification de code applicatif dans cette passe.*
