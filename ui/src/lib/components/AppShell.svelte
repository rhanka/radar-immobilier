<script lang="ts">
  import type { HealthView } from "$lib/api/health";
  import type { DashboardState } from "$lib/state/dashboard";
  import ApiStatusBadge from "./ApiStatusBadge.svelte";
  import MapPreview from "./MapPreview.svelte";
  import MetricStrip from "./MetricStrip.svelte";
  import OpportunityPanel from "./OpportunityPanel.svelte";
  import SignalQueue from "./SignalQueue.svelte";
  import TopBar from "./TopBar.svelte";

  export let dashboard: DashboardState;
  export let health: HealthView;
  export let onSelectSignal: (signalId: string) => void;
</script>

<div class="flex min-h-screen flex-col bg-slate-100 text-slate-950">
  <TopBar {health} />

  <main class="grid min-h-0 flex-1 gap-4 p-4 xl:grid-cols-[320px_minmax(0,1fr)_340px]">
    <div class="min-h-[420px] xl:min-h-0">
      <SignalQueue
        signals={dashboard.signals}
        selectedSignalId={dashboard.selectedSignal.id}
        {onSelectSignal}
      />
    </div>

    <div class="min-w-0 space-y-4">
      <MetricStrip metrics={dashboard.metrics} />
      <div class="min-h-[520px]">
        <OpportunityPanel
          opportunity={dashboard.opportunity}
          selectedSignal={dashboard.selectedSignal}
        />
      </div>
    </div>

    <div class="space-y-4">
      <div class="lg:hidden">
        <ApiStatusBadge {health} />
      </div>
      <MapPreview selectedSignal={dashboard.selectedSignal} />
      <section class="rounded-md border border-slate-200 bg-white p-4">
        <h2 class="text-sm font-semibold text-slate-950">Radar chat</h2>
        <p class="mt-2 text-sm leading-6 text-slate-600">
          Shell chat branche au Lot 4 avec les composants Sentropic.
        </p>
      </section>
    </div>
  </main>
</div>
