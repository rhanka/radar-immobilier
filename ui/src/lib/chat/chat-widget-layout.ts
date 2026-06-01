/**
 * ÉV9 — Chat widget layout control (mirror of `../sentropic`
 * `ChatWidget.svelte` display-mode logic, trimmed to the radar demo).
 *
 * Re-exports the canonical `chatWidgetLayout` store from
 * `@sentropic/chat-ui` and adds the persisted display-mode helpers:
 *   - localStorage key `chatWidgetDisplayMode` (same key as sentropic),
 *   - `docked | floating` modes, `docked` by default,
 *   - a `dockWidthCss` derived from the viewport (33vw / 50vw / 100vw).
 */

import {
  chatWidgetLayout,
  type ChatWidgetDisplayMode,
} from "@sentropic/chat-ui/stores/chatWidgetLayout";

export { chatWidgetLayout };
export type { ChatWidgetDisplayMode };

export const DISPLAY_MODE_STORAGE_KEY = "chatWidgetDisplayMode";

const isBrowser = (): boolean => typeof window !== "undefined";

/** Read the persisted display mode; docked by default. */
export const readDisplayMode = (): ChatWidgetDisplayMode => {
  if (!isBrowser()) return "docked";
  const saved = window.localStorage.getItem(DISPLAY_MODE_STORAGE_KEY);
  return saved === "floating" ? "floating" : "docked";
};

export const persistDisplayMode = (mode: ChatWidgetDisplayMode): void => {
  if (!isBrowser()) return;
  window.localStorage.setItem(DISPLAY_MODE_STORAGE_KEY, mode);
};

/** Dock width as a CSS length, scaled to the viewport (mirror of sentropic). */
export const computeDockWidthCss = (): string => {
  if (!isBrowser()) return "0px";
  const width = window.innerWidth;
  if (width < 768) return "100vw";
  if (width < 1280) return "50vw";
  return "33vw";
};
