import assert from "node:assert/strict";
import { cases as original } from "./base-api-pwe-mutation-cases.mjs";
assert.equal(original.filter(([name]) => name === "M02-comparator-tier").length, 1);
const replay = original.filter(([name]) => name === "M11-replayed-executor");
assert.equal(replay.length, 1);
assert.equal(replay[0][2], "await confirmPwSignalWrite(db, principal.sub, row.intentId,");
assert.ok(replay[0][3].endsWith(replay[0][2]));
export const cases = original.map((entry) => entry[0] === "M02-comparator-tier"
  ? [entry[0], entry[1],
    "return left.issuer === right.issuer && left.sub === right.sub && left.tier === right.tier;",
    "return left.issuer === right.issuer && left.sub === right.sub;", ...entry.slice(4)]
  : entry);
