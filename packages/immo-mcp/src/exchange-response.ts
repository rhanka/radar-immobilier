/** Read bounded bytes before decoding; never buffer an unbounded issuer response. */
export async function readExchangeResponse(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel();
    throw new Error("exchange_response_too_large");
  }
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error("exchange_response_too_large");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof Error && error.message === "exchange_response_too_large") throw error;
    throw new Error("exchange_unavailable");
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString("utf8");
}
