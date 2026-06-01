/**
 * ÉV16 — Backlog tool-calling surface (mirror of `../sentropic`
 * `api/src/services/tools.ts` + `tool-service.ts`).
 *
 * Declares the two tools the chat can call to drive the Backlog and executes
 * them server-side by calling the existing ÉV15 Backlog HTTP API
 * (`POST /api/backlog/items`, `POST /api/backlog/items/:id/process`). We call
 * the real HTTP endpoints (same in-process server) instead of importing the
 * route's private store, so the chat exercises the exact same path the UI does
 * and `GET /api/backlog` reflects every change. No new app.ts route is added.
 *
 * Tool definitions use the `@sentropic/llm-mesh` `ToolDefinition`
 * (`{ type: "function", name, description, inputSchema }`) so the per-provider
 * adapters can serialize them to each native tool schema.
 */

import type { ToolDefinition } from "@sentropic/llm-mesh";

/** Tool names, kept in one place so the runtime + executor agree. */
export const AJOUTER_DEMANDE = "ajouter_demande";
export const TRAITER_DEMANDE = "traiter_demande";

/**
 * The two backlog tools, in French (the demo UI + prompts are French). The
 * schemas mirror the ÉV15 `POST /api/backlog/items` body and the `:id` path
 * parameter of `POST /api/backlog/items/:id/process`.
 */
export const BACKLOG_TOOLS: readonly ToolDefinition[] = [
  {
    type: "function",
    name: AJOUTER_DEMANDE,
    description:
      "Ajoute une demande d'evolution au backlog du radar (colonne A faire). " +
      "A utiliser des que l'utilisateur exprime le souhait d'une nouvelle " +
      "fonctionnalite, amelioration ou correction.",
    inputSchema: {
      type: "object",
      properties: {
        titre: {
          type: "string",
          description: "Titre court de la demande (1 phrase).",
        },
        description: {
          type: "string",
          description: "Description detaillee de la demande (optionnelle).",
        },
      },
      required: ["titre"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: TRAITER_DEMANDE,
    description:
      "Fait passer une demande du backlog en cours de traitement (colonne " +
      "En cours). A utiliser quand l'utilisateur demande de demarrer/traiter " +
      "une demande deja ajoutee. Le parametre id est l'identifiant retourne " +
      "par ajouter_demande.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Identifiant de la demande a traiter.",
        },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
];

/** Result of executing a backlog tool, surfaced to the UI + fed back to the LLM. */
export type BacklogToolResult = {
  readonly status: "completed" | "error";
  readonly tool: string;
  readonly summary: string;
  readonly item?: {
    id: string;
    titre: string;
    statut: string;
  };
  readonly error?: string;
};

/** Internal base URL of the running API (same process, loopback). */
const apiBaseUrl = (env: NodeJS.ProcessEnv = process.env): string => {
  const port = env.PORT && env.PORT.trim().length > 0 ? env.PORT.trim() : "3000";
  return `http://127.0.0.1:${port}`;
};

type AddBody = { titre?: unknown; description?: unknown };

const asString = (value: unknown): string =>
  typeof value === "string" ? value : "";

/**
 * Execute one backlog tool call. `argumentsText` is the raw JSON the model
 * streamed; it is parsed defensively. Any failure (bad JSON, HTTP error,
 * unknown tool) returns an `error` result so the loop can feed it back to the
 * model gracefully instead of crashing the turn.
 */
export const executeBacklogTool = async (input: {
  name: string;
  argumentsText: string;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
}): Promise<BacklogToolResult> => {
  const doFetch = input.fetchImpl ?? fetch;
  const base = apiBaseUrl(input.env);

  let args: Record<string, unknown>;
  try {
    const parsed: unknown = input.argumentsText.trim().length
      ? JSON.parse(input.argumentsText)
      : {};
    args = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {
      status: "error",
      tool: input.name,
      summary: "Arguments invalides",
      error: `Could not parse tool arguments: ${input.argumentsText.slice(0, 200)}`,
    };
  }

  try {
    if (input.name === AJOUTER_DEMANDE) {
      const body: AddBody = {
        titre: asString(args.titre),
        ...(typeof args.description === "string"
          ? { description: args.description }
          : {}),
      };
      const response = await doFetch(`${base}/api/backlog/items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        return {
          status: "error",
          tool: input.name,
          summary: "Ajout refuse",
          error: `HTTP ${response.status}: ${detail.slice(0, 200)}`,
        };
      }
      const json = (await response.json()) as {
        item: { id: string; titre: string; statut: string };
      };
      return {
        status: "completed",
        tool: input.name,
        summary: `Demande ajoutee : "${json.item.titre}" (id ${json.item.id})`,
        item: {
          id: json.item.id,
          titre: json.item.titre,
          statut: json.item.statut,
        },
      };
    }

    if (input.name === TRAITER_DEMANDE) {
      const id = asString(args.id).trim();
      if (!id) {
        return {
          status: "error",
          tool: input.name,
          summary: "Identifiant manquant",
          error: "The 'id' argument is required",
        };
      }
      const response = await doFetch(
        `${base}/api/backlog/items/${encodeURIComponent(id)}/process`,
        { method: "POST" },
      );
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        return {
          status: "error",
          tool: input.name,
          summary: `Traitement impossible (id ${id})`,
          error: `HTTP ${response.status}: ${detail.slice(0, 200)}`,
        };
      }
      const json = (await response.json()) as {
        item: { id: string; titre: string; statut: string };
      };
      return {
        status: "completed",
        tool: input.name,
        summary: `Demande traitee : "${json.item.titre}" -> ${json.item.statut}`,
        item: {
          id: json.item.id,
          titre: json.item.titre,
          statut: json.item.statut,
        },
      };
    }

    return {
      status: "error",
      tool: input.name,
      summary: "Outil inconnu",
      error: `Unknown tool "${input.name}"`,
    };
  } catch (error) {
    return {
      status: "error",
      tool: input.name,
      summary: "Erreur d'execution de l'outil",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
};
