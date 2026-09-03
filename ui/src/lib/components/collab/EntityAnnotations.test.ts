/**
 * EntityAnnotations — test présentiel (props → rendu + callbacks). Pur jsdom :
 * le composant ne monte ni maplibre ni chat-ui ni API, il se rend en isolation.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/svelte";
import EntityAnnotations from "./EntityAnnotations.svelte";
import type { EntityAnnotation } from "$lib/collab/annotation.js";

afterEach(() => cleanup());

const NOTES: EntityAnnotation[] = [
  { id: "n1", body: "à creuser — contacter la mairie", authorId: "me", authorName: "Moi", createdAt: "2026-01-01T10:00:00Z" },
  { id: "n2", body: "vérifié, faux positif", authorId: "autre", authorName: "Collègue", createdAt: "2026-01-02T11:00:00Z" },
];

function renderPanel(over: Record<string, unknown> = {}) {
  const onAdd = vi.fn();
  const onEdit = vi.fn();
  const onDelete = vi.fn();
  const r = render(EntityAnnotations, {
    props: { notes: NOTES, currentUserId: "me", canAnnotate: true, onAdd, onEdit, onDelete, ...over },
  });
  return { ...r, onAdd, onEdit, onDelete };
}

describe("EntityAnnotations", () => {
  it("liste les notes + compteur ; édition/suppression seulement sur SES notes", () => {
    const { getByTestId, getAllByTestId } = renderPanel();
    expect(getByTestId("annotations-count").textContent).toBe("2");
    const items = getAllByTestId("annotation-item");
    expect(items).toHaveLength(2);
    // n1 (auteur "me") éditable ; n2 (auteur "autre") non.
    expect(items[0]!.querySelector('[data-testid="annotation-edit"]')).not.toBeNull();
    expect(items[0]!.querySelector('[data-testid="annotation-delete"]')).not.toBeNull();
    expect(items[1]!.querySelector('[data-testid="annotation-edit"]')).toBeNull();
    expect(items[1]!.querySelector('[data-testid="annotation-delete"]')).toBeNull();
  });

  it("Ajouter : onAdd(corps trimé) puis vide le champ", async () => {
    const { getByTestId, onAdd } = renderPanel({ notes: [] });
    const ta = getByTestId("annotation-new") as HTMLTextAreaElement;
    await fireEvent.input(ta, { target: { value: "  nouvelle note  " } });
    await fireEvent.click(getByTestId("annotation-add"));
    expect(onAdd).toHaveBeenCalledWith("nouvelle note");
    expect(ta.value).toBe("");
  });

  it("Modifier : ouvre l'éditeur puis onEdit(id, corps)", async () => {
    const { getByTestId, getAllByTestId, onEdit } = renderPanel();
    await fireEvent.click(getAllByTestId("annotation-edit")[0]!);
    const editor = getAllByTestId("annotation-item")[0]!.querySelector("textarea") as HTMLTextAreaElement;
    await fireEvent.input(editor, { target: { value: "corrigé" } });
    await fireEvent.click(getByTestId("annotation-save-edit"));
    expect(onEdit).toHaveBeenCalledWith("n1", "corrigé");
  });

  it("Supprimer : onDelete(id)", async () => {
    const { getAllByTestId, onDelete } = renderPanel();
    await fireEvent.click(getAllByTestId("annotation-delete")[0]!);
    expect(onDelete).toHaveBeenCalledWith("n1");
  });

  it("canAnnotate=false : lecture seule, aucun champ d'ajout", () => {
    const { getByTestId, queryByTestId } = renderPanel({ canAnnotate: false });
    expect(getByTestId("annotations-readonly")).toBeTruthy();
    expect(queryByTestId("annotation-add")).toBeNull();
  });

  it("liste vide → état vide", () => {
    const { getByTestId } = renderPanel({ notes: [] });
    expect(getByTestId("annotations-empty")).toBeTruthy();
    expect(getByTestId("annotations-count").textContent).toBe("0");
  });
});
