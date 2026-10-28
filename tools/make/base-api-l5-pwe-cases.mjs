import assert from "node:assert/strict";
import { cases as original } from "./base-api-pwe-mutation-cases.mjs";
assert.equal(original.filter(([name]) => name === "M02-comparator-tier").length, 1);
export const cases = original.map((entry) => entry[0] === "M02-comparator-tier"
  ? [entry[0], entry[1],
    "return left.issuer === right.issuer && left.sub === right.sub && left.tier === right.tier;",
    "return left.issuer === right.issuer && left.sub === right.sub;", ...entry.slice(4)]
  : entry);
