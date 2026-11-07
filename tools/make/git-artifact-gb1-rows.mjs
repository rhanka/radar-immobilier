// Prints artifact-build/gb1-qualification.json for a lockfile (default: the
// repository package-lock.json). Node 24 strips the types of the imported
// TypeScript module; no dependency is installed or executed.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gb1Qualification } from '../../packages/artifacts-host/src/git-mode/gb1-qualification.ts';

const bytes = readFileSync(process.argv[2] ?? 'package-lock.json');
const sha256Hex = (data) => createHash('sha256').update(data).digest('hex');
process.stdout.write(`${JSON.stringify(gb1Qualification(new Uint8Array(bytes), sha256Hex), null, 2)}\n`);
