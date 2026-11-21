<script lang="ts">
  import { Badge, Tag, Tooltip } from "@sentropic/design-system-svelte";
  import {
    Bot,
    Check,
    Clock,
    Plug,
    ShieldCheck,
    Sparkles,
    TriangleAlert,
    User,
    UserCheck,
    UserPen,
  } from "@lucide/svelte";
  import {
    buildAnnotationBadges,
    type AnnotationBadgeIcon,
    type AnnotationBadgeInput,
    type AnnotationBadgeSecondaryIcon,
    type AnnotationBadgeVariant,
  } from "$lib/signals/annotation-badge-model.js";

  interface Props {
    input: AnnotationBadgeInput;
    variant: AnnotationBadgeVariant;
    scenarioId?: string;
    tooltipPlacement?: "top" | "bottom";
    forceOpenIndex?: number | null;
  }

  let {
    input,
    variant,
    scenarioId = "",
    tooltipPlacement = "top",
    forceOpenIndex = null,
  }: Props = $props();

  const badges = $derived(buildAnnotationBadges(input, variant));

  const ICON_COMPONENTS: Record<AnnotationBadgeIcon, typeof Bot> = {
    sparkles: Sparkles,
    bot: Bot,
    "triangle-alert": TriangleAlert,
    user: User,
    "user-check": UserCheck,
    "user-pen": UserPen,
    "shield-check": ShieldCheck,
    plug: Plug,
    clock: Clock,
  };

  const SECONDARY_COMPONENTS: Record<AnnotationBadgeSecondaryIcon, typeof Check> = {
    "triangle-alert": TriangleAlert,
    clock: Clock,
    check: Check,
  };
</script>

{#if badges.length > 0}
  <span
    class="annotation-badges-group"
    class:annotation-badges-group--joined={variant === "c" && badges.length > 1}
    data-testid="signal-annotation-badges"
    data-variant={variant}
  >
    {#each badges as badge, index (badge.id)}
      {@const PrimaryIcon = ICON_COMPONENTS[badge.icon]}
      {@const SecondaryIcon = badge.secondaryIcon ? SECONDARY_COMPONENTS[badge.secondaryIcon] : null}
      <Tooltip
        content={badge.tooltipText}
        placement={tooltipPlacement}
        class="annotation-badge-tooltip {forceOpenIndex === index ? 'annotation-badge-tooltip--open' : ''}"
      >
        <button
          type="button"
          class="annotation-badge-trigger"
          aria-label={badge.ariaLabel}
          data-badge-scenario={scenarioId}
          data-badge-state={badge.state}
          data-badge-index={index}
        >
          {#if badge.component === "tag"}
            <Tag tone={badge.tone} size="sm" class="annotation-ds-pill annotation-ds-pill--{badge.tone}">
              <span class="annotation-pill-content">
                <PrimaryIcon size={12} strokeWidth={2.1} aria-hidden="true" />
                {#if badge.shortLabel}
                  <span>{badge.shortLabel}</span>
                {/if}
                {#if SecondaryIcon}
                  <SecondaryIcon size={11} strokeWidth={2.3} aria-hidden="true" />
                {/if}
              </span>
            </Tag>
          {:else}
            <Badge
              tone={badge.tone}
              shape={badge.shape}
              size="sm"
              class="annotation-ds-pill annotation-ds-pill--{badge.tone} {badge.shape === 'circle' ? 'annotation-ds-circle' : ''}"
            >
              <span class="annotation-pill-content">
                <PrimaryIcon size={12} strokeWidth={2.1} aria-hidden="true" />
                {#if badge.shortLabel}
                  <span>{badge.shortLabel}</span>
                {/if}
                {#if SecondaryIcon}
                  <SecondaryIcon size={11} strokeWidth={2.3} aria-hidden="true" />
                {/if}
              </span>
            </Badge>
          {/if}
        </button>
      </Tooltip>
    {/each}
  </span>
{/if}

<style>
  .annotation-badges-group {
    display: inline-flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.3rem;
  }

  .annotation-badges-group--joined {
    gap: 0.2rem;
    padding: 0.1rem 0.2rem;
    border-radius: 999px;
    border: 1px solid var(--st-semantic-border-subtle, #e2e8f0);
    background: var(--st-semantic-surface-default, #ffffff);
  }

  .annotation-badge-trigger {
    display: inline-flex;
    align-items: center;
    padding: 0;
    border: 0;
    background: transparent;
    font: inherit;
    border-radius: 999px;
    cursor: help;
    outline: none;
  }

  .annotation-badge-trigger:focus-visible {
    outline: 2px solid var(--st-semantic-border-interactive, #0284c7);
    outline-offset: 2px;
  }

  .annotation-pill-content {
    display: inline-flex;
    align-items: center;
    gap: 0.24rem;
    white-space: nowrap;
    line-height: 1.1;
  }

  :global(.annotation-ds-circle) {
    min-width: 1.375rem;
    min-height: 1.375rem;
    padding: 0.18rem;
  }

  :global(.annotation-ds-pill) {
    border: 1px solid transparent;
  }

  /* Accessible light-mode contrast (WCAG AA >= 4.5:1 on light cards). */
  :global(.annotation-ds-pill--info) {
    background: #eff6ff;
    border-color: #bfdbfe;
    color: #1d4ed8;
  }

  :global(.annotation-ds-pill--success) {
    background: #f0fdf4;
    border-color: #bbf7d0;
    color: #15803d;
  }

  :global(.annotation-ds-pill--warning) {
    background: #fffbeb;
    border-color: #fde68a;
    color: #92400e;
  }

  :global(.annotation-ds-pill--neutral) {
    background: #f1f5f9;
    border-color: #cbd5e1;
    color: #334155;
  }

  /* Accessible dark-mode contrast (WCAG AA >= 4.5:1 on #0f172a / #1e293b cards). */
  :global([data-theme="dark"] .annotation-ds-pill--info) {
    background: rgb(59 130 246 / 0.22);
    border-color: rgb(96 165 250 / 0.45);
    color: #93c5fd;
  }

  :global([data-theme="dark"] .annotation-ds-pill--success) {
    background: rgb(34 197 94 / 0.2);
    border-color: rgb(74 222 128 / 0.45);
    color: #86efac;
  }

  :global([data-theme="dark"] .annotation-ds-pill--warning) {
    background: rgb(245 158 11 / 0.22);
    border-color: rgb(251 191 36 / 0.45);
    color: #fcd34d;
  }

  :global([data-theme="dark"] .annotation-ds-pill--neutral) {
    background: #334155;
    border-color: #475569;
    color: #e2e8f0;
  }

  /* Keep the DS Tooltip aligned on the trigger's left edge so it never clips outside narrow 26rem cards. */
  :global(.annotation-badge-tooltip.st-tooltip--top .st-tooltip__content),
  :global(.annotation-badge-tooltip.st-tooltip--bottom .st-tooltip__content) {
    left: 0;
    transform: none;
    max-width: 21rem;
    white-space: normal;
    text-align: left;
    font-weight: 500;
    z-index: 120;
  }

  :global(.annotation-badge-tooltip--open .st-tooltip__content) {
    opacity: 1;
  }
</style>
