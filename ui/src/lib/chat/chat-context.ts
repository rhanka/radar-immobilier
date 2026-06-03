/**
 * ÉV16 — Radar chat context store (P3 from the @sentropic/chat-ui 0.5.0
 * migration).
 *
 * Implements the library `ChatContextProvider` port with an app-owned writable
 * store. The app (`App.svelte`) resolves the human label for the currently
 * selected signal / dossier (via `buildSignalLabel`) and pushes an
 * already-resolved `ChatContextEntry[]` here; `ContextChips.svelte` reads the
 * provider and renders the chips. Route detection and label resolution stay
 * app-owned, per the library contract.
 */

import { writable, type Readable } from "svelte/store";
import type {
  ChatContextEntry,
  ChatContextProvider,
} from "@sentropic/chat-ui/state/chat-context";

/** Writable source of the current radar chat context chips. */
const entries = writable<ChatContextEntry[]>([]);

/** Read-only view exposed to the rest of the app. */
export const chatContextEntries: Readable<ChatContextEntry[]> = {
  subscribe: entries.subscribe,
};

/**
 * Replace the current context chips. The app passes already-resolved entries
 * (label resolved, `active` flag set). An empty array clears the chips.
 */
export const setChatContext = (next: ChatContextEntry[]): void => {
  entries.set(next);
};

/**
 * Library-shaped provider read by `ContextChips.svelte`. Its `context` store
 * emits the app-resolved chip list.
 */
export const radarChatContextProvider: ChatContextProvider = {
  context: { subscribe: entries.subscribe },
};
