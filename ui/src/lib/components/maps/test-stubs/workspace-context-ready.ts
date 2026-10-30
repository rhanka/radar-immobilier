// Test-only: a workspace context resolved to one explicit workspace by
// default, so screens under test issue their scoped reads. Used from vi.mock
// factories; `setTestWorkspaceState` drives the missing/choose states.
import { writable } from "svelte/store";
import type * as WorkspaceClient from "$lib/signals/workspace-client.js";

export const TEST_WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";

export function readyWorkspaceState(): WorkspaceClient.WorkspaceContextState {
  return {
    status: "ready",
    workspaces: [{ id: TEST_WORKSPACE_ID, slug: "test", label: "Test",
      moderateArchive: false, manageMembers: false }],
    context: { viewerKey: { context: "tester-1" }, workspaceId: TEST_WORKSPACE_ID },
    sub: "tester-1",
    error: null,
  };
}

let state = readyWorkspaceState();
const store = writable(state);

export function setTestWorkspaceState(next: WorkspaceClient.WorkspaceContextState): void {
  state = next;
  store.set(next);
}

export function readyWorkspaceModule(actual: typeof WorkspaceClient): typeof WorkspaceClient {
  return {
    ...actual,
    workspaceContext: {
      subscribe: store.subscribe,
      current: () => state,
      load: async () => state,
      select: () => {},
      reset: () => {},
    },
  };
}
