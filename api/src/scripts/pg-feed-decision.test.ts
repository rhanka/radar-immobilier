/**
 * pg-feed-decision.test.ts — the worker-live PG-feed gate. Regression cover for
 * the pinned-image diag failure: a plain exploit run with NO DB credentials
 * wired (envFrom radar-api gives POSTGRES_HOST but not POSTGRES_PASSWORD) must
 * NOT try to reach Postgres — it must run S3-only ("PG feed: OFF"), never exit(1).
 */
import { describe, expect, it } from "vitest";

import { decidePgFeed } from "./pg-feed-decision.js";

describe("decidePgFeed", () => {
  it("no exploitation requested → no feed", () => {
    expect(
      decidePgFeed({ exploit: false, reexploit: false, env: {} }),
    ).toEqual({ feed: false, reason: "no exploitation requested" });
  });

  it("reexploit always feeds PG, even with no credentials (its sole purpose is PG)", () => {
    expect(decidePgFeed({ exploit: true, reexploit: true, env: {} })).toEqual({
      feed: true,
    });
    // reexploit implies exploitation; still feeds regardless of the exploit flag.
    expect(decidePgFeed({ exploit: false, reexploit: true, env: {} })).toEqual({
      feed: true,
    });
  });

  it("plain exploit WITH explicit credentials → feed (fail-loud downstream)", () => {
    expect(
      decidePgFeed({
        exploit: true,
        reexploit: false,
        env: { POSTGRES_PASSWORD: "s3cr3t-from-radar-db-credentials" },
      }),
    ).toEqual({ feed: true });
  });

  it("plain exploit with NO POSTGRES_PASSWORD → OFF (the diag / 33-34 scrape jobs)", () => {
    const d = decidePgFeed({ exploit: true, reexploit: false, env: {} });
    expect(d.feed).toBe(false);
    if (d.feed === false) expect(d.reason).toMatch(/POSTGRES_PASSWORD/);
  });

  it("plain exploit with an empty POSTGRES_PASSWORD → OFF (empty is not wired)", () => {
    expect(
      decidePgFeed({
        exploit: true,
        reexploit: false,
        env: { POSTGRES_PASSWORD: "" },
      }).feed,
    ).toBe(false);
  });
});
