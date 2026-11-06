# Immo A1 registry values for git-backed artifacts

Host-administered registry entry for `rhanka/radar-immobilier` (G0 v3 §2.1,
§3.1, §7.1), recorded here for the sentropic server-side builder and commit
port. It is configuration of the host registry, not a tool argument, and no
workflow of this repository enforces it: the sentropic port refuses a path
before any forge call, and the sandbox builder builds only commits inside it.

## Entry

```ts
{
  locator: 'rhanka/radar-immobilier',
  branchPrefix: 'artifact/',
  allowedSubPaths: [''],              // root binding; UI imports the workspaces
  writablePaths: [
    'ui/**',
    'packages/radar-domain/src/**',
    'packages/radar-scoring/src/**',
    'packages/radar-sources/src/**',
  ],
  refusedWritePaths: [
    '.github/**',
    'deploy/**',
    'api/**',
    '.track/**',
    'packages/immo-mcp/**',           // MCP server code; never imported by the UI
    'package*.json',                  // root and every subtree: package.json, package-lock.json
    '**/package*.json',
  ],
  publicationPolicy: {
    personalBranchPrefix: 'artifact/p/', // artifact/p/<id8-principal>/<slug>-<id8>
    sharedPublishers: [],
    delegatedPublication: 'personal-only',
  },
}
```

A denial always wins over an allow match. The UI imports `@radar/domain`,
`@radar/scoring` and `@radar/sources`, never `@radar/immo-mcp`, hence the
three workspace `src/**` subtrees and nothing else under `packages/`.

## Generic denials that also apply (G0 v3 §3.1)

- traversal, `.`/`..` segments, absolute paths;
- `.git/**`;
- environment and key files (`.env*`, private keys);
- the descriptor `outputDir` subtree, `ui/dist/**`;
- symlinks and other path aliases.

Recommended addition for the builder: refuse `.npmrc` and `.yarnrc*` at any
depth, so a branch cannot redirect the locked install of the closed recipe.

## Build recipe the builder runs

`sentropic.artifact.json` at the repository root (`subPath=''`):
1. `npm ci` at the root lockfile, install scripts off;
2. `npm run build:artifact` at the root;
3. output `ui/dist`.

Measured closure (2026-11-05, `make -f tools/make/git-artifact.mk proof`):
- 19 lockfile packages declare an install script, all from the `api` workspace
  closure (`@sentropic/engram`, `tree-sitter-*`, `tesseract.js`) or dev tooling
  (`esbuild`, `fsevents`);
- the artifact build needs none of them, so the postinstall allowlist for the
  artifact build is empty;
- enabling scripts would require `node-gyp` and Python (`tree-sitter-lua`).
