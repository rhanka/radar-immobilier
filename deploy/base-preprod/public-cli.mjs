/* global Buffer, URL, process */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runCdpQualification } from './cdp-probe.mjs';
export function probeConfig(input, phase) {
  const binding = input?.binding;
  const citySlug = input?.qualification?.citySlug ?? 'salaberry-de-valleyfield';
  const releaseSha = binding?.releaseId?.split(/[:/]/)[0];
  if (input?.namespace !== 'radar-immobilier-preprod' || !['preflight', 'q1', 'q2'].includes(phase)
    || !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(binding?.workspaceId ?? '')
    || typeof binding?.actorSub !== 'string' || !binding.actorSub.length || binding.actorSub.length > 512
    || !/^[a-f0-9]{40}$/.test(releaseSha ?? '') || !/^[a-z0-9-]{1,128}$/.test(citySlug)) throw new Error('invalid_probe_input');
  return { origin: 'https://preprod.immo.sent-tech.ca', phase, workspaceId: binding.workspaceId,
    actorSub: binding.actorSub, releaseSha, citySlug };
}
async function main() {
  let receipt;
  try {
    const raw = readFileSync(0, 'utf8');
    if (Buffer.byteLength(raw) > 1048576) throw new Error('invalid_probe_input');
    const config = probeConfig(JSON.parse(raw), process.argv[2]);
    const cases = JSON.parse(readFileSync(new URL('public-checks.json', import.meta.url), 'utf8'));
    receipt = await runCdpQualification(config, cases);
  } catch { receipt = { passed: false, error: 'invalid_probe_input', ownedTargetClosed: false }; }
  process.stdout.write(JSON.stringify(receipt) + '\n');
  if (receipt.passed !== true) process.exitCode = 2;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
