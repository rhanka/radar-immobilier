import { writable } from "svelte/store";

/**
 * Flag « beta » — vue Évaluation cachée de la nav principale.
 *
 * La vue Évaluation n'est pas encore assez aboutie pour la nav grand public :
 * elle est MASQUÉE par défaut, mais reste dans le code et accessible :
 *   - par URL directe `#/evaluation` (la route reste valide, cf. router.ts) ;
 *   - via le raccourci clavier global `Ctrl+Shift+X` qui bascule ce flag et
 *     révèle l'entrée « Évaluation » dans la nav (TopNav.svelte).
 *
 * Le flag est PERSISTANT (localStorage `radar.beta.evaluation`) : une fois
 * révélée, l'entrée reste visible d'une session à l'autre jusqu'à re-bascule.
 * Ce module est volontairement SANS dépendance au routeur : les effets de
 * navigation éventuels sont câblés par l'appelant (App.svelte) via `onToggle`.
 */

/** Clé localStorage du flag (contrat stable — ne pas renommer). */
export const EVALUATION_BETA_STORAGE_KEY = "radar.beta.evaluation";

function readInitial(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(EVALUATION_BETA_STORAGE_KEY) === "true";
  } catch {
    // Stockage indisponible (navigation privée, quota…) : flag mémoire only.
    return false;
  }
}

/** true = l'entrée « Évaluation » est révélée dans la nav principale. */
export const evaluationBeta = writable<boolean>(readInitial());

function persist(value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (value) {
      window.localStorage.setItem(EVALUATION_BETA_STORAGE_KEY, "true");
    } else {
      window.localStorage.removeItem(EVALUATION_BETA_STORAGE_KEY);
    }
  } catch {
    // Stockage indisponible : le flag reste effectif en mémoire pour la session.
  }
}

/** Bascule le flag beta Évaluation (et le persiste). Retourne le nouvel état. */
export function toggleEvaluationBeta(): boolean {
  let next = false;
  evaluationBeta.update((value) => {
    next = !value;
    return next;
  });
  persist(next);
  return next;
}

/**
 * true si la frappe vient d'un champ de saisie : on ne détourne JAMAIS la
 * saisie utilisateur (input/textarea/select/contenteditable).
 */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

/** true si l'événement clavier est le raccourci beta `Ctrl+Shift+X` (exact). */
export function isEvaluationBetaShortcut(event: KeyboardEvent): boolean {
  return (
    event.ctrlKey &&
    event.shiftKey &&
    !event.altKey &&
    !event.metaKey &&
    (event.key === "X" || event.key === "x" || event.code === "KeyX")
  );
}

/**
 * Monte le listener clavier GLOBAL du raccourci beta (à appeler UNE fois,
 * dans le onMount de App.svelte — symétrique de initRouter). Retourne la
 * fonction de cleanup pour onDestroy.
 *
 * - Ignore la frappe quand le focus est dans un champ (isEditableTarget).
 * - `onToggle(enabled)` permet à l'appelant de réagir (ex. naviguer vers la
 *   vue Évaluation à l'activation) sans coupler ce module au routeur.
 */
export function initEvaluationBetaShortcut(
  onToggle?: (enabled: boolean) => void,
): () => void {
  if (typeof window === "undefined") return () => {};

  function onKeydown(event: KeyboardEvent): void {
    if (!isEvaluationBetaShortcut(event)) return;
    if (isEditableTarget(event.target)) return;
    event.preventDefault();
    const enabled = toggleEvaluationBeta();
    onToggle?.(enabled);
  }

  window.addEventListener("keydown", onKeydown);
  return () => window.removeEventListener("keydown", onKeydown);
}
