---
name: ingest-test
description: Run a source adapter against fixture data and verify the extracted output
paths: "packages/radar-sources/**"
allowed-tools: Read Bash Grep
---

# Ingest Test

Skill to quickly validate that a source adapter:
1. Fetches successfully (live or against a fixture).
2. Produces the expected canonical raw document shape.
3. Yields the expected extracted fields when fed through the LLM extractor.

## Steps

1. **Identify the adapter**
   Path: `packages/radar-sources/src/sources/<adapter-name>/`.

2. **Run the adapter test suite**
   ```bash
   make test-api SCOPE=packages/radar-sources/tests/<adapter-name>.spec.ts ENV=test-<slug>
   ```

3. **Live smoke (optional, opt-in)**
   ```bash
   make ingest-smoke SOURCE=<adapter-name> LIMIT=3 ENV=dev
   ```
   This runs the adapter against the live source, writes raw payloads to MinIO (local) under `raw-smoke/`, and prints the extracted fields. Cleans up after.

4. **Verify the output**
   - Raw payload present in MinIO (`mc ls dev/raw-smoke/<adapter-name>/`).
   - Extracted fields match expected shape (see `packages/radar-domain/src/schemas/<kind>.v1.ts`).
   - Confidence scores are non-zero on the LLM extraction.

5. **Report**
   - Adapter: `<name>`.
   - Documents fetched: `N`.
   - Documents extracted: `N`.
   - Extraction confidence avg: `X.XX`.
   - Anomalies observed: list (missing field, low confidence, parse error).

## Rules

- The `ingest-smoke` target is opt-in: it hits the live source. Do not run repeatedly during dev — use fixtures.
- Smoke output is namespaced under `raw-smoke/` to keep it separated from production data.
- Never run smoke against a paid source without explicit confirmation.
