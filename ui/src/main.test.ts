import { beforeEach, afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  initializeWorker: vi.fn(),
  mount: vi.fn(() => ({ mounted: true })),
}));
vi.mock("@fontsource-variable/inter", () => ({}));
vi.mock("./app.css", () => ({}));
vi.mock("./App.svelte", () => ({ default: {} }));
vi.mock("svelte", () => ({ mount: mocks.mount }));
vi.mock("./lib/maps/maplibre-worker", () => ({
  initializeMaplibreWorker: mocks.initializeWorker,
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => { document.body.innerHTML = ""; });

it("should wait for worker initialization before mounting any application maps", async () => {
  let finishWorker!: () => void;
  mocks.initializeWorker.mockImplementation(() => new Promise<void>((resolve) => {
    finishWorker = resolve;
  }));
  const application = await import("./main");
  expect(mocks.initializeWorker).toHaveBeenCalledOnce();
  expect(mocks.mount).not.toHaveBeenCalled();
  finishWorker();
  await expect(application.default).resolves.toEqual({ mounted: true });
  expect(mocks.mount).toHaveBeenCalledOnce();
  expect(mocks.mount.mock.calls[0]).toEqual([{}, { target: document.getElementById("app") }]);
});

it("should fail startup without mounting maps when the worker cannot initialize", async () => {
  mocks.initializeWorker.mockRejectedValue(new Error("Worker unavailable"));
  const application = await import("./main");
  await expect(application.default).rejects.toThrow("Worker unavailable");
  expect(mocks.mount).not.toHaveBeenCalled();
});

it("should reject a missing application root before initializing the worker", async () => {
  document.body.innerHTML = "";
  await expect(import("./main")).rejects.toThrow("Missing #app root");
  expect(mocks.initializeWorker).not.toHaveBeenCalled();
  expect(mocks.mount).not.toHaveBeenCalled();
});
