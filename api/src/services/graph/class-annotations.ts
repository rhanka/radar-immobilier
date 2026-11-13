import { sql } from "drizzle-orm";
import type { Database } from "../../db/client.js";

export type SignalClass = "pertinent" | "a_surveiller" | "non_classe" | "ecarte";
export interface ClassAnnotation {
  citySlug: string;
  nodeType: string;
  nodeId: string;
  classe: SignalClass;
  reason: string;
  source: "ai" | "manual";
  model: string | null;
  effort: string | null;
  promptId: string | null;
  promptSha256: string | null;
  pipelineRunId: string | null;
  inputSha256: string | null;
}
export type AiClassAnnotation = ClassAnnotation & {
  source: "ai"; model: string; effort: string; promptId: string;
  promptSha256: string; pipelineRunId: string; inputSha256: string;
};

/** Human history, including deselections and restored archives, remains authoritative. */
export async function writeClassAnnotation(db: Database, input: AiClassAnnotation): Promise<"written" | "manual" | "noop"> {
  return db.transaction(async (tx) => {
    // Existing human writers acquire ROW EXCLUSIVE on insertion. SHARE prevents
    // a human insert between the history check and this AI commit.
    await tx.execute(sql`LOCK TABLE facet_events IN SHARE MODE`);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([
      "class-annotation", input.citySlug, input.nodeType, input.nodeId,
    ])}, 0))`);
    const manual = await tx.execute(sql`SELECT 1 FROM facet_events WHERE target_type = 'signal'
      AND city_slug = ${input.citySlug} AND node_type = ${input.nodeType} AND node_id = ${input.nodeId}
      AND source = 'manual' LIMIT 1`);
    if (manual.rows.length) return "manual";
    const result = await tx.execute(sql`INSERT INTO signal_class_annotations
      (city_slug,node_type,node_id,classe,reason,source,model,effort,prompt_id,prompt_sha256,pipeline_run_id,input_sha256)
      VALUES (${input.citySlug},${input.nodeType},${input.nodeId},${input.classe},${input.reason},'ai',
        ${input.model},${input.effort},${input.promptId},${input.promptSha256},${input.pipelineRunId},${input.inputSha256})
      ON CONFLICT (city_slug,node_type,node_id) DO UPDATE SET classe = EXCLUDED.classe,
        reason = EXCLUDED.reason, model = EXCLUDED.model, effort = EXCLUDED.effort,
        prompt_id = EXCLUDED.prompt_id, prompt_sha256 = EXCLUDED.prompt_sha256,
        pipeline_run_id = EXCLUDED.pipeline_run_id, input_sha256 = EXCLUDED.input_sha256, updated_at = now()
      WHERE signal_class_annotations.source = 'ai' AND
        (signal_class_annotations.prompt_sha256,signal_class_annotations.input_sha256,
         signal_class_annotations.model,signal_class_annotations.effort) IS DISTINCT FROM
        (EXCLUDED.prompt_sha256,EXCLUDED.input_sha256,EXCLUDED.model,EXCLUDED.effort)
      RETURNING node_id`);
    if (result.rows.length) return "written";
    const current = await tx.execute(sql`SELECT source FROM signal_class_annotations
      WHERE city_slug=${input.citySlug} AND node_type=${input.nodeType} AND node_id=${input.nodeId}`);
    return current.rows[0]?.source === "manual" ? "manual" : "noop";
  });
}

export async function readClassAnnotations(db: Database, citySlug: string): Promise<Map<string, ClassAnnotation>> {
  const result = await db.execute(sql`SELECT city_slug AS "citySlug", node_type AS "nodeType", node_id AS "nodeId",
    classe, reason, source, model, effort, prompt_id AS "promptId", prompt_sha256 AS "promptSha256",
    pipeline_run_id AS "pipelineRunId", input_sha256 AS "inputSha256" FROM signal_class_annotations
    WHERE city_slug = ${citySlug}`);
  const annotations = new Map(result.rows.map((row) => {
    const value = row as unknown as ClassAnnotation;
    return [`${value.nodeType}:${value.nodeId}`, value] as const;
  }));
  const manual = await db.execute(sql`SELECT DISTINCT node_type, node_id FROM facet_events
    WHERE target_type='signal' AND city_slug=${citySlug} AND source='manual'`);
  for (const row of manual.rows) {
    // Do not disclose another user's class or reason through the public graph card.
    annotations.set(`${row.node_type}:${row.node_id}`, { citySlug, nodeType: String(row.node_type),
      nodeId: String(row.node_id), source: "manual", classe: "non_classe", reason: "",
      model: null, effort: null, promptId: null, promptSha256: null, pipelineRunId: null, inputSha256: null });
  }
  return annotations;
}
