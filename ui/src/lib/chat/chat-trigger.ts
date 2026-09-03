/**
 * Pont Immo entre un déclencheur de chat fourni par l'HÔTE (p.ex. le cluster de
 * contrôles de la carte) et le `ChatWidgetHost` global — SANS modifier chat-ui.
 *
 * Motif « map-contextuel » (réconcilié avec chat-ui) : sur la carte, le chat est
 * une icône carrée dans le cluster de contrôles (pas de bulle flottante qui
 * chevauche la carte) ; hors carte, la bulle globale du `ChatWidgetHost` reste.
 *
 *  - `chatBubbleSuppressed` : un hôte qui fournit SON propre déclencheur le met à
 *    `true` (au mount) / `false` (au unmount) ; le `ChatWidgetHost` MASQUE alors
 *    sa bulle flottante → plus de chevauchement. Défaut `false` (bulle visible).
 *  - `requestChatToggle()` : commande d'ouverture/fermeture émise par le
 *    déclencheur hôte ; le `ChatWidgetHost` s'y abonne et bascule son `isOpen`
 *    existant (le `ChatWidget` chat-ui ne rend aucun trigger — il est 100 % hôte).
 */
import { writable } from "svelte/store";

/** `true` ⇒ un hôte fournit le déclencheur, le `ChatWidgetHost` masque sa bulle. */
export const chatBubbleSuppressed = writable(false);

/** Nonce monotone incrémenté à chaque demande de bascule (canal de commande). */
const toggleNonce = writable(0);

/** Abonnement lecture seule : le `ChatWidgetHost` bascule le chat à chaque bump. */
export const chatToggleNonce = { subscribe: toggleNonce.subscribe };

/** Demande une bascule d'ouverture du chat depuis un déclencheur hôte. */
export const requestChatToggle = (): void => toggleNonce.update((n) => n + 1);
