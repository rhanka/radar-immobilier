import { sql } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { bumpClassAnnotationRevision } from "./class-annotations.js";

export interface PurgeAiAnnotationsOptions {
  apply?: boolean;
  pipelineRunId?: string;
  promptSha256?: string;
  /** Explicit intent for a purge of every AI annotation, across runs and prompts. */
  all?: boolean;
}

export function parsePurgeAiAnnotationsArgs(args: readonly string[]): PurgeAiAnnotationsOptions {
  const options: PurgeAiAnnotationsOptions = { apply: false };
  let modeSeen = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--dry-run" || arg === "--apply") {
      if (modeSeen) throw new Error("Specify only one purge mode");
      modeSeen = true;
      options.apply = arg === "--apply";
    } else if (arg === "--all") {
      if (options.all) throw new Error("Invalid --all");
      options.all = true;
    } else if (arg === "--pipeline-run-id" || arg === "--prompt-sha256") {
      const key = arg === "--pipeline-run-id" ? "pipelineRunId" : "promptSha256";
      const value = args[++index];
      if (!value?.trim() || value.startsWith("--") || options[key] !== undefined) {
        throw new Error(`Invalid ${arg}`);
      }
      if (key === "promptSha256" && !/^[a-f0-9]{64}$/u.test(value)) throw new Error("Invalid prompt SHA-256");
      options[key] = value;
    } else throw new Error(`Unknown purge argument: ${arg}`);
  }
  validatePurgeOptions(options);
  return options;
}

function validatePurgeOptions(options: PurgeAiAnnotationsOptions): void {
  if (options.pipelineRunId !== undefined && !/^[A-Za-z0-9._:-]{1,200}$/u.test(options.pipelineRunId)) {
    throw new Error("Invalid pipeline run id");
  }
  if (options.promptSha256 !== undefined && !/^[a-f0-9]{64}$/u.test(options.promptSha256)) {
    throw new Error("Invalid prompt SHA-256");
  }
  const filtered = options.pipelineRunId !== undefined || options.promptSha256 !== undefined;
  if (options.all && filtered) throw new Error("--all cannot be combined with a filter");
  if (options.apply && !options.all && !filtered) {
    throw new Error("An applied purge needs --pipeline-run-id, --prompt-sha256 or an explicit --all");
  }
}

/** Delete only the AI overlay. Graph properties and human history remain byte-for-byte intact. */
export async function purgeAiAnnotations(db: Database, options: PurgeAiAnnotationsOptions = {}) {
  validatePurgeOptions(options);
  return db.transaction(async (tx) => {
    const where = sql`source = 'ai'
      ${options.pipelineRunId === undefined ? sql`` : sql`AND pipeline_run_id = ${options.pipelineRunId}`}
      ${options.promptSha256 === undefined ? sql`` : sql`AND prompt_sha256 = ${options.promptSha256}`}`;
    const result = options.apply
      ? await tx.execute(sql`DELETE FROM signal_class_annotations WHERE ${where}
          RETURNING city_slug, node_type, node_id, classe, pipeline_run_id, prompt_sha256`)
      : await tx.execute(sql`SELECT city_slug, node_type, node_id, classe, pipeline_run_id, prompt_sha256
          FROM signal_class_annotations WHERE ${where} ORDER BY city_slug, node_type, node_id`);
    const cities = [...new Set(result.rows.map((row) => String(row.city_slug)))].sort();
    if (options.apply) for (const city of cities) await bumpClassAnnotationRevision(tx, city);
    return { kind: "purge-ai-annotations", mode: options.apply ? "apply" : "dry-run",
      filters: { pipelineRunId: options.pipelineRunId ?? null, promptSha256: options.promptSha256 ?? null },
      matched: result.rows.length, deleted: options.apply ? result.rows.length : 0, annotations: result.rows };
  });
}
