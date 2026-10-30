/**
 * Shared fixtures for the real-stack suite: the seeded synthetic data and a
 * network guard that records every API response and fails the test when any
 * retired legacy reader is called or any 410 is observed.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { test as base, expect, type Page } from "@playwright/test";

export interface SeedData {
  city: string;
  workspaceId: string;
  signals: Array<{ id: string; label: string }>;
  people: Record<"admin" | "member" | "outsider", { email: string; name: string }>;
  zones: number;
  lots: number;
}

export const STATE_DIR = process.env.E2E_STATE_DIR ?? "/e2e-state";
export const seed: SeedData = JSON.parse(readFileSync(`${STATE_DIR}/seed.json`, "utf8"));
export const stateFor = (role: "admin" | "member" | "outsider") => `${STATE_DIR}/${role}.json`;

/** Unscoped signal readers retired by 6H; the UI must never call them. */
const LEGACY = [/\/api\/graph-signals\//, /\/api\/v1\/signal-facets\//];

interface NetworkEntry { method: string; url: string; status: number }

export const test = base.extend<{ network: NetworkEntry[] }>({
  network: [async ({ page }, use, testInfo) => {
    const entries: NetworkEntry[] = [];
    const diagnostics: string[] = [];
    page.on("response", (response) => {
      const url = response.url();
      if (url.includes("/api/")) {
        entries.push({ method: response.request().method(), url, status: response.status() });
      }
    });
    page.on("requestfailed", (request) => {
      diagnostics.push(`requestfailed ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ""}`);
    });
    page.on("pageerror", (error) => diagnostics.push(`pageerror ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error" || message.type() === "warning") {
        diagnostics.push(`console.${message.type()} ${message.text()}`);
      }
    });
    await use(entries);
    mkdirSync("../tmp/e2e-real/network", { recursive: true });
    const name = testInfo.titlePath.join(" ").replace(/[^a-z0-9]+/gi, "-").slice(0, 120);
    writeFileSync(`../tmp/e2e-real/network/${name}.json`, JSON.stringify({ entries, diagnostics }, null, 2));
    const legacy = entries.filter((entry) => LEGACY.some((pattern) => pattern.test(new URL(entry.url).pathname)));
    expect(legacy, "retired legacy readers called").toEqual([]);
    expect(entries.filter((entry) => entry.status === 410), "410 responses observed").toEqual([]);
  }, { auto: true }],
});

export { expect };

/** Open the Signaux map on the seeded city, all periods, signals bucket unfolded. */
export async function openSeededCity(page: Page): Promise<void> {
  await page.goto(`/geo/city/${seed.city}?mode=signal&filter.period=all`);
  await expect(page.getByText(`${seed.signals.length} signaux`).first()).toBeVisible();
  await expandSignals(page);
  await expect(page.getByRole("button", { name: new RegExp(escapeRegExp(seed.signals[0]!.label)) }))
    .toBeVisible();
}

/** Unfold the Signaux bucket of the selection panel when it is folded. */
export async function expandSignals(page: Page): Promise<void> {
  const bucket = page.locator("details.sel-bucket")
    .filter({ has: page.locator("summary", { hasText: "Signaux" }) }).first();
  await expect(bucket).toBeVisible();
  if (!(await bucket.evaluate((element) => (element as HTMLDetailsElement).open))) {
    await bucket.locator("summary").first().click();
  }
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
