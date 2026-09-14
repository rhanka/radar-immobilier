export function createPinnedWirePlanner({ runtime, facade, account, variant,
  routingSubject, affinityKey, outcomes }) {
  const candidateRef = `${variant.transport}:pinned-wire`;
  return {
    async plan() {
      return { planRef: `${candidateRef}:plan`, candidateRefs: [candidateRef],
        diagnostics: [{ candidateRef, actualProviderId: variant.provider }] };
    },
    async prepareAttempt(_subject, _planRef, _candidateRef, requestId) {
      const acquisition = await facade.acquire({ accountId: account.accountId,
        ownerScopeRef: routingSubject.ownerScopeRef, targetProviderId: variant.provider,
        transportProviderId: variant.transport, modelId: variant.model, affinityKey, requestId });
      let released = false;
      const release = async () => {
        if (!released) { released = true; await facade.release(acquisition); }
      };
      return {
        generate: (request) => runtime.generate({ ...request, auth: acquisition.material }),
        async complete(usage) {
          outcomes.push({ status: "completed", usage: usage ?? null });
          await release();
        },
        async recordOutcome(outcome, usage) {
          outcomes.push({ status: "failed", outcome, usage: usage ?? null });
          await release();
        },
        async releaseCancelled() {
          outcomes.push({ status: "cancelled" });
          await release();
        },
      };
    },
  };
}
