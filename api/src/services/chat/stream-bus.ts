/**
 * ÉV9 — In-memory chat stream bus.
 *
 * Bridges the mesh stream (server side) to the browser `StreamHub` (client
 * side) over SSE. A `POST /api/chat/messages` opens a stream id and pumps
 * mesh `StreamEvent`s into a buffer; the `GET /api/chat/streams/sse`
 * endpoint replays the buffer for a freshly connected client and then
 * forwards live events. Events are shaped exactly as the StreamHub wire
 * contract expects: a named SSE event whose JSON payload is
 * `{ streamId, sequence, data }`.
 *
 * `@sentropic/chat-core`'s `InMemoryStreamSequencer` provides the per-stream
 * monotonic sequence numbers the StreamHub uses to de-duplicate on replay.
 */

import { InMemory } from "@sentropic/chat-core";

export type StreamFrame = {
  streamId: string;
  type: string;
  sequence: number;
  data: unknown;
};

type Subscriber = (frame: StreamFrame) => void;

const sequencer = new InMemory.InMemoryStreamSequencer();
const buffers = new Map<string, StreamFrame[]>();
const subscribers = new Set<Subscriber>();
const MAX_BUFFER_PER_STREAM = 500;
const MAX_STREAMS = 100;

const nextSequence = (streamId: string): Promise<number> =>
  sequencer.allocate(streamId);

/** Record + fan-out a frame to every connected SSE subscriber. */
export const publish = async (
  streamId: string,
  type: string,
  data: unknown,
): Promise<StreamFrame> => {
  const sequence = await nextSequence(streamId);
  const frame: StreamFrame = { streamId, type, sequence, data };
  if (isStreamTypeRetired(streamId, type)) return frame;

  let buffer = buffers.get(streamId);
  if (!buffer) {
    if (buffers.size >= MAX_STREAMS) {
      const oldest = buffers.keys().next().value;
      if (oldest) buffers.delete(oldest);
    }
    buffer = [];
    buffers.set(streamId, buffer);
  }
  buffer.push(frame);
  if (buffer.length > MAX_BUFFER_PER_STREAM) buffer.shift();

  for (const subscriber of subscribers) {
    try {
      subscriber(frame);
    } catch {
      // ignore a single broken subscriber
    }
  }
  return frame;
};

/** Replay buffered frames for all known streams (newest streams last). */
export const replayAll = (subscriber: Subscriber): void => {
  for (const buffer of buffers.values()) {
    for (const frame of buffer) {
      if (!isStreamTypeRetired(frame.streamId, frame.type)) subscriber(frame);
    }
  }
};

/**
 * 6K: retire legacy mark/batch delivery on the shared prospect stream.
 * Note frames (`prospect:note`) are unaffected. Idempotent.
 */
export const retireLegacyMarkDelivery = (): void => {
  retireStreamTypes("prospect-marks", ["prospect:mark", "prospect:batch"]);
};

/** True once legacy mark/batch delivery has been retired. */
export const isLegacyMarkDeliveryRetired = (): boolean =>
  isStreamTypeRetired("prospect-marks", "prospect:mark")
  && isStreamTypeRetired("prospect-marks", "prospect:batch");

export const subscribe = (subscriber: Subscriber): (() => void) => {
  subscribers.add(subscriber);
  return () => {
    subscribers.delete(subscriber);
  };
};

// ── 6K legacy mark retirement ────────────────────────────────────────────────
// Retired delivery types are neither buffered nor broadcast, so neither new
// nor reconnecting subscribers can receive retired payloads. Notes and
// other types on the same stream keep flowing unchanged.

/** Stream frame types retired by the 6K lot cutover. */
const retiredTypes = new Set<string>();
const retirementSubscribers = new Set<(streamId: string, types: string[]) => void>();

/** Close queued delivery on connections that predate retirement. */
export const subscribeRetirement = (subscriber: (streamId: string, types: string[]) => void): (() => void) => {
  retirementSubscribers.add(subscriber);
  return () => { retirementSubscribers.delete(subscriber); };
};

function retiredKey(streamId: string, type: string): string {
  return `${streamId}::${type}`;
}

/** Stop buffering and broadcasting the given frame types on a stream. */
export const retireStreamTypes = (streamId: string, types: string[]): void => {
  const newlyRetired = types.filter((type) => !isStreamTypeRetired(streamId, type));
  for (const type of types) {
    retiredTypes.add(retiredKey(streamId, type));
    const buffer = buffers.get(streamId);
    if (buffer) {
      const kept = buffer.filter((frame) => frame.type !== type);
      buffers.set(streamId, kept);
    }
  }
  if (newlyRetired.length > 0) {
    for (const subscriber of retirementSubscribers) subscriber(streamId, newlyRetired);
  }
};

/** True once the frame type has been retired on the stream. */
export const isStreamTypeRetired = (streamId: string, type: string): boolean =>
  retiredTypes.has(retiredKey(streamId, type));
