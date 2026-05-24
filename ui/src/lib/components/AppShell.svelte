<script lang="ts">
  import type { HealthView } from "$lib/api/health";
  import type { DashboardState } from "$lib/state/dashboard";
  import ApiStatusBadge from "./ApiStatusBadge.svelte";
  import MapPreview from "./MapPreview.svelte";
  import MetricStrip from "./MetricStrip.svelte";
  import OpportunityPanel from "./OpportunityPanel.svelte";
  import RadarChatPanel from "./RadarChatPanel.svelte";
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
      <RadarChatPanel />
    </div>
  </main>
</div>
