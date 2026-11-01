import { get } from "svelte/store";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initServiceWorker, type ServiceWorkerClient } from "./client.js";
import { gateServiceWorkerRuntime, isAllowedServiceWorkerOrigin } from "./runtime.js";
import { buildDisabledWorkerSource } from "./disabled-worker-source.js";
import workerSource from "../../../public/immo-sw.js?raw";
const probes = { productionBuild: true, secureContext: true, workerApi: true,
  origin: "https://preprod.immo.sent-tech.ca" };
const opened: ServiceWorkerClient[] = [];
afterEach(() => { opened.splice(0).forEach((client) => client.dispose()); vi.unstubAllGlobals(); });
describe("worker rollout and degradation", () => {
  it("should leave the retiring worker stopped and handshake only after its replacement activates", async () => {
    class Channel {
      port1 = { onmessage: null as ((event: { data: unknown }) => void) | null, close() {} };
      port2 = { postMessage: (data: unknown) => this.port1.onmessage?.({ data }) };
    }
    vi.stubGlobal("MessageChannel", Channel);
    const old = { state: "activated", postMessage: vi.fn() };
    const replacement = Object.assign(new EventTarget(), { state: "installing",
      postMessage(message: { id: string }, ports: MessagePort[]) {
        ports[0]!.postMessage({ protocol: 1, type: "HELLO_ACK", id: "new", correlationId: message.id,
          payload: { workerBuildId: "replacement", protocolVersion: 1 } });
      } });
    const registration = Object.assign(new EventTarget(), { active: old as unknown,
      installing: replacement as unknown, waiting: null as unknown, update: vi.fn().mockResolvedValue(undefined) });
    const container = Object.assign(new EventTarget(), { register: vi.fn().mockResolvedValue(registration) });
    vi.stubGlobal("navigator", { serviceWorker: container });
    const client = initServiceWorker({ probes }); opened.push(client);
    await Promise.resolve(); await Promise.resolve();
    replacement.state = "installed"; registration.installing = null; registration.waiting = replacement;
    replacement.dispatchEvent(new Event("statechange"));
    await client.checkForUpdate();
    expect(get(client.status)).toBe("waiting"); expect(old.postMessage).not.toHaveBeenCalled();
    registration.waiting = null; registration.active = replacement; replacement.state = "activating";
    container.dispatchEvent(new Event("controllerchange"));
    expect(old.postMessage).not.toHaveBeenCalled();
    replacement.state = "activated"; replacement.dispatchEvent(new Event("statechange"));
    await vi.waitFor(() => expect(get(client.status)).toBe("ready"));
    expect(get(client.worker)?.workerBuildId).toBe("replacement");
  });
  it("should neutralize on a correlated kill reply even when the broadcast notice is missed", async () => {
    class Channel {
      port1: { onmessage: ((event: { data: unknown }) => void) | null; close(): void } = { onmessage: null, close() {} };
      port2 = { postMessage: (data: unknown) => this.port1.onmessage?.({ data }) };
    }
    vi.stubGlobal("MessageChannel", Channel);
    const active = Object.assign(new EventTarget(), { state: "activated",
      postMessage(message: { id: string }, ports: MessagePort[]) {
        ports[0]!.postMessage({ protocol: 1, type: "DISABLED", id: "kill", correlationId: message.id,
          payload: { workerBuildId: "kill" } });
      } });
    const registration = Object.assign(new EventTarget(), { active, installing: null, waiting: null });
    const container = Object.assign(new EventTarget(), { register: vi.fn().mockResolvedValue(registration) });
    vi.stubGlobal("navigator", { serviceWorker: container });
    const client = initServiceWorker({ probes }); opened.push(client);
    await vi.waitFor(() => expect(get(client.status)).toBe("disabled"));
    expect(get(client.worker)).toBeNull();
    await expect(client.ping()).rejects.toThrow("worker-unavailable");
  });
  it("should degrade without requiring secure crypto APIs on an unsupported origin", () => {
    vi.stubGlobal("crypto", undefined);
    const client = initServiceWorker({ probes: { ...probes, secureContext: false } });
    opened.push(client); expect(get(client.status)).toBe("unsupported");
  });
  it("should enable only production secure preprod UI, excluding ordinary QA and artefacts", () => {
    expect(gateServiceWorkerRuntime(probes)).toBe(true);
    for (const p of [{ ...probes, productionBuild: false }, { ...probes, secureContext: false },
      { ...probes, workerApi: false }, { ...probes, origin: "http://localhost:8080" },
      { ...probes, origin: "https://release.pinned.preprod.immo-pages.sent-tech.ca" }]) expect(gateServiceWorkerRuntime(p)).toBe(false);
    expect(isAllowedServiceWorkerOrigin("https://immo.sent-tech.ca")).toBe(false);
  });
  it("should keep the application usable when registration fails", async () => {
    const container = new EventTarget();
    Object.assign(container, { register: vi.fn().mockRejectedValue(new Error("404")) });
    vi.stubGlobal("navigator", { serviceWorker: container });
    const client = initServiceWorker({ probes }); opened.push(client);
    await vi.waitFor(() => expect(get(client.status)).toBe("unavailable"));
    await expect(client.ping()).rejects.toThrow("worker-unavailable");
  });
  it("should continue update checks for existing registrations when installs are disabled", async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const container = Object.assign(new EventTarget(), {
      register: vi.fn(), getRegistration: vi.fn().mockResolvedValue(Object.assign(new EventTarget(), { update })),
    });
    vi.stubGlobal("navigator", { serviceWorker: container });
    const client = initServiceWorker({ probes, enabled: false }); opened.push(client);
    await vi.waitFor(() => expect(get(client.status)).toBe("disabled"));
    expect(container.register).not.toHaveBeenCalled(); expect(update).toHaveBeenCalledOnce();
  });
  it("should have no network interception or private cache in either worker", () => {
    for (const source of [workerSource, buildDisabledWorkerSource("kill")]) {
      expect(source).not.toMatch(/addEventListener\(["']fetch["']/);
      expect(source).not.toMatch(/\bcaches\.|\bindexedDB\b|\blocalStorage\b|\bfetch\(/);
    }
    expect(workerSource).not.toMatch(/clients\.claim\(|addEventListener\(["']install/);
    expect(buildDisabledWorkerSource("kill")).toContain("registration.unregister()");
  });
});
