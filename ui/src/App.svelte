<script lang="ts">
  import { onMount } from "svelte";
  import { ThemeProvider } from "@sentropic/design-system-svelte";
  import { sentTechTheme } from "@sentropic/design-system-themes";
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

<ThemeProvider theme={sentTechTheme}>
  <AppShell
    {dashboard}
    {health}
    onSelectSignal={(signalId) => {
      selectedSignalId = signalId;
    }}
  />
</ThemeProvider>
