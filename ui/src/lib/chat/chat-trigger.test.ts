/**
 * chat-trigger — pont hôte↔ChatWidgetHost (motif « chat map-contextuel »).
 *
 * Teste la logique PURE du store (aucun composant monté) : la suppression de
 * bulle REF-COMPTÉE (robuste au chevauchement mount/unmount d'une transition de
 * route) et le canal de commande de bascule (nonce monotone).
 */
import { describe, it, expect } from "vitest";
import { get } from "svelte/store";
import {
  chatBubbleSuppressed,
  chatToggleNonce,
  requestChatToggle,
  acquireChatTrigger,
} from "./chat-trigger.js";

describe("chat-trigger", () => {
  it("chatBubbleSuppressed : ref-compté, robuste au chevauchement mount/unmount", () => {
    expect(get(chatBubbleSuppressed)).toBe(false);
    const releaseA = acquireChatTrigger();
    expect(get(chatBubbleSuppressed)).toBe(true);
    // Transition de route : la NOUVELLE carte s'acquiert AVANT que l'ancienne libère.
    const releaseB = acquireChatTrigger();
    releaseA();
    expect(get(chatBubbleSuppressed)).toBe(true); // reste masquée (B encore actif)
    releaseB();
    expect(get(chatBubbleSuppressed)).toBe(false); // plus aucun hôte
    releaseB(); // idempotent : pas de compte négatif
    expect(get(chatBubbleSuppressed)).toBe(false);
  });

  it("requestChatToggle : incrémente le nonce à chaque appel", () => {
    const seen: number[] = [];
    const unsub = chatToggleNonce.subscribe((n) => seen.push(n));
    const start = seen[seen.length - 1]!; // valeur courante rejouée à l'abonnement
    requestChatToggle();
    requestChatToggle();
    unsub();
    expect(seen[seen.length - 1]).toBe(start + 2);
    expect(seen[seen.length - 1]!).toBeGreaterThan(seen[seen.length - 2]!);
  });

  it("chatToggleNonce est en lecture seule (aucun .set exposé)", () => {
    expect((chatToggleNonce as { set?: unknown }).set).toBeUndefined();
  });
});
