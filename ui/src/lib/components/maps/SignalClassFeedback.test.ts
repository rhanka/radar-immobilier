import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import SignalClassFeedback from "./SignalClassFeedback.svelte";

afterEach(cleanup);
const reasonCodes = [{ code: "N-NON-RES", verdict: "non_pertinent" as const },
  { code: "S-PLANIFIE", verdict: "a_surveiller" as const }];

describe("required AI correction", () => {
  it("should require a different class and reason, retain failed form and cancel without writing", async () => {
    const onSubmit = vi.fn(async () => false);
    render(SignalClassFeedback, { props: { classe: "pertinent", reasonCodes, onSubmit } });
    await fireEvent.click(screen.getByRole("button", { name: "Corriger l’annotation IA" }));
    const form = screen.getByRole("form", { name: "Reclassement obligatoire" });
    expect((screen.getByRole("button", { name: "Reclasser" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("option", { name: "Pertinent" })).toBeNull();
    await fireEvent.keyDown(window, { key: "Escape" });
    await fireEvent.click(document.body);
    expect(screen.getByRole("form")).toBe(form);
    await fireEvent.change(screen.getByLabelText("Nouvelle classe"), { target: { value: "ecarte" } });
    expect((screen.getByRole("button", { name: "Reclasser" }) as HTMLButtonElement).disabled).toBe(true);
    await fireEvent.change(screen.getByLabelText("Motif du reclassement"), { target: { value: "N-NON-RES" } });
    await fireEvent.submit(form);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ verdict: "down", nextClass: "ecarte", reasonCode: "N-NON-RES" }));
    expect(screen.getByRole("form")).toBeTruthy();
    await fireEvent.click(screen.getByRole("button", { name: "Annuler" }));
    expect(screen.queryByRole("form")).toBeNull();
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
  it("should validate directly with the DS small icon button", async () => {
    const onSubmit = vi.fn(async () => true);
    render(SignalClassFeedback, { props: { classe: "pertinent", reasonCodes, onSubmit } });
    const button = screen.getByRole("button", { name: "Valider l’annotation IA" });
    expect(button.classList.contains("st-iconButton--sm")).toBe(true);
    await fireEvent.click(button);
    expect(onSubmit).toHaveBeenCalledWith({ verdict: "up" });
  });
});
