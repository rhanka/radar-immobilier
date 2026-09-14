import { readFile } from "node:fs/promises";

import { assertInstalledRelease } from "./release-readiness.mjs";

const required = (name) => process.env[name]
  || (() => { throw new Error(`${name} is required`); })();
const graphifyPackage = JSON.parse(await readFile(required("BENCHMARK_GRAPHIFY_PACKAGE_JSON"), "utf8"));
const meshPackage = JSON.parse(await readFile(required("BENCHMARK_MESH_PACKAGE_JSON"), "utf8"));
const result = assertInstalledRelease({ graphifyPackage, meshPackage });
console.log(JSON.stringify(result));
