/**
 * GH #817 — argv of project-graph-from-s3: city slugs, plus the optional declared
 * changes of ONE city (`--remove=<id>,…`, `--lose=<id>:<key>,…`) and `--preview`.
 */
import { describe, expect, it } from "vitest";

import { MAX_DECLARED_LOSSES, MAX_DECLARED_REMOVALS, parseProjectionArgs } from "./projection-args.js";

describe("parseProjectionArgs", () => {
  it("keeps the existing calls unchanged: slugs only, or nothing (every city)", () => {
    expect(parseProjectionArgs([])).toEqual({ slugs: [], preview: false });
    expect(parseProjectionArgs(["sherbrooke", "ogden"])).toEqual({ slugs: ["sherbrooke", "ogden"], preview: false });
  });

  it("parses the brigham declaration: 21 removals and one accepted loss, preview or apply", () => {
    const ids = Array.from({ length: 21 }, (_, i) => `lot-${i}`);
    const parsed = parseProjectionArgs([`--remove=${ids.join(",")}`, "--lose=muni-brigham:flag", "--preview", "brigham"]);
    expect(parsed.slugs).toEqual(["brigham"]);
    expect(parsed.preview).toBe(true);
    expect([...(parsed.declared?.removals ?? [])]).toEqual(ids);
    expect([...(parsed.declared?.propertyLosses ?? new Map())].map(([id, keys]) => [id, [...keys]])).toEqual([
      ["muni-brigham", ["flag"]],
    ]);
    expect(parseProjectionArgs(["brigham", "--remove=a"]).preview).toBe(false);
  });

  it("accepts a declaration with removals only or losses only", () => {
    expect(parseProjectionArgs(["--remove=a,b", "x"]).declared?.propertyLosses.size).toBe(0);
    expect(parseProjectionArgs(["--lose=a:k", "x"]).declared?.removals.size).toBe(0);
  });

  it.each([
    [["--remove=a", "x", "y"], /exactly one city/],
    [["--remove=a"], /exactly one city/],
    [["--preview", "x"], /--preview needs a declaration/],
    [["--remove=", "x"], /empty/],
    [["--lose=", "x"], /empty/],
    [["--remove=a,,b", "x"], /invalid node id/],
    [["--remove=a b", "x"], /invalid node id/],
    [["--remove=a;rm", "x"], /invalid node id/],
    [["--remove=-a", "x"], /invalid node id/],
    [["--remove=a,a", "x"], /duplicate/],
    [["--lose=a", "x"], /invalid property loss/],
    [["--lose=a:k:z", "x"], /invalid property loss/],
    [["--lose=a:k-1", "x"], /invalid property loss/],
    [["--lose=a:k,a:k", "x"], /duplicate/],
    [["--remove=a", "--lose=a:k", "x"], /both removed and losing/],
    [["--remove=a", "--remove=b", "x"], /more than once/],
    [["--preview", "--preview", "--remove=a", "x"], /more than once/],
    [["--force", "x"], /unknown option/],
    [["--remove=a", "Bad/Slug"], /invalid city slug/],
  ])("refuses %j", (argv, message) => {
    expect(() => parseProjectionArgs(argv)).toThrow(message);
  });

  it("bounds the declarations", () => {
    const removals = Array.from({ length: MAX_DECLARED_REMOVALS + 1 }, (_, i) => `n-${i}`).join(",");
    expect(() => parseProjectionArgs([`--remove=${removals}`, "x"])).toThrow(/at most/);
    const losses = Array.from({ length: MAX_DECLARED_LOSSES + 1 }, (_, i) => `n-${i}:k`).join(",");
    expect(() => parseProjectionArgs([`--lose=${losses}`, "x"])).toThrow(/at most/);
    expect(() => parseProjectionArgs([`--remove=${"a".repeat(129)}`, "x"])).toThrow(/invalid node id/);
  });
});
