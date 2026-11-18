import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import SignalMcpNotes from "./SignalMcpNotes.svelte";
import { appendSignalNote } from "$lib/signals/signal-mcp-client.js";
vi.mock("$lib/signals/signal-mcp-client.js", async (original) => ({
  ...await original<typeof import("$lib/signals/signal-mcp-client.js")>(), appendSignalNote: vi.fn(),
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const annotations = { version: "a".repeat(32), current: null, notes: [{ id: "note-1", source: "mcp" as const,
  model: "gpt-client", validation: "auto" as const, pending_human: true, text: "<img src=x onerror=alert(1)>Check council", created_at: "2026-11-13" }] };
const target = { citySlug: "synthetic-city", type: "Signal", id: "signal-1" };
describe("signal notes", () => {
  it("should show pending confirmation while escaping all note text", () => {
    const view = render(SignalMcpNotes, { props: { annotations, workspaceId: "workspace-1", target } });
    expect(screen.getByText("MCP · gpt-client · à confirmer")).toBeTruthy();
    expect(screen.getByText(/<img src=x/)).toBeTruthy();
    expect(view.container.querySelector("img")).toBeNull();
  });
  it("should append user text and show the cleaned server note", async () => {
    vi.mocked(appendSignalNote).mockResolvedValue({ ...annotations, version: "b".repeat(32), notes: [
      ...annotations.notes, { id: "note-2", source: "manual", model: null, validation: "human", text: "New note", created_at: "2026-11-13" }] });
    render(SignalMcpNotes, { props: { annotations, workspaceId: "workspace-1", target } });
    await fireEvent.input(screen.getByLabelText("Note libre"), { target: { value: "New note" } });
    await fireEvent.submit(screen.getByRole("form"));
    await waitFor(() => expect(screen.getByText("New note")).toBeTruthy());
    expect(appendSignalNote).toHaveBeenCalledWith("workspace-1", target, "New note", "a".repeat(32));
  });
  it("should retain the draft and display an error after a failed save", async () => {
    vi.mocked(appendSignalNote).mockRejectedValue(new Error("Save failed"));
    render(SignalMcpNotes, { props: { annotations, workspaceId: "workspace-1", target } });
    await fireEvent.input(screen.getByLabelText("Note libre"), { target: { value: "Retry this note" } });
    await fireEvent.submit(screen.getByRole("form"));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Save failed"));
    expect((screen.getByLabelText("Note libre") as HTMLTextAreaElement).value).toBe("Retry this note");
  });
});
