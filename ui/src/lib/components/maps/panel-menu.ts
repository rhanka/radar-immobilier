import { writable } from "svelte/store";

/** Id of the single panel menu currently open (classement or bucket reload), or null. */
export const openPanelMenuId = writable<string | null>(null);

let seq = 0;
export function nextPanelMenuId(prefix: string): string {
  seq += 1;
  return `${prefix}-${seq}`;
}
