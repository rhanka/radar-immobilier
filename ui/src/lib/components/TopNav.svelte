<script lang="ts">
  import { onMount } from "svelte";
  import {
    Rocket,
    SlidersHorizontal,
    MonitorDot,
    KanbanSquare,
    Network,
    GitMerge,
    Target,
    ShieldCheck,
    Map,
    Radio,
    ChevronDown,
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
  const adminItems: { value: DemoView; label: string; icon: typeof Rocket }[] = [
    { value: "admin", label: "Admin", icon: ShieldCheck },
    { value: "onboarding", label: "Onboarding", icon: Rocket },
    { value: "ciblage", label: "Ciblage", icon: Target },
    { value: "grilles", label: "Grilles", icon: SlidersHorizontal },
    { value: "console", label: "Console sources", icon: MonitorDot },
    { value: "ontologie", label: "Ontologie", icon: GitMerge },
    { value: "coordination", label: "Coordination", icon: Network },
    { value: "backlog", label: "Backlog", icon: KanbanSquare },
    { value: "geo", label: "Carte géo", icon: Map },
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
</script>

<!--
  Header CANONIQUE DS : `AppHeader` (la primitive de chrome du design system).
  - Conteneur / barre / hauteur / bordure / fond : 100% AppHeader (zéro layout
    bespoke, plus de `Header` + flex maison).
  - Nav desktop : liens via la classe utilitaire PUBLIÉE `st-appHeader__navLink`
    (pill soulignée + état actif `aria-current="page"` du DS), PAS une pilule
    bleue `Button variant="primary"` maison.
  - Burger + tiroir mobile : `compact`/`drawer` NATIFS d'AppHeader (plus
    d'OverflowMenu détourné en nav).
  - Identité : `IdentityMenu` DS dans `actions`.
-->
<AppHeader
  brandName="Radar"
  productName="immobilier"
  {compact}
  {menuOpen}
  onMenuToggle={() => (menuOpen = !menuOpen)}
  menuLabel="Ouvrir la navigation"
>
  {#snippet logo()}
    <!-- Marque : carré coloré + glyphe, couleurs via tokens sémantiques DS. -->
    <span class="topnav-brand">
      <span class="topnav-logo" aria-hidden="true">
        <Radio size={18} strokeWidth={2.25} />
      </span>
      <span class="topnav-brandcopy">
        <span class="topnav-brandname">Radar</span>
        <span class="topnav-brandproduct">immobilier</span>
      </span>
    </span>
  {/snippet}

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
        placement="bottom-start"
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
      Menu identité — composant canonique DS `IdentityMenu`, câblé sur le store
      auth réel. `onLogout` = le logout CORRIGÉ (fetch /logout + purge du
      disjoncteur anti-boucle + reload propre vers /).
    -->
    <IdentityMenu
      user={identityUser}
      isAuthenticated={!!(authState?.authenticated && authState.user)}
      onLogout={onLogout}
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
  /* ── Marque : aligne le bloc logo carré + nom + sous-titre sur le pattern DS ──
     (couleurs exclusivement via tokens sémantiques, aucune valeur en dur). */
  .topnav-brand {
    align-items: center;
    display: inline-flex;
    gap: var(--st-spacing-3, 0.75rem);
  }

  .topnav-logo {
    align-items: center;
    background: var(--st-semantic-action-primary);
    border-radius: var(--st-radius-md, 0.375rem);
    color: var(--st-semantic-action-primaryText);
    display: inline-flex;
    flex: 0 0 auto;
    height: 2rem;
    justify-content: center;
    width: 2rem;
  }

  .topnav-brandcopy {
    display: grid;
    gap: var(--st-spacing-px, 1px);
    line-height: 1;
  }

  .topnav-brandname {
    color: var(--st-semantic-text-primary);
    font-size: 1rem;
    font-weight: 760;
  }

  .topnav-brandproduct {
    color: var(--st-semantic-text-secondary);
    font-size: 0.75rem;
    font-weight: 650;
  }

  /* ── Pont <button> ↔ classe de lien de nav DS ──────────────────────────────
     `st-appHeader__navLink` est la classe utilitaire PUBLIÉE par le DS pour les
     liens de nav (état actif = soulignement). Conçue pour des <a> ; nos items
     sont des <button> (navigation SPA, pas des URLs). Ce bloc ne fait QUE
     neutraliser les défauts du <button> pour que le rendu soit BYTE-identique
     au lien DS — aucun re-style (couleurs/tailles/état actif restent ceux du DS).
     MANQUE DS : un composant/`navItem` de nav top-level pilotable en mode
     bouton (sans href) supprimerait ce pont — voir rapport. */
  .topnav-navbtn {
    appearance: none;
    background: transparent;
    border: 0;
    border-bottom: 2px solid transparent;
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
</style>
