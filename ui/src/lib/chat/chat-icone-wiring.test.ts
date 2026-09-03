/**
 * GUARD — câblage du motif « chat map-contextuel » à travers 3 fichiers.
 *
 * Le rendu réel n'est pas exécuté en unit test : `ChatWidgetHost` monte
 * `@sentropic/chat-ui` (aucun stub/précédent de rendu), et `GeoCityMapBase` monte
 * maplibre-gl (canvas/WebGL indispo en jsdom → toujours stubé). On lit donc la
 * SOURCE et on prouve que le câblage est en place ; l'interaction visuelle est
 * couverte par l'e2e. Si l'un des maillons régresse, ce guard rougit.
 *
 * Pur : aucun Docker, aucune API, aucun composant monté — lecture fichier.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel: string): string => readFileSync(resolve(HERE, rel), "utf8");

const host = read("../components/chat/ChatWidgetHost.svelte");
const socle = read("../components/maps/GeoCityMapBase.svelte");
const signaux = read("../components/maps/SignauxMapView.svelte");

describe("chat map-contextuel — câblage source", () => {
  it("ChatWidgetHost masque sa bulle quand un hôte fournit le déclencheur", () => {
    expect(host).toContain("chatBubbleSuppressed");
    // La bulle flottante est conditionnée à la NON-suppression.
    expect(host).toMatch(/\{#if !isOpen && !\$chatBubbleSuppressed\}/);
    // La bascule hôte est branchée (le toggle existant est réutilisé).
    expect(host).toContain("chatToggleNonce");
  });

  it("GeoCityMapBase : bouton chat opt-in dans le cluster + suppression liée au montage", () => {
    expect(socle).toContain("export let showChatToggle");
    expect(socle).toContain('data-testid="chat-toggle"');
    expect(socle).toContain("requestChatToggle");
    expect(socle).toMatch(/showChatToggle\)\s*chatBubbleSuppressed\.set\(true\)/);
    expect(socle).toMatch(/showChatToggle\)\s*chatBubbleSuppressed\.set\(false\)/);
  });

  it("SignauxMapView (vue carte principale) active le bouton chat du socle", () => {
    expect(signaux).toContain("showChatToggle");
  });
});
