import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { validateProfileExtraction } from "/workspace/node_modules/@sentropic/graphify/dist/index.js";

const repositoryRoot = process.env.BENCHMARK_REPOSITORY_ROOT;
const t1Root = process.env.BENCHMARK_T1_ROOT;
const output = process.env.BENCHMARK_OUTPUT;
if (!repositoryRoot || !t1Root || !output) throw new Error("Missing benchmark diagnostic input");
const { loadRefreshProfileContext } = await import(pathToFileURL(resolve(t1Root,
  "api/src/services/graph/refresh-profile.ts")));
const context = loadRefreshProfileContext({ root: t1Root,
  profilePath: resolve(t1Root, "radar/ontology/ontology-profile.yaml"), unregisteredOnly: true });
const extraction = JSON.parse(await readFile(resolve(repositoryRoot, output), "utf8"));
const result = validateProfileExtraction(extraction, {
  profile: context.profile, registryExtraction: context.registryExtraction,
});
console.log(JSON.stringify({ valid: result.valid, issues: result.issues.filter(({ severity }) => severity === "error") }));
