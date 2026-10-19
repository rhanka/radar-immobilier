import { SteveCaptureError } from "./types.js";

export function localName(raw: string): string {
  const sep = raw.indexOf(":");
  return sep === -1 ? raw : raw.slice(sep + 1);
}

export function decodeEntities(input: string): string {
  return input.replace(
    /&(?:lt|gt|amp|quot|apos|#[0-9]+|#x[0-9a-fA-F]+);|&/g,
    (entity: string): string => {
      switch (entity) {
        case "&lt;":
          return "<";
        case "&gt;":
          return ">";
        case "&amp;":
          return "&";
        case "&quot;":
          return '"';
        case "&apos;":
          return "'";
        default: {
          const body = entity.slice(1, -1);
          const code = body.startsWith("#x")
            ? Number.parseInt(body.slice(2), 16)
            : Number.parseInt(body.slice(1), 10);
          if (!Number.isFinite(code) || code === 0 || (code >= 0xd800 && code <= 0xdfff)) {
            throw new SteveCaptureError("invalid XML entity");
          }
          try {
            return String.fromCodePoint(code);
          } catch {
            throw new SteveCaptureError("invalid XML character reference");
          }
        }
      }
    },
  );
}

export function parseTag(inner: string): { tagName: string; attrs: Record<string, string> } {
  // Null-prototype map: an attribute literally named `__proto__` stays an own
  // property instead of mutating the object prototype.
  const attrs: Record<string, string> = Object.create(null) as Record<string, string>;
  const nameMatch = /^\s*([^\s/=]+)/.exec(inner);
  const rawName = nameMatch?.[1] ?? "";
  const rest = rawName === "" ? "" : inner.slice(inner.indexOf(rawName) + rawName.length);
  const attrRe = /([^\s=]+)\s*=\s*("[^"]*"|'[^']*')/g;
  let m: RegExpExecArray | null;
  let consumed = 0;
  while ((m = attrRe.exec(rest)) !== null) {
    const key = m[1] ?? "";
    const quoted = m[2] ?? '""';
    if (rest.slice(consumed, m.index).trim() !== "" || Object.hasOwn(attrs, key)) {
      throw new SteveCaptureError("invalid or duplicate XML attribute");
    }
    attrs[key] = decodeEntities(quoted.slice(1, -1));
    consumed = attrRe.lastIndex;
  }
  if (rest.slice(consumed).trim() !== "") throw new SteveCaptureError("invalid XML attributes");
  return { tagName: localName(rawName), attrs };
}

export function findTagEnd(source: string, from: number): number {
  let quote: string | null = null;
  for (let j = from; j < source.length; j++) {
    const ch = source[j] ?? "";
    if (quote !== null) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ">") {
      return j;
    }
  }
  return -1;
}
