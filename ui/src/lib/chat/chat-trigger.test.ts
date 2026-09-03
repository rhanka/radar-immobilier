/**
 * chat-trigger — pont hôte↔ChatWidgetHost (motif « chat map-contextuel »).
 *
 * Teste la logique PURE du store (aucun composant monté) : le drapeau de
 * suppression de bulle et le canal de commande de bascule (nonce monotone).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { get } from "svelte/store";
import {
  chatBubbleSuppressed,
  chatToggleNonce,
  requestChatToggle,
} from "./chat-trigger.js";

beforeEach(() => {
  chatBubbleSuppressed.set(false);
});

describe("chat-trigger", () => {
  it("chatBubbleSuppressed : false par défaut, réglable par l'hôte", () => {
    expect(get(chatBubbleSuppressed)).toBe(false);
    chatBubbleSuppressed.set(true);
    expect(get(chatBubbleSuppressed)).toBe(true);
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
