/** Bounded operator Job: complete JSON on stdout; compact, hashed termination receipt. */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { inspect } from "./base-preprod-inspect.js";

interface Invocation {
  action: "inspect" | "init" | "attach" | "activate" | "resume";
  binding: { workspaceId: string; actorSub: string; maintenanceAttemptId: string; releaseId: string };
  args: string[];
}

export async function runJob(invocation: Invocation) {
  if (!invocation.binding || !Array.isArray(invocation.args)) throw new Error("invalid_invocation");
  let result: unknown;
  if (invocation.action === "inspect") result = await inspect(invocation.binding.workspaceId);
  else {
    const scripts = { init: "init-workspace-authority", attach: "attach-personal-history",
      activate: "base-api-personal-activation", resume: "base-api-personal-activation" };
    const script = scripts[invocation.action];
    if (!script) throw new Error("invalid_action");
    const child = spawnSync(process.execPath, [`api/dist/scripts/${script}.js`, ...invocation.args], {
      encoding: "utf8", timeout: 480_000, maxBuffer: 4 * 1024 * 1024,
    });
    // Never echo arbitrary SQL/configuration errors or the invocation back to logs.
    if (child.error || child.status !== 0) throw new Error("operator_script_failed");
    result = JSON.parse(child.stdout) as unknown;
    if (!result || typeof result !== "object") throw new Error("operator_receipt_missing");
  }
  const complete = { action: invocation.action, binding: invocation.binding,
    observedAt: new Date().toISOString(), result };
  const bytes = `${JSON.stringify(complete)}\n`;
  process.stdout.write(bytes);
  const receipt = { action: invocation.action, binding: invocation.binding, status: "complete",
    sha256: createHash("sha256").update(bytes).digest("hex"), bytes: Buffer.byteLength(bytes) };
  writeFileSync("/dev/termination-log", JSON.stringify(receipt));
  if ((invocation.action === "activate" || invocation.action === "resume")
      && (result as { status?: string }).status !== "open-success") process.exitCode = 2;
  if (invocation.action === "attach" && (result as { pendingAmbiguous?: number }).pendingAmbiguous !== 0) {
    process.exitCode = 2;
  }
}

if (/(?:^|[/\\])base-preprod-job\.(ts|js)$/.test(process.argv[1] ?? "")) {
  Promise.resolve().then(() => runJob(JSON.parse(process.argv[2] ?? "") as Invocation))
    .catch(() => {
      const failure = '{"status":"failed","error":"operator_job_failed"}';
      writeFileSync("/dev/termination-log", failure);
      process.stderr.write(`${failure}\n`);
      process.exitCode = 1;
    });
}
