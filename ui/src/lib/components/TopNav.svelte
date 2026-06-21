<script lang="ts">
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
  } from "@lucide/svelte";
  import {
    Button,
    Header,
    IdentityMenu,
    Menu,
    MenuPopover,
    OverflowMenu,
  } from "@sentropic/design-system-svelte";
  import type {
    MenuItem,
    OverflowMenuItem,
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
   * Items mobile : vues principales (toujours) + outils admin (UNIQUEMENT si
   * admin), regroupés dans l'OverflowMenu DS pour le repli responsive (< md).
   */
  $: mobileNavItems = [
    ...mainItems.map(
      (item): OverflowMenuItem => ({
        value: item.id,
        label: item.label,
        onclick: () => onSelect(item.id),
      }),
    ),
    ...(isAdmin
      ? [
          { kind: "divider" as const },
          { kind: "group" as const, label: "Outils internes" },
          ...adminItems.map(
            (item): OverflowMenuItem => ({
              value: item.value,
              label: item.label,
              icon: item.icon,
              onclick: () => onSelect(item.value),
            }),
          ),
        ]
      : []),
  ];
</script>

<Header title="Radar immobilier" sticky={false} label="Navigation principale">
  {#snippet logo()}
    <!--
      Bloc logo conforme au pattern Header DS : carré coloré + glyphe, couleurs
      via tokens sémantiques DS uniquement (zéro hex/classe couleur en dur).
    -->
    <span class="topnav-logo" aria-hidden="true">
      <Radio size={18} strokeWidth={2.25} />
    </span>
  {/snippet}

  {#snippet navigation()}
    <!-- Nav desktop (≥ md = 768px) : vues principales + menu Admin (si admin) -->
    <div class="hidden md:flex items-center gap-1">
      {#each mainItems as item}
        <Button
          type="button"
          size="sm"
          variant={activeView === item.id ? "primary" : "ghost"}
          aria-current={activeView === item.id ? "page" : undefined}
          class="whitespace-nowrap"
          onclick={() => onSelect(item.id)}
        >
          {item.label}
        </Button>
      {/each}

      <!--
        Menu Admin — outils internes gatés au rôle admin. Rendu UNIQUEMENT pour
        un compte admin : le grand public ne voit aucun outil interne.
        Le span est une ancre HTMLElement (inline-flex, pas display:contents)
        pour que MenuPopover se positionne bien sous le bouton.
      -->
      {#if isAdmin}
        <span bind:this={adminTriggerEl} class="inline-flex">
          <Button
            type="button"
            size="sm"
            variant={isAdminActive ? "primary" : "ghost"}
            aria-haspopup="menu"
            aria-expanded={adminOpen}
            onclick={() => (adminOpen = !adminOpen)}
          >
            <ShieldCheck size={16} aria-hidden="true" />
            Admin
          </Button>
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
    </div>

    <!-- Nav mobile (< md = 768px) : OverflowMenu DS regroupant les vues -->
    <div class="flex md:hidden items-center">
      <OverflowMenu
        items={mobileNavItems}
        label="Navigation"
        triggerLabel="Ouvrir la navigation"
        placement="bottom-start"
      />
    </div>
  {/snippet}

  {#snippet actions()}
    <!--
      Menu identité — composant canonique DS `IdentityMenu`, câblé sur le store
      auth réel. `onLogout` = le logout CORRIGÉ (fetch /logout + purge du
      disjoncteur anti-boucle + reload propre vers /).

      TODO DS items[] extension : quand la version DS exposant `items[]` +
      `secondaryLabel` sera publiée (non dispo en 0.34.57), brancher ici en une
      ligne `items={[Profil, Paramètres, Admin profils/utilisateurs]}` +
      `secondaryLabel="Créer un compte"`.
    -->
    <IdentityMenu
      user={identityUser}
      isAuthenticated={!!(authState?.authenticated && authState.user)}
      onLogout={onLogout}
    />
  {/snippet}
</Header>

<style>
  /* Logo : couleurs exclusivement via tokens sémantiques DS. */
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
</style>
