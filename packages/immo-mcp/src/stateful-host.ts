import type { Hono } from "hono";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { StatefulMcpHost, StatefulMcpHooks, VerifiedMcpRequest } from "@sentropic/cluster-mesh/compose/mcp-stateful";

/** One process generation: failed or superseded binding never reopens admission. */
export class ImmoStatefulHost implements StatefulMcpHost {
  readonly verifiedClaimNames: readonly string[] = [];
  private readonly servers = new Set<Server>();
  private hooks: StatefulMcpHooks | undefined;
  private attempted = false;
  private admitted = false;
  private active = 0;
  private drained: (() => void) | undefined;

  constructor(private readonly router: Hono) {}

  retain(server: Server): void {
    this.servers.add(server);
    if (this.admitted) {
      try { this.hooks!.register(server); }
      catch (error) { this.admitted = false; throw error; }
    }
  }

  forget(server: Server): void { this.servers.delete(server); }

  async bind(hooks: StatefulMcpHooks): Promise<Hono> {
    this.admitted = false;
    if (this.attempted) throw new Error("composition_already_attempted");
    this.attempted = true;
    if (this.active) await new Promise<void>((resolve) => { this.drained = resolve; });
    // No seed bearer exists on retained servers; identity is request-local only.
    for (const server of this.servers) hooks.register(server);
    this.hooks = hooks;
    this.admitted = true;
    return this.router;
  }

  async run<T>(authority: VerifiedMcpRequest, next: () => Promise<T>): Promise<T> {
    if (!this.admitted || !this.hooks) throw new Error("composition_unavailable");
    this.active++;
    try { return await this.hooks.run(authority, next); }
    finally {
      if (--this.active === 0) { this.drained?.(); this.drained = undefined; }
    }
  }

  async boundRequest(request: Request): Promise<Request> {
    if (!this.admitted || !this.hooks) throw new Error("composition_unavailable");
    if (request.method !== "POST") return request;
    const reader = request.body?.getReader();
    if (!reader) return request;
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > this.hooks.maxRequestBytes) {
          await reader.cancel();
          throw new Error("request_too_large");
        }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    return new Request(request.url, { method: request.method, headers: request.headers,
      body: Buffer.concat(chunks), signal: request.signal });
  }
}
