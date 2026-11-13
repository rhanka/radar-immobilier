const r = require('./runtime.cjs');
try {
  const data = JSON.parse(r.fs.readFileSync(0, 'utf8'));
  if (data.database !== 'radar' || r.prefix(data.migrations) !== 13) r.fail('expected_production_prefix_13');
  process.stdout.write(`${JSON.stringify({ database: data.database, bytes: data.bytes,
    migrations: data.migrations.length, roles: data.roles, prefixVerified: true })}\n`);
} catch { process.stderr.write('production_inventory_refused\n'); process.exitCode = 1; }
