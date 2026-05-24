<script lang="ts">
  import { Bell, Building2, Search } from "@lucide/svelte";
  import ApiStatusBadge from "./ApiStatusBadge.svelte";
  import type { HealthView } from "$lib/api/health";

  export let health: HealthView;
</script>

<header class="flex min-h-16 items-center justify-between gap-4 border-b border-slate-200 bg-white px-4">
  <div class="flex min-w-0 items-center gap-3">
    <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-teal-700 text-white">
      <Building2 class="h-5 w-5" aria-hidden="true" />
    </div>
    <div class="min-w-0">
      <p class="text-xs font-medium uppercase tracking-normal text-slate-500">
        Salaberry-de-Valleyfield
      </p>
      <h1 class="truncate text-lg font-semibold text-slate-950">Radar immobilier</h1>
    </div>
  </div>

  <div class="hidden min-w-0 flex-1 justify-center px-4 md:flex">
    <label class="flex h-10 w-full max-w-md items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 text-sm text-slate-500">
      <Search class="h-4 w-4 shrink-0" aria-hidden="true" />
      <span class="sr-only">Rechercher</span>
      <input
        class="min-w-0 flex-1 bg-transparent text-slate-700 outline-none placeholder:text-slate-400"
        placeholder="Lot, rue, reglement, source"
        type="search"
      />
    </label>
  </div>

  <div class="flex shrink-0 items-center gap-2">
    <div class="hidden lg:block">
      <ApiStatusBadge {health} />
    </div>
    <button
      class="flex h-10 w-10 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
      type="button"
      aria-label="Notifications"
      title="Notifications"
    >
      <Bell class="h-4 w-4" aria-hidden="true" />
    </button>
  </div>
</header>
