import type { Context } from "hono";
import { validPwPageEnvelope } from "./write-intent-page-envelope.js";
import { isWriteRefusalCode, writeRefusal, WRITE_REFUSAL_CODES } from "./write-intent-refusal.js";

/** Bound the actual stream, then project only a closed public envelope. */
export async function projectPageWriteResponse(c: Context, response: Response,
  expected: Parameters<typeof validPwPageEnvelope>[1]): Promise<Response> {
  const bad = () => writeRefusal(c, "upstream_bad_payload", 502, "unknown", expected.verb);
  if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return bad();
  const reader = response.body?.getReader();
  if (!reader) return bad();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16 * 1024) { await reader.cancel(); return bad(); }
      chunks.push(value);
    }
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (response.status >= 400) {
      if (value?.operation !== `facets.write-intents.${expected.verb}.v1` || !isWriteRefusalCode(value?.error?.code) ||
        !["unknown", "not_executed"].includes(value.error.attemptOutcome)) return bad();
      const result = writeRefusal(c, value.error.code, response.status, value.error.attemptOutcome, expected.verb);
      if (response.status === 429) {
        const seconds = response.headers.get("retry-after") ?? "2";
        if (/^([1-9]|[1-5][0-9]|60)$/.test(seconds)) result.headers.set("Retry-After", seconds);
      }
      return result;
    }
    if (![200, 201].includes(response.status) || (expected.verb === "status" && response.status !== 200) ||
      !validPwPageEnvelope(value, expected, WRITE_REFUSAL_CODES)) return bad();
    return c.json(value, response.status as 200);
  } catch { return bad(); }
}
