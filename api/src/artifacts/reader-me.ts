/**
 * J1.2d/e wagon 2 — `app.me.v1` (§2.3): what an artifact may know about the
 * reader. The response is synthesized server-side from the verified reader
 * context: no app cookie is relayed, no session is re-minted, no account is
 * reconciled, and nothing is written.
 */
import { createHmac, hkdfSync } from "node:crypto";
import { z } from "zod";

/** Strict params: GET with zero parameters (same contract as `workspacesListParams`). */
export const appMeParams = z.object({}).strict();

/**
 * Exact §2.3 contract, nothing else: the opaque `userRef` (never the IdP
 * `sub`), the constant role label, the constant status. No `email`, no
 * `isAdmin`, no `authDisabled`.
 */
export const appMeResponseSchema = z.object({
  authenticated: z.literal(true),
  user: z.object({
    sub: z.string().regex(/^usr_[A-Za-z0-9_-]{32}$/),
    name: z.literal("Lecteur"),
    status: z.literal("approved"),
  }).strict(),
}).strict();

export type AppMeResponse = z.infer<typeof appMeResponseSchema>;

/**
 * Purpose-bound key derived from the reader session secret (HKDF-SHA256):
 * the raw secret never keys an op digest directly, and each purpose
 * (`app.me.v1/userRef`, `signals.coherent-city.v1/token`) gets its own key.
 */
export function deriveReaderKey(sessionSecret: string, purpose: string): Buffer {
  return Buffer.from(hkdfSync("sha256", sessionSecret, "radar-reader-ops-v1", purpose, 32));
}

/**
 * Opaque per-(artifact, reader) incarnation key. Stable for the couple, so
 * the UI can key its viewer incarnation on it; non reversible and not
 * correlatable across artifacts. Rotating the reader session secret mints a
 * new incarnation cleanly (the profile revision does not enter the digest).
 * The value is NEVER accepted back as an identity: every call re-derives
 * authority from the sealed grant, and client identity headers stay refused
 * with 400.
 */
export function deriveUserRef(sessionSecret: string, artifactId: string, readerSub: string): string {
  const digest = createHmac("sha256", deriveReaderKey(sessionSecret, "app.me.v1/userRef"))
    .update(`me-v1:${artifactId}:${readerSub}`, "utf8")
    .digest("base64url");
  return `usr_${digest.slice(0, 32)}`;
}

/** Build the exact §2.3 body. Throws when the contract is not met. */
export function buildAppMeResponse(
  sessionSecret: string, artifactId: string, readerSub: string,
): AppMeResponse {
  return appMeResponseSchema.parse({
    authenticated: true,
    user: {
      sub: deriveUserRef(sessionSecret, artifactId, readerSub),
      name: "Lecteur",
      status: "approved",
    },
  });
}
