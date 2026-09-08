/**
 * ChatWidgetHost — test du SHELL après migration vers ChatDock (@sentropic/chat-ui
 * 0.33.0). On teste le comportement générique fourni par ChatDock via l'hôte :
 * bulle rendue → clic ouvre le dialog → « Fermer le chat » ferme. Contenu lourd
 * (ChatWidget / RadarChatPanel = streaming chat-ui) stubé ; `matchMedia` polyfillé
 * (ChatDock l'utilise au mount). La parité VISUELLE « 0 changement » est vérifiée
 * au déploiement préprod (owner/i-cond) — cf. option (b).
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  beforeEach,
  afterEach,
} from "vitest";
import { render, fireEvent, cleanup, waitFor } from "@testing-library/svelte";
import {
  acquireChatTrigger,
  requestChatToggle,
} from "$lib/chat/chat-trigger";

// Feature-flag chat (décision owner 2026-09-07) : DÉFAUT OFF → ce host ne rend
// rien sans flag. Les tests de COMPORTEMENT ci-dessous vérifient l'état ACTIVÉ :
// on force donc le flag ON (VITE_CHAT_ENABLED="true") avant chaque rendu. Un
// describe dédié plus bas couvre l'état DÉSACTIVÉ (flag OFF ⇒ aucun rendu).
beforeEach(() => {
  vi.stubEnv("VITE_CHAT_ENABLED", "true");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

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

describe("ChatWidgetHost — chat DÉSACTIVÉ (flag OFF, décision owner 2026-09-07)", () => {
  // Flag OFF : ce host ne doit RIEN rendre — ni bulle, ni dialog, ni widget. Le
  // code Lot 2 est GARDÉ (seulement gaté) → flag ON ré-active tout (couvert plus
  // haut). On surcharge le flag global (mis à ON par le beforeEach) en OFF ici.
  beforeEach(() => {
    vi.stubEnv("VITE_CHAT_ENABLED", "false");
  });

  it("aucune bulle rendue (le déclencheur global est absent)", () => {
    const { queryByLabelText, queryByTestId } = render(ChatWidgetHost);
    expect(queryByLabelText("Ouvrir l'assistant radar")).toBeNull();
    expect(queryByTestId("chat-bubble-trigger")).toBeNull();
  });

  it("aucun dialog / widget monté, même après une demande de bascule (#564)", async () => {
    const { container, queryByTestId } = render(ChatWidgetHost);
    // Un bump du nonce ne doit RIEN ouvrir : le dock n'est pas monté.
    requestChatToggle();
    await Promise.resolve();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(queryByTestId("chat-widget-stub")).toBeNull();
  });

  it("aucun rendu même quand un hôte fournit son déclencheur (carte)", () => {
    const release = acquireChatTrigger();
    try {
      const { container } = render(ChatWidgetHost);
      expect(container.querySelector('[role="dialog"]')).toBeNull();
      expect(container.textContent?.trim()).toBe("");
    } finally {
      release();
    }
  });
});
