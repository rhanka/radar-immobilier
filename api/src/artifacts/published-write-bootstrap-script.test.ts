import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { PUBLISHED_WRITE_SCRIPT } from "./published-write-bootstrap.js";

it.each(["transport", "body"])("should settle L5 bootstrap after a suspended %s and reject late installation", async (stage) => {
  let release = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  const timers: Array<{ fn: () => void; delay: number }> = [];
  const button = { disabled: false };
  const installed: unknown[] = [];
  const window: { __pwWriteReady?: Promise<void> } = {};
  runInNewContext(PUBLISHED_WRITE_SCRIPT, {
    window, location: { search: "?grant=initial" }, URLSearchParams, AbortController,
    document: { documentElement: { dataset: { pwWorkspace: "workspace" }, appendChild: (node: unknown) => installed.push(node) },
      querySelectorAll: () => [button], createElement: () => ({}) },
    setTimeout: (fn: () => void, delay: number) => { timers.push({ fn, delay }); return timers.length; },
    clearTimeout: () => {},
    fetch: async () => {
      if (stage === "transport") await held;
      return { ok: true, json: async () => { if (stage === "body") await held; return {}; } };
    },
  });
  const outcome = window.__pwWriteReady!.then(() => "ready", () => "failed");
  for (let i = 0; i < 12; i++) await Promise.resolve();
  expect(timers.map((timer) => timer.delay)).toContain(15000);
  timers.find((timer) => timer.delay === 15000)!.fn();
  expect(await outcome).toBe("failed");
  expect(button.disabled).toBe(true);
  release();
  for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(installed).toEqual([]);
});
