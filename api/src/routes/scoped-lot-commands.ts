/**
 * 6J scoped lot commands: single writes and the atomic batch.
 *
 * Writes require an authenticated browser session. Personal scope
 * supports archive and restoration only; a contributor is never silently
 * redirected from a forbidden common archive to a personal action.
 */
import { Hono } from "hono";
import { z } from "zod";
import { writeLotBatch } from "../services/facets/lots/lot-batch.js";
import {
  LOT_FACETS_CONTRACT_VERSION,
  type LotBatchCommand,
  type LotCommand,
} from "../services/facets/lots/lot-commands.js";
import { writeLotFacet } from "../services/facets/lots/lot-writer.js";
import {
  lotBatchSchema,
  lotSingleBodySchema,
  toLotError,
  type ScopedLotFacetsDeps,
} from "./scoped-lot-facets-common.js";

export function scopedLotCommandsRoute(deps: ScopedLotFacetsDeps): Hono {
  const app = new Hono();

  for (const scope of ["workspace", "personal"] as const) {
    app.post(`/api/v1/workspaces/:workspaceId/lot-facets/${scope}/commands`, async (c) => {
      const body = await c.req.json().catch(() => null);
      const parsed = lotSingleBodySchema.safeParse(body);
      const key = z.string().uuid().transform((value) => value.toLowerCase())
        .safeParse(c.req.header("Idempotency-Key"));
      if (!parsed.success || !key.success) {
        return c.json({ error: "invalid_facet_command" }, 400);
      }
      const session = c.get("session" as never) as { sub: string };
      try {
        const { mode: commandMode, ...item } = parsed.data;
        const command: LotCommand = { ...item,
          contract_version: LOT_FACETS_CONTRACT_VERSION,
          command_key: key.data, mode: commandMode };
        const event = await writeLotFacet(deps.db, session.sub,
          c.req.param("workspaceId"), scope, command);
        return c.json({ ok: true, result: event });
      } catch (error) {
        return toLotError(c, error);
      }
    });

    app.post(`/api/v1/workspaces/:workspaceId/lot-facets/${scope}/commands/batch`, async (c) => {
      const body = await c.req.json().catch(() => null);
      const parsed = lotBatchSchema.safeParse(body);
      const key = z.string().uuid().transform((value) => value.toLowerCase())
        .safeParse(c.req.header("Idempotency-Key"));
      if (!parsed.success || !key.success) {
        return c.json({ error: "invalid_facet_command" }, 400);
      }
      const session = c.get("session" as never) as { sub: string };
      try {
        const batch: LotBatchCommand = { ...parsed.data,
          contract_version: LOT_FACETS_CONTRACT_VERSION,
          command_key: key.data };
        const result = await writeLotBatch(deps.db, session.sub,
          c.req.param("workspaceId"), scope, batch);
        return c.json({ ok: true, result });
      } catch (error) {
        return toLotError(c, error);
      }
    });
  }
  return app;
}
