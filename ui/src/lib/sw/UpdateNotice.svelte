<script lang="ts">
  import { onDestroy } from "svelte";
  import { serviceWorkerClientStore, type SwStatus } from "./client.js";
  export let save: () => void;
  let status: SwStatus = "unsupported";
  let error = "";
  let reloading = false;
  let stopStatus = () => {};
  const stopClient = serviceWorkerClientStore.subscribe((client) => {
    stopStatus(); stopStatus = client?.status.subscribe((value) => { status = value; }) ?? (() => {});
  });
  onDestroy(() => { stopStatus(); stopClient(); });
  async function reload() {
    if (reloading || !$serviceWorkerClientStore) return;
    reloading = true; save();
    const result = await $serviceWorkerClientStore.requestCompatibleActivation();
    if (result.ok) window.location.reload();
    else { reloading = false; error = "Un autre onglet empêche la mise à jour. Fermez-le puis réessayez."; }
  }
</script>

{#if status === "waiting"}
  <div role="status" class="flex items-center gap-2 border-b bg-white px-4 py-2 text-sm">
    <span>Une mise à jour est disponible.</span>
    <button type="button" class="rounded border px-2 py-1" disabled={reloading} on:click={reload}>Recharger cet onglet</button>
    {#if error}<span>{error}</span>{/if}
  </div>
{/if}
