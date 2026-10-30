/**
 * 6H workspace picker: hidden for 0/1 workspace, explicit choice for N.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { get } from "svelte/store";
import WorkspacePicker from "./WorkspacePicker.svelte";
import { workspaceContext } from "$lib/signals/workspace-client.js";

const WS_A = "11111111-1111-4111-8111-111111111111";
const WS_B = "22222222-2222-4222-8222-222222222222";

function row(id: string, label: string) {
  return { workspace: { id, slug: label.toLowerCase(), label, scope: "all-municipalities" },
    accountId: "33333333-3333-4333-8333-333333333333", moderateArchive: false, manageMembers: false };
}

function stubWorkspaces(rows: unknown[]) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true, workspaces: rows }),
    { status: 200, headers: { "content-type": "application/json" } })));
}

afterEach(() => {
  cleanup();
  workspaceContext.reset();
  vi.unstubAllGlobals();
});

describe("WorkspacePicker", () => {
  it("stays hidden for a single workspace", async () => {
    stubWorkspaces([row(WS_A, "Alpha")]);
    await workspaceContext.load("sub-a");
    const { queryByTestId } = render(WorkspacePicker);
    expect(queryByTestId("workspace-picker")).toBeNull();
    expect(get(workspaceContext).context.workspaceId).toBe(WS_A);
  });

  it("asks for an explicit pick among several workspaces", async () => {
    stubWorkspaces([row(WS_A, "Alpha"), row(WS_B, "Beta")]);
    await workspaceContext.load("sub-a");
    const { getByLabelText } = render(WorkspacePicker);
    const select = getByLabelText("Espace de travail") as HTMLSelectElement;
    expect(get(workspaceContext).status).toBe("choose");
    expect(get(workspaceContext).context.workspaceId).toBeNull();
    await fireEvent.change(select, { target: { value: WS_B } });
    expect(get(workspaceContext).status).toBe("ready");
    expect(get(workspaceContext).context.workspaceId).toBe(WS_B);
  });
});
