#!/usr/bin/env bash
# Runs only inside the verification container, after a green baseline.
set -euo pipefail
cd /workspace/api
source_dir=src/services/facets/lot-migration-report
mutant_dir=src/services/facets/lot-migration-report-mutant
cp -a "$source_dir" "$mutant_dir"
cp "$mutant_dir/diagnose.ts" /workspace/diagnose.pristine.ts
node --input-type=module <<'JS'
import { readFileSync, writeFileSync } from "node:fs";
const file = "src/services/facets/lot-migration-report-mutant/diagnose.ts";
const original = readFileSync(file, "utf8");
const altered = original.replace(/codes\.add\("(?!target-unresolved|destination-unqualified)[^"]+"\);/g, "void 0;");
if (altered === original) throw new Error("Mutation did not change conflict detection");
writeFileSync(file, altered);
JS
mutation_status=0
../node_modules/.bin/vitest run --config vitest.isolated.config.ts "$mutant_dir" \
  --exclude '**/source-db.test.ts' > /evidence/mutation.log 2>&1 || mutation_status=$?
test "$mutation_status" -eq 1
grep -q 'AssertionError' /evidence/mutation.log
grep -q 'integrity.test.ts' /evidence/mutation.log
grep -q 'contract.test.ts' /evidence/mutation.log
cp /workspace/diagnose.pristine.ts "$mutant_dir/diagnose.ts"
cmp /workspace/diagnose.pristine.ts "$mutant_dir/diagnose.ts"
cmp "$source_dir/diagnose.ts" "$mutant_dir/diagnose.ts"
echo "Mutation exit=$mutation_status; restored copy cmp=0; production cmp=0" | tee /evidence/mutation-identity.log
../node_modules/.bin/vitest run --config vitest.isolated.config.ts "$mutant_dir" \
  --exclude '**/source-db.test.ts' > /evidence/mutation-restored.log 2>&1
rm -rf "$mutant_dir"
