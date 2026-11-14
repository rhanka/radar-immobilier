import { expect, seed, test } from "./fixtures";

test("city click paints reduced geometry, then lot click loads the exact detail", async ({ page }) => {
  const requests: URL[] = [];
  const exactGeometry = { type: "Polygon", coordinates: [[[-74.123456789,45.25],[-74.123156789,45.25],[-74.123156789,45.2505],[-74.123456789,45.25]]] };
  const lot = { type: "Feature", id: "ca/qc/lot/123", geometry: exactGeometry, properties: { noLot: "123", citySlug: seed.city, geoId: "ca/qc/lot/123", surface_m2: 650, frontage_m: 22.9 } };
  await page.route("**/api/geo/collections/**", async (route) => {
    const url = new URL(route.request().url());
    requests.push(url);
    const detail = url.pathname.includes("/items/");
    const reduced = { ...lot, geometry: { type: "Polygon", coordinates: [[[-74.123457,45.25],[-74.123157,45.25],[-74.123157,45.2505],[-74.123457,45.25]]] }, properties: { noLot: "123", geoId: lot.id } };
    const features = url.pathname.includes("qc-lots-") ? [reduced] : [];
    await route.fulfill({ contentType: "application/geo+json", json: detail ? lot : { type: "FeatureCollection", features, numberMatched: features.length, numberReturned: features.length } });
  });
  await page.goto("/geo?mode=signal&filter.period=all");
  const city = page.locator("button").filter({ hasText: /Salaberry-de-Valleyfield/i }).first();
  await expect(city).toBeVisible();
  await city.click();
  const bucket = page.locator("details.sel-bucket").filter({ has: page.locator("summary", { hasText: "Lots" }) }).first();
  await expect(bucket).toBeVisible();
  if (!(await bucket.evaluate((element) => (element as HTMLDetailsElement).open))) await bucket.locator("summary").first().click();
  await page.getByRole("button", { name: "123 lot", exact: true }).click();
  const drawer = page.getByTestId("sel-lot-drawer");
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText("22,9 m");
  await expect(drawer.getByRole("status")).toHaveCount(0);
  const display = requests.filter((url) => !url.pathname.includes("/items/"));
  expect(display.some((url) => url.pathname.includes("qc-lots-") && url.searchParams.get("coordPrecision") === "6")).toBe(true);
  expect(display.some((url) => url.pathname.includes("qc-zonage-") && url.searchParams.get("coordPrecision") === "6")).toBe(true);
  const detail = requests.find((url) => url.pathname.includes("/items/"));
  expect(detail?.searchParams.has("coordPrecision")).toBe(false);
  expect(detail?.pathname).toContain("ca%2Fqc%2Flot%2F123");
  expect(requests.every((url) => url.origin === new URL(page.url()).origin)).toBe(true);
});
