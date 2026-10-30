/* global URL, fetch */
// Synthetic, idempotent seed for the real-stack Playwright suite (6H).
//
// Runs inside the e2e runner container only (`node --import tsx`), against the
// compose project database of a `test-*` ENV. It reuses the API's own
// services (workspace init, history attachment, scoped activation, session
// signer) so the suite exercises the real authorization path. Nothing here is
// a credential: the session secret is a test-only literal shared with the API
// container by docker-compose.e2e.yml.
//
//   node --import tsx ui/e2e-real/seed.mjs           seed + storage states
//   node --import tsx ui/e2e-real/seed.mjs --verify  read back through the API
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { loadConfig } from "../../api/src/config.ts";
import { createDb } from "../../api/src/db/client.ts";
import { accountUsers, graphNodes } from "../../api/src/db/schema.ts";
import { initializeWorkspaceStore } from "../../api/src/services/workspaces/init-store.ts";
import { attachPersonalHistory } from "../../api/src/services/facets/attachment.ts";
import { runPersonalAttachmentActivation } from "../../api/src/services/facets/activation-run.ts";
import { requireScopedEpochFor } from "../../api/src/services/facets/activation.ts";
import { signSession } from "../../api/src/services/auth/session.ts";
import { classifyGraphNodeVivierV2 } from "../../api/src/services/graph/graph-store.ts";

const STATE_DIR = process.env.E2E_STATE_DIR ?? "/e2e-state";
const SESSION_SECRET = process.env.E2E_SESSION_SECRET ?? "";
const UI_BASE = process.env.PLAYWRIGHT_UI_BASE_URL ?? "http://localhost:8080";
const API_BASE = process.env.PLAYWRIGHT_API_BASE_URL ?? "http://api:3000";
const CITY = "salaberry-de-valleyfield";
const WORKSPACE_SLUG = "e2e-synthetic-workspace";

const PEOPLE = {
  admin: { id: "0e2e0000-0000-4000-8000-000000000001", sub: "e2e-synthetic-admin",
    email: "e2e-admin@example.test", name: "E2E Synthetic Admin", isAdmin: true },
  member: { id: "0e2e0000-0000-4000-8000-000000000002", sub: "e2e-synthetic-member",
    email: "e2e-member@example.test", name: "E2E Synthetic Member", isAdmin: false },
  outsider: { id: "0e2e0000-0000-4000-8000-000000000003", sub: "e2e-synthetic-outsider",
    email: "e2e-outsider@example.test", name: "E2E Synthetic Outsider", isAdmin: false },
};

// Synthetic signals: explicit residential rezoning content so the server
// vivier_v2 classifier qualifies them for the default B view (asserted below).
const SIGNALS = [
  { id: "e2e-signal-1", label: "E2E rezonage résidentiel multifamilial zone H-901",
    props: { properties: { category: "rezonage", etape: "avis_motion", nb_unites_max: "12",
      zone_ref: "H-901", reglement_number: "901-01", residentiel: "oui",
      description: "Avis de motion : rezonage de la zone H-901 pour habitations multifamiliales de 12 logements." } } },
  { id: "e2e-signal-2", label: "E2E rezonage résidentiel densification zone H-902",
    props: { properties: { category: "rezonage", etape: "projet_reglement", nb_unites_max: "8",
      zone_ref: "H-902", reglement_number: "901-02", residentiel: "oui",
      description: "Projet de règlement : densification résidentielle de la zone H-902, 8 logements." } } },
  { id: "e2e-signal-3", label: "E2E rezonage résidentiel habitation zone H-903",
    props: { properties: { category: "rezonage", etape: "avis_motion", nb_unites_max: "6",
      zone_ref: "H-903", reglement_number: "901-03", residentiel: "oui",
      description: "Avis de motion : modification de zonage pour habitations de 6 logements en zone H-903." } } },
];

function fail(message) {
  console.error(`[e2e-seed] ${message}`);
  process.exit(1);
}

async function cookieFor(sub) {
  return signSession({ sub }, { sessionSecret: SESSION_SECRET, ttlSeconds: 4 * 3600 });
}

function storageState(token) {
  const host = new URL(UI_BASE).hostname;
  return { cookies: [{ name: "radar_session", value: token, domain: host, path: "/",
    expires: Math.floor(Date.now() / 1000) + 4 * 3600, httpOnly: true, secure: false, sameSite: "Lax" }],
  origins: [] };
}

async function seed() {
  if (SESSION_SECRET.length < 16) fail("E2E_SESSION_SECRET is missing");
  const config = loadConfig();
  if (!/^radar$|^radar_/.test(config.POSTGRES_DB) || config.POSTGRES_HOST !== "postgres") {
    fail("refusing to seed outside the compose test database");
  }
  const { db, pool } = createDb(config);
  try {
    for (const person of Object.values(PEOPLE)) {
      await db.insert(accountUsers).values({ id: person.id, sub: person.sub, email: person.email,
        name: person.name, status: "approved", isAdmin: person.isAdmin, approvedAt: new Date(),
        approvedBy: "e2e-seed" }).onConflictDoNothing({ target: accountUsers.sub });
    }
    const init = await initializeWorkspaceStore(db, {
      workspaceSlug: WORKSPACE_SLUG, workspaceLabel: "E2E synthetic workspace",
      approvedAccountIds: [PEOPLE.admin.id, PEOPLE.member.id],
      managerAccountIds: [PEOPLE.admin.id], moderatorAccountIds: [PEOPLE.admin.id],
      actorAccountId: PEOPLE.admin.id, reason: "e2e synthetic initialization",
    });
    const workspaceId = init.workspaceId;
    const opened = await requireScopedEpochFor(db, workspaceId).then(() => true, () => false);
    if (!opened) {
      await attachPersonalHistory(db, { actorAccountId: PEOPLE.admin.id, reason: "e2e synthetic attachment",
        entries: [{ accountId: PEOPLE.admin.id, workspaceId }, { accountId: PEOPLE.member.id, workspaceId }] });
      // Synthetic database only: no service drains, so the safety hooks are no-ops.
      await runPersonalAttachmentActivation(db, { workspaceId, actorSub: PEOPLE.admin.sub,
        reason: "e2e synthetic activation" }, { drain: async () => {}, readback: async () => {} });
    }
    for (const signal of SIGNALS) {
      await db.insert(graphNodes).values({ id: signal.id, type: "Signal", citySlug: CITY,
        label: signal.label, props: signal.props, sourceRef: `e2e/${signal.id}` }).onConflictDoNothing();
      const classification = classifyGraphNodeVivierV2({ id: signal.id, type: "Signal",
        category: signal.props.properties.category, label: signal.label,
        description: signal.props.properties.description, etapeAnnote: signal.props.properties.etape,
        props: signal.props, sourceRef: `e2e/${signal.id}` });
      if (classification.exclusion_reason !== null || classification.zonage.valeur !== "oui"
        || classification.residentiel.valeur === "non") {
        fail(`seeded signal ${signal.id} is not qualified for the B view: ${JSON.stringify(classification)}`);
      }
    }
    // Geo rows read by the géo view (zones + lots with geometry).
    for (const [index, code] of ["H-901", "H-902"].entries()) {
      const x = -74.13 + index * 0.01;
      await db.execute(sql`INSERT INTO zone_versions (canonical_id, city_slug, code_affiche, kind,
        valid_from, known_from, geom, geom_source, raw_ref, code_norm)
        SELECT ${`e2e-zone-${code}`}, ${CITY}, ${code}, 'zonage', DATE '2026-01-01', now(),
          ST_SetSRID(ST_GeomFromText(${`POLYGON((${x} 45.25, ${x + 0.008} 45.25, ${x + 0.008} 45.258, ${x} 45.258, ${x} 45.25))`}), 4326),
          'e2e-synthetic', ${`e2e/zone/${code}`}, ${code}
        WHERE NOT EXISTS (SELECT 1 FROM zone_versions WHERE canonical_id = ${`e2e-zone-${code}`})`);
      await db.execute(sql`INSERT INTO lot_versions (canonical_id, no_lot, city_slug, valid_from,
        known_from, geom, geom_source, raw_ref, no_lot_norm)
        SELECT ${`e2e-lot-${index}`}, ${`9 900 00${index}`}, ${CITY}, DATE '2026-01-01', now(),
          ST_SetSRID(ST_GeomFromText(${`POLYGON((${x} 45.251, ${x + 0.002} 45.251, ${x + 0.002} 45.253, ${x} 45.253, ${x} 45.251))`}), 4326),
          'e2e-synthetic', ${`e2e/lot/${index}`}, ${`990000${index}`}
        WHERE NOT EXISTS (SELECT 1 FROM lot_versions WHERE canonical_id = ${`e2e-lot-${index}`})`);
    }
    mkdirSync(STATE_DIR, { recursive: true });
    for (const [role, person] of Object.entries(PEOPLE)) {
      writeFileSync(join(STATE_DIR, `${role}.json`), JSON.stringify(storageState(await cookieFor(person.sub))));
    }
    writeFileSync(join(STATE_DIR, "seed.json"), JSON.stringify({ city: CITY, workspaceId,
      signals: SIGNALS.map(({ id, label }) => ({ id, label })),
      people: Object.fromEntries(Object.entries(PEOPLE).map(([role, p]) => [role, { email: p.email, name: p.name }])),
      zones: 2, lots: 2 }, null, 2));
    console.log(`[e2e-seed] seeded workspace ${workspaceId}, ${SIGNALS.length} signals in ${CITY}`);
  } finally {
    await pool.end();
  }
}

async function verify() {
  const seedFile = JSON.parse(readFileSync(join(STATE_DIR, "seed.json"), "utf8"));
  const member = JSON.parse(readFileSync(join(STATE_DIR, "member.json"), "utf8")).cookies[0].value;
  const read = async (path) => {
    const res = await fetch(`${API_BASE}${path}`, { headers: { cookie: `radar_session=${member}` } });
    const body = await res.json().catch(() => null);
    if (!res.ok) fail(`${path} answered ${res.status} ${JSON.stringify(body)}`);
    return body;
  };
  const workspaces = await read("/api/v1/workspaces");
  if (workspaces.workspaces.length !== 1 || workspaces.workspaces[0].workspace.id !== seedFile.workspaceId) {
    fail("the seeded member does not resolve exactly the seeded workspace");
  }
  const base = `/api/v1/workspaces/${seedFile.workspaceId}/signal-facets`;
  const city = await read(`${base}/coherent-city?citySlug=${seedFile.city}&mode=signal`);
  if (city.signals.length !== seedFile.signals.length) fail(`coherent-city served ${city.signals.length} signals`);
  if (city.signals.some((node) => node.classification === undefined)) fail("coherent-city served no classification");
  const byCity = await read(`${base}/by-city`);
  const count = byCity.cities.find((row) => row.citySlug === seedFile.city)?.signalCount;
  if (count !== seedFile.signals.length) fail(`by-city counted ${count}`);
  console.log("[e2e-seed] scoped read-back verified (workspaces, coherent-city, by-city)");
}

const verifyOnly = process.argv.includes("--verify");
await (verifyOnly ? verify() : seed());
