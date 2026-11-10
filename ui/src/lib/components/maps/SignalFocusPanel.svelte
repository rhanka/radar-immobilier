<script lang="ts">
  /**
   * SignalFocusPanel — artifact mockup (focus-signal lane).
   * Upper half of the central area when a signal is focused: signal info,
   * bylaw evolution, zones, lots and LotAI-inspired valuation.
   * REAL data only (see focus-signal-cases.ts); simulated incorporations
   * are badged, missing real inputs are explicit source-gaps.
   */
  import { Badge } from "@sentropic/design-system-svelte";
  import { X } from "@lucide/svelte";
  import {
    VALUATION_ASSUMPTIONS,
    valuateLot,
    type FocusCase,
  } from "$lib/maps/focus-signal-cases.js";

  export let focusCase: FocusCase;
  export let hoveredLot: string | null = null;
  export let onHoverLot: (noLot: string | null) => void = () => {};
  export let onClose: () => void = () => {};

  function fmtInt(n: number): string {
    return n.toLocaleString("fr-CA");
  }
  function fmtMoney(n: number): string {
    return `${fmtInt(n)} $`;
  }
</script>

<section
  class="flex h-full min-h-0 flex-col border-b border-slate-200 bg-white"
  data-testid="signal-focus-panel"
  aria-label="Focus signal"
>
  <header class="flex items-start gap-3 border-b border-slate-100 px-4 py-3">
    <div class="min-w-0 flex-1">
      <p class="m-0 text-xs font-semibold text-slate-500">
        Focus signal · {focusCase.cityLabel} · zone {focusCase.zoneCode}
      </p>
      <h2 class="m-0 mt-1 text-base font-semibold text-slate-900">
        Règlement {focusCase.bylaw} — {focusCase.signalType}
      </h2>
      <p class="m-0 mt-1 text-sm text-slate-600">{focusCase.summary}</p>
      <p class="m-0 mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <Badge tone="info">{focusCase.stage} · {focusCase.stageDate}</Badge>
        <Badge tone="neutral">{focusCase.documentId}</Badge>
        <Badge tone="warning">incorporation simulée</Badge>
      </p>
    </div>
    <button
      type="button"
      class="shrink-0 rounded-sm border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50"
      aria-label="Fermer le focus signal"
      data-testid="signal-focus-close"
      on:click={onClose}
    >
      <X size={16} aria-hidden="true" />
    </button>
  </header>

  <div class="grid min-h-0 flex-1 grid-cols-1 gap-0 overflow-y-auto lg:grid-cols-3">
    <div class="border-b border-slate-100 px-4 py-3 lg:border-b-0 lg:border-r">
      <h3 class="m-0 text-xs font-semibold text-slate-500">Signal et preuve</h3>
      <p class="m-0 mt-2 text-sm font-medium text-slate-800">{focusCase.documentTitle}</p>
      <blockquote class="m-0 mt-2 border-l-2 border-slate-200 pl-3 text-xs leading-relaxed text-slate-600">
        {focusCase.evidenceExcerpt}
      </blockquote>
      <p class="m-0 mt-2 text-xs text-slate-400">
        Source : MCP immo (preprod, lecture seule), {focusCase.documentId}, lu le 2026-11-09.
      </p>

      <h3 class="m-0 mt-4 text-xs font-semibold text-slate-500">Règlement associé</h3>
      <dl class="m-0 mt-2 space-y-2 text-xs">
        <div>
          <dt class="font-medium text-slate-500">Avant (état réel lu)</dt>
          <dd class="m-0 mt-0.5 text-slate-700">{focusCase.zoneUseBefore}</dd>
        </div>
        <div>
          <dt class="font-medium text-slate-500">Après (texte du PV / projet déposé)</dt>
          <dd class="m-0 mt-0.5 text-slate-700">{focusCase.bylawEvolutionAfter}</dd>
        </div>
      </dl>
      {#if focusCase.gridSourceGap}
        <p class="m-0 mt-2 rounded-sm bg-amber-50 px-2 py-1.5 text-xs text-amber-800" data-testid="focus-grid-gap">
          Source-gap grille : {focusCase.gridSourceGap}
        </p>
      {/if}
    </div>

    <div class="border-b border-slate-100 px-4 py-3 lg:border-b-0 lg:border-r">
      <h3 class="m-0 text-xs font-semibold text-slate-500">Zone associée</h3>
      <p class="m-0 mt-2 text-sm text-slate-700">
        Zone <strong>{focusCase.zoneCode}</strong> — {focusCase.zoneUseBefore}
      </p>
      <p class="m-0 mt-1 text-xs text-slate-500">
        Lien signal ↔ zone : porté par le signal réel (zone_ref, MCP search_signals).
        Sur la carte ci-dessous, la zone et les lots du focus sont surlignés.
      </p>

      <h3 class="m-0 mt-4 text-xs font-semibold text-slate-500">Lots associés</h3>
      <ul class="m-0 mt-2 list-none space-y-2 p-0">
        {#each focusCase.lots as lot (lot.noLot)}
          <li>
            <button
              type="button"
              class="w-full rounded-sm border px-2.5 py-2 text-left text-xs {hoveredLot === lot.noLot
                ? 'border-orange-400 bg-orange-50'
                : 'border-slate-200 bg-white hover:bg-slate-50'}"
              data-testid="focus-lot-{lot.noLot.replaceAll(' ', '')}"
              on:mouseenter={() => onHoverLot(lot.noLot)}
              on:mouseleave={() => onHoverLot(null)}
              on:focus={() => onHoverLot(lot.noLot)}
              on:blur={() => onHoverLot(null)}
            >
              <span class="font-semibold text-slate-800">Lot {lot.noLot}</span>
              <span class="text-slate-500"> · {fmtInt(lot.areaM2)} m² · {lot.usage}</span>
              <span class="mt-1 block text-slate-500">
                {lot.addressStreet ?? "adresse : source-gap"}
                {lot.frontageM !== null ? ` · façade ${lot.frontageM} m` : ""}
                · {lot.serviced ? "desservi" : "non desservi"}
              </span>
              <span class="mt-1 block">
                {#if lot.linkedByProduct}
                  <Badge tone="success">lien produit réel</Badge>
                {:else}
                  <Badge tone="warning">incorporation simulée</Badge>
                {/if}
              </span>
            </button>
          </li>
        {/each}
      </ul>
      <p class="m-0 mt-2 text-xs text-slate-400">{focusCase.valuationNote}</p>
    </div>

    <div class="px-4 py-3" data-testid="focus-valuation">
      <h3 class="m-0 text-xs font-semibold text-slate-500">Valorisation (incorporation simulée)</h3>
      {#each focusCase.lots as lot (lot.noLot)}
        {@const v = valuateLot(focusCase, lot)}
        <div class="mt-2 rounded-sm border border-slate-200 px-2.5 py-2 text-xs">
          <p class="m-0 font-semibold text-slate-800">Lot {lot.noLot}</p>
          {#if v.status === "source-gap"}
            <p class="m-0 mt-1 text-amber-700" data-testid="focus-valuation-gap-{lot.noLot.replaceAll(' ', '')}">
              Source-gap : {v.reason}
            </p>
          {:else}
            <dl class="m-0 mt-1 space-y-1 text-slate-600">
              <div class="flex justify-between gap-2">
                <dt>Surface de plancher (borne haute)</dt>
                <dd class="m-0 font-medium text-slate-800">{fmtInt(v.grossFloorM2 ?? 0)} m²</dd>
              </div>
              <div class="flex justify-between gap-2">
                <dt>Logements théoriques après</dt>
                <dd class="m-0 font-medium text-slate-800">{v.unitsAfter} logements</dd>
              </div>
              {#if v.indicativeValue !== null}
                <div class="flex justify-between gap-2">
                  <dt>Valeur indicative (médiane publique)</dt>
                  <dd class="m-0 font-medium text-slate-800">{fmtMoney(v.indicativeValue)}</dd>
                </div>
              {:else}
                <div class="flex justify-between gap-2">
                  <dt>Valeur indicative</dt>
                  <dd class="m-0 font-medium text-amber-700">source-gap prix</dd>
                </div>
              {/if}
            </dl>
            <p class="m-0 mt-1 text-slate-400">{v.reason}</p>
          {/if}
        </div>
      {/each}

      <details class="mt-3 text-xs text-slate-600" data-testid="focus-how-computed">
        <summary class="cursor-pointer font-medium text-slate-700">Comment c'est calculé</summary>
        <p class="m-0 mt-2 leading-relaxed">{VALUATION_ASSUMPTIONS.label}</p>
        <p class="m-0 mt-2 leading-relaxed">
          Formules : surface brute (borne haute, empreinte pleine sans grille CES) =
          superficie du lot × étages autorisés après ; logements = surface brute × 80 % ÷ 85 m² ;
          valeur indicative = logements × prix médian public cité ci-dessous.
          Inspiration LotAI (analyse de constructibilité : superficie × gabarit réglementaire,
          croisée avec le rôle et les sources publiques — GetApp/Capterra, consultés le 2026-11-09).
        </p>
        {#if focusCase.medianPriceSource}
          <p class="m-0 mt-2 leading-relaxed">Prix : {focusCase.medianPriceSource}</p>
        {:else}
          <p class="m-0 mt-2 leading-relaxed">
            Prix : aucun indicateur public relevé pour cette ville dans les sources lues — valeur non affichée.
          </p>
        {/if}
      </details>
    </div>
  </div>
</section>
