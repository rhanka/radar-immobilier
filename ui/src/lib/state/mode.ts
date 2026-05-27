import { writable } from "svelte/store";

export type AppMode = "real" | "simulation";

export const appMode = writable<AppMode>("real");

export function toggleMode(): void {
  appMode.update((m) => (m === "real" ? "simulation" : "real"));
}
