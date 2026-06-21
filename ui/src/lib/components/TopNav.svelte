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
    Settings,
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
  /** Callback de déconnexion. */
  export let onLogout: (() => void) | undefined = undefined;

  $: isAdmin = authState?.user?.isAdmin === true;

  /** 3 vues principales — navigation visible. */
  const mainItems: { id: DemoView; label: string }[] = [
    { id: "signaux", label: "Signaux" },
    { id: "evaluation", label: "Évaluation" },
    { id: "sources", label: "Sources" },
  ];

  /**
   * Items du menu Outils construits dynamiquement pour filtrer Admin si non-admin.
   * MenuItem du DS supporte icon?: Component compatible Lucide.
   */
  $: outilsItems = [
    { kind: "group" as const, label: "Outils internes" },
    ...(isAdmin ? [{ value: "admin", label: "Admin", icon: ShieldCheck }] : []),
    { value: "onboarding", label: "Onboarding", icon: Rocket },
    { value: "ciblage", label: "Ciblage", icon: Target },
    { value: "grilles", label: "Grilles", icon: SlidersHorizontal },
    { value: "console", label: "Console sources", icon: MonitorDot },
    { value: "ontologie", label: "Ontologie", icon: GitMerge },
    { value: "coordination", label: "Coordination", icon: Network },
    { value: "backlog", label: "Backlog", icon: KanbanSquare },
    { value: "geo", label: "Carte géo", icon: Map },
  ] as MenuItem[];

  /** Vrai si la vue active est une vue Outils. */
  $: isOutilsActive = outilsItems.some(
    (item) => "value" in item && (item as { value: string }).value === activeView
  );

  let outilsOpen = false;
  /** Référence à l'élément HTML du déclencheur Outils (span wrapper). */
  let outilsTriggerEl: HTMLElement | null = null;

  function handleOutilsSelect(value: string): void {
    onSelect(value as DemoView);
    outilsOpen = false;
  }

  /** Identité utilisateur pour IdentityMenu. */
  $: identityUser = authState?.authenticated && authState.user
    ? {
        displayName: authState.user.name ?? authState.user.email ?? authState.user.sub,
        email: authState.user.email,
      }
    : null;

  /**
   * Items mobile : toutes les vues (principales + Outils) regroupées dans
   * l'OverflowMenu DS pour le repli responsive sous le seuil md (768px).
   * Réutilise outilsItems (déjà filtré sur Admin) en ne conservant que les
   * entrées actionnables.
   */
  $: mobileNavItems = [
    ...mainItems.map(
      (item): OverflowMenuItem => ({
        value: item.id,
        label: item.label,
        onclick: () => onSelect(item.id),
      })
    ),
    ...outilsItems.flatMap((item): OverflowMenuItem[] =>
      "value" in item
        ? [
            {
              value: item.value,
              label: item.label,
              icon: item.icon,
              onclick: () => onSelect(item.value as DemoView),
            },
          ]
        : []
    ),
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
    <!-- Nav desktop (≥ md = 768px) : vues principales + menu Outils DS -->
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
        Déclencheur Outils : span ancre HTMLElement pour MenuPopover.
        `inline-flex` (et NON `display:contents`) garantit une boîte de rendu
        réelle ; sinon getBoundingClientRect() renvoie un rect dégénéré et le
        popover se positionne en haut-gauche du viewport au lieu de sous le
        bouton.
      -->
      <span bind:this={outilsTriggerEl} class="inline-flex">
        <Button
          type="button"
          size="sm"
          variant={isOutilsActive ? "primary" : "ghost"}
          aria-haspopup="menu"
          aria-expanded={outilsOpen}
          onclick={() => (outilsOpen = !outilsOpen)}
        >
          <Settings size={16} aria-hidden="true" />
          Outils
        </Button>
      </span>

      <!-- Popover DS positionné sous le déclencheur -->
      <MenuPopover
        bind:open={outilsOpen}
        trigger={outilsTriggerEl}
        placement="bottom-start"
        label="Menu Outils"
      >
        <Menu
          label="Outils internes"
          items={outilsItems}
          open={true}
          dismissOnSelect={false}
          onselect={handleOutilsSelect}
        />
      </MenuPopover>
    </div>

    <!-- Nav mobile (< md = 768px) : OverflowMenu DS regroupant toutes les vues -->
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
