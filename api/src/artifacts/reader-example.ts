/**
 * Minimal connected technical example (ARTEFACTS A6/H5, D2 default).
 *
 * A static page served only to authorized readers. It calls the named
 * reader operations with the grant passed out-of-band (never a ticket in
 * the URL) and renders synthetic Geo + protected signals. No publisher or
 * MCP credential appears in these bytes.
 */
export const READER_EXAMPLE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Artifact reader example</title>
</head>
<body>
<main>
<h1>Artifact reader example</h1>
<p data-testid="reader-status">Loading authorized content…</p>
<section><h2>Public geography</h2><pre data-testid="geo-output">[]</pre></section>
<section><h2>Protected signals</h2><pre data-testid="signals-output">[]</pre></section>
</main>
<script>
(async () => {
  const params = new URLSearchParams(location.search);
  const grant = params.get("grant");
  history.replaceState(null, "", location.pathname);
  const status = document.querySelector('[data-testid="reader-status"]');
  if (!grant) {
    status.textContent = "Missing reader grant.";
    return;
  }
  const headers = { "x-preview-grant": grant };
  const geo = await fetch("/__reader/api/geo.read.v1?collectionId=qc-zonage-valleyfield&limit=2", { headers });
  document.querySelector('[data-testid="geo-output"]').textContent = JSON.stringify(await geo.json());
  const signals = await fetch("/__reader/api/signals.protected-read.v1?city=valleyfield", { headers });
  document.querySelector('[data-testid="signals-output"]').textContent = JSON.stringify(await signals.json());
  status.textContent = geo.ok && signals.ok ? "Connected." : "Reader call refused.";
})();
</script>
</body>
</html>
`;
