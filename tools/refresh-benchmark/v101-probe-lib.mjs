import { createHash } from "node:crypto";
import { access, mkdir, open, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const prompt = "Reply with PING_OK only.";

export const sha256 = (value) => createHash("sha256").update(value).digest("hex");

export function sanitize(value) {
  return String(value ?? "N-A")
    .slice(0, 500)
    .replace(/sk-(?:proj|ant)-[A-Za-z0-9_-]+/gu, "[REDACTED]")
    .replace(/sk-[A-Za-z0-9]{20,}/gu, "[REDACTED]")
    .replace(/(Bearer\s+)\S+/giu, "$1[REDACTED]")
    .replace(/(?:access|refresh|api)[_-]?token["']?\s*[:=]\s*["']?[^"'\s,}]+/giu,
      "token=[REDACTED]");
}

export function endpointPath(value) {
  try {
    const url = new URL(String(value));
    return `${url.origin}${url.pathname}`;
  } catch {
    return "N-A";
  }
}

export async function writeOnce(path, receipt) {
  await mkdir(dirname(path), { recursive: true });
  try {
    await access(path);
    console.log(JSON.stringify({ status: "skipped", reason: "receipt-exists", path }));
    return false;
  } catch {
    await writeFile(path, `${JSON.stringify(receipt)}\n`, { flag: "wx" });
    return true;
  }
}

export async function claimOnce(path, receiptPath) {
  await mkdir(dirname(path), { recursive: true });
  try {
    await access(receiptPath);
    console.log(JSON.stringify({ status: "skipped", reason: "receipt-exists", receiptPath }));
    return false;
  } catch { /* No completed receipt: attempt the exclusive claim. */ }
  try {
    const handle = await open(path, "wx");
    await handle.writeFile(`${JSON.stringify({ state: "in-flight",
      startedAt: new Date().toISOString() })}\n`);
    await handle.close();
    return true;
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    try {
      await access(receiptPath);
      console.log(JSON.stringify({ status: "skipped", reason: "receipt-exists", receiptPath }));
      return false;
    } catch {
      throw new Error("Existing phase-1 lock has uncertain in-flight state");
    }
  }
}

export async function completeClaim(path, receiptPath) {
  await writeFile(path, `${JSON.stringify({ state: "completed", receiptPath,
    completedAt: new Date().toISOString() })}\n`);
}

export function textFromOpenAi(payload) {
  return (payload?.output ?? [])
    .filter((item) => item?.type === "message")
    .flatMap((item) => item.content ?? [])
    .filter((part) => part?.type === "output_text")
    .map((part) => part.text ?? "")
    .join("")
    .trim();
}

export function safeUsage(value) {
  if (!value || typeof value !== "object") return null;
  const allowed = ["input_tokens", "output_tokens", "total_tokens",
    "inputTokens", "outputTokens", "totalTokens"];
  return Object.fromEntries(allowed
    .filter((key) => typeof value[key] === "number")
    .map((key) => [key, value[key]]));
}
