import { readFileSync, writeFileSync } from 'node:fs';
// Exercise installed runtime code; the mounted modules are test probes only.
await import('./a4-image-probe.mjs');
const path = '/evidence/image-proof.json';
const receipt = JSON.parse(readFileSync(path));
receipt.imageSource = process.env.GIT_SHA;
writeFileSync(path, JSON.stringify(receipt, null, 2));
