import type { AdmissionResult, ProviderFailureProbe } from "@radar/artifacts-host";

/**
 * Provisional H4 v3 host API adapter. Sentropic is revising spec r2 names;
 * rename/rebind them HERE only. These are requested contracts, not exports
 * claimed to exist in the current provider. Never emulate a missing binding.
 */
interface FinalizationContext {
  readonly actorId: string;
  readonly operation: string;
  readonly storageScopeId: string;
  readonly artifactId?: string;
}
type Authorize = (context: FinalizationContext) => Promise<AdmissionResult>;

function member(target: unknown, name: string): unknown {
  return target !== null && typeof target === "object"
    ? (target as Record<string, unknown>)[name] : undefined;
}

function requiredFunction(target: unknown, name: string, contract: string): (...args: unknown[]) => unknown {
  const binding = member(target, name);
  if (typeof binding !== "function") {
    throw new Error(`[missing-contract] ${contract}: callable ${name} is required`);
  }
  return binding.bind(target) as (...args: unknown[]) => unknown;
}

// The registered policy receives immutable verified invocation context. It
// must be invoked by provider finalization after waits, never by this helper.
export function bindFinalization(host: unknown, authorize: Authorize): void {
  requiredFunction(host, "setFinalizeAuthorization", "provider.finalizeAuthorization")(authorize);
}

// Drain the provider's private request-correlated cause through the facade's
// existing probe port. Radar's below-HTTP record fallback is deliberately
// absent: it would make a provider with no typed-cause contract look qualified.
export function providerCauses(host: unknown): { probe: ProviderFailureProbe; causes: unknown[] } {
  const take = requiredFunction(member(host, "app"), "takeTypedCause", "provider.typedCause");
  const causes: unknown[] = [];
  return { causes, probe: {
    record: () => {},
    run: (work) => work(),
    take() {
      const cause = take();
      if (cause !== undefined) causes.push(cause);
      return cause;
    },
  } };
}

export function requireSelectedProfile(host: unknown): void {
  const selected = member(host, "selectedCapabilities");
  if (selected === undefined || selected === null) {
    throw new Error("[missing-contract] provider.selectCapabilities: explicit selectedCapabilities required before compilation");
  }
  if (!Array.isArray(selected) || selected.length !== 4 ||
    ["ensure", "publish", "meta", "list"].some((op) => !selected.includes(op))) {
    throw new Error("[contract-violation] provider.selectCapabilities: expected exactly ensure, publish, meta, list");
  }
}
