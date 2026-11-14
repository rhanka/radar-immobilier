import type { TextJsonGenerationClient } from "@sentropic/engram";

/** Classification admission; single-pass also includes its combined extraction calls. */
export class RefreshRunBudget {
  calls = 0;
  reservedTokens = 0;
  haltedBy: "calls" | "tokens" | "time" | undefined;
  private readonly startedAt: number;
  constructor(private readonly limits: { calls: number; tokens: number; durationMs: number },
    private readonly now: () => number = Date.now) { this.startedAt = now(); }

  wrap(client: TextJsonGenerationClient, signal: AbortSignal): TextJsonGenerationClient {
    return { ...client, generateJson: async (input) => {
      signal.throwIfAborted();
      if (!input.maxOutputTokens || !Number.isSafeInteger(input.maxOutputTokens)) {
        throw new Error("Refresh run budget requires an output-token cap");
      }
      // UTF-8 bytes upper-bound input tokens. Keep the full output reservation,
      // including failures: missing provider usage must never refund spent work.
      const tokens = Buffer.byteLength(input.prompt) + Buffer.byteLength(input.schema) + input.maxOutputTokens;
      this.haltedBy ??= this.now() - this.startedAt >= this.limits.durationMs ? "time"
        : this.calls >= this.limits.calls ? "calls"
          : this.reservedTokens + tokens > this.limits.tokens ? "tokens" : undefined;
      if (this.haltedBy) throw Object.assign(new Error("Refresh run budget exhausted"),
        { code: "REFRESH_RUN_BUDGET" });
      // Synchronous reservation prevents concurrent workers overspending the cap.
      this.calls++;
      this.reservedTokens += tokens;
      return client.generateJson(input);
    } };
  }
}
