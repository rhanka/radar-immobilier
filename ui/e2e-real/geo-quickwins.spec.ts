import { expect, seed, test } from "./fixtures";

for (const fallbackStatus of [null, 400, 404, 503]) {
test(`city click loads display then exact detail (fallback ${fallbackStatus ?? "none"})`, async ({ page }) => {
  const requests: URL[] = [];
  const logs: string[] = [];
  page.on("console", (message) => { if (message.type() === "warning") logs.push(message.text()); });
  const exactGeometry = { type: "Polygon", coordinates: [[[-74.123456789,45.25],[-74.123156789,45.25],[-74.123156789,45.2505],[-74.123456789,45.25]]] };
  const lot = { type: "Feature", id: "ca/qc/lot/123", geometry: exactGeometry, properties: { noLot: "123", citySlug: seed.city, geoId: "ca/qc/lot/123", surface_m2: 650, frontage_m: 22.9 } };
  await page.route("**/api/geo/collections/**", async (route) => {
    const url = new URL(route.request().url());
    if (!/\/qc-(lots|zonage)-/.test(url.pathname)) {
      await route.fulfill({ contentType: "application/geo+json", json: { type: "FeatureCollection", features: [], numberMatched: 0, numberReturned: 0 } });
      return;
    }
    requests.push(url);
    const detail = url.pathname.includes("/items/");
    const display = url.searchParams.get("profile") === "display";
    if (display) {
      expect([...url.searchParams.keys()]).toEqual(["profile"]);
      if (fallbackStatus) {
        await route.fulfill({ status: fallbackStatus, json: { code: fallbackStatus === 503 ? "DisplayUnavailable" : fallbackStatus === 400 ? "InvalidParameter" : "NotFound" } });
        return;
      }
    } else if (!detail) {
      expect(url.searchParams.get("coordPrecision")).toBe("6");
    }
    const reduced = { ...lot, geometry: { type: "Polygon", coordinates: [[[-74.123457,45.25],[-74.123157,45.25],[-74.123157,45.2505],[-74.123457,45.25]]] }, properties: { noLot: "123", geoId: lot.id } };
    const features = url.pathname.includes("qc-lots-") ? [reduced] : [];
    await route.fulfill({ contentType: "application/geo+json", headers: { ETag: '"m1"', "Cache-Control": "no-cache", "X-Geo-Display-Version": "m1", "X-Geo-Display-Stale": "1" }, json: detail ? lot : { type: "FeatureCollection", features, numberMatched: features.length, numberReturned: features.length } });
  });
  await page.goto("/geo?mode=signal&filter.period=all");
  const city = page.locator("button").filter({ hasText: /Salaberry-de-Valleyfield/i }).first();
  await expect(city).toBeVisible();
  const start = performance.now();
  await city.click();
  const bucket = page.locator("details.sel-bucket").filter({ has: page.locator("summary", { hasText: "Lots" }) }).first();
  await expect(bucket).toBeVisible();
  if (!(await bucket.evaluate((element) => (element as HTMLDetailsElement).open))) await bucket.locator("summary").first().click();
  await page.getByRole("button", { name: "123 lot", exact: true }).click();
  const drawer = page.getByTestId("sel-lot-drawer");
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText("22,9 m");
  await expect(drawer).toContainText("650");
  await expect(drawer.getByRole("status")).toHaveCount(0);
  console.log(`City click to exact lot card (fallback ${fallbackStatus ?? "none"}): ${Math.round(performance.now() - start)} ms`);
  const display = requests.filter((url) => !url.pathname.includes("/items/"));
  for (const collection of ["qc-lots-", "qc-zonage-"]) {
    const calls = display.filter((url) => url.pathname.includes(collection));
    expect(calls.filter((url) => url.searchParams.get("profile") === "display")).toHaveLength(1);
    expect(calls).toHaveLength(fallbackStatus ? 2 : 1);
    if (fallbackStatus) expect(logs.some((line) => line.includes(collection) && line.includes(`HTTP ${fallbackStatus}; falling back`))).toBe(true);
  }
  const detail = requests.find((url) => url.pathname.includes("/items/"));
  expect(detail?.searchParams.has("coordPrecision")).toBe(false);
  expect(detail?.searchParams.has("profile")).toBe(false);
  expect(detail?.pathname).toContain("ca%2Fqc%2Flot%2F123");
  expect(requests.every((url) => url.origin === new URL(page.url()).origin)).toBe(true);
});
}
