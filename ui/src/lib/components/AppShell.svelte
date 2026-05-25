<script lang="ts">
  import type { HealthView } from "$lib/api/health";
  import type { DashboardState } from "$lib/state/dashboard";
  import { dashboardLayout } from "$lib/layout/dashboard-layout";
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

<div class={dashboardLayout.shell}>
  <TopBar {health} />

  <main class={dashboardLayout.topGrid}>
    <div class={dashboardLayout.signalColumn}>
      <SignalQueue
        signals={dashboard.signals}
        selectedSignalId={dashboard.selectedSignal.id}
        {onSelectSignal}
      />
    </div>

    <div class={dashboardLayout.workColumn}>
      <MetricStrip metrics={dashboard.metrics} />
      <div class={dashboardLayout.opportunitySlot}>
        <OpportunityPanel
          opportunity={dashboard.opportunity}
          selectedSignal={dashboard.selectedSignal}
        />
      </div>
    </div>

    <div class={dashboardLayout.chatColumn}>
      <RadarChatPanel />
    </div>

    <div class={dashboardLayout.mobileStatus}>
      <ApiStatusBadge {health} />
    </div>

    <div class={dashboardLayout.mapRow}>
      <MapPreview selectedSignal={dashboard.selectedSignal} />
    </div>
  </main>
</div>
