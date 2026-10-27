import { controlTestHost } from "./control-test-host.js";
import { vi } from "vitest";
import type { ActivationConfig } from "./activation.js";
import type { AdmissionAuthority } from "./admission.js";

export const NOW = Date.parse("2026-10-21T00:00:00Z");
export const ARTIFACT = "123e4567-e89b-12d3-a456-426614174000";
export const RELEASE = "123e4567-e89b-12d3-a456-426614174001";
export const DIGEST = "ab".repeat(32);
export const SCOPE = "storage-scope";

export const general = (): ActivationConfig =>
  ({ enabled: true, subjects: [], expiresAtMs: Number.POSITIVE_INFINITY, mode: "general" });
export const closed: ActivationConfig = { enabled: false, reason: "activation_off" };
export const ensureBody = { bindingName: "summer", idempotencyKey: "key" };

export function stubAuthority(options: {
  activations?: ActivationConfig[];
  statuses?: Array<string | null>;
  memberships?: string[][];
}): { authority: AdmissionAuthority; membershipCalls: string[] } {
  const activations = options.activations ?? [general()];
  const statuses = options.statuses ?? ["approved"];
  const membershipSets = options.memberships ?? [[]];
  const membershipCalls: string[] = [];
  let activationIndex = 0;
  let statusIndex = 0;
  let membershipIndex = 0;
  return {
    authority: {
      readActivation: () => activations[Math.min(activationIndex++, activations.length - 1)]!,
      readStatus: async (sub: string) => statuses[Math.min(statusIndex++, statuses.length - 1)]!,
      nowMs: () => NOW,
      readMemberships: async (sub: string) => {
        membershipCalls.push(sub);
        return membershipSets[Math.min(membershipIndex++, membershipSets.length - 1)]!;
      },
      scope: SCOPE,
    },
    membershipCalls,
  };
}

export function stubHost() {
  const handle = vi.fn(async () => ({ status: 201,
    body: { artifactId: ARTIFACT, releaseId: RELEASE, manifest: JSON.stringify({ digest: DIGEST }) } }));
  return { host: controlTestHost(handle), handle };
}
