#!/usr/bin/env node
// =============================================================================
// bascule.selftest.mjs — self-test des fonctions PURES de bascule.mjs.
//
// N'exécute AUCUN appel réel (0 kubectl, 0 aws, 0 DB, 0 réseau) : il n'importe
// que la fonction pure exportée `classifyJobStatus` et la nourrit de `.status`
// MOCKÉS. But : verrouiller la SEULE information que le runner lit d'un Job
// (verdict pass/fail/en-cours via .status) — le runner ne lit JAMAIS les logs.
//
//   node deploy/ci/bascule-preprod/bascule.selftest.mjs   → exit 0 si tout passe.
// =============================================================================
import process from "node:process";
import console from "node:console";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { classifyJobStatus, withScheme, parseListingMeta, reconMissing, refreshJobName, buildRefreshArgs, refreshArgsYaml } from "./bascule.mjs";

let passed = 0;
let failed = 0;
const ok = (name, cond) => {
  if (cond) { passed += 1; console.log(`  ok   ${name}`); }
  else { failed += 1; console.log(`  FAIL ${name}`); }
};
const eq = (name, a, b) => ok(`${name} (got ${JSON.stringify(a)})`, JSON.stringify(a) === JSON.stringify(b));

// 1) succeeded>=1 → done + ok.
eq("succeeded=1 ⇒ done/ok/succeeded", classifyJobStatus({ succeeded: 1 }), { done: true, ok: true, state: "succeeded" });

// 2) failed>=1 → done + !ok (fail-closed).
eq("failed=1 ⇒ done/!ok/failed", classifyJobStatus({ failed: 1 }), { done: true, ok: false, state: "failed" });

// 3) active>0 sans succeeded/failed → en cours (active).
eq("active=1 ⇒ !done/active", classifyJobStatus({ active: 1 }), { done: false, ok: false, state: "active" });

// 4) status vide ({}) → en attente (pending), ni done ni ok.
eq("{} ⇒ !done/pending", classifyJobStatus({}), { done: false, ok: false, state: "pending" });

// 5) undefined/null → pending (robustesse : status pas encore peuplé).
eq("undefined ⇒ pending", classifyJobStatus(undefined), { done: false, ok: false, state: "pending" });
eq("null ⇒ pending", classifyJobStatus(null), { done: false, ok: false, state: "pending" });

// 6) succeeded prime sur active (pod terminé OK alors qu'un autre index actif).
eq("succeeded=1 & active=1 ⇒ succeeded", classifyJobStatus({ succeeded: 1, active: 1 }), { done: true, ok: true, state: "succeeded" });

// 7) failed prime sur active (fail-closed : un pod en échec = KO).
eq("failed=1 & active=1 ⇒ failed", classifyJobStatus({ failed: 1, active: 1 }), { done: true, ok: false, state: "failed" });

// 8) champs string (jsonpath peut renvoyer des strings) → coercés en nombre.
eq("succeeded='1' (string) ⇒ succeeded", classifyJobStatus({ succeeded: "1" }), { done: true, ok: true, state: "succeeded" });
eq("failed='2' (string) ⇒ failed", classifyJobStatus({ failed: "2" }), { done: true, ok: false, state: "failed" });

// ── withScheme : root cause endpoint sans schéma (BHS = host nu) ─────────────
eq("withScheme — host nu ⇒ https://", withScheme("s3.bhs.io.cloud.ovh.net"), "https://s3.bhs.io.cloud.ovh.net");
eq("withScheme — déjà https:// (idempotent)", withScheme("https://s3.bhs.io.cloud.ovh.net"), "https://s3.bhs.io.cloud.ovh.net");
eq("withScheme — http:// conservé", withScheme("http://minio.local:9000"), "http://minio.local:9000");
eq("withScheme — espaces trim + préfixe", withScheme("  s3.example  "), "https://s3.example");
eq("withScheme — vide ⇒ vide", withScheme(""), "");

// ── reconMissing : DIFF LIST-only Key+Size (ETag IGNORÉ) — dest ⊇ src ? ───────
const SRC = ["a/1.txt\t10", "b/2.txt\t20", "c 3.txt\t30"].join("\n"); // clé avec espace
const DST_OK = ["a/1.txt\t10", "b/2.txt\t20", "c 3.txt\t30", "extra\t99"].join("\n");
eq("recon — dest ⊇ src ⇒ [] (aucun manquant)", reconMissing(SRC, DST_OK), []);
const DST_MISS = ["a/1.txt\t10", "b/2.txt\t20"].join("\n"); // manque c 3.txt
eq("recon — clé src absente de dst ⇒ manquante", reconMissing(SRC, DST_MISS), ["c 3.txt"]);
const DST_SIZE = ["a/1.txt\t10", "b/2.txt\t999", "c 3.txt\t30"].join("\n"); // size diff
eq("recon — Size différent ⇒ manquante", reconMissing(SRC, DST_SIZE), ["b/2.txt"]);
// ETag différent mais MÊME Size ⇒ PLUS flaggé (ETag ignoré = fix multipart).
const SRC3 = ["a/1.txt\t10\t\"e1\"", "b/2.txt\t20\t\"e2\""].join("\n");
const DST3 = ["a/1.txt\t10\t\"DIFF-multipart\"", "b/2.txt\t20\t\"e2\""].join("\n");
eq("recon — ETag différent + Size identique ⇒ [] (ETag ignoré)", reconMissing(SRC3, DST3), []);
eq("recon — src vide ⇒ [] (dest ⊇ ∅)", reconMissing("", DST_OK), []);
ok("recon — parseListingMeta ne retient que la Size (col1), ETag ignoré", parseListingMeta("a\t1\t\"e\"").get("a") === "1");
ok("recon — parseListingMeta ignore lignes vides", parseListingMeta("a\t1\n\n").size === 1);

// ── refreshJobName : nom de Job RFC1123 sûr (force-refresh) ──────────────────
eq("refreshJobName — suffixe simple", refreshJobName("12345"), "radar-refresh-pv-forced-12345");
eq("refreshJobName — charset non-RFC1123 remplacé + minusculé", refreshJobName("Abc_DEF.9"), "radar-refresh-pv-forced-abc-def-9");
eq("refreshJobName — suffixe vide ⇒ base seule", refreshJobName(""), "radar-refresh-pv-forced");
eq("refreshJobName — undefined ⇒ base seule", refreshJobName(undefined), "radar-refresh-pv-forced");
eq("refreshJobName — tirets en tête/fin taillés", refreshJobName("--foo--"), "radar-refresh-pv-forced-foo");
ok("refreshJobName — borné à 63 caractères", refreshJobName("x".repeat(100)).length <= 63);
ok("refreshJobName — pas de tiret final après troncature", !/-$/.test(refreshJobName("a".repeat(60) + "-".repeat(10))));
ok("refreshJobName — charset RFC1123 [a-z0-9-] uniquement", /^[a-z0-9-]+$/.test(refreshJobName("Wéîrd Run #42!")));

// ── buildRefreshArgs / refreshArgsYaml : bornage (d) du refresh S6 ───────────
const throws = (fn) => { try { fn(); return false; } catch { return true; } };
// Défaut (vides) ⇒ [] = delta complet des 530 villes config-only.
eq("refreshArgs — vides ⇒ [] (delta complet)", buildRefreshArgs({}).args, []);
eq("refreshArgs — vides ⇒ [] (aucun champ)", buildRefreshArgs().args, []);
// --chunk k/n ⇒ shard worker-live.
eq("refreshArgs — chunk 1/4 ⇒ --chunk", buildRefreshArgs({ chunk: "1/4" }).args, ["--chunk", "1/4"]);
eq("refreshArgs — chunk trim", buildRefreshArgs({ chunk: "  2/5 " }).args, ["--chunk", "2/5"]);
// Liste de slugs (espaces et/ou virgules).
eq("refreshArgs — cities espace", buildRefreshArgs({ cities: "carignan delson" }).args, ["carignan", "delson"]);
eq("refreshArgs — cities virgule + espaces", buildRefreshArgs({ cities: " saint-henri, laval " }).args, ["saint-henri", "laval"]);
// Mutuellement exclusifs + validations (throw, jamais process.exit).
ok("refreshArgs — chunk + cities ⇒ throw (exclusifs)", throws(() => buildRefreshArgs({ chunk: "1/4", cities: "laval" })));
ok("refreshArgs — chunk mal formé ⇒ throw", throws(() => buildRefreshArgs({ chunk: "1-4" })));
ok("refreshArgs — chunk k>n ⇒ throw", throws(() => buildRefreshArgs({ chunk: "5/4" })));
ok("refreshArgs — chunk 0/n ⇒ throw", throws(() => buildRefreshArgs({ chunk: "0/4" })));
ok("refreshArgs — slug injection (espace/quote) ⇒ throw", throws(() => buildRefreshArgs({ cities: 'laval","--evil' })));
ok("refreshArgs — slug majuscule ⇒ throw", throws(() => buildRefreshArgs({ cities: "Laval" })));
// refreshArgsYaml : corps de liste inline JSON-quoté (sans crochets), injection-safe.
eq("refreshArgsYaml — vide ⇒ '' (args: [])", refreshArgsYaml([]), "");
eq("refreshArgsYaml — chunk", refreshArgsYaml(["--chunk", "1/4"]), '"--chunk", "1/4"');
eq("refreshArgsYaml — slugs", refreshArgsYaml(["carignan", "delson"]), '"carignan", "delson"');
ok("refreshArgsYaml — sortie sans crochets (le template fournit args: [...])", !/[[\]]/.test(refreshArgsYaml(["a", "b"])));

// ── docs-sync : copie INCRÉMENTALE + CONCURRENTE (script réel du template) ──────
// Parité rhanka/geo#396. Le script `node -e` du Job est extrait du template et
// exécuté dans un contexte vm avec un faux @aws-sdk/client-s3 (0 réseau). On
// vérifie ce qu'il COPIE — ÉCART immo volontaire (déjà noté côté geo) : source
// vide ⇒ exit 0 « rien à copier » (pas exit 1 comme geo).
{
  const tmpl = readFileSync(join(import.meta.dirname, "docs-sync-job.tmpl.yaml"), "utf8");
  const m = tmpl.match(/\n {10}args:\n {12}- \|\n([\s\S]*?)\n {10}env:/);
  ok("docs-sync — script node extrait du template", !!m);
  const code = m ? m[1].split("\n").map((l) => l.replace(/^ {14}/, "")).join("\n") : "";
  ok("docs-sync — aucun placeholder ${...} dans le script", !/\$\{/.test(code));

  const T0 = "2026-09-01T00:00:00.000Z";
  const T1 = "2026-09-20T00:00:00.000Z";
  const o = (Key, Size, ETag, LastModified) => ({ Key, Size, ETag, LastModified });
  const runSync = ({ srcObjs, dstObjs, dstListFails = false, failCopyKey = null, concurrency, pageSize = 2 }) => new Promise((resolve) => {
    const copies = [];
    let inFlight = 0;
    let maxInFlight = 0;
    let done = false;
    const finish = (r) => { if (!done) { done = true; resolve({ ...r, copies, maxInFlight }); } };
    class Cmd { constructor(input) { this.input = input; } }
    class ListObjectsV2Command extends Cmd {}
    class CopyObjectCommand extends Cmd {}
    class HeadObjectCommand extends Cmd {}
    class S3Client {
      async send(cmd) {
        const i = cmd.input;
        if (cmd instanceof ListObjectsV2Command) {
          if (i.Bucket === "dst" && dstListFails) throw Object.assign(new Error("denied"), { name: "AccessDenied" });
          const all = i.Bucket === "src" ? srcObjs : dstObjs;
          const start = i.ContinuationToken ? Number(i.ContinuationToken) : 0;
          const size = i.MaxKeys || pageSize;
          const page = all.slice(start, start + size);
          const more = start + size < all.length && !i.MaxKeys;
          return { Contents: page, IsTruncated: more, NextContinuationToken: more ? String(start + size) : undefined };
        }
        if (cmd instanceof HeadObjectCommand) return {};
        if (cmd instanceof CopyObjectCommand) {
          inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight);
          await new Promise((r) => globalThis.setTimeout(r, 2));
          inFlight -= 1;
          if (i.Key === failCopyKey) throw Object.assign(new Error("boom"), { name: "InternalError" });
          copies.push(i);
          return {};
        }
        throw new Error("commande inattendue");
      }
    }
    const env = { S3_ENDPOINT: "https://s3.test", SRC_BUCKET: "src", DST_BUCKET: "dst", COPY_GRANTEE: "g1", COPY_PREFIX: "normalized/", ...(concurrency ? { COPY_CONCURRENCY: String(concurrency) } : {}) };
    const logs = [];
    const fakeConsole = {
      // pas de process.exit() explicite sur le chemin « source vide » (ÉCART immo,
      // cf. header) : on détecte AUSSI la fin sur ce message, pas seulement "ok ".
      log: (...a) => { const s = a.join(" "); logs.push(s); if (s.startsWith("[docs-sync] ok ") || /rien a copier/.test(s)) finish({ code: 0, logs }); },
      warn: (...a) => logs.push(a.join(" ")),
      error: (...a) => logs.push(a.join(" ")),
    };
    const fakeProcess = { env, exit: (c) => finish({ code: c, logs }) };
    const sdk = { S3Client, ListObjectsV2Command, CopyObjectCommand, HeadObjectCommand };
    vm.runInNewContext(code, { require: (id) => { if (id !== "@aws-sdk/client-s3") throw new Error(id); return sdk; }, process: fakeProcess, console: fakeConsole });
  });

  const SRC5 = [
    o("normalized/a", 10, '"e1"', T0),        // dst identique (même ETag) ⇒ sauté
    o("normalized/b", 20, '"e2"', T0),        // dst même Size, ETag différent, copiée APRÈS ⇒ sautée
    o("normalized/c", 30, '"e3"', T0),        // dst Size différente ⇒ copiée
    o("normalized/d", 40, '"e4-3"', T1),      // dst même Size, ETag différent, plus ANCIENNE que prod ⇒ copiée
    o("normalized/e f", 50, '"e5"', T0),      // absente de dst ⇒ copiée (clé avec espace)
  ];
  const DST5 = [
    o("normalized/a", 10, '"e1"', T0),
    o("normalized/b", 20, '"md5-b"', T1),
    o("normalized/c", 31, '"e3"', T1),
    o("normalized/d", 40, '"md5-d"', T0),
    o("normalized/x-preprod", 7, '"px"', T0), // extra préprod ignoré
  ];
  const keys = (r) => r.copies.map((c) => c.Key).sort();

  const r1 = await runSync({ srcObjs: SRC5, dstObjs: DST5 });
  eq("docs-sync — exit 0", r1.code, 0);
  eq("docs-sync — copie SEULEMENT absentes/différentes (pagination src+dst)", keys(r1), ["normalized/c", "normalized/d", "normalized/e f"]);
  ok("docs-sync — CopySource encodé + GrantFullControl + même clé", r1.copies.some((c) => c.CopySource === "/src/normalized/e%20f" && c.GrantFullControl === "id=g1" && c.Bucket === "dst"));
  ok("docs-sync — compte rendu source/deja_a_jour/a_copier", r1.logs.some((l) => /source=5 deja_a_jour=2 a_copier=3 concurrence=8/.test(l)));

  const r2 = await runSync({ srcObjs: SRC5, dstObjs: SRC5 });
  eq("docs-sync — préprod déjà complète ⇒ 0 copie, exit 0", [r2.code, r2.copies.length], [0, 0]);

  const r3 = await runSync({ srcObjs: SRC5, dstObjs: DST5, dstListFails: true });
  eq("docs-sync — LIST destination refusée ⇒ repli copie complète", [r3.code, r3.copies.length], [0, 5]);
  ok("docs-sync — repli signalé en WARN", r3.logs.some((l) => /LIST destination impossible \(AccessDenied\)/.test(l)));

  const MANY = Array.from({ length: 40 }, (_, k) => o(`normalized/k${k}`, k + 1, `"e${k}"`, T0));
  const r4 = await runSync({ srcObjs: MANY, dstObjs: [], concurrency: 4, pageSize: 7 });
  eq("docs-sync — 40 absentes ⇒ 40 copies", [r4.code, r4.copies.length], [0, 40]);
  ok(`docs-sync — concurrence bornée à COPY_CONCURRENCY=4 et effective (max ${r4.maxInFlight})`, r4.maxInFlight === 4);

  const r5 = await runSync({ srcObjs: MANY, dstObjs: [], concurrency: 999 });
  ok(`docs-sync — COPY_CONCURRENCY plafonnée à 32 (max ${r5.maxInFlight})`, r5.maxInFlight <= 32 && r5.maxInFlight > 1);

  const r6 = await runSync({ srcObjs: MANY, dstObjs: [], failCopyKey: "normalized/k7" });
  eq("docs-sync — erreur de copie ⇒ exit 1 (fail-closed)", r6.code, 1);

  // ÉCART immo (volontaire, cf. header docs-sync-job.tmpl.yaml) : source vide ⇒
  // « rien à copier », exit 0 (geo : exit 1, un normalized/ prod vide = panne).
  const r7 = await runSync({ srcObjs: [], dstObjs: DST5 });
  eq("docs-sync — source vide ⇒ « rien à copier », exit 0 (écart immo, inchangé)", [r7.code, r7.copies.length], [0, 0]);
}

// ── Cadence du run planifié : HEBDOMADAIRE, dimanche 03:17 UTC (décision owner 2026-09-26) ──
{
  const wf = readFileSync(join(import.meta.dirname, "../../../.github/workflows/bascule-preprod.yml"), "utf8");
  const crons = [...wf.matchAll(/^\s*- cron: '([^']*)'/mg)].map((x) => x[1]);
  eq("bascule-preprod.yml — un seul cron, hebdomadaire dimanche 03:17 UTC", crons, ["17 3 * * 0"]);
  ok("bascule-preprod.yml — run planifié armé par vars.BASCULE_SCHEDULE_ENABLED (inchangé)",
    wf.includes("github.event_name != 'schedule' || vars.BASCULE_SCHEDULE_ENABLED == 'true'"));
}

console.log(`\nbascule.selftest — ${passed} passés, ${failed} échoués`);
process.exit(failed ? 1 : 0);
