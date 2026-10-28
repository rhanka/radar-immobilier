import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it, vi } from "vitest";
import { describeDb } from "../../src/services/facets/workspace-archive-fixture.js";
import { pwConfirmation } from "../../src/services/facets/pw-write-fixture.js";
import { baseState } from "../../src/services/facets/signal-write-fixture.js";
import { blockedBy, effects, NO_EFFECTS, ONE_COMMIT, writeFixture } from "./pwe-fixture.js";

type Message = { kind: string; pid?: number; processId?: number; committed?: boolean; writes?: number; error?: string };
function replica() {
  const child = fork(fileURLToPath(new URL("./pwe-replica-worker.ts", import.meta.url)), [], {
    execArgv: ["--import", "tsx"], stdio: ["ignore", "pipe", "pipe", "ipc"] });
  const messages: Message[] = [];
  const failures: string[] = [];
  child.stderr!.on("data", (data: Buffer) => failures.push(data.toString()));
  child.on("error", (error) => failures.push(error.message));
  child.on("message", (value: Message) => messages.push(value));
  const wait = async (kind: string) => {
    await vi.waitFor(() => {
      expect(failures.join(""), "Replica must start without runtime failures").toBe("");
      expect(messages.some((item) => item.kind === kind)).toBe(true);
    }, { timeout: 1500, interval: 5 });
    return messages.find((item) => item.kind === kind)!;
  };
  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>((resolve) => { child.once("exit", () => resolve()); child.kill(); });
  };
  return { child, wait, stop };
}

describeDb("PWE-04 C01 independent replicas", () => {
  it.each([false, true])("should serialize separate processes with first rollback=$0", async (rollback) => {
    const h = await writeFixture();
    const before = await baseState(h.f);
    const first = replica(); const second = replica();
    const message = { database: h.f.name, sub: h.f.contributor.sub, intentId: h.row.intentId,
      input: h.input, confirmation: pwConfirmation(h.row) };
    try {
      const ready = await Promise.all([first.wait("ready"), second.wait("ready")]);
      expect(new Set(ready.map((item) => item.processId)).size).toBe(2);
      first.child.send({ ...message, hold: "record", rollback });
      const held = await first.wait("held");
      second.child.send({ ...message, hold: "reserve", rollback: false });
      await blockedBy(h.f, held.pid!);
      expect(await effects(h.f)).toEqual(NO_EFFECTS);
      first.child.send("release");
      const done = await first.wait("done");
      expect(done).toMatchObject({ committed: !rollback, writes: 1 });
      if (rollback) {
        expect(done.error).toBe("PWE replica rollback");
        await second.wait("held");
        expect(await effects(h.f)).toEqual(NO_EFFECTS);
        expect(await baseState(h.f)).toEqual(before);
        second.child.send("release");
        expect(await second.wait("done")).toMatchObject({ committed: true, writes: 1 });
      } else {
        expect(await second.wait("done")).toMatchObject({ committed: false, writes: 0, error: "challenge_consumed" });
      }
      expect(await effects(h.f)).toEqual(ONE_COMMIT);
    } finally {
      await Promise.all([first.stop(), second.stop()]);
    }
  });
});
