import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { attachPersonalHistory } from "./attachment.js";
import { attach, describeDb, event, fixture } from "./scope-db-fixture.js";

describeDb("6H operator attachment", () => {
  it("should replay attachment without changing rows or personal histories", async () => {
    const f = await fixture();
    await event(f);
    const history = (await f.pool.query("SELECT * FROM facet_events ORDER BY id")).rows;
    expect(await attach(f)).toMatchObject({ attached: 1, replayed: false });
    const before = (await f.pool.query("SELECT * FROM facet_stream_attachments")).rows;
    await expect(attach(f)).resolves.toEqual({ attached: 0, pendingAmbiguous: 0, replayed: true, pending: [] });
    expect((await f.pool.query("SELECT * FROM facet_stream_attachments")).rows).toEqual(before);
    expect((await f.pool.query("SELECT * FROM facet_events ORDER BY id")).rows).toEqual(history);
    await expect(attachPersonalHistory(f.db, { actorAccountId: f.actor.id, reason: "synthetic",
      entries: [{ accountId: f.member.id, workspaceId: f.otherId }] }))
      .rejects.toMatchObject({ status: 409, message: "attachment_destination_conflict" });
  });

  it("should persist ambiguous destinations as pending without selecting a destination", async () => {
    const f = await fixture();
    const input = { actorAccountId: f.actor.id, reason: "synthetic ambiguity", entries: [
      { accountId: f.member.id, workspaceId: f.workspaceId },
      { accountId: f.member.id, workspaceId: f.otherId },
    ] };
    expect(await attachPersonalHistory(f.db, input)).toMatchObject({ attached: 0, pendingAmbiguous: 1 });
    expect(await attachPersonalHistory(f.db, input)).toMatchObject({ replayed: true });
    expect((await f.pool.query("SELECT status, detail FROM facet_stream_attachments")).rows)
      .toEqual([{ status: "pending-ambiguous", detail: { ids: [f.workspaceId, f.otherId].sort() } }]);
    expect((await f.pool.query("SELECT * FROM facet_event_bindings")).rows).toEqual([]);
  });

  it("should execute the operator CLI twice with supplied subjects and unchanged receipts", async () => {
    const f = await fixture();
    const args = ["--import", "tsx", "src/scripts/attach-personal-history.ts", "--actor", f.actor.sub,
      "--entry", `${f.member.sub}:${f.workspaceId}`, "--reason", "synthetic CLI"];
    const run = () => promisify(execFile)(process.execPath, args, {
      env: { ...process.env, POSTGRES_DB: f.name },
    });
    const first = await run();
    expect(first.stderr).toBe("");
    expect(JSON.parse(first.stdout)).toMatchObject({ attached: 1, replayed: false });
    const second = await run();
    expect(second.stderr).toBe("");
    expect(JSON.parse(second.stdout)).toMatchObject({ attached: 0, replayed: true });
    await expect(promisify(execFile)(process.execPath, args.map((arg) => arg === f.actor.sub ? "synthetic-unknown" : arg),
      { env: { ...process.env, POSTGRES_DB: f.name } })).rejects.toMatchObject({ code: 1 });
  });
});
