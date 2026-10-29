import assert from "node:assert/strict";
import { cases as original } from "./base-api-pwc-review-cases.mjs";
assert.equal(original.filter(([name]) => name === "A6-unserved-write-page").length, 1);
export const cases = original.map((entry) => entry[0] === "A6-unserved-write-page"
  ? [entry[0], entry[1], "if (!deps.releaseFiles && deps.writePageSurface &&",
    "if (false && !deps.releaseFiles && deps.writePageSurface &&", ...entry.slice(4)]
  : entry);
