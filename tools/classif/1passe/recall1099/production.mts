import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { extractRefreshProfile, loadRefreshProfileContext, REFRESH_PROFILE_CONTRACT_VERSION } from '/workspace/api/src/services/graph/refresh-profile.ts';
import { loadSinglePassPrompt, singlePassPrimary } from '/workspace/api/src/services/graph/refresh-single-pass.ts';
import { extractDocumentHeaderDate } from '/workspace/packages/radar-sources/src/index.ts';
import { dir, home, documents, write, save, load, json } from './context.mjs';
const runtime = '/runtime';
fs.writeFileSync(`${runtime}/package.json`, '{"type":"module"}');
const hash = (x: string | Buffer) => createHash('sha256').update(x).digest('hex');
const corpusPath = '/workspace/api/src/services/graph/refresh-corpus.ts';
const corpus = fs.readFileSync(corpusPath, 'utf8');
// Export-only instrumentation exposes the production chunker without copying its implementation.
fs.writeFileSync(`${runtime}/corpus.ts`, corpus + '\nexport { chunkDocument };\n');
const { chunkDocument } = await import(`${runtime}/corpus.ts`);
process.env.REFRESH_PROMPT_MANIFEST = '/workspace/radar/prompts/refresh-single-pass.json';
const prompt = await loadSinglePassPrompt();
assert.equal(prompt.sha256, '8957bcaa146b3b83ee89000fccec3c6f393c7b801b320a158d58d2631fa3a205');
const model = singlePassPrimary({ REFRESH_SINGLE_PASS_MODEL: 'gpt-6-astra', REFRESH_SINGLE_PASS_REASONING_EFFORT: 'low' });
const context = loadRefreshProfileContext({ root: '/workspace', profilePath: '/workspace/radar/ontology/ontology-profile.yaml', unregisteredOnly: true });
const docs = documents().sort((a, b) => a.id.localeCompare(b.id));
const requests: any[] = [], proofs: any[] = [];
const mode = process.argv[2];
if (mode !== 'prepare') {
  const frozen = json(`${dir}/freeze.json`);
  for (const [path, expected] of Object.entries(frozen.sourceHashes)) {
    assert.equal(hash(fs.readFileSync(`/workspace/${path}`)), expected, `production source changed: ${path}`);
  }
  write(`${dir}/runtime-proof.json`, {
    engram: JSON.parse(fs.readFileSync('/workspace/node_modules/@sentropic/engram/package.json', 'utf8')).version,
    node: process.version, promptSha256: prompt.sha256, sourceHashesVerified: true });
}
let v9: any;
let v9Context: any;
if (mode === 'validate' || mode === 'preflight') {
  fs.mkdirSync(`${runtime}/v9`, { recursive: true });
  const frozen = fs.readFileSync('/bench/t1/frozen-refresh-profile.ts', 'utf8');
  fs.writeFileSync(`${runtime}/v9/profile.ts`, frozen.replace('"@sentropic/graphify"',
    '"/bench/sandbox/node_modules/@sentropic/graphify/dist/index.js"') + '\nexport { validatedExtraction, physicalPageTexts };\n');
  fs.copyFileSync('/bench/t1/frozen-refresh-corpus.ts', `${runtime}/v9/refresh-corpus.ts`);
  v9 = await import(`${runtime}/v9/profile.ts`);
  v9Context = v9.loadRefreshProfileContext({ root: '/bench', profilePath: '/bench/t1/frozen-ontology-profile.yaml', unregisteredOnly: true });
  write(`${dir}/v9-proof.json`, { moduleSha256: hash(frozen), corpusSha256: hash(fs.readFileSync('/bench/t1/frozen-refresh-corpus.ts')),
    graphifyVersion: JSON.parse(fs.readFileSync('/bench/sandbox/node_modules/@sentropic/graphify/package.json', 'utf8')).version,
    method: 'export-only validator instrumentation; dependency resolved to frozen graphify; accepted native graph, without annotations or declared version' });
}
if (mode === 'preflight') { console.log(JSON.stringify({ v9Ready: true, nativeContract: REFRESH_PROFILE_CONTRACT_VERSION })); process.exit(0); }
for (const d of docs) {
  const pages = d.text.split('\f');
  if (pages.at(-1) === '') pages.pop();
  const chunks = chunkDocument({ sourceId: d.sourceId, citySlug: d.city, sha256: d.sha256,
    originalKey: d.originalKey, sourceUrl: d.sourceUrl, documentDate: extractDocumentHeaderDate(pages[0] ?? ''),
    pages: pages.map((text, i) => ({ page: i + 1, text })) });
  for (const chunk of chunks) {
    const key = `${d.id}--${chunk.id}`;
    let request: any;
    let result: any;
    try {
      const accepted = await extractRefreshProfile([chunk], { context, singlePassPrompt: prompt, maxOutputTokens: 32768,
        outputDir: `${runtime}/validation/${key}`, textClient: { mode: 'seat', provider: 'openai', model: model.model,
          async generateJson(input: any) {
            request = { document: d.id, blind: d.blind, chunk, schema: input.schema, prompt: input.prompt,
              maxOutputTokens: input.maxOutputTokens };
            if (mode === 'prepare') throw new Error('capture-only');
            const captured = json(`${home}/requests/${key}.json`);
            assert.equal(hash(input.prompt), hash(captured.prompt));
            assert.equal(hash(input.schema), hash(captured.schema));
            result = load(`${home}/responses/${key}`, d.blind).result;
            if (result.code !== 0 || result.toolEvents || result.errorEnvelope) throw new Error('seat-failure');
            input.validateResponse(result.text);
            fs.writeFileSync(input.outputPath, result.text);
            return { status: 'completed', outputPath: input.outputPath };
          } } });
      let v9Accepted = true, v9Error = null;
      try { v9.validatedExtraction(JSON.stringify(accepted[0].extraction), chunk, v9Context, v9.physicalPageTexts(chunk)); }
      catch (error) { v9Accepted = false; v9Error = String(error); }
      save(`${home}/validated/${key}`, { accepted: v9Accepted, nativeAccepted: true, v9Accepted, v9Error, result: accepted[0] }, d.blind);
    } catch (error) {
      if (mode === 'validate') save(`${home}/validated/${key}`, { accepted: false,
        error: String(error), result: null }, d.blind);
    } finally {
      fs.rmSync(`${runtime}/validation/${key}`, { recursive: true, force: true });
    }
    assert(request, 'production must reach generateJson');
    const input = `${request.prompt}\n\nSchema: ${request.schema}`;
    const proof = { key, document: d.id, blind: d.blind, chunkId: chunk.id, pages: chunk.pages,
      promptSha256: hash(request.prompt), schemaSha256: hash(request.schema), inputSha256: hash(input) };
    if (mode === 'prepare') write(`${home}/requests/${key}.json`, { ...request, input, ...proof });
    proofs.push(proof); requests.push({ key, document: d.id, blind: d.blind, inputSha256: hash(input) });
  }
}
if (mode === 'prepare') {
  const paths = ['api/src/services/graph/refresh-profile.ts', 'api/src/services/graph/refresh-corpus.ts',
    'api/src/services/graph/refresh-single-pass.ts', 'radar/ontology/ontology-profile.yaml'];
  write(`${dir}/freeze.json`, { at: new Date().toISOString(), productionPromptSha256: prompt.sha256,
    model, concurrency: 10, quotaStop: 90, contract: REFRESH_PROFILE_CONTRACT_VERSION,
    sourceHashes: Object.fromEntries(paths.map((p) => [p, hash(fs.readFileSync(`/workspace/${p}`))])),
    documentCount: docs.length, chunkCount: proofs.length, requestManifestSha256: hash(JSON.stringify(proofs)),
    example: proofs.find((p) => !p.blind), metrics: ['detection/B', 'visible/B', 'P_union_S/B'],
    matching: 'inherited frozen matcher; one-to-one groups', blind: 'one shot; sealed; aggregate only',
    surface: 'production extractRefreshProfile generateJson boundary -> isolated Codex CLI seat; no mesh fallback',
    chunker: 'production module, export-only instrumentation; cached PDF text verified against v101b',
    dates: 'production PDF header date extraction; no remote sidecar or ingestion date' });
  write(`${home}/request-manifest.json`, requests);
  write(`${home}/proofs.json`, proofs);
}
console.log(JSON.stringify({ mode, documents: docs.length, chunks: proofs.length, contract: REFRESH_PROFILE_CONTRACT_VERSION }));
