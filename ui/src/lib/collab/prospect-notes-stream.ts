/**
 * prospect-notes-stream — abonnement TEMPS RÉEL aux annotations « Domaine
 * collaboratif » (§2, PR2), par-dessus le `StreamHub` du chat (`@sentropic/
 * chat-ui`). Le endpoint SSE `/api/chat/streams/sse` fan-out TOUS les streams :
 * les frames `prospect:note` (émises par l'api sur le stream `prospect-marks`)
 * y transitent déjà — on s'y abonne sans toucher ni api ni chat.
 *
 * Le hub délivre des frames génériques `{ type, streamId, sequence, data }` ;
 * on ne garde que `type === "prospect:note"` (on ignore `prospect:mark`,
 * `prospect:batch`, `ping`, …). Sur une frame qui concerne la cible affichée,
 * le composant **refetch** `listAnnotations(target)` (idempotent, aligné sur le
 * pattern refetch-after-mutation ; évite le souci auteur imbriqué/plat de la
 * forme POST/PATCH vs GET).
 */
import { getStreamHub } from "$lib/chat/chat-client.js";
import type { AnnotationTarget, AnnotationTargetType } from "$lib/collab/annotation.js";

/** Stream serveur portant les frames prospect (voir api `PROSPECT_STREAM_ID`). */
export const PROSPECT_STREAM_ID = "prospect-marks";
/** Nom d'event SSE des annotations (add/edit/delete). */
export const PROSPECT_NOTE_EVENT = "prospect:note";

/** Note portée par une frame `prospect:note` (sous-ensemble utile au match). */
export interface ProspectNoteFrameNote {
  id: string;
  targetType: AnnotationTargetType;
  noLot?: string | null;
  citySlug?: string | null;
  signalId?: string | null;
}

/** Payload `data` d'une frame `prospect:note`. */
export interface ProspectNoteFrame {
  action: "add" | "edit" | "delete";
  note: ProspectNoteFrameNote;
}

export type NoteFrameHandler = (frame: ProspectNoteFrame) => void;

/** Clés d'abonnement uniques : le hub dédoublonne par clé, donc chaque instance
 *  de composant doit s'abonner sous une clé distincte (sinon écrasement). */
let keySeq = 0;

function isProspectNoteFrame(data: unknown): data is ProspectNoteFrame {
  if (!data || typeof data !== "object") return false;
  const d = data as { action?: unknown; note?: unknown };
  if (d.action !== "add" && d.action !== "edit" && d.action !== "delete") return false;
  const note = d.note as { id?: unknown; targetType?: unknown } | undefined;
  return !!note && typeof note === "object"
    && typeof note.id === "string"
    && (note.targetType === "signal" || note.targetType === "lot");
}

/**
 * S'abonne aux frames `prospect:note`. Retourne un désabonnement.
 * `onFrame` n'est appelé QUE pour les frames `prospect:note` bien formées.
 */
export function subscribeNoteFrames(onFrame: NoteFrameHandler): () => void {
  const hub = getStreamHub();
  const key = `prospect-notes:${(keySeq += 1)}`;
  hub.setStream(key, PROSPECT_STREAM_ID, (event) => {
    if (event.type !== PROSPECT_NOTE_EVENT) return;
    const data = (event as { data?: unknown }).data;
    if (!isProspectNoteFrame(data)) return;
    onFrame(data);
  });
  return () => hub.delete(key);
}

/** Vrai si la note d'une frame concerne la cible affichée (signal|lot). */
export function noteMatchesTarget(note: ProspectNoteFrameNote, target: AnnotationTarget): boolean {
  if (note.targetType !== target.type) return false;
  if (target.type === "signal") {
    return note.signalId === target.id;
  }
  // lot : discriminé par no_lot + city_slug
  return note.noLot === target.id && note.citySlug === target.citySlug;
}
