export const dashboardLayout = {
  shell: "flex min-h-screen flex-col bg-slate-100 text-slate-950",
  topGrid:
    "grid min-h-0 flex-1 gap-4 p-4 xl:grid-cols-[320px_minmax(0,1fr)_minmax(340px,380px)] xl:items-stretch",
  signalColumn:
    "min-h-[420px] xl:col-start-1 xl:row-start-1 xl:min-h-[640px]",
  workColumn:
    "flex min-w-0 flex-col gap-4 xl:col-start-2 xl:row-start-1 xl:min-h-[640px]",
  opportunitySlot: "min-h-[520px] flex-1 xl:min-h-0",
  chatColumn:
    "min-h-[420px] xl:col-start-3 xl:row-start-1 xl:min-h-[640px]",
  mobileStatus: "lg:hidden",
  mapRow: "w-full xl:col-span-3 xl:row-start-2",
} as const;
