// In-pod READ-ONLY dry run of the Chaperon triage reprise. Serialized with
// Function#toString and piped to `node --input-type=module -` inside radar-api,
// so it must stay self-contained (no module-scope references) and only uses the
// pod's own `pg`. One REPEATABLE READ READ ONLY transaction, always rolled back.
//
// Insert-only (owner decision 2026-11-12): for each account, a target that
// already carries a facet head of that account is never superseded: `noop` when
// that head was written by this reprise (same UUIDv5 command key as
// api/src/scripts/chaperon-reprise-apply.ts), otherwise `skipExisting` (listed).
/* global console, process, Buffer */
export async function podDryRun(PLAN) {
  const { createRequire } = await import('node:module');
  const { createHash } = await import('node:crypto');
  const pg = createRequire('/workspace/api/package.json')('pg');
  if (!/^https:\/\/preprod\./.test(process.env.APP_BASE_URL || '')) throw new Error('refused: not the preprod radar-api');
  const canonicalJson = (v) => Array.isArray(v) ? `[${v.map(canonicalJson).join(',')}]`
    : v !== null && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(',')}}`
      : JSON.stringify(v);
  const digest = (v) => createHash('sha256').update(canonicalJson(v)).digest('hex');
  const fingerprint = (n) => { const props = { ...n.props }; delete props.community; delete props.community_name;
    return digest({ type: n.type, label: n.label, source_ref: n.source_ref, props }); };
  const uuidV5 = (name) => { const ns = Buffer.from(PLAN.keyNamespace.replace(/-/g, ''), 'hex');
    const h = createHash('sha1').update(Buffer.concat([ns, Buffer.from(name, 'utf8')])).digest();
    h[6] = (h[6] & 0x0f) | 0x50; h[8] = (h[8] & 0x3f) | 0x80; const x = h.subarray(0, 16).toString('hex');
    return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`; };
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const c = new pg.Client({ host: process.env.POSTGRES_HOST, port: Number(process.env.POSTGRES_PORT),
    user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD, database: process.env.POSTGRES_DB });
  await c.connect();
  const out = { mode: 'dry-run', insertOnly: true };
  try {
    await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await c.query("SET LOCAL statement_timeout = '60s'");
    const one = async (sql, args = []) => (await c.query(sql, args)).rows;
    [out.database] = await one("SELECT current_database() AS database, current_setting('transaction_read_only') AS read_only");
    const [ws] = await one('SELECT id, slug FROM workspaces WHERE slug = $1', [PLAN.workspaceSlug]);
    if (!ws) throw new Error('workspace not found');
    out.workspace = ws;
    [out.activation] = await one(`SELECT writer_epoch, maintenance_barrier, old_index_dropped
      FROM facet_activation_state WHERE workspace_id = $1`, [ws.id]);
    const members = await one(`SELECT m.account_id, m.status, u.status AS account_status, split_part(u.email, '@', 2) AS domain,
      a.status AS attachment, a.workspace_id = m.workspace_id AS attached_here
      FROM workspace_memberships m JOIN account_users u ON u.id = m.account_id
      LEFT JOIN facet_stream_attachments a ON a.account_id = m.account_id WHERE m.workspace_id = $1`, [ws.id]);
    const wanted = PLAN.ownerAccountIds.length ? PLAN.ownerAccountIds
      : members.filter((m) => m.domain === PLAN.ownerEmailDomain).map((m) => m.account_id);
    if (wanted.length === 0) throw new Error('no owner account');
    const owners = wanted.map((id) => {
      const m = members.find((entry) => entry.account_id === id);
      return { accountId: id, approved: m?.account_status === 'approved', member: m?.status === 'active',
        attachedHere: m?.attachment === 'attached' && m?.attached_here === true };
    });

    const codes = new Map((await one('SELECT code, verdict FROM facet_reason_codes WHERE profile_id = $1', [PLAN.profile]))
      .map((r) => [r.code, r.verdict]));
    out.reasonCodes = { profile: PLAN.profile, inProfile: codes.size, used: new Set(PLAN.targets.map((t) => t.reasonCode)).size,
      mismatched: PLAN.targets.filter((t) => codes.get(t.reasonCode) !== t.verdict).map((t) => ({ row: t.row, code: t.reasonCode })) };

    // Matching: exact id, then stable key (city, document rawRef, page, normalized citation, id-stem tie-break).
    const nodes = await one(`SELECT id, city_slug, type, label, source_ref, props FROM graph_nodes
      WHERE id = ANY($1) AND type IN ('Signal', 'DesignationEvent')`, [PLAN.targets.map((t) => t.nodeId)]);
    const byId = new Map(); for (const n of nodes) byId.set(n.id, [...(byId.get(n.id) || []), n]);
    const refsOf = (n) => (Array.isArray(n.props?.refs) ? n.props.refs : []);
    const citySlugs = new Set((await one("SELECT DISTINCT city_slug FROM graph_nodes WHERE type IN ('Signal', 'DesignationEvent')")).map((r) => r.city_slug));
    const match = { exact: 0, exactSameDocument: 0, exactOtherDocument: [], byKey: 0, byKeySameId: 0, ambiguous: [], notFound: [] };
    const resolved = [];
    const lcp = (a, b) => { let i = 0; while (i < a.length && a[i] === b[i]) i += 1; return i; };
    for (const t of PLAN.targets) {
      const all = byId.get(t.nodeId) || [];
      const exact = all.filter((n) => n.city_slug === t.citySlugHint || all.length === 1);
      if (!PLAN.keyOnly && exact.length === 1) {
        const docs = refsOf(exact[0]).map((r) => r.rawRef);
        match.exact += 1;
        if (t.rawRefs.length === 0 || docs.some((d) => t.rawRefs.includes(d))) match.exactSameDocument += 1;
        else match.exactOtherDocument.push({ row: t.row, nodeRawRef: docs.some(Boolean) ? 'different' : 'absent' });
        resolved.push({ t, n: exact[0], how: 'exact' }); continue;
      }
      const stem = t.nodeId.replace(/^(signal|event)-/, '');
      const city = citySlugs.has(t.citySlugHint) ? t.citySlugHint
        : [...citySlugs].filter((s) => stem.startsWith(`${s}-`)).sort((a, b) => b.length - a.length)[0];
      let candidates = !city || t.rawRefs.length === 0 ? [] : await one(`SELECT id, city_slug, type, label, source_ref, props FROM graph_nodes g
        WHERE city_slug = $1 AND type IN ('Signal', 'DesignationEvent') AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(g.props->'refs') = 'array' THEN g.props->'refs' ELSE '[]'::jsonb END) r
          WHERE r->>'rawRef' = ANY($2))`, [city, t.rawRefs]);
      if (city && candidates.length === 0) {
        candidates = await one(`SELECT id, city_slug, type, label, source_ref, props FROM graph_nodes
          WHERE city_slug = $1 AND type IN ('Signal', 'DesignationEvent')`, [city]);
      }
      const keyed = candidates.filter((n) => refsOf(n).some((r) => {
        const q = norm(r.citation || r.excerpt).slice(0, 80);
        return q.length >= 20 && t.citations.some((seg) => (seg.page === null || Number(r.page) === seg.page)
          && seg.norm.length >= 20 && (q.startsWith(seg.norm) || seg.norm.startsWith(q)));
      }));
      const best = Math.max(-1, ...keyed.map((n) => lcp(n.id, t.nodeId)));
      const top = keyed.filter((n) => lcp(n.id, t.nodeId) === best);
      if (top.length === 1) { match.byKey += 1; if (top[0].id === t.nodeId) match.byKeySameId += 1; resolved.push({ t, n: top[0], how: 'key' }); }
      else if (top.length > 1) match.ambiguous.push({ row: t.row, nodeId: t.nodeId, candidates: top.length });
      else match.notFound.push({ row: t.row, nodeId: t.nodeId });
    }
    out.match = { targets: PLAN.targets.length, ...match };
    out.targets = resolved.map(({ t, n, how }) => ({ row: t.row, citySlug: n.city_slug, type: n.type, id: n.id, how,
      verdict: t.verdict, reasonCode: t.reasonCode, fingerprint: fingerprint(n) }));

    // Per account: existing heads on each target decide insert / noop / skipExisting.
    out.accounts = [];
    for (const owner of owners) {
      const [unresolved] = await one(`SELECT count(*)::int AS n FROM facet_events e
        LEFT JOIN facet_event_bindings b ON b.event_id = e.id WHERE e.owner_id = $1 AND b.event_id IS NULL`, [owner.accountId]);
      const heads = await one(`SELECT s.city_slug, s.node_type, s.node_id, s.facet, s.basket, e.state, e.reason_code, e.command_key
        FROM facet_streams s JOIN facet_heads h ON h.stream_id = s.id JOIN facet_events e ON e.id = h.event_id
        WHERE s.workspace_id = $1 AND s.scope = 'personal' AND s.owner_id = $2 AND s.target_type = 'signal'`, [ws.id, owner.accountId]);
      const byTarget = new Map();
      for (const h of heads) { const k = JSON.stringify([h.city_slug, h.node_type, h.node_id]); byTarget.set(k, [...(byTarget.get(k) || []), h]); }
      const plan = { insert: 0, noop: 0, skipExisting: [] };
      const perVerdict = { pertinent: 0, a_surveiller: 0, archive: 0 }; const cities = new Set();
      for (const t of out.targets) {
        const existing = byTarget.get(JSON.stringify([t.citySlug, t.type, t.id])) || [];
        const facet = t.verdict === 'non_pertinent' ? 'archive' : 'selection';
        const basket = facet === 'selection' ? t.verdict : null;
        if (existing.length === 0) {
          plan.insert += 1; perVerdict[facet === 'archive' ? 'archive' : basket] += 1; cities.add(t.citySlug); continue;
        }
        const key = uuidV5(JSON.stringify([ws.id, owner.accountId, t.citySlug, t.type, t.id, facet, basket, t.reasonCode]));
        if (existing.length === 1 && existing[0].command_key === key) plan.noop += 1;
        else plan.skipExisting.push({ row: t.row, id: t.id, existing: existing.map((h) => `${h.facet}/${h.basket ?? '-'}/${h.state}`) });
      }
      const [before] = await one(`SELECT
        (SELECT count(*)::int FROM facet_streams WHERE workspace_id = $1 AND owner_id = $2) AS facet_streams,
        (SELECT count(*)::int FROM facet_events WHERE owner_id = $2) AS facet_events,
        (SELECT count(*)::int FROM facet_event_bindings b JOIN facet_streams s ON s.id = b.stream_id WHERE s.workspace_id = $1 AND s.owner_id = $2) AS facet_event_bindings,
        (SELECT count(*)::int FROM facet_heads h JOIN facet_streams s ON s.id = h.stream_id WHERE s.workspace_id = $1 AND s.owner_id = $2) AS facet_heads,
        (SELECT count(*)::int FROM facet_commands WHERE owner_id = $2) AS facet_commands,
        (SELECT count(*)::int FROM facet_command_contexts WHERE workspace_id = $1 AND owner_id = $2) AS facet_command_contexts,
        (SELECT count(*)::int FROM personal_projection_revisions WHERE workspace_id = $1 AND owner_id = $2) AS personal_projection_revisions`,
      [ws.id, owner.accountId]);
      const ppr = new Set((await one('SELECT city_slug FROM personal_projection_revisions WHERE workspace_id = $1 AND owner_id = $2',
        [ws.id, owner.accountId])).map((r) => r.city_slug));
      const newCities = [...cities].filter((city) => !ppr.has(city)).length;
      const add = (k, n) => before[k] + n;
      out.accounts.push({ ...owner, unresolvedHistory: unresolved.n,
        writable: owner.approved && owner.member && owner.attachedHere && unresolved.n === 0,
        plan, expectedReadback: { cities: cities.size, ...perVerdict },
        counts: { before, expectedAfter: { facet_streams: add('facet_streams', plan.insert), facet_events: add('facet_events', plan.insert),
          facet_event_bindings: add('facet_event_bindings', plan.insert), facet_heads: add('facet_heads', plan.insert),
          facet_commands: add('facet_commands', plan.insert), facet_command_contexts: add('facet_command_contexts', plan.insert),
          personal_projection_revisions: add('personal_projection_revisions', newCities) } } });
    }
    out.writable = out.activation?.writer_epoch === 'scoped' && out.activation.maintenance_barrier === false
      && out.accounts.every((a) => a.writable) && out.reasonCodes.mismatched.length === 0;
  } finally {
    await c.query('ROLLBACK').catch(() => {});
    await c.end();
  }
  console.log(JSON.stringify(out));
}
