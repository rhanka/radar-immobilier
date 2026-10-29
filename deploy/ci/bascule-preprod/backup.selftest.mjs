// Offline backup primitives: versioned S3, pinned restoration, additive documents,
// pure validators and the preserved cross-tenant artifact contracts. No cluster calls.
import { Buffer } from "node:buffer";
import console from "node:console";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
