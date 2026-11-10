// bench-wonder: single-arm driver, reuses score-676.mjs scoreSource exactly
// (same code path as score-v11.mjs for a muse seat arm).
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
const DIR = process.env.BENCH_DIR ?? new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const { scoreSource } = await import(`${DIR}/full/score-676.mjs`);
const manifest = JSON.parse(await readFile(`${DIR}/harness/manifest-v101b.json`, "utf8"));
const quantile = (arr, q) => { if (!arr.length) return null; const s=[...arr].sort((a,b)=>a-b); return s[Math.min(s.length-1, Math.floor(q*s.length))]; };
const armDir = `${DIR}/full/arms/muse-wonder-low`;
const meta = (await readFile(`${armDir}/meta.jsonl`, "utf8")).split("\n").filter(Boolean).map((l)=>JSON.parse(l));
const done = meta.filter((r)=>r.exit!==undefined);
const quotas = meta.filter((r)=>r.event==="QUOTA");
const resolveDoc = async (documentId) => {
  const out = `${armDir}/validated/low--${documentId}.output.json`;
  if (!existsSync(out)) return { state: "refused_or_missing" };
  return { state: "accepted", output: JSON.parse(await readFile(out, "utf8")) };
};
const scored = await scoreSource("muse-wonder-low", "muse-wonder-seat", resolveDoc);
const failClasses = { J:0, V:0, Pr:0, T:0 };
for (const d of manifest.documents) {
  const rc = `${armDir}/validated/low--${d.id}.receipt.json`;
  if (existsSync(rc)) { const fc = JSON.parse(await readFile(rc,"utf8")).validation.failureClass;
    if (fc==="json") failClasses.J+=1; else if (fc==="profile") failClasses.V+=1; else if (fc==="provenance") failClasses.Pr+=1;
  } else failClasses.T+=1;
}
const ok = done.filter((r)=>r.exit===0);
let inBytes=0; for (const d of manifest.documents) { try{ inBytes+=(await readFile(`${DIR}/full/prompts/${d.id}.muse.txt`)).length; }catch{ /* prompt absent: skip */ } }
const outBytesMean = ok.length ? ok.reduce((s,r)=>s+r.bytes,0)/ok.length : null;
const row = { arm:"muse-wonder-low", model:"muse-wonder-1.0", effort:"low", docs:manifest.documents.length,
  completed:done.length, quotaEvents:quotas.length, accepted:scored.accepted, strict:scored.net, broad:scored.broad,
  stageTolerant:scored.stageTolerant, soft:scored.soft, f1n4:scored.human4.f1, failClasses,
  p50s: quantile(done.map(r=>r.ms),0.5)/1000, p90s: quantile(done.map(r=>r.ms),0.9)/1000,
  tokens:{ note:"estimated bytes/4, no provider usage on muse exec", inBytesMean:inBytes/manifest.documents.length, outBytesMean,
    outTokensMeanEst: outBytesMean==null?null:outBytesMean/4 } };
await writeFile(`${DIR}/full/scores-wonder.json`, JSON.stringify({arms:[row], cases:scored.cases}, null, 1));
console.log(JSON.stringify(row,null,1));
