import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.env.BENCHMARK_RESULT_ROOT
  || (() => { throw new Error("BENCHMARK_RESULT_ROOT is required"); })();
const parse = async (path) => JSON.parse(await readFile(path, "utf8"));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const availability = resolve(root, "availability");
const names = (await readdir(availability)).sort();
const pingNames = names.filter((name) => /^ping-.+\.json$/u.test(name)
  && !name.endsWith(".lock.json"));
if (names.some((name) => name.endsWith(".lock.json"))) throw new Error("Transient lock is published");
if (pingNames.length !== 26) throw new Error(`Expected 26 ping receipts, got ${pingNames.length}`);
const pings = await Promise.all(pingNames.map((name) => parse(resolve(availability, name))));
if (pings.filter(({ actual }) => actual.httpStatus === 200 && actual.pingExact).length !== 24) {
  throw new Error("Expected 24 exact PING_OK receipts");
}
if (pings.reduce((sum, receipt) => sum + receipt.requestCount, 0) !== 32
  || pings.some(({ requestCount }) => requestCount < 1 || requestCount > 2)) {
  throw new Error("Unexpected ping request accounting");
}
const catalogBytes = await readFile(resolve(availability, "catalogs.json"));
const cPrimeBytes = await readFile(resolve(root, "cprime-baseline.json"));
const catalog = JSON.parse(catalogBytes);
const cPrime = JSON.parse(cPrimeBytes);
const manifest = await parse(resolve(root, "manifest.json"));
if (catalog.requestCount !== 6 || catalog.llmMesh.version !== "0.19.2") {
  throw new Error("Unexpected catalog freeze");
}
if (cPrime.strict.accepted !== 87 || cPrime.cPrime.accepted !== 94
  || cPrime.cPrime.directCandidates !== 9 || cPrime.cPrime.requalified !== 7) {
  throw new Error("Unexpected strict/C-prime measurement");
}
if (manifest.documents.length !== 100 || manifest.corpus.cityCount !== 100
  || manifest.outputCap.commonMaxOutputTokens !== 32768
  || manifest.contract.mainMergeCommit !== "4e3a4db8f71fe4824bf9aa9f166d1d47b95211c4") {
  throw new Error("Unexpected v101 manifest contract");
}
if (manifest.fingerprints.availabilityCatalogsSha256 !== sha256(catalogBytes)
  || manifest.fingerprints.cPrimeBaselineSha256 !== sha256(cPrimeBytes)) {
  throw new Error("Manifest evidence fingerprint mismatch");
}
const text = await Promise.all(["protocol.md", "manifest.json", "cprime-baseline.json",
  ...names].filter((name) => !name.endsWith(".lock.json")).map((name) => readFile(
  name.startsWith("ping-") || name === "catalogs.json" ? resolve(availability, name) : resolve(root, name),
  "utf8").catch(() => "")));
if (/sk-(?:proj|ant)-|sk-[A-Za-z0-9]{20}/u.test(text.join("\n"))) {
  throw new Error("Secret-like signature found in v101 artifacts");
}
console.log(JSON.stringify({ documents: 100, cities: 100, pingReceipts: 26,
  exactPings: 24, pingHttpRequests: 32, strictAccepted: 87, cPrimeAccepted: 94,
  commonMaxOutputTokens: 32768, secretSignatures: 0 }));
