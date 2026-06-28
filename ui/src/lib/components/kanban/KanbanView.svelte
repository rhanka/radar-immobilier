<script lang="ts">
  // WP6 — Kanban 4 niveaux = 4 échelles de temps (onglets primaires).
  //
  // Lit la projection WP (GET /api/backlog/wp-projection). Les 4 ÉCHELLES sont
  // les niveaux primaires (onglets) : « En cours » (now), « Semaine » (week),
  // « Mois » (month), « Global » (project). DANS chaque échelle : une table
  // statut × swimlanes WP1-6, avec sous-items WPx.y repliables.
  //
  // Règle d'échelle : en_cours = item in_progress (WIP) ; semaine/mois = item
  // dans la fenêtre temporelle du read-model précalculé (transition/échéance
  // récente) ; global = TOUT, y compris done/dropped (le passé est conservé).
  // Le Global rend le rollup serveur autoritaire (incl. blocked/AWAITED) ; les
  // échelles temporelles recomptent depuis les items de la fenêtre.
  //
  // Track reste la source de vérité ; le rattachement WP est une projection (le
  // reparent physique 6-WP est bloqué par le containment workspace de Track —
  // voir docs/spec/reports/wp6-socle-status.md).
  import { onMount, onDestroy } from "svelte";
  import { Badge, Button, Card, Alert, EmptyState } from "@sentropic/design-system-svelte";
  import {
    fetchWpProjection,
    rollupForScale,
    WP_STATUS_COLUMNS,
    type WpProjection,
    type WpRollup,
    type WpScale,
    type WpStatus,
  } from "$lib/backlog/wp-projection-client.js";

  let projection: WpProjection | null = null;
  let loading = true;
  let error: string | null = null;
  let scale: WpScale = "now";
  let showSub = true;
  let timer: ReturnType<typeof setInterval> | undefined;

  const SCALES: { scale: WpScale; label: string; hint: string }[] = [
    { scale: "now", label: "En cours", hint: "items in_progress (WIP)" },
    { scale: "week", label: "Semaine", hint: "clôturé/actif < 7 jours" },
    { scale: "month", label: "Mois", hint: "actif ce mois-ci" },
    { scale: "project", label: "Global", hint: "tout, y compris fait" },
  ];

  type BadgeTone = "neutral" | "success" | "warning" | "error" | "info";
  const STATUS_TONE: Record<WpStatus, BadgeTone> = {
    planned: "neutral",
    in_progress: "info",
    blocked: "error",
    needs_review: "warning",
    done: "success",
    dropped: "neutral",
  };

  async function refresh(): Promise<void> {
    try {
      projection = await fetchWpProjection();
      error = null;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    void refresh();
    timer = setInterval(() => void refresh(), 15_000);
  });
  onDestroy(() => {
    if (timer) clearInterval(timer);
  });

  // Lanes pour l'échelle active (Global = rollup serveur ; sinon recompté).
  $: lanes = projection ? rollupForScale(projection, scale) : [];
  $: totals = lanes.reduce(
    (acc, l) => {
      acc.total += l.total;
      acc.done += l.done;
      acc.needs_review += l.needs_review;
      acc.in_progress += l.in_progress;
      acc.planned += l.planned;
      acc.blocked += l.blocked;
      acc.dropped += l.dropped;
      return acc;
    },
    { total: 0, done: 0, needs_review: 0, in_progress: 0, planned: 0, blocked: 0, dropped: 0 },
  );
  $: scaleEmpty = projection != null && scale !== "project" && totals.total === 0;
  $: windowUnavailable =
    scaleEmpty && projection?.source !== "precomputed" && (scale === "week" || scale === "month");

  function statusCount(lane: WpRollup, status: WpStatus): number {
    return lane[status] as number;
  }
</script>

<section class="flex h-full flex-col gap-4 overflow-auto p-4">
  <header class="flex flex-wrap items-center justify-between gap-3">
    <div>
      <h1 class="text-lg font-semibold text-slate-800">Kanban WorkPackages — 4 échelles de temps</h1>
      <p class="text-xs text-slate-500">
        Onglet « {SCALES.find((s) => s.scale === scale)?.label} » · statut × swimlanes WP1-6 ·
        {#if projection}
          source <Badge tone={projection.source === "precomputed" ? "success" : projection.source === "live" ? "info" : "warning"}>{projection.source}</Badge>
          · maj {new Date(projection.generatedAt).toLocaleString("fr-CA")}
        {/if}
      </p>
    </div>
    <div class="flex gap-1">
      <Button
        variant={showSub ? "primary" : "secondary"}
        size="sm"
        type="button"
        onclick={() => (showSub = !showSub)}>Sous-items WPx.y</Button
      >
      <Button variant="secondary" size="sm" type="button" onclick={() => void refresh()}>↻</Button>
    </div>
  </header>

  <!-- Niveaux primaires : 4 onglets = 4 échelles de temps. -->
  <div role="tablist" aria-label="Échelles de temps" class="flex flex-wrap gap-1 border-b border-slate-200">
    {#each SCALES as s}
      <button
        role="tab"
        type="button"
        aria-selected={scale === s.scale}
        title={s.hint}
        class="-mb-px rounded-t px-3 py-1.5 text-sm font-medium transition-colors {scale === s.scale
          ? 'border-x border-t border-slate-200 bg-white text-slate-800'
          : 'text-slate-500 hover:text-slate-700'}"
        onclick={() => (scale = s.scale)}
      >
        {s.label}
        {#if projection}
          <span class="ml-1 text-xs text-slate-400">({rollupForScale(projection, s.scale).reduce((n, l) => n + l.total, 0)})</span>
        {/if}
      </button>
    {/each}
  </div>

  {#if error}
    <Alert tone="error" title="Projection indisponible" message={error} />
  {/if}

  {#if loading && !projection}
    <p class="text-sm text-slate-500">Chargement de la projection…</p>
  {:else if projection && projection.available}
    {#if projection.note}
      <Alert tone="info" title="Note projection" message={projection.note} />
    {/if}

    {#if windowUnavailable}
      <EmptyState
        title="Fenêtre temporelle indisponible"
        message="Les échelles Semaine/Mois nécessitent le read-model précalculé (wp6-rollup.json). Source live : seules « En cours » et « Global » sont peuplées."
      />
    {:else if scaleEmpty}
      <EmptyState title="Aucun item dans cette échelle" message="Rien à clôturer/afficher sur cette fenêtre." />
    {:else}
      <Card class="overflow-x-auto">
        <table class="w-full border-collapse text-sm">
          <thead>
            <tr class="border-b border-slate-200 text-left text-slate-500">
              <th class="p-2">WorkPackage</th>
              {#each WP_STATUS_COLUMNS as col}
                <th class="p-2 text-center">{col.label}</th>
              {/each}
              <th class="p-2 text-center">%fait</th>
            </tr>
          </thead>
          <tbody>
            {#each lanes as lane}
              <tr class="border-b border-slate-100">
                <td class="p-2 font-medium text-slate-700">
                  <span class="font-semibold">{lane.wp}</span> · {lane.title}
                  <span class="text-xs text-slate-400">({lane.total})</span>
                </td>
                {#each WP_STATUS_COLUMNS as col}
                  <td class="p-2 text-center">
                    {#if statusCount(lane, col.status) > 0}
                      <Badge tone={STATUS_TONE[col.status]}>{statusCount(lane, col.status)}</Badge>
                    {:else}
                      <span class="text-slate-300">—</span>
                    {/if}
                  </td>
                {/each}
                <td class="p-2 text-center font-semibold text-slate-700">
                  {lane.pctDone === null ? "n/a" : `${lane.pctDone}%`}
                </td>
              </tr>
              {#if showSub && lane.subLanes}
                {#each lane.subLanes.filter((s) => s.total > 0) as sub}
                  <tr class="border-b border-slate-50 bg-slate-50/40 text-slate-500">
                    <td class="py-1 pl-6 pr-2">
                      <span class="font-medium text-slate-600">{sub.subItem}</span>
                      {sub.title.replace(sub.subItem, "").trim()}
                      <span class="text-xs text-slate-400">({sub.total})</span>
                    </td>
                    {#each WP_STATUS_COLUMNS as col}
                      <td class="py-1 px-2 text-center">
                        {#if (sub[col.status] as number) > 0}
                          <Badge tone={STATUS_TONE[col.status]}>{sub[col.status]}</Badge>
                        {:else}
                          <span class="text-slate-200">—</span>
                        {/if}
                      </td>
                    {/each}
                    <td class="py-1 px-2 text-center text-slate-500">
                      {sub.pctDone === null ? "n/a" : `${sub.pctDone}%`}
                    </td>
                  </tr>
                {/each}
              {/if}
            {/each}
            <tr class="bg-slate-50 font-semibold">
              <td class="p-2">TOTAL ({totals.total})</td>
              <td class="p-2 text-center">{totals.planned}</td>
              <td class="p-2 text-center">{totals.in_progress}</td>
              <td class="p-2 text-center">{totals.blocked}</td>
              <td class="p-2 text-center">{totals.needs_review}</td>
              <td class="p-2 text-center">{totals.done}</td>
              <td class="p-2 text-center">{totals.dropped}</td>
              <td class="p-2 text-center">
                {totals.total - totals.dropped > 0
                  ? `${Math.round((100 * totals.done) / (totals.total - totals.dropped))}%`
                  : "n/a"}
              </td>
            </tr>
          </tbody>
        </table>
      </Card>
    {/if}
  {:else}
    <EmptyState
      title="Projection WP indisponible"
      message={projection?.note ?? "Ni read-model précalculé ni sidecar+mapping disponibles."}
    />
  {/if}
</section>
