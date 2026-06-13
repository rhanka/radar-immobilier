<script lang="ts">
  import { Bell } from "@lucide/svelte";
  import { Header } from "@sentropic/design-system-svelte";
  import ApiStatusBadge from "./ApiStatusBadge.svelte";
  import type { HealthView } from "$lib/api/health";

  export let health: HealthView;
</script>

<Header sticky={false} label="En-tête application">
  {#snippet logo()}
    <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-teal-700 text-white">
      <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
        <polyline points="9 22 9 12 15 12 15 22"></polyline>
      </svg>
    </div>
  {/snippet}

  {#snippet navigation()}
    <div class="min-w-0 flex-1 flex justify-center px-4">
      <label class="flex h-10 w-full max-w-md items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 text-sm text-slate-500">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line>
        </svg>
        <span class="sr-only">Rechercher</span>
        <input
          class="min-w-0 flex-1 bg-transparent text-slate-700 outline-none placeholder:text-slate-400"
          placeholder="Lot, rue, reglement, source"
          type="search"
        />
      </label>
    </div>
  {/snippet}

  {#snippet actions()}
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
  {/snippet}
</Header>
