export interface SwRuntimeProbes {
  productionBuild: boolean;
  secureContext: boolean;
  workerApi: boolean;
  origin: string;
}
/** Initial rollout is preprod only. Ordinary QA/loopback never registers. */
export function isAllowedServiceWorkerOrigin(origin: string): boolean {
  return origin === "https://preprod.immo.sent-tech.ca";
}
export function gateServiceWorkerRuntime(p: SwRuntimeProbes): boolean {
  return p.productionBuild && p.secureContext && p.workerApi && isAllowedServiceWorkerOrigin(p.origin);
}
export function readClientBuildId(): string {
  return typeof __IMMO_CLIENT_BUILD_ID__ === "string" ? __IMMO_CLIENT_BUILD_ID__ : "unknown";
}
export function runtimeProbes(): SwRuntimeProbes {
  return { productionBuild: import.meta.env.PROD, secureContext: window.isSecureContext,
    workerApi: "serviceWorker" in navigator, origin: window.location.origin };
}
