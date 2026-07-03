<script lang="ts">
  import { AppChrome, IdentityMenu } from "@sentropic/design-system-svelte";
  import type {
    AppChromeNavItem,
    AppChromeColorMode,
    AppChromeLocale,
  } from "@sentropic/design-system-svelte";
  import type { DemoView } from "$lib/demo/views.js";
  import type { AuthState } from "$lib/auth/auth-store.js";
  import { evaluationBeta } from "$lib/state/beta.js";

  export let activeView: DemoView;
  /**
   * Conservé pour compat de contrat avec App.svelte. NB : avec `AppChrome`, les
   * liens de nav sont des <a href="#/<view>"> rendus PAR le DS — la navigation
   * passe par `hashchange` (router.ts), pas par `onSelect`. La prop reste
   * exposée pour ne pas casser l'appelant et un futur câblage programmatique.
   */
  export let onSelect: (view: DemoView) => void = () => {};
  /** État d'authentification (optionnel pour compatibilité). */
  export let authState: AuthState | undefined = undefined;
  /** Callback de déconnexion (logout corrigé : fetch /logout + reload propre). */
  export let onLogout: (() => void) | undefined = undefined;

  // `onSelect` est conservé pour compat (voir ci-dessus) mais non lu ici : on
  // référence le type pour éviter tout faux positif d'« export inutilisé ».
  void onSelect;

  $: isAdmin = authState?.user?.isAdmin === true;

  /**
   * Vues principales — navigation visible, grand public.
   * « Évaluation » est marquée `beta` : pas assez aboutie pour la nav par
   * défaut, elle est MASQUÉE tant que le flag beta (Ctrl+Shift+X, persisté
   * localStorage — voir $lib/state/beta.ts) n'est pas activé. La route
   * `#/evaluation` reste valide dans tous les cas (router.ts).
   */
  const mainItems: { id: DemoView; label: string; beta?: boolean }[] = [
    { id: "signaux", label: "Signaux" },
    { id: "evaluation", label: "Évaluation", beta: true },
    { id: "sources", label: "Sources" },
  ];

  /** Entrées visibles : les entrées `beta` n'apparaissent que flag activé. */
  $: visibleItems = mainItems.filter((item) => !item.beta || $evaluationBeta);

  /**
   * Nav AppChrome (0-custo) : chaque vue principale devient un `AppChromeNavItem`
   * `{ label, href, active }`. Le href est un lien HASH SPA (`#/<view>`) — le
   * routeur radar (router.ts) écoute `hashchange` et met à jour `activeRouteView`
   * au clic. La nav top-level se limite STRICTEMENT à Signaux/(Évaluation si
   * beta)/Sources : « Grilles » et « Console sources » ne sont plus dans le
   * header (ils migrent respectivement sous Évaluation et Sources, hors de ce
   * composant).
   */
  $: navItems = visibleItems.map(
    (item): AppChromeNavItem => ({
      label: item.label,
      href: `#/${item.id}`,
      active: activeView === item.id,
    }),
  );

  /** Identité utilisateur pour IdentityMenu (contrat DS : displayName requis). */
  $: identityUser =
    authState?.authenticated && authState.user
      ? {
          displayName:
            authState.user.name ?? authState.user.email ?? authState.user.sub,
          email: authState.user.email,
        }
      : null;

  /**
   * Destination de l'entrée « Paramètres » du dropdown identité. Les outils
   * internes (Admin, Ontologie) ne sont plus un bouton séparé dans le header :
   * ils vivent SOUS « Paramètres ». Le hub admin (`#/admin`) les regroupe ;
   * GATING : seul un compte admin y est routé (sinon l'entrée reste inerte).
   * IdentityMenu n'expose qu'UN lien `settingsHref` (menu à forme fixe) — voir
   * la note d'écart d'API en bas de fichier.
   */
  $: settingsHref = isAdmin ? "#/admin" : undefined;

  /** État ouvert du tiroir mobile NATIF d'AppChrome (`mobileMenuOpen`). */
  let menuOpen = false;

  /**
   * Mode couleur + langue NATIFS du DS (AppChrome `colorMode` / `locale`). Le
   * seul effet de bord conservé est la pose de `data-theme` sur <html> —
   * pilotée par `onColorModeChange`. `colorMode` cycle light → dark → auto ;
   * `auto` résout la préférence système via `prefers-color-scheme`. La langue
   * n'a pas encore de store i18n : l'état local reproduit le comportement
   * antérieur (libellé FR/EN).
   */
  let colorMode: AppChromeColorMode = "light";
  let locale: AppChromeLocale = "fr";

  function applyColorMode(mode: AppChromeColorMode): void {
    if (typeof document === "undefined") return;
    const resolved =
      mode === "auto"
        ? typeof window !== "undefined" &&
          window.matchMedia?.("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : mode;
    document.documentElement.dataset.theme = resolved;
  }

  function handleColorModeChange(mode: AppChromeColorMode): void {
    colorMode = mode;
    applyColorMode(mode);
  }

  function handleLocaleChange(next: AppChromeLocale): void {
    locale = next;
  }
</script>

<!--
  Header CANONIQUE DS : `AppChrome` (le chrome batteries-included du design
  system) — 0-custo côté logique. AppChrome porte la marque, la nav principale,
  les contrôles utilitaires (mode couleur + langue NATIFS), le tiroir mobile et
  le burger.

  - Marque : props brandName/productName/logoSrc → bloc canonique DS (logo carré
    + nom « Radar » + sous-titre « immobilier »), rendu nativement par AppChrome.
  - Nav : `nav` = AppChromeNavItem[] (liens hash SPA `#/<view>`, état actif via
    `active`) — Signaux/Évaluation/Sources UNIQUEMENT. SPA préservée : router.ts
    écoute `hashchange`. CENTRÉE (KO nav-center) : voir la note CSS plus bas.
  - Mode couleur / langue : NATIFS (colorMode/locale + callbacks). `data-theme`
    posé par `onColorModeChange`.
  - Identité : snippet `identity` = IdentityMenu DS en mode `compact` (avatar
    carré à initiale) + dropdown natif « Appareils / Paramètres / Se déconnecter ».
    « Paramètres » route vers le hub admin pour un compte admin (outils internes
    Admin/Ontologie regroupés là — plus de bouton Admin séparé dans le header).
  - Police : 100% DS — AppChrome/AppHeader rendent `font-family: var(--st-font-sans)`
    et le ThemeProvider (`[data-st-theme="sent-tech"]`, qui enveloppe ce header)
    déclare `--st-font-sans: Inter, …` ; Inter est chargée par app.css. Aucune
    font posée ici (cf. note KO police en bas de fichier).
  - Mobile : `mobileMenuOpen`/`onMobileMenuToggle` câblés sur `menuOpen`.
-->
<AppChrome
  class="topnav-chrome"
  brandName="Radar"
  productName="immobilier"
  logoSrc="/radar-logo.svg"
  logoAlt="Radar"
  brandHref="#/signaux"
  brandLabel="Radar immobilier"
  nav={navItems}
  navLabel="Navigation principale"
  {colorMode}
  onColorModeChange={handleColorModeChange}
  colorModeLabels={{ light: "Mode clair", dark: "Mode sombre", auto: "Mode auto" }}
  {locale}
  onLocaleChange={handleLocaleChange}
  localeLabel="Changer de langue"
  mobileMenuOpen={menuOpen}
  onMobileMenuToggle={() => (menuOpen = !menuOpen)}
  menuLabel="Ouvrir la navigation"
>
  {#snippet identity()}
    <!--
      Menu identité — composant canonique DS `IdentityMenu` en mode `compact`
      (avatar carré à initiale), câblé sur le store auth réel. Le dropdown natif
      rend « Appareils / Paramètres / Se déconnecter ». `settingsHref` route
      « Paramètres » vers le hub admin pour un compte admin (gating isAdmin).
      `onLogout` = le logout CORRIGÉ (fetch /logout + purge du disjoncteur
      anti-boucle + reload vers /).
    -->
    <IdentityMenu
      user={identityUser}
      isAuthenticated={!!identityUser}
      settingsHref={settingsHref}
      onLogout={onLogout}
      compact={true}
    />
  {/snippet}
</AppChrome>

<style>
  /* ── Nav centrée (KO nav-center) ───────────────────────────────────────────
     AppChrome n'EXPOSE PAS `navAlign` : il embarque `AppHeader` en interne mais
     ne forwarde PAS la prop (AppHeader, lui, a bien `navAlign="start" | "center"`).
     On reproduit donc À L'IDENTIQUE le mode `navAlign="center"` PUBLIÉ du DS —
     `position:relative` sur la barre + `position:absolute; left:50%;
     translateX(-50%)` sur le <nav> — au lieu d'inventer une mise en page. Le
     `class="topnav-chrome"` posé sur AppChrome (→ `<div class="st-appChrome
     topnav-chrome">`) sert d'ancre de scoping ; les classes ciblées sont les
     classes utilitaires DS publiées.
     Restreint à ≥768px : sous le seuil la zone utilitaire bascule en burger
     (comportement AppChrome natif) — inutile et risqué de centrer en absolu.
     ÉCART D'API rapporté : AppChrome devrait forwarder `navAlign` à son
     AppHeader (sinon tout consommateur voulant une nav centrée doit ce patch). */
  @media (min-width: 768px) {
    :global(.topnav-chrome .st-appHeader__bar) {
      position: relative;
    }

    :global(.topnav-chrome .st-appHeader__nav) {
      flex: 0 0 auto;
      left: 50%;
      position: absolute;
      transform: translateX(-50%);
    }
  }

  /* ── Indicateur « bêta » sur l'entrée Évaluation ───────────────────────────
     L'entrée n'existe dans le DOM que flag beta activé (Ctrl+Shift+X) : le
     badge ne s'affiche donc que quand elle est révélée. `AppChromeNavItem` ne
     porte qu'un `label: string` (pas de slot/badge natif) : on pose l'étiquette
     en ::after sur le lien DS, scopé `.topnav-chrome` + href — mêmes classes
     utilitaires publiées que le patch nav-center ci-dessus. Tokens DS
     (couleurs/rayon/espacement sémantiques) avec repli neutre. */
  :global(.topnav-chrome .st-appHeader__navLink[href="#/evaluation"]::after) {
    border: 1px solid var(--st-semantic-border-subtle, #d4d4d8);
    border-radius: var(--st-radius-sm, 4px);
    color: var(--st-semantic-text-secondary, #6b7280);
    content: "bêta";
    font-size: 0.7em;
    line-height: 1;
    margin-left: var(--st-spacing-1, 4px);
    padding: 1px var(--st-spacing-1, 4px) 2px;
    vertical-align: middle;
  }
</style>
