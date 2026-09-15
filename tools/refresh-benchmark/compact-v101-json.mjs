import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.env.BENCHMARK_RESULT_ROOT
  || (() => { throw new Error("BENCHMARK_RESULT_ROOT is required"); })();
async function paths(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? paths(path) : [path];
  }));
  return nested.flat();
}
const jsonPaths = (await paths(root)).filter((path) => path.endsWith(".json")
  && !path.endsWith(".lock.json")).sort();
for (const path of jsonPaths) {
  const value = JSON.parse(await readFile(path, "utf8"));
  await writeFile(path, `${JSON.stringify(value)}\n`, "utf8");
}
console.log(JSON.stringify({ compacted: jsonPaths.length }));
