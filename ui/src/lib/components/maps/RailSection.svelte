<script lang="ts">
  /**
   * RailSection — section accordéon de 1er niveau d'un rail gauche
   * (`<details>` natif : summary overline + chevron + corps slotté).
   * Extraite de SignauxRail (iso-rendu), partagée Signaux ↔ Sources.
   */
  /** Libellé overline de la section (ex. « Villes », « Portée »). */
  export let label: string;
  /** Section ouverte par défaut. */
  export let open = true;
</script>

<details class="rail-section-acc" {open}>
  <summary class="rail-section-summary">
    <span class="rail-section-chevron" aria-hidden="true">▸</span>
    <span class="rail-overline">{label}</span>
  </summary>

  <div class="rail-section-body">
    <slot />
  </div>
</details>

<style>
  .rail-overline {
    font-size: var(--rail-fs-overline, 0.6875rem);
    font-weight: 700;
    letter-spacing: 0;
    text-transform: uppercase;
    color: var(--st-semantic-text-muted, #64748b);
  }

  .rail-section-acc {
    border-bottom: 1px solid var(--st-semantic-border-subtle);
  }

  .rail-section-acc > summary {
    list-style: none;
  }

  .rail-section-acc > summary::-webkit-details-marker {
    display: none;
  }

  .rail-section-summary {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.45rem 1rem;
    cursor: pointer;
    user-select: none;
    background: var(--st-semantic-surface-subtle);
    transition: background 0.1s;
  }

  .rail-section-summary:hover {
    background: var(--st-semantic-surface-hover, var(--st-semantic-surface-subtle));
  }

  .rail-section-chevron {
    font-size: var(--rail-fs-caption, 0.6875rem);
    color: var(--st-semantic-text-muted);
    transition: transform 0.12s ease;
    flex-shrink: 0;
  }

  details[open] > .rail-section-summary > .rail-section-chevron {
    transform: rotate(90deg);
  }
</style>
