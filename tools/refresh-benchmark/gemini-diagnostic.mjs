export const CLOUD_CODE_ENDPOINTS = Object.freeze({
  mesh: "https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse",
  agy: "https://cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse",
});

const redactMessage = (value) => String(value ?? "")
  .slice(0, 400)
  .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
  .replace(/(Bearer\s+)\S+/gi, "$1[redacted]")
  .replace(/(project\s+)[A-Z0-9][A-Z0-9._:-]*/gi, "$1[redacted-project]");

export function sanitizeCloudCodeError(payload) {
  const candidate = payload?.error && typeof payload.error === "object"
    ? payload.error : payload;
  return {
    code: typeof candidate?.code === "number" ? candidate.code : null,
    status: typeof candidate?.status === "string" ? candidate.status : null,
    message: redactMessage(candidate?.message),
  };
}

export function buildProbeRequest({ model, effort }) {
  return {
    modelId: model,
    messages: [{ role: "user", content: "Reply with PING_OK only." }],
    maxOutputTokens: 64,
    ...(effort ? { reasoning: { effort } } : {}),
  };
}
