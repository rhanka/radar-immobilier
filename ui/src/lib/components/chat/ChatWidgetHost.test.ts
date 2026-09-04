/**
 * ChatWidgetHost — test du SHELL après migration vers ChatDock (@sentropic/chat-ui
 * 0.33.0). On teste le comportement générique fourni par ChatDock via l'hôte :
 * bulle rendue → clic ouvre le dialog → « Fermer le chat » ferme. Contenu lourd
 * (ChatWidget / RadarChatPanel = streaming chat-ui) stubé ; `matchMedia` polyfillé
 * (ChatDock l'utilise au mount). La parité VISUELLE « 0 changement » est vérifiée
 * au déploiement préprod (owner/i-cond) — cf. option (b).
 */
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/svelte";

beforeAll(() => {
  if (typeof window !== "undefined" && !window.matchMedia) {
    // Polyfill minimal jsdom pour ChatDock.
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
});

vi.mock("@sentropic/chat-ui/components/ChatWidget.svelte", async () => ({
  default: (await import("./__stubs__/ChatWidgetStub.svelte")).default,
}));
vi.mock("$lib/components/RadarChatPanel.svelte", async () => ({
  default: (await import("./__stubs__/RadarChatPanelStub.svelte")).default,
}));

import ChatWidgetHost from "./ChatWidgetHost.svelte";

afterEach(() => cleanup());

describe("ChatWidgetHost — migration ChatDock", () => {
  it("bulle rendue ; dialog fermé au départ", () => {
    const { getByLabelText, container } = render(ChatWidgetHost);
    expect(getByLabelText("Ouvrir l'assistant radar")).toBeTruthy();
    // hasOpenedOnce=false → aucun dialog rendu.
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("clic bulle → dialog visible (close présent) ; close → dialog caché", async () => {
    const { getByLabelText, container } = render(ChatWidgetHost);
    await fireEvent.click(getByLabelText("Ouvrir l'assistant radar"));

    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog!.classList.contains("hidden")).toBe(false); // ouvert
    // contenu = shell + ChatWidget stub (pas de contenu lourd réel)
    expect(container.querySelector('[data-testid="chat-widget-stub"]')).not.toBeNull();

    await fireEvent.click(getByLabelText("Fermer le chat"));
    expect(dialog!.classList.contains("hidden")).toBe(true); // fermé (caché, pas démonté)
  });

  it("bascule ancré/flottant présente dans le header ouvert", async () => {
    const { getByLabelText } = render(ChatWidgetHost);
    await fireEvent.click(getByLabelText("Ouvrir l'assistant radar"));
    // Par défaut docked → le bouton propose « Passer en fenetre flottante ».
    expect(getByLabelText("Passer en fenetre flottante")).toBeTruthy();
  });
});
