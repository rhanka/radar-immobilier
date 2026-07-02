/**
 * Tests request-guard — garde « dernière requête gagne » (anti-course).
 *
 * Prouve le cœur du correctif « une réponse en retard ne peint jamais la
 * mauvaise ville » de façon DÉTERMINISTE, sans rendre MapLibre :
 *  - un bail plus récent invalide le précédent (`isCurrent()` → false) ;
 *  - émettre un nouveau bail avorte le signal du précédent ;
 *  - `cancel()` invalide le bail courant sans en émettre de nouveau.
 */
import { describe, it, expect } from "vitest";
import { RequestGuard } from "./request-guard.js";

describe("RequestGuard — latest-wins", () => {
  it("un seul bail : reste courant", () => {
    const guard = new RequestGuard();
    const lease = guard.lease();
    expect(lease.isCurrent()).toBe(true);
    expect(lease.signal.aborted).toBe(false);
  });

  it("un bail plus récent invalide le précédent", () => {
    const guard = new RequestGuard();
    const first = guard.lease();
    const second = guard.lease();
    expect(first.isCurrent()).toBe(false);
    expect(second.isCurrent()).toBe(true);
  });

  it("émettre un nouveau bail avorte le signal du précédent", () => {
    const guard = new RequestGuard();
    const first = guard.lease();
    expect(first.signal.aborted).toBe(false);
    const second = guard.lease();
    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(false);
  });

  it("les jetons sont strictement monotones", () => {
    const guard = new RequestGuard();
    const a = guard.lease();
    const b = guard.lease();
    const c = guard.lease();
    expect(b.token).toBeGreaterThan(a.token);
    expect(c.token).toBeGreaterThan(b.token);
  });

  it("cancel() invalide et avorte le bail courant sans en émettre un nouveau", () => {
    const guard = new RequestGuard();
    const lease = guard.lease();
    guard.cancel();
    expect(lease.isCurrent()).toBe(false);
    expect(lease.signal.aborted).toBe(true);
  });

  it("un bail émis après cancel() redevient courant", () => {
    const guard = new RequestGuard();
    guard.lease();
    guard.cancel();
    const fresh = guard.lease();
    expect(fresh.isCurrent()).toBe(true);
    expect(fresh.signal.aborted).toBe(false);
  });

  it("scénario ville : la réponse en retard de la ville A est ignorée après passage à B", async () => {
    const guard = new RequestGuard();
    // Sélection ville A → bail A.
    const leaseA = guard.lease();
    // L'utilisateur switch vers B AVANT que A ne réponde → bail B.
    const leaseB = guard.lease();
    // Réponse A arrive en retard : le composant vérifie isCurrent() avant commit.
    const wouldCommitA = leaseA.isCurrent();
    // Réponse B arrive : elle, peut committer.
    const wouldCommitB = leaseB.isCurrent();
    expect(wouldCommitA).toBe(false);
    expect(wouldCommitB).toBe(true);
    expect(leaseA.signal.aborted).toBe(true);
  });
});
