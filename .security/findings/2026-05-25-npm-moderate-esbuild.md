# npm audit moderate findings — esbuild/vite toolchain

- **Severity**: medium
- **Detected**: 2026-05-25 during BR04
- **Command**: `make security-audit ENV=test-k8s-tenant`
- **Status**: accepted for BR04; follow-up dependency modernization needed

## Finding

After upgrading `drizzle-orm` to fix high advisory `GHSA-gpj5-g38j-94v9`,
`npm audit --audit-level=high` exits successfully but still reports moderate
findings through `esbuild <=0.24.2`.

Affected dependency paths include the Vite/Vitest/Svelte plugin toolchain and
`drizzle-kit` transitive dependencies. The npm suggested remediation requires
`npm audit fix --force` and would upgrade major toolchain packages, including
Vite, outside BR04's infra scope.

## Risk

The advisory concerns development-server exposure. BR04 production artifacts
are static UI assets and containerized API runtime; the vulnerable dev server
is not exposed by the K8s manifests.

## Follow-up

Schedule a dependency modernization branch to upgrade Vite/Vitest/Svelte
tooling and Drizzle Kit together, then remove this finding once
`npm audit` is clean at moderate level.
