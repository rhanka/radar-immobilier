import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { AsyncLocalStorage } from "node:async_hooks";
import type {
  CanonicalCommandStore, CanonicalRouterFactory, CapacityDescriptor,
  DecisionResolutionPort,
} from "@sentropic/comments";
import { SESSION_COOKIE_NAME, verifySession, type VerifiedSession } from "../services/auth/session.js";
import { createAnnotationHostPorts, type AnnotationHostRepository } from "../services/annotations/host-ports.js";

/** Injected from the cluster-mesh module at M2/M3; never an immo store/router. */
export interface CanonicalAnnotationsModule {
  createCanonicalCommentsRouter: CanonicalRouterFactory<Hono>;
  store: CanonicalCommandStore;
  capacity: CapacityDescriptor;
}

export interface AnnotationsDeps {
  repository: AnnotationHostRepository;
  approvedPrincipal(sub: string): Promise<boolean>;
  sessionSecret?: string;
  module?: CanonicalAnnotationsModule;
  decisions?: DecisionResolutionPort;
}

export function annotationsRoute(deps?: AnnotationsDeps) {
  const app = new Hono<{ Variables: { session: VerifiedSession } }>();
  const principals = new AsyncLocalStorage<string>();
  app.use("*", async (c, next) => {
    if (!deps?.sessionSecret) {
      return c.json({ code: "unauthenticated", message: "Authentication is required" }, 401);
    }
    const token = getCookie(c, SESSION_COOKIE_NAME);
    const session = token ? await verifySession(token, { sessionSecret: deps.sessionSecret }) : null;
    if (!session) return c.json({ code: "unauthenticated", message: "Authentication is required" }, 401);
    if (!(await deps.approvedPrincipal(session.sub))) {
      return c.json({ code: "denied", message: "Access denied" }, 403);
    }
    if (!deps.module) {
      return c.json({ code: "unavailable", message: "Canonical annotations module is unavailable" }, 503);
    }
    c.set("session", session);
    await principals.run(session.sub, next);
    return;
  });
  if (deps?.module) {
    const host = createAnnotationHostPorts(deps.repository);
    const router = deps.module.createCanonicalCommentsRouter({
      store: deps.module.store,
      capabilities: { check: (claimed, capability, targets) => claimed === principals.getStore()
        ? host.capabilities.check(claimed, capability, targets) : Promise.resolve(false) },
      resolver: { resolve: (claimed, resource) => claimed === principals.getStore()
        ? host.resolver.resolve(claimed, resource) : Promise.resolve("unavailable") },
      decisions: deps.decisions ?? host.decisions,
    }, { capacity: deps.module.capacity });
    // M3 must qualify the session context convention; port calls are independently bound.
    app.route("/", router);
  }
  return app;
}
