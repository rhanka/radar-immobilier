import { readFileSync } from 'node:fs';
const report = JSON.parse(readFileSync(process.argv[2], 'utf8'));
if (!report.success || !report.testResults?.length) process.exit(1);
for (const suite of report.testResults) {
  const tests = suite.assertionResults ?? [];
  const passed = tests.filter(t => t.status === 'passed').length;
  const failed = tests.filter(t => t.status === 'failed').length;
  const skipped = tests.length - passed - failed;
  const path = suite.name.replace(/^.*\/api\//, '');
  console.log([path, passed, failed, skipped].join('\t'));
}
