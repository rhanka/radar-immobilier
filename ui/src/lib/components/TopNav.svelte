<script lang="ts">
  import {
    SlidersHorizontal,
    MonitorDot,
    GitMerge,
    ShieldCheck,
    ChevronDown,
  } from "@lucide/svelte";
  import {
    AppChrome,
    IdentityMenu,
    Menu,
    MenuPopover,
  } from "@sentropic/design-system-svelte";
  import type {
    MenuItem,
    AppChromeNavItem,
    AppChromeColorMode,
    AppChromeLocale,
  } from "@sentropic/design-system-svelte";
  import type { DemoView } from "$lib/demo/views.js";
  import type { AuthState } from "$lib/auth/auth-store.js";

  export let activeView: DemoView;
  export let onSelect: (view: DemoView) => void;
  /** État d'authentification (optionnel pour compatibilité). */
  export let authState: AuthState | undefined = undefined;
  /** Callback de déconnexion (logout corrigé : fetch /logout + reload propre). */
  export let onLogout: (() => void) | undefined = undefined;

  $: isAdmin = authState?.user?.isAdmin === true;

  /** 3 vues principales — navigation visible, grand public. */
  const mainItems: { id: DemoView; label: string }[] = [
    { id: "signaux", label: "Signaux" },
    { id: "evaluation", label: "Évaluation" },
    { id: "sources", label: "Sources" },
  ];

  /**
   * Nav AppChrome (0-custo) : chaque vue principale devient un `AppChromeNavItem`
   * `{ label, href, active }`. Le href est un lien HASH SPA (`#/<view>`) — le
   * routeur radar (router.ts) écoute désormais `hashchange` et met à jour
   * `activeRouteView` quand l'utilisateur clique un de ces liens : navigation
   * SPA SANS rechargement, sans pont <button> maison. L'état actif est piloté
   * par `activeView` (dérivé du store `activeRouteView`).
   */
  $: navItems = mainItems.map(
    (item): AppChromeNavItem => ({
      label: item.label,
      href: `#/${item.id}`,
      active: activeView === item.id,
    }),
  );

  /**
   * Outils internes (admin/dev) — GATÉS AU RÔLE ADMIN. Ils ne font plus partie
   * de la navigation top-level grand public : le menu Admin n'apparaît QUE si
   * `isAdmin`. Plus aucun doublon avec la nav principale.
   */
  const adminItems: { value: DemoView; label: string; icon: typeof ShieldCheck }[] = [
    { value: "admin", label: "Admin", icon: ShieldCheck },
    { value: "grilles", label: "Grilles", icon: SlidersHorizontal },
    { value: "console", label: "Console sources", icon: MonitorDot },
    { value: "ontologie", label: "Ontologie", icon: GitMerge },
  ];

  /** Items DS du menu Admin (group + entrées actionnables). */
  const adminMenuItems: MenuItem[] = [
    { kind: "group", label: "Outils internes" },
    ...adminItems.map(
      (item): MenuItem => ({
        kind: "item",
        value: item.value,
        label: item.label,
        icon: item.icon,
      }),
    ),
  ];

  /** Vrai si la vue active est un outil admin (état visuel du déclencheur). */
  $: isAdminActive = adminItems.some((item) => item.value === activeView);

  let adminOpen = false;
  /** Référence HTML du déclencheur Admin (ancre du MenuPopover). */
  let adminTriggerEl: HTMLElement | null = null;

  function handleAdminSelect(value: string): void {
    onSelect(value as DemoView);
    adminOpen = false;
    menuOpen = false;
  }

  /** Identité utilisateur pour IdentityMenu (contrat DS : displayName requis). */
  $: identityUser =
    authState?.authenticated && authState.user
      ? {
          displayName:
            authState.user.name ?? authState.user.email ?? authState.user.sub,
          email: authState.user.email,
        }
      : null;

  /** État ouvert du tiroir mobile NATIF d'AppChrome (`mobileMenuOpen`). */
  let menuOpen = false;

  /**
   * Mode couleur + langue NATIFS du DS (AppChrome `colorMode` / `locale`). Ils
   * remplacent les anciens toggles custo (soleil/lune, globe). L'unique effet de
   * bord conservé est la pose de `data-theme` sur <html> — pilotée par
   * `onColorModeChange`. `colorMode` cycle light → dark → auto ; `auto` résout la
   * préférence système via `prefers-color-scheme`. La langue n'a pas encore de
   * store i18n : l'état local reproduit le comportement antérieur (libellé FR/EN).
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
  system) — 0-custo. AppChrome porte la marque, la nav principale, les contrôles
  utilitaires (mode couleur + langue NATIFS), le tiroir mobile et le burger. Plus
  aucun layout/CSS maison (suppression du pont <button> `topnav-navbtn`, des
  toggles custo soleil/lune + globe, et du tiroir `topnav-drawer*`).

  - Marque : props brandName/productName/logoSrc → bloc canonique DS (logo carré
    + nom « Radar » + sous-titre « immobilier »), càd le branding nom+sous-titre
    actuel, rendu nativement par AppChrome.
  - Nav : `nav` = AppChromeNavItem[] (liens hash SPA `#/<view>`, état actif via
    `active`). SPA préservée : router.ts écoute `hashchange`.
  - Mode couleur / langue : NATIFS (colorMode/locale + callbacks). `data-theme`
    posé par `onColorModeChange`.
  - Identité : snippet `identity` = IdentityMenu DS (contrat displayName).
  - Admin (transition) : snippet `extraSelectors` = dropdown Admin (MenuPopover +
    adminMenuItems) GATÉ au rôle admin. Sera remplacé par une nav `kind:'menu'`
    quand le MenuButton DS sera publié.
  - Mobile : `mobileMenuOpen`/`onMobileMenuToggle` câblés sur `menuOpen`.
-->
<AppChrome
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
      (carré à initiales), câblé sur le store auth réel. `onLogout` = le logout
      CORRIGÉ (fetch /logout + purge du disjoncteur anti-boucle + reload vers /).
    -->
    <IdentityMenu
      user={identityUser}
      isAuthenticated={!!(authState?.authenticated && authState.user)}
      onLogout={onLogout}
      compact={true}
    />
  {/snippet}

  {#snippet extraSelectors()}
    <!--
      Menu Admin — outils internes GATÉS au rôle admin. Rendu UNIQUEMENT pour un
      compte admin. TRANSITOIRE dans `extraSelectors` (zone utilitaire) : à
      remplacer par une entrée de nav `kind:'menu'` à la publication du MenuButton
      DS. Déclencheur = pill utilitaire DS `st-appHeader__control`, panneau =
      MenuPopover + Menu DS (gating + actionnabilité préservés).
    -->
    {#if isAdmin}
      <button
        bind:this={adminTriggerEl}
        type="button"
        class="st-appHeader__control"
        aria-current={isAdminActive ? "page" : undefined}
        aria-haspopup="menu"
        aria-expanded={adminOpen}
        onclick={() => (adminOpen = !adminOpen)}
      >
        <ShieldCheck size={16} aria-hidden="true" />
        Admin
        <ChevronDown size={14} aria-hidden="true" />
      </button>

      <MenuPopover
        bind:open={adminOpen}
        trigger={adminTriggerEl}
        placement="bottom-end"
        label="Menu Admin"
      >
        <Menu
          label="Outils internes"
          items={adminMenuItems}
          open={true}
          dismissOnSelect={false}
          onselect={handleAdminSelect}
        />
      </MenuPopover>
    {/if}
  {/snippet}
</AppChrome>
