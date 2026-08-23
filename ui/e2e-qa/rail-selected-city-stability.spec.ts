import { expect, test, type Page, type Route } from "@playwright/test";
import { mockAuthenticated } from "./_helpers";

/**
 * QA NAVIGATEUR — Rail Signaux : la ville SÉLECTIONNÉE ne disparaît JAMAIS
 * du rail (RED→GREEN).
 *
 * Bug PO (vue « Nouveau B ») : cliquer Notre-Dame-du-Bon-Conseil dans le rail
 * fait DISPARAÎTRE sa ligne. Régression de la garde anti-flicker #378 : le fix
 * m1.7 (`selectedCityLiveCount`) substitue le compte LIVE (axes + exclusions B
 * + plage de dates = 1) au compte bulk serveur (4) pour la ville sélectionnée —
 * et ce compte live participe au TRI et à la COUPE au plafond
 * (RAIL_CITY_LIST_MAX) de la liste :
 *   - la ligne SAUTE de sa position dès que le fetch détail aboutit
 *     (4 → 1 → re-tri sous toutes les villes ≥ 2) ;
 *   - au-delà du plafond, elle est COUPÉE de la liste — exactement l'éjection
 *     #378, désormais permanente tant que la ville reste sélectionnée.
 *
 * Contrat attendu :
 *   1. la ligne de la ville sélectionnée reste VISIBLE et À SA PLACE (tri par
 *      compte bulk, stable) pendant ET après le fetch détail ;
 *   2. le badge est HONNÊTE : « 1/4 » (1 signal affiché sur 4 au total) — pas
 *      « 4 » qui devient « 1 » sans explication.
 *
 * Aucun docker : vite preview + routes /api mockées. Slugs RÉELS du registre
 * QC_MUNICIPALITIES (les slugs inconnus sont écartés par buildCityMapEntries).
 */

const NDBC_SLUG = "notre-dame-du-bon-conseil--drummond";
const NDBC_NAME = "Notre-Dame-du-Bon-Conseil";

/**
 * 62 premiers slugs prioritaires du registre QC_MUNICIPALITIES (hors NDBC) :
 * assez pour dépasser RAIL_CITY_LIST_MAX (60) et prouver la coupe au plafond.
 */
const FILLER_SLUGS = [
  "westmount", "saint-lambert", "hampstead", "mont-royal", "montreal-ouest",
  "cote-saint-luc", "brossard", "sainte-catherine", "la-prairie", "delson",
  "candiac", "montreal-est", "boucherville", "dorval", "lile-dorval",
  "saint-constant", "saint-bruno-de-montarville", "carignan",
  "dollard-des-ormeaux", "pointe-claire", "saint-philippe", "saint-mathieu",
  "chateauguay", "sainte-julie", "saint-basile-le-grand", "chambly",
  "rosemere", "varennes", "kirkland", "bois-des-filion",
  "saint-isidore--roussillon", "beaconsfield", "lorraine", "lery", "mercier",
  "charlemagne", "boisbriand", "deux-montagnes", "mcmasterville",
  "sainte-therese", "saint-mathias-sur-richelieu", "saint-mathieu-de-beloeil",
  "saint-amable", "saint-remi", "otterburn-park", "saint-jacques-le-mineur",
  "richelieu", "beloeil", "baie-durfe", "sainte-marthe-sur-le-lac",
  "mascouche", "saint-eustache", "notre-dame-de-lile-perrot", "repentigny",
  "saint-edouard", "sainte-anne-de-bellevue", "saint-michel", "blainville",
  "pointe-calumet", "mont-saint-hilaire", "senneville", "marieville",
];

/** Date ISO (YYYY-MM-DD) à `monthsAgo` mois d'aujourd'hui, jour 15 (loin des bornes). */
function isoMonthsAgo(monthsAgo: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - monthsAgo);
  d.setDate(15);
  return d.toISOString().slice(0, 10);
}

/** Nœud Signal QUALIFIÉ vivier B (rezonage, avis de motion), daté explicitement. */
function signalNode(id: string, citySlug: string, etapeDate: string) {
  return {
    id,
    type: "Signal",
    label: id,
    citySlug,
    sourceRef: null,
    createdAt: null,
    props: { properties: { etape_date: etapeDate } },
    classification: {
      zonage: { valeur: "oui", source: "t", confiance: 0.9 },
      residentiel: { valeur: "oui", source: "t", confiance: 0.9 },
      effet_densifiant: "inconnu",
      instrument: "rezonage",
      etape: "avis_motion",
      etapes_historique: ["avis_motion"],
      exclusion_reason: null,
      provenance: { extrait: "" },
      confiance: 0.9,
    },
  };
}

/** Comptes v2 bulk serveur : `qualified` nœuds, tous à l'étape avis_motion. */
function bulkCounts(qualified: number) {
  return {
    qualified,
    residentialUnknown: 0,
    excludedByReason: {
      non_residentiel_franc: 0,
      piia_non_pertinent: 0,
      hors_zonage: 0,
      derogation_hors_sujet: 0,
    },
    stageCounts: {
      avis_motion: qualified,
      projet_reglement: 0,
      consultation_publique: 0,
      second_projet: 0,
      adoption: 0,
      entree_vigueur: 0,
      inconnu: 0,
    },
    stageCountsHorsZonage: {
      avis_motion: 0,
      projet_reglement: 0,
      consultation_publique: 0,
      second_projet: 0,
      adoption: 0,
      entree_vigueur: 0,
      inconnu: 0,
    },
    total: qualified,
  };
}

/**
 * NDBC : bulk serveur = 4 (tous qualifiés précoces), mais UN SEUL dans la plage
 * de dates par défaut (6 mois) — les 3 autres ont 9 mois. C'est l'écart
 * « rail 4 / détail 1 » rapporté par le PO : une lentille d'affichage (plage de
 * dates), pas des signaux perdus.
 */
const NDBC_NODES = [
  signalNode("ndbc-recent", NDBC_SLUG, isoMonthsAgo(1)),
  signalNode("ndbc-vieux-1", NDBC_SLUG, isoMonthsAgo(9)),
  signalNode("ndbc-vieux-2", NDBC_SLUG, isoMonthsAgo(9)),
  signalNode("ndbc-vieux-3", NDBC_SLUG, isoMonthsAgo(9)),
];

async function mockSignauxApi(
  page: Page,
  opts: { fillerSlugs: string[]; fillerQualified: number; detailDelayMs?: number },
): Promise<void> {
  await mockAuthenticated(page);
  // Enregistrées APRÈS le catch-all de mockAuthenticated → prioritaires.
  await page.route("**/api/graph-signals/by-city", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        totalCount: opts.fillerSlugs.length + 1,
        cities: [
          {
            citySlug: NDBC_SLUG,
            signalCount: 4,
            subsetCounts: {},
            vivierV2Counts: bulkCounts(4),
          },
          ...opts.fillerSlugs.map((slug) => ({
            citySlug: slug,
            signalCount: opts.fillerQualified,
            subsetCounts: {},
            vivierV2Counts: bulkCounts(opts.fillerQualified),
          })),
        ],
      }),
    }),
  );
  await page.route(`**/api/graph-signals/${NDBC_SLUG}`, async (route: Route) => {
    if (opts.detailDelayMs) {
      await new Promise((resolve) => setTimeout(resolve, opts.detailDelayMs));
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        citySlug: NDBC_SLUG,
        legacyProjection: null,
        nodes: NDBC_NODES,
      }),
    });
  });
}

function cityRows(page: Page) {
  return page.locator("button.rail-city-row");
}

function ndbcRow(page: Page) {
  return cityRows(page).filter({ hasText: NDBC_NAME });
}

function ndbcBadge(page: Page) {
  return ndbcRow(page).locator(".st-badge");
}

async function openVivierB(page: Page): Promise<void> {
  await page.goto("/#/signaux");
  // Le vivier B est la vue UNIQUE par défaut (bandeau à onglets retiré) : les
  // lignes du rail lisent directement `vivierV2Counts`, sans bascule d'onglet.
  await cityRows(page).first().waitFor({ state: "visible", timeout: 15_000 });
}

test.use({ viewport: { width: 1600, height: 900 } });

test.describe("Signaux — stabilité de la ville sélectionnée dans le rail", () => {
  test("1 — au-delà du plafond, la ville sélectionnée n'est JAMAIS coupée de la liste", async ({
    page,
  }) => {
    // 62 villes bulk=2 + NDBC bulk=4 : NDBC est 1re avant le clic. Sur le code
    // bogué, le fetch détail fait tomber son compte à 1 (plage de dates) → tri
    // sous les 62 villes à 2 → position 63 > plafond 60 → ligne COUPÉE du DOM.
    await mockSignauxApi(page, { fillerSlugs: FILLER_SLUGS, fillerQualified: 2 });
    await openVivierB(page);

    await expect(ndbcRow(page)).toBeVisible();
    await expect(ndbcBadge(page)).toHaveText("4");

    const detailDone = page.waitForResponse((res) =>
      res.url().includes(`/api/graph-signals/${NDBC_SLUG}`),
    );
    await ndbcRow(page).click();
    await detailDone;

    // CONTRAT : la ville sélectionnée reste visible, quel que soit son compte
    // live. (RED avant fix : la ligne disparaît entièrement du rail.)
    await expect(ndbcRow(page)).toBeVisible();
    await expect(ndbcRow(page)).toHaveClass(/rail-city-row--active/);
    // Badge HONNÊTE : 1 signal dans les filtres actifs / 4 au total.
    await expect(ndbcBadge(page)).toHaveText("1/4");
  });

  test("2 — la ligne sélectionnée garde SA PLACE (tri bulk stable), sans sauter au fetch", async ({
    page,
  }) => {
    // 3 villes bulk=3 + NDBC bulk=4 : NDBC est 1re. Sur le code bogué, le
    // compte live (1) la fait re-trier DERNIÈRE dès que le fetch aboutit — la
    // ligne « disparaît » de sa position sous le curseur.
    await mockSignauxApi(page, {
      fillerSlugs: FILLER_SLUGS.slice(0, 3),
      fillerQualified: 3,
      detailDelayMs: 400,
    });
    await openVivierB(page);

    await expect(cityRows(page)).toHaveCount(4);
    await expect(cityRows(page).first()).toContainText(NDBC_NAME);

    const detailDone = page.waitForResponse((res) =>
      res.url().includes(`/api/graph-signals/${NDBC_SLUG}`),
    );
    await ndbcRow(page).click();

    // PENDANT le fetch (réponse détail retardée de 400 ms) : la ligne reste
    // visible, à sa place, au compte bulk — aucun flash 0/n·d (garde #378).
    await expect(ndbcRow(page)).toBeVisible();
    await expect(cityRows(page).first()).toContainText(NDBC_NAME);
    await expect(ndbcBadge(page)).toHaveText("4");

    await detailDone;

    // APRÈS le fetch : toujours 1re (tri par bulk, stable), badge honnête 1/4.
    // (RED avant fix : la ligne saute en DERNIÈRE position avec badge « 1 ».)
    await expect(ndbcBadge(page)).toHaveText("1/4");
    await expect(cityRows(page).first()).toContainText(NDBC_NAME);
    await expect(ndbcRow(page)).toHaveClass(/rail-city-row--active/);
  });
});
