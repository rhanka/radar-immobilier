import { randomUUID } from "node:crypto";
import type { Database } from "../../src/db/client.js";
import { workspaceFixture } from "../../src/services/facets/workspace-archive-fixture.js";
import { preparedSelect } from "../../src/services/facets/signal-write-fixture.js";
import { pwPrepared, pwConfirmation } from "../../src/services/facets/pw-write-fixture.js";
import { coordinateSignalWrite } from "../../src/services/facets/signal-write-admission.js";
import { createDurableWriteAdmission } from "../../src/services/facets/pw-write-admission-durable.js";
import { writeScopedPersonalFacet } from "../../src/services/facets/scoped-writer.js";
import { writeWorkspaceArchiveFacet } from "../../src/services/facets/workspace-writer.js";
import { upsertGraph } from "../../src/services/graph/graph-store.js";
import { backendPid, latch } from "./pwe-fixture.js";

export async function revisionFixture() {
  const f = await workspaceFixture();
  const input = await preparedSelect(f);
  const other = await preparedSelect(f);
  const row = await pwPrepared(f, input);
  const admission = () => createDurableWriteAdmission(row.intentId, { confirmation: pwConfirmation(row) });
  const execute = (port = admission()) => coordinateSignalWrite(f.db, f.contributor.sub, input, port);
  const mutate = (kind: "personal" | "common" | "source" | "privateB", db = f.db) => {
    const command = { target: other.target, expectedHeadId: null,
      displayedFingerprint: other.displayedFingerprint, commandKey: randomUUID() };
    if (kind === "source") return upsertGraph(db, input.target.citySlug,
      { nodes: [{ id: randomUUID(), type: "Signal", label: "Synthetic concurrent source" }], links: [] });
    if (kind === "common") return writeWorkspaceArchiveFacet(db, f.moderator.sub, f.workspaceId,
      { ...command, action: "discard", reasonCode: "N-NON-RES" });
    return writeScopedPersonalFacet(db, kind === "privateB" ? f.moderator.sub : f.contributor.sub,
      f.workspaceId, { ...command, action: "select", basket: "pertinent" });
  };
  return { f, input, row, admission, execute, mutate };
}

/** Hold a real public writer's own transaction immediately before commit. */
export function holdTransaction(db: Database) {
  const reached = latch(); const release = latch();
  let pid = 0;
  const held = Object.create(db) as Database;
  held.transaction = ((work, config) => db.transaction(async (tx) => {
    const result = await work(tx);
    pid = await backendPid(tx); reached.resolve(); await release.promise;
    return result;
  }, config)) as Database["transaction"];
  return { db: held, reached, release, pid: () => pid };
}
