import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const corpusRoot = process.env.BENCHMARK_CORPUS_ROOT;
if (!corpusRoot) throw new Error("BENCHMARK_CORPUS_ROOT is required");
const runtimeTextRoot = process.env.BENCHMARK_RUNTIME_TEXT_ROOT;
if (!runtimeTextRoot) throw new Error("BENCHMARK_RUNTIME_TEXT_ROOT is required");

const selections = [
  ["waterloo-2026-08-18", "waterloo", "c18dcea9adf05d028f5ee1c71b2244fb3dc5e83acdab86996c81401d4038cebd", ["Que le conseil municipal adopte le Règlement 26-956-2"]],
  ["wickham-2026-09-15", "wickham", "7d17c277199e3664a1c49ddd92f34f490f269578194d504a97380905826c0fa0", ["Demande numéro 2026-00080"]],
  ["saint-barthelemy-2026-09-08", "saint-barthelemy", "ac5306d7efd793dc3b456afaf203b1d1a8e495456099ac560457f56591953845", ["zones R-7 et R-8"]],
  ["saint-etienne-de-bolton-2026-08-04", "saint-etienne-de-bolton", "27799681a178dd23d99596d78811ff5c678be649901748e0eca3d9b0eb26c45d", ["refuse, sur recommandation du CCU"]],
  ["waterloo-2026-08-31-negative", "waterloo", "132187c152d73a08da3c2d48eece98d4e415379c899bdc4c8dfb261d0d2b372e", ["Nomination au poste de directeur général par intérim"]],
];

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const records = [];
for (const [id, city, sha, terms] of selections) {
  const worker = resolve(corpusRoot, "workers", city);
  const pdfPath = resolve(worker, "corpus", `${sha}.pdf`);
  const meta = JSON.parse(await readFile(`${pdfPath}.meta.json`, "utf8"));
  const pdf = await readFile(pdfPath);
  if (sha256(pdf) !== sha || meta.sha256 !== sha) throw new Error(`SHA mismatch: ${id}`);
  const parsedPath = resolve(runtimeTextRoot, `${sha}.txt`);
  const text = await readFile(parsedPath, "utf8");
  const pages = text.split("\f").map((page) => page.replace(/\r\n/g, "\n"));
  if (pages.at(-1) === "") pages.pop();
  records.push({
    id, city, sha256: sha, sourceUrl: meta.sourceUrl, title: meta.title,
    pdfPath, parsedPath, bytes: pdf.length, pageCount: pages.length,
    textSha256: sha256(text), pageTextSha256: pages.map(sha256),
    termPages: Object.fromEntries(terms.map((term) => [term, pages.flatMap((page, index) => page.includes(term) ? [index + 1] : [])])),
  });
}
console.log(JSON.stringify({ schemaVersion: 1, records }, null, 2));
