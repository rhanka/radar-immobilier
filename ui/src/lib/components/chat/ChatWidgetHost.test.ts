/**
 * ChatWidgetHost — test du SHELL après migration vers ChatDock (@sentropic/chat-ui
 * 0.33.0). On teste le comportement générique fourni par ChatDock via l'hôte :
 * bulle rendue → clic ouvre le dialog → « Fermer le chat » ferme. Contenu lourd
 * (ChatWidget / RadarChatPanel = streaming chat-ui) stubé ; `matchMedia` polyfillé
 * (ChatDock l'utilise au mount). La parité VISUELLE « 0 changement » est vérifiée
 * au déploiement préprod (owner/i-cond) — cf. option (b).
 */
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, fireEvent, cleanup, waitFor } from "@testing-library/svelte";
import {
  acquireChatTrigger,
  requestChatToggle,
} from "$lib/chat/chat-trigger";

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

describe("ChatWidgetHost — pont hôte↔chat (store #564)", () => {
  it("bulle ronde MASQUÉE quand un hôte fournit son déclencheur (chatBubbleSuppressed)", () => {
    // Un hôte (ex. la rangée de contrôles carte) prend la main sur le déclencheur.
    const release = acquireChatTrigger();
    try {
      const { queryByLabelText } = render(ChatWidgetHost);
      // Aucune bulle ronde locale rendue → pas de DOUBLE déclencheur.
      expect(queryByLabelText("Ouvrir l'assistant radar")).toBeNull();
    } finally {
      release(); // ne pas fuiter la suppression (store singleton ref-compté).
    }
  });

  it("bulle ronde de nouveau rendue une fois le déclencheur hôte libéré", () => {
    // Régression : la libération ref-comptée restaure la bulle par défaut.
    const { getByLabelText } = render(ChatWidgetHost);
    expect(getByLabelText("Ouvrir l'assistant radar")).toBeTruthy();
  });

  it("la bulle ronde porte le testid `chat-bubble-trigger` (repère e2e stable)", () => {
    const { getByTestId } = render(ChatWidgetHost);
    expect(getByTestId("chat-bubble-trigger")).toBeTruthy();
  });

  it("hôte actif (carte) : chat FORCÉ ancré → bascule flottante MASQUÉE (fix #579)", async () => {
    // Sur la vue carte (un hôte fournit le déclencheur), le chat doit rester
    // ANCRÉ pour coexister avec le pane droit : la bascule « Passer en fenetre
    // flottante » n'est PAS proposée (sinon l'utilisateur ré-introduirait la
    // superposition #579).
    const release = acquireChatTrigger();
    try {
      const { container, queryByLabelText } = render(ChatWidgetHost);
      requestChatToggle();
      await waitFor(() => {
        const dialog = container.querySelector('[role="dialog"]');
        expect(dialog).not.toBeNull();
        expect(dialog!.classList.contains("hidden")).toBe(false);
      });
      // Ouvert, mais AUCUNE bascule ancré/flottant ; « Fermer le chat » présent.
      expect(queryByLabelText("Passer en fenetre flottante")).toBeNull();
      expect(queryByLabelText("Ancrer le chat")).toBeNull();
      expect(queryByLabelText("Fermer le chat")).not.toBeNull();
    } finally {
      release();
    }
  });

  it("requestChatToggle ouvre puis ferme l'UNIQUE dialog via le toggle() du dock", async () => {
    const { container } = render(ChatWidgetHost);
    // Fermé au départ (hasOpenedOnce=false → aucun dialog monté).
    expect(container.querySelector('[role="dialog"]')).toBeNull();

    // Un bump du nonce = une demande de bascule → le dock s'ouvre.
    requestChatToggle();
    await waitFor(() => {
      const dialog = container.querySelector('[role="dialog"]');
      expect(dialog).not.toBeNull();
      expect(dialog!.classList.contains("hidden")).toBe(false);
    });

    // Un second bump referme (dialog caché, pas démonté).
    requestChatToggle();
    await waitFor(() => {
      const dialog = container.querySelector('[role="dialog"]');
      expect(dialog!.classList.contains("hidden")).toBe(true);
    });
  });
});
