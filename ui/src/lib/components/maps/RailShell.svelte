<script lang="ts">
  /**
   * RailShell — coquille PARTAGÉE des rails gauches des vues carte
   * (Signaux, Sources/Couverture).
   *
   * Porte l'échafaudage commun extrait de SignauxRail (iso-rendu) :
   *   - conteneur plein-hauteur + variables typo raccordées aux tokens DS ;
   *   - en-tête : overline titre + bouton « Actualiser » (SVG inline, zéro
   *     dépendance lucide) ;
   *   - ligne de synthèse (slot `count`) + divider ;
   *   - corps scrollable (slot par défaut — sections RailSection des vues).
   *
   * Anti-invention : aucun appel API, aucune logique métier — tout par props.
   */
  import { Button } from "@sentropic/design-system-svelte";

  /** Titre overline de l'en-tête (ex. « Signaux · Villes »). */
  export let title: string;
  /** Chargement en cours : anime l'icône refresh et désactive le bouton. */
  export let loading = false;
  /** Appelé pour actualiser les données. */
  export let onRefresh: () => void = () => {};
</script>

<!-- Rail container -->
<div class="rail">
  <!-- En-tête du rail -->
  <div class="rail-head">
    <div class="rail-head-row">
      <span class="rail-overline">{title}</span>
      <Button
        type="button"
        aria-label="Actualiser"
        size="sm"
        variant="ghost"
        disabled={loading}
        onclick={onRefresh}
      >
        <!-- SVG refresh inline — aucune dépendance lucide -->
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          class={loading ? "spin" : ""}
          aria-hidden="true"
        >
          <polyline points="23 4 23 10 17 10"></polyline>
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
        </svg>
      </Button>
    </div>

    <!-- Ligne de synthèse (compteur global de la vue) -->
    <div class="rail-global-count">
      <slot name="count" />
    </div>
    <div class="rail-divider" aria-hidden="true"></div>
  </div>

  <!-- Corps scrollable : sections de la vue (RailSection) -->
  <div class="rail-body flex-1 min-h-0 overflow-y-auto">
    <slot />
  </div>
</div>

<style>
  /*
   * Typographie rail alignée DS — variables PARTAGÉES par les vues (les
   * sections/lignes slottées les consomment via héritage CSS).
   */
  .rail {
    --rail-fs-overline: var(--st-component-label-fontSize, 0.6875rem);
    --rail-fs-caption: var(--st-component-caption-fontSize, 0.6875rem);
    --rail-fs-small: var(--st-component-tag-fontSize, 0.75rem);
    --rail-fs-body: var(--st-component-body-sm-fontSize, 0.8125rem);
  }

  /* ── Rail container ── */
  .rail {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    overflow: hidden;
    scrollbar-gutter: stable;
  }

  .rail-head {
    flex-shrink: 0;
  }

  .rail-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    scrollbar-gutter: stable;
  }

  /* ── En-tête du rail ── */
  .rail-head-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1rem 0.25rem;
  }

  .rail-overline {
    font-size: var(--rail-fs-overline);
    font-weight: 700;
    letter-spacing: 0;
    text-transform: uppercase;
    color: var(--st-semantic-text-muted, #64748b);
  }

  .rail-divider {
    height: 1px;
    background: var(--st-semantic-border-subtle, #e2e8f0);
  }

  /* ── Ligne de synthèse ── */
  .rail-global-count {
    padding: 0 1rem 0.5rem;
    font-size: var(--rail-fs-small);
    color: var(--st-semantic-text-secondary);
  }

  /* Emphases de la ligne de synthèse (markup slotté par la vue) */
  .rail-global-count :global(.rail-count-strong) {
    font-weight: 600;
    color: var(--st-semantic-text-primary);
  }

  .rail-global-count :global(.rail-muted) {
    color: var(--st-semantic-text-muted);
  }

  /* ── Spin animation (bouton refresh) ── */
  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .spin {
    animation: spin 1s linear infinite;
  }
</style>
