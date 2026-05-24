<script lang="ts">
  import { onMount } from "svelte";
  import { readHealth, type HealthView } from "$lib/api/health";
  import AppShell from "$lib/components/AppShell.svelte";
  import { demoOpportunity, demoSignals } from "$lib/demo/radar-demo-data";
  import { createDashboardState } from "$lib/state/dashboard";

  let selectedSignalId = demoSignals[0]?.id;
  let health: HealthView = {
    kind: "offline",
    label: "API en attente",
    detail: "Verification en cours",
  };

  $: dashboard = createDashboardState(
    demoSignals,
    demoOpportunity,
    selectedSignalId,
  );

  onMount(async () => {
    health = await readHealth();
  });
</script>

<AppShell
  {dashboard}
  {health}
  onSelectSignal={(signalId) => {
    selectedSignalId = signalId;
  }}
/>
