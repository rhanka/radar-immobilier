<script lang="ts">
  import { MapPin } from "@lucide/svelte";
  import type { RadarSignal } from "$lib/demo/radar-demo-data";

  export let selectedSignal: RadarSignal;
</script>

<section class="rounded-md border border-slate-200 bg-white p-4">
  <div class="flex items-center justify-between gap-3">
    <div>
      <h2 class="text-sm font-semibold text-slate-950">Secteur cartographique</h2>
      <p class="mt-1 text-xs text-slate-500">Preview BR-03, carte interactive en BR-10</p>
    </div>
    <MapPin class="h-5 w-5 text-teal-700" aria-hidden="true" />
  </div>

  <div class="mt-4 h-[260px] overflow-hidden rounded-md border border-slate-200 bg-slate-100 md:h-[340px] xl:h-[360px]">
    <div class="relative h-full w-full bg-[linear-gradient(90deg,#e2e8f0_1px,transparent_1px),linear-gradient(#e2e8f0_1px,transparent_1px)] bg-[size:32px_32px]">
      <div class="absolute left-[12%] top-[20%] h-[64%] w-3 rotate-12 rounded-md bg-slate-300"></div>
      <div class="absolute left-[8%] top-[52%] h-3 w-[82%] -rotate-6 rounded-md bg-slate-300"></div>
      <div class="absolute left-[28%] top-[26%] h-[22%] w-[28%] rounded-md border-2 border-teal-600 bg-teal-100"></div>
      <div class="absolute right-[18%] top-[44%] h-[18%] w-[24%] rounded-md border border-amber-500 bg-amber-100"></div>
      <div class="absolute left-[42%] top-[37%] flex h-9 w-9 items-center justify-center rounded-md bg-teal-700 text-white shadow-sm">
        <MapPin class="h-5 w-5" aria-hidden="true" />
      </div>
    </div>
  </div>

  <p class="mt-3 text-xs leading-5 text-slate-600">{selectedSignal.title}</p>
</section>
