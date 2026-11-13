import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { facetCommands, facetCommandContexts } from "../../db/schema.js";
import { lockWorkspace } from "../workspaces/mutations.js";
import { approvedAccountId, resolveWorkspaceAccess } from "../workspaces/store.js";
import { WorkspaceError } from "../workspaces/types.js";
import { FACET_PROFILE } from "../facets/codebook.js";
import { requireScopedEpoch } from "../facets/scope.js";
import { scopedEpochFor } from "../facets/activation.js";
import { readCommand } from "../facets/commands.js";
import { writeScopedPersonalFacetInTx } from "../facets/scoped-writer.js";
import { writeWorkspaceArchiveFacetInTx } from "../facets/workspace-writer.js";
import { digest, FacetError } from "../facets/target.js";
import type { ClassFeedbackCommand } from "./class-feedback-command.js";

/** Preserve the existing scope writers and commit feedback with their transitions. */
export async function writeClassFeedback(db: Database, sub: string, workspaceId: string, command: ClassFeedbackCommand) {
  return db.transaction(async (tx) => {
    await lockWorkspace(tx, workspaceId);
    const actor = await approvedAccountId(tx, sub, true);
    const access = await resolveWorkspaceAccess(tx, workspaceId, sub);
    requireScopedEpoch(await scopedEpochFor(tx, workspaceId), workspaceId);
    if (command.scope === "workspace" && !access.moderateArchive) {
      throw new WorkspaceError(403, "workspace_capability_required");
    }
    const key = command.commandKey.toLowerCase();
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(["scoped-command", actor, key])},0))`);
    const hash = digest({ workspaceId, ...command, commandKey: key });
    const previous = await tx.execute(sql`SELECT id,command_digest FROM signal_class_feedback
      WHERE actor_id=${actor} AND command_key=${key}`);
    if (previous.rows[0]) {
      if (previous.rows[0].command_digest !== hash) throw new FacetError(409, "idempotency_key_conflict");
      return String(previous.rows[0].id);
    }
    if (await readCommand(tx, actor, key, hash) !== undefined) throw new FacetError(409, "idempotency_key_conflict");
    // Match the AI writer's table-before-row order. Exclude AI replacement until commit.
    await tx.execute(sql`LOCK TABLE facet_events IN ROW EXCLUSIVE MODE`);
    const { target, annotation } = command;
    const rows = await tx.execute(sql`SELECT * FROM signal_class_annotations
      WHERE city_slug=${target.citySlug} AND node_type=${target.type} AND node_id=${target.id} FOR UPDATE`);
    const ai = rows.rows[0];
    if (!ai || ai.source !== "ai" || ai.model !== annotation.model || ai.prompt_sha256 !== annotation.promptSha256
      || ai.pipeline_run_id !== annotation.pipelineRunId || ai.classe !== annotation.classe
      || new Date(String(ai.updated_at)).getTime() !== new Date(annotation.updatedAt).getTime()) {
      throw new FacetError(409, "annotation_version_conflict");
    }
    const next = command.verdict === "up" ? annotation.classe : command.nextClass!;
    const id = randomUUID();
    const validation = command.verdict === "up" ? { validatedAiFeedbackId: id } : {};
    let reasonCode = command.reasonCode;
    if (command.verdict === "down") {
      const codes = await tx.execute(sql`SELECT code FROM facet_reason_codes WHERE profile_id=${FACET_PROFILE}
        AND verdict=${next === "ecarte" ? "non_pertinent" : next}
        AND code=${reasonCode!} LIMIT 1`);
      if (!codes.rows[0]) throw new FacetError(400, "invalid_reclassification_reason");
      reasonCode = String(codes.rows[0].code);
    }
    const base = { target, displayedFingerprint: command.displayedFingerprint };
    const personal = (part: Parameters<typeof writeScopedPersonalFacetInTx>[3]) =>
      writeScopedPersonalFacetInTx(tx, sub, workspaceId, part, validation);
    let event: Awaited<ReturnType<typeof writeScopedPersonalFacetInTx>>;
    if (command.scope === "workspace") {
      event = await writeWorkspaceArchiveFacetInTx(tx, sub, workspaceId, { ...base, action: "discard",
        reasonCode, expectedHeadId: command.archives.workspace, commandKey: randomUUID() }, validation);
    } else {
      if (command.archives.workspace && next !== "ecarte") {
        await writeWorkspaceArchiveFacetInTx(tx, sub, workspaceId, { ...base, action: "restore",
          expectedHeadId: command.archives.workspace, commandKey: randomUUID() });
      }
      if (command.archives.personal && next !== "ecarte") {
        await personal({ ...base, action: "restore", expectedHeadId: command.archives.personal, commandKey: randomUUID() });
      }
      for (const basket of ["pertinent", "a_surveiller"] as const) {
        if (next !== basket && command.selectionHeads[basket]) {
          await personal({ ...base, action: "deselect", basket,
            expectedHeadId: command.selectionHeads[basket], commandKey: randomUUID() });
        }
      }
      event = next === "ecarte"
        ? await personal({ ...base, action: "discard", reasonCode,
          expectedHeadId: command.archives.personal, commandKey: randomUUID() })
        : await personal({ ...base, action: next === "non_classe" ? "deselect" : "select",
          basket: next === "non_classe" ? "pertinent" : next, ...(reasonCode ? { reasonCode } : {}),
          expectedHeadId: command.selectionHeads[next === "non_classe" ? "pertinent" : next], commandKey: randomUUID() });
    }
    if (!event) throw new FacetError(409, "manual_annotation_required");
    const history = await tx.execute(sql`SELECT id FROM signal_class_annotation_history
      WHERE city_slug=${target.citySlug} AND node_type=${target.type} AND node_id=${target.id}
        AND model=${ai.model} AND prompt_sha256=${ai.prompt_sha256} AND pipeline_run_id=${ai.pipeline_run_id}
      ORDER BY created_at DESC,id DESC LIMIT 1`);
    const reason = command.verdict === "up" ? `validé : ${ai.reason}` : command.reasonCode!;
    await tx.execute(sql`INSERT INTO signal_class_feedback
      (id,city_slug,node_type,node_id,workspace_id,actor_id,scope,command_key,command_digest,verdict,
       annotation_id,source,model,prompt_sha256,pipeline_run_id,judged_class,human_class,reason_code,reason,comment,event_id)
      VALUES (${id},${target.citySlug},${target.type},${target.id},${workspaceId},${actor},${command.scope},${key},${hash},
        ${command.verdict},${history.rows[0]!.id},'ai',${ai.model},${ai.prompt_sha256},${ai.pipeline_run_id},${ai.classe},
        ${next},${reasonCode ?? null},${reason},${command.comment ?? null},${event.id})`);
    await tx.insert(facetCommands).values({ ownerId: actor, commandKey: key, commandDigest: hash,
      result: { event: null, context: { workspaceId, operation: "class-feedback-v1", feedbackId: id } } });
    await tx.insert(facetCommandContexts).values({ ownerId: actor, commandKey: key,
      workspaceId, status: "resolved", commandDigest: hash });
    return id;
  });
}
