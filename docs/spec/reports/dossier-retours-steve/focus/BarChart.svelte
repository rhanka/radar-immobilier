<script>
  // Horizontal bar charts in inline SVG (no dependency): stacked by classement, grouped
  // (two series) or percentage. Colours come from tokens redefined for the dark theme;
  // values are written in the bars (or at their end), the legend names the series, and the
  // table next to each chart carries every figure, so colour is never the only carrier.
  import { CHARTS, SERIES } from './charts.js';
  import ZoomFrame from './ZoomFrame.svelte';
  let { id } = $props();
  const chart = $derived(CHARTS[id]);
  const W = 960, LABEL = 300, RIGHT = 120, ROW = 40, BAR = 24, TOP = 8;
  const plot = W - LABEL - RIGHT;
  const keys = Object.keys(SERIES);
  const total = row => keys.reduce((sum, key) => sum + row.values[key], 0);
  const max = $derived(chart.kind === 'stacked' ? Math.max(...chart.rows.map(total))
    : chart.kind === 'grouped' ? Math.max(...chart.rows.flatMap(row => row.values)) : 100);
  const scale = value => (value / max) * plot;
  const rowHeight = $derived(chart.kind === 'grouped' ? ROW + 18 : ROW);
  const height = $derived(TOP * 2 + chart.rows.length * rowHeight);
  const segments = row => {
    let x = LABEL;
    return keys.map(key => { const width = scale(row.values[key]); const segment = { key, value: row.values[key], x, width }; x += width; return segment; });
  };
  const fmt = value => String(value).replace('.', ',');
</script>

<figure class="chart" data-chart={id} data-chart-kind={chart.kind}>
  <figcaption><strong>{chart.title}</strong></figcaption>
  {#if chart.kind === 'stacked'}
    <p class="legend" aria-hidden="true">{#each keys as key}<span><i class="swatch fill-{SERIES[key].token}"></i>{SERIES[key].label}</span>{/each}</p>
  {:else if chart.kind === 'grouped'}
    <p class="legend" aria-hidden="true">{#each chart.series as name, index}<span><i class="swatch fill-g{index}"></i>{name}</span>{/each}</p>
  {/if}
  <ZoomFrame id={`chart-${id}`} label={chart.title} inline={false} minWidth={720}>
  <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label={chart.title}>
    {#each chart.rows as row, index}
      {@const y = TOP + index * rowHeight}
      <g data-chart-row={row.label}>
        <text class="row-label" x={LABEL - 12} y={y + (chart.kind === 'grouped' ? 18 : BAR / 2 + 5)} text-anchor="end">{row.label}</text>
        {#if row.detail}<text class="row-detail" x={LABEL - 12} y={y + 36} text-anchor="end">{row.detail}</text>{/if}
        {#if chart.kind === 'stacked'}
          {#each segments(row) as segment}
            {#if segment.value}
              <rect class="fill-{SERIES[segment.key].token}" x={segment.x} {y} width={segment.width} height={BAR} data-series={segment.key} data-value={segment.value}>
                <title>{row.label} · {SERIES[segment.key].label} : {segment.value}</title>
              </rect>
              {#if segment.width >= 26}<text class="in-bar" x={segment.x + segment.width / 2} y={y + BAR / 2 + 5} text-anchor="middle">{segment.value}</text>{/if}
            {/if}
          {/each}
          <text class="row-total" x={LABEL + scale(total(row)) + 10} y={y + BAR / 2 + 5}>{total(row)}{#if row.extra !== undefined}{' '}<tspan class="row-detail">(passe 1 : {row.extra})</tspan>{/if}</text>
        {:else if chart.kind === 'grouped'}
          {#each row.values as value, series}
            {@const by = y + series * (BAR / 2 + 6)}
            <rect class="fill-g{series}" x={LABEL} y={by} width={Math.max(scale(value), 1)} height={BAR / 2 + 2} data-series={chart.series[series]} data-value={value}>
              <title>{row.label} · {chart.series[series]} : {value}</title>
            </rect>
            <text class="row-total small" x={LABEL + scale(value) + 8} y={by + 11}>{value}</text>
          {/each}
        {:else}
          <rect class="track" x={LABEL} {y} width={plot} height={BAR} />
          <rect class={`fill-${row.tone ?? 'g0'}`} x={LABEL} {y} width={scale(row.value)} height={BAR} data-value={row.value}>
            <title>{row.label} : {fmt(row.value)} % ({row.ratio})</title>
          </rect>
          <text class="row-total" x={LABEL + plot + 10} y={y + BAR / 2 + 5}>{fmt(row.value)} %{' '}<tspan class="row-detail">{row.ratio}</tspan></text>
        {/if}
      </g>
    {/each}
  </svg>
  </ZoomFrame>
  <p class="chart-note">{chart.note} <span class="chart-source">Source : {chart.source}.</span></p>
</figure>

<style>
  .chart { margin: 18px 0 24px; padding: 14px 16px; max-width: 1000px; border: 1px solid var(--st-semantic-border-subtle); background: var(--st-semantic-surface-default); }
  figcaption { font-size: .95rem; margin-bottom: 6px; }
  .legend { display: flex; flex-wrap: wrap; gap: 16px; margin: 4px 0 8px; font-size: .82rem; color: var(--st-semantic-text-secondary); }
  .legend span { display: inline-flex; align-items: center; gap: 6px; }
  .swatch { display: inline-block; width: 14px; height: 14px; }
  .legend .fill-p, .legend .fill-s, .legend .fill-n, .legend .fill-g0, .legend .fill-g1 { background: var(--swatch); }
  svg { display: block; width: 100%; height: auto; }
  .row-label { font: 600 15px var(--st-font-sans, Inter, system-ui, sans-serif); fill: var(--st-semantic-text-primary); }
  .row-detail { font: 12px var(--st-font-sans, Inter, system-ui, sans-serif); fill: var(--st-semantic-text-secondary); }
  .row-total { font: 700 15px var(--st-font-sans, Inter, system-ui, sans-serif); fill: var(--st-semantic-text-primary); }
  .row-total.small { font-size: 13px; }
  .in-bar { font: 700 13px var(--st-font-sans, Inter, system-ui, sans-serif); fill: var(--chart-on); }
  .fill-p { --swatch: var(--chart-p); fill: var(--chart-p); }
  .fill-s { --swatch: var(--chart-s); fill: var(--chart-s); }
  .fill-n { --swatch: var(--chart-n); fill: var(--chart-n); }
  .fill-g0 { --swatch: var(--chart-g0); fill: var(--chart-g0); }
  .fill-g1 { --swatch: var(--chart-g1); fill: var(--chart-g1); }
  .track { fill: var(--st-semantic-surface-subtle); stroke: var(--st-semantic-border-subtle); }
  .chart-note { margin: 8px 0 0; font-size: .84rem; line-height: 1.5; color: var(--st-semantic-text-secondary); }
  .chart-source { font-style: italic; }
</style>
