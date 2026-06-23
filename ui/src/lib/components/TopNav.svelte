<script lang="ts">
  import { onMount } from "svelte";
  import {
    SlidersHorizontal,
    MonitorDot,
    GitMerge,
    ShieldCheck,
    ChevronDown,
    Globe,
    Sun,
    Moon,
  } from "@lucide/svelte";
  import {
    AppHeader,
    IdentityMenu,
    Menu,
    MenuPopover,
  } from "@sentropic/design-system-svelte";
  import type { MenuItem } from "@sentropic/design-system-svelte";
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

  /**
   * Mode compact (burger) piloté à la VOLÉE par le DS via `AppHeader.compact`.
   * Au lieu d'un repli Tailwind maison (`hidden md:flex`) + OverflowMenu détourné,
   * on laisse `AppHeader` rendre son burger + tiroir CANONIQUES sous le seuil md
   * (767px). SPA client-only : `matchMedia` est sûr, mais on garde un guard SSR.
   */
  let compact = false;
  let menuOpen = false;

  onMount(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const sync = () => {
      compact = mq.matches;
      if (!compact) menuOpen = false;
    };
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  });

  /** Sélection d'une vue principale (ferme le tiroir mobile le cas échéant). */
  function selectMain(view: DemoView): void {
    onSelect(view);
    menuOpen = false;
  }

  /**
   * Contrôles utilitaires de la zone `actions` (parité avec le chrome DS / docs) :
   * langue (globe + libellé court) et thème jour/nuit (soleil/lune). Rendus via la
   * classe utilitaire PUBLIÉE `st-appHeader__control` (pill icône canonique du DS).
   * État local (l'app n'expose pas encore de store i18n/thème) : le bouton thème
   * reflète la préférence en posant `data-theme` sur <html>, le bouton langue
   * bascule le libellé FR/EN.
   */
  let lang: "fr" | "en" = "fr";
  let dark = false;

  function toggleLang(): void {
    lang = lang === "fr" ? "en" : "fr";
  }

  function toggleTheme(): void {
    dark = !dark;
    if (typeof document !== "undefined") {
      document.documentElement.dataset.theme = dark ? "dark" : "light";
    }
  }
</script>

<!--
  Header CANONIQUE DS : `AppHeader` (la primitive de chrome du design system).
  - Conteneur / barre / hauteur / bordure / fond : 100% AppHeader (zéro layout
    bespoke, plus de `Header` + flex maison).
  - Marque : `brandMode="full"` + props `brandName`/`productName`/`logoSrc` →
    bloc CANONIQUE `st-appHeader__brand` (carré 2rem + nom poids 760 + sous-titre
    poids 650), rendu par le DS. En mode `icon` (défaut DS) le DS rend l'IMAGE
    SEULE et masque nom/produit → marque réduite à un glyphe (régression visible).
    `full` restaure le nom « Radar » + sous-titre « immobilier ».
    Plus de snippet `logo` maison ni de CSS `.topnav-brand*`
    dupliqué (gap-analysis §3.1/§5.2). Le glyphe Radar (Lucide « Radio ») vit
    dans l'asset `logoSrc` (`/radar-logo.svg`), pas en CSS consommateur.
  - Nav desktop : liens via la classe utilitaire PUBLIÉE `st-appHeader__navLink`
    (pill soulignée + état actif `aria-current="page"` du DS), PAS une pilule
    bleue `Button variant="primary"` maison.
  - Burger + tiroir mobile : `compact`/`drawer` NATIFS d'AppHeader (plus
    d'OverflowMenu détourné en nav) → aucun débordement viewport mobile.
  - Actions : contrôles utilitaires canoniques DS (`st-appHeader__control`) —
    langue (globe + libellé FR/EN) et thème jour/nuit (soleil/lune) — puis
    `IdentityMenu` DS en mode `compact` (carré à initiales).
  - Identité : `IdentityMenu` DS dans `actions` (API publiée 0.34.62 : avatar
    compact + items Paramètres/Appareils + déconnexion).
-->
<AppHeader
  brandMode="full"
  brandName="Radar"
  productName="immobilier"
  logoSrc="/radar-logo.svg"
  logoAlt="Radar"
  brandLabel="Radar immobilier"
  navAlign="center"
  {compact}
  {menuOpen}
  onMenuToggle={() => (menuOpen = !menuOpen)}
  menuLabel="Ouvrir la navigation"
>
  {#snippet nav()}
    <!-- Vues principales : liens de nav DS (état actif = soulignement canonique). -->
    {#each mainItems as item}
      <button
        type="button"
        class="st-appHeader__navLink topnav-navbtn"
        aria-current={activeView === item.id ? "page" : undefined}
        onclick={() => selectMain(item.id)}
      >
        {item.label}
      </button>
    {/each}

    <!--
      Menu Admin — outils internes gatés au rôle admin. Rendu UNIQUEMENT pour
      un compte admin. Le déclencheur réutilise la même classe de lien de nav DS
      (cohérence visuelle stricte), le panneau est un MenuPopover + Menu DS.
    -->
    {#if isAdmin}
      <span bind:this={adminTriggerEl} class="inline-flex">
        <button
          type="button"
          class="st-appHeader__navLink topnav-navbtn"
          aria-current={isAdminActive ? "page" : undefined}
          aria-haspopup="menu"
          aria-expanded={adminOpen}
          onclick={() => (adminOpen = !adminOpen)}
        >
          <ShieldCheck size={16} aria-hidden="true" />
          Admin
          <ChevronDown size={14} aria-hidden="true" />
        </button>
      </span>

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

  {#snippet actions()}
    <!--
      Contrôles utilitaires canoniques DS (`st-appHeader__control`) : langue
      (globe + libellé) puis thème jour/nuit (soleil/lune). Mêmes pills que le
      chrome de la doc DS — aucun style maison.
    -->
    <button
      type="button"
      class="st-appHeader__control"
      aria-label="Changer de langue"
      onclick={toggleLang}
    >
      <Globe size={14} aria-hidden="true" />
      {lang === "fr" ? "FR" : "EN"}
      <ChevronDown size={12} aria-hidden="true" />
    </button>
    <button
      type="button"
      class="st-appHeader__control"
      aria-label={dark ? "Activer le mode clair" : "Activer le mode sombre"}
      aria-pressed={dark}
      onclick={toggleTheme}
    >
      {#if dark}
        <Moon size={16} aria-hidden="true" />
      {:else}
        <Sun size={16} aria-hidden="true" />
      {/if}
    </button>

    <!--
      Menu identité — composant canonique DS `IdentityMenu` en mode `compact`
      (carré à initiales, gabarit `st-appHeader__control`), câblé sur le store
      auth réel. `onLogout` = le logout CORRIGÉ (fetch /logout + purge du
      disjoncteur anti-boucle + reload propre vers /).
    -->
    <IdentityMenu
      user={identityUser}
      isAuthenticated={!!(authState?.authenticated && authState.user)}
      onLogout={onLogout}
      compact={true}
    />
  {/snippet}

  {#snippet drawer()}
    <!--
      Tiroir mobile NATIF d'AppHeader (rendu sous le seuil md). Vues principales
      en liens de nav DS + outils internes (si admin) + identité — mêmes classes
      utilitaires DS, zéro composant détourné.
    -->
    <nav class="topnav-drawer" aria-label="Navigation">
      <div class="topnav-drawer-section">
        {#each mainItems as item}
          <button
            type="button"
            class="st-appHeader__navLink topnav-navbtn topnav-drawer-link"
            aria-current={activeView === item.id ? "page" : undefined}
            onclick={() => selectMain(item.id)}
          >
            {item.label}
          </button>
        {/each}
      </div>

      {#if isAdmin}
        <div class="topnav-drawer-section">
          <span class="topnav-drawer-label">Outils internes</span>
          {#each adminItems as item}
            {@const Icon = item.icon}
            <button
              type="button"
              class="st-appHeader__navLink topnav-navbtn topnav-drawer-link"
              aria-current={activeView === item.value ? "page" : undefined}
              onclick={() => {
                onSelect(item.value);
                menuOpen = false;
              }}
            >
              <Icon size={16} aria-hidden="true" />
              {item.label}
            </button>
          {/each}
        </div>
      {/if}

      <div class="topnav-drawer-section">
        <div class="topnav-drawer-controls">
          <button
            type="button"
            class="st-appHeader__control"
            aria-label="Changer de langue"
            onclick={toggleLang}
          >
            <Globe size={14} aria-hidden="true" />
            {lang === "fr" ? "FR" : "EN"}
            <ChevronDown size={12} aria-hidden="true" />
          </button>
          <button
            type="button"
            class="st-appHeader__control"
            aria-label={dark ? "Activer le mode clair" : "Activer le mode sombre"}
            aria-pressed={dark}
            onclick={toggleTheme}
          >
            {#if dark}
              <Moon size={16} aria-hidden="true" />
            {:else}
              <Sun size={16} aria-hidden="true" />
            {/if}
          </button>
        </div>
        <IdentityMenu
          user={identityUser}
          isAuthenticated={!!(authState?.authenticated && authState.user)}
          onLogout={onLogout}
        />
      </div>
    </nav>
  {/snippet}
</AppHeader>

<style>
  /* Marque : 100% bloc canonique DS `st-appHeader__brand` via props
     brandName/productName/logoSrc. Aucun CSS marque maison (supprimé :
     .topnav-brand/.topnav-logo/.topnav-brandcopy/-name/-product). */

  /* ── Pont <button> ↔ classe de lien de nav DS ──────────────────────────────
     `st-appHeader__navLink` est la classe utilitaire PUBLIÉE par le DS pour les
     liens de nav (état actif = SOULIGNEMENT `border-bottom-color` sur
     `[aria-current=page]`). Conçue pour des <a> ; nos items sont des <button>
     (navigation SPA, pas des URLs). Ce bloc ne fait QUE neutraliser les défauts
     du <button> SANS toucher au `border-bottom` : le DS gère entièrement la
     bordure basse (transparente au repos, colorée sur l'actif). Touchant le
     `border-bottom` ici, le CSS scopé Svelte (`.topnav-navbtn.svelte-xxx`)
     égalait la spécificité du sélecteur DS `[aria-current=page]` et, injecté
     après, écrasait le soulignement actif en transparent (bug #1). On neutralise
     donc UNIQUEMENT les bordures top/right/left, et on laisse le DS souligner.
     MANQUE DS : un composant/`navItem` de nav top-level pilotable en mode
     bouton (sans href) supprimerait ce pont — voir rapport. */
  .topnav-navbtn {
    appearance: none;
    background: transparent;
    border-top: 0;
    border-right: 0;
    border-left: 0;
    cursor: pointer;
    font: inherit;
  }

  /* ── Tiroir mobile : structure alignée sur `st-appChrome__drawer` du DS ──── */
  .topnav-drawer {
    display: flex;
    flex-direction: column;
    gap: var(--st-spacing-2, 0.5rem);
    padding: var(--st-spacing-4, 1rem);
  }

  .topnav-drawer-section {
    border-top: 1px solid var(--st-semantic-border-subtle);
    display: flex;
    flex-direction: column;
    gap: var(--st-spacing-1, 0.25rem);
    padding-top: var(--st-spacing-3, 0.75rem);
  }

  .topnav-drawer-section:first-child {
    border-top: 0;
    padding-top: var(--st-spacing-1, 0.25rem);
  }

  .topnav-drawer-label {
    color: var(--st-semantic-text-secondary);
    font-size: 0.75rem;
    font-weight: 650;
    padding: 0 0.75rem;
  }

  /* Liens du tiroir : pleine largeur, alignés à gauche (anatomie tiroir DS). */
  .topnav-drawer-link {
    border-bottom: 0;
    justify-content: flex-start;
    width: 100%;
  }

  /* Contrôles utilitaires du tiroir (langue + thème) : rangée alignée à gauche. */
  .topnav-drawer-controls {
    display: flex;
    gap: var(--st-spacing-2, 0.5rem);
    margin-bottom: var(--st-spacing-2, 0.5rem);
  }
</style>
