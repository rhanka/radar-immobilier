/**
 * QA léger — flag beta Évaluation (store + raccourci global Ctrl+Shift+X).
 *
 * Vérifie :
 *   1. Flag OFF par défaut (localStorage vierge).
 *   2. toggle → ON + persistance localStorage `radar.beta.evaluation`.
 *   3. re-toggle → OFF + clé purgée.
 *   4. Lecture initiale depuis localStorage (flag persistant entre sessions).
 *   5. Raccourci global : Ctrl+Shift+X bascule le flag et notifie onToggle.
 *   6. Le raccourci IGNORE la frappe quand le focus est dans un champ
 *      (input/textarea/contenteditable) — on ne détourne pas la saisie.
 *   7. Pas de déclenchement sans les bons modificateurs (X seul, Ctrl+X…).
 *   8. Le cleanup démonte le listener.
 *
 * Environnement jsdom — aucun docker, aucune API.
 */
import { get } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EVALUATION_BETA_STORAGE_KEY,
  evaluationBeta,
  initEvaluationBetaShortcut,
  isEvaluationBetaShortcut,
  toggleEvaluationBeta,
} from "./beta.js";

/** Frappe Ctrl+Shift+X dispatchée depuis `target` (bulle jusqu'à window). */
function pressShortcut(target: HTMLElement | Window = window): void {
  const event = new KeyboardEvent("keydown", {
    key: "X",
    code: "KeyX",
    ctrlKey: true,
    shiftKey: true,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
}

beforeEach(() => {
  window.localStorage.clear();
  evaluationBeta.set(false);
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("evaluationBeta — store + persistance", () => {
  it("est OFF par défaut", () => {
    expect(get(evaluationBeta)).toBe(false);
  });

  it("toggle → ON, persisté dans localStorage", () => {
    const enabled = toggleEvaluationBeta();
    expect(enabled).toBe(true);
    expect(get(evaluationBeta)).toBe(true);
    expect(window.localStorage.getItem(EVALUATION_BETA_STORAGE_KEY)).toBe(
      "true",
    );
  });

  it("re-toggle → OFF, clé localStorage purgée", () => {
    toggleEvaluationBeta();
    const enabled = toggleEvaluationBeta();
    expect(enabled).toBe(false);
    expect(get(evaluationBeta)).toBe(false);
    expect(
      window.localStorage.getItem(EVALUATION_BETA_STORAGE_KEY),
    ).toBeNull();
  });

  it("lit l'état initial depuis localStorage (flag persistant)", async () => {
    window.localStorage.setItem(EVALUATION_BETA_STORAGE_KEY, "true");
    // Réimport à froid du module : simule un nouveau chargement de l'app.
    vi.resetModules();
    const fresh = await import("./beta.js");
    expect(get(fresh.evaluationBeta)).toBe(true);
  });
});

describe("isEvaluationBetaShortcut — détection de la combinaison", () => {
  it("reconnaît Ctrl+Shift+X (majuscule ou minuscule)", () => {
    for (const key of ["X", "x"]) {
      const event = new KeyboardEvent("keydown", {
        key,
        ctrlKey: true,
        shiftKey: true,
      });
      expect(isEvaluationBetaShortcut(event), `key=${key}`).toBe(true);
    }
  });

  it("rejette X seul, Ctrl+X, Shift+X, Ctrl+Shift+Y et Ctrl+Shift+Alt+X", () => {
    const cases: KeyboardEventInit[] = [
      { key: "X" },
      { key: "X", ctrlKey: true },
      { key: "X", shiftKey: true },
      { key: "Y", code: "KeyY", ctrlKey: true, shiftKey: true },
      { key: "X", ctrlKey: true, shiftKey: true, altKey: true },
    ];
    for (const init of cases) {
      const event = new KeyboardEvent("keydown", init);
      expect(
        isEvaluationBetaShortcut(event),
        JSON.stringify(init),
      ).toBe(false);
    }
  });
});

describe("initEvaluationBetaShortcut — listener global", () => {
  it("Ctrl+Shift+X bascule le flag et notifie onToggle", () => {
    const onToggle = vi.fn();
    const cleanup = initEvaluationBetaShortcut(onToggle);

    pressShortcut();
    expect(get(evaluationBeta)).toBe(true);
    expect(onToggle).toHaveBeenCalledWith(true);

    pressShortcut();
    expect(get(evaluationBeta)).toBe(false);
    expect(onToggle).toHaveBeenCalledWith(false);

    cleanup();
  });

  it("ignore la frappe quand le focus est dans un <input>", () => {
    const cleanup = initEvaluationBetaShortcut();
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    pressShortcut(input);
    expect(get(evaluationBeta)).toBe(false);

    cleanup();
  });

  it("ignore la frappe quand le focus est dans un <textarea>", () => {
    const cleanup = initEvaluationBetaShortcut();
    const textarea = document.createElement("textarea");
    document.body.appendChild(textarea);
    textarea.focus();

    pressShortcut(textarea);
    expect(get(evaluationBeta)).toBe(false);

    cleanup();
  });

  it("ignore la frappe dans un élément contenteditable", () => {
    const cleanup = initEvaluationBetaShortcut();
    const div = document.createElement("div");
    // jsdom ne calcule pas isContentEditable depuis l'attribut : on force la
    // propriété (le code de prod lit `target.isContentEditable`).
    Object.defineProperty(div, "isContentEditable", { value: true });
    document.body.appendChild(div);

    pressShortcut(div);
    expect(get(evaluationBeta)).toBe(false);

    cleanup();
  });

  it("après cleanup, le raccourci n'a plus d'effet", () => {
    const cleanup = initEvaluationBetaShortcut();
    cleanup();

    pressShortcut();
    expect(get(evaluationBeta)).toBe(false);
  });
});
