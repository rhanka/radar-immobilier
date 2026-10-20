/**
 * Query helpers over the minimal XML DOM.
 */

import type { XmlNode } from "./types.js";

export function documentElement(root: XmlNode): XmlNode | null {
  return root.children[0] ?? null;
}

export function childElements(node: XmlNode, name: string): XmlNode[] {
  return node.children.filter((child) => child.name === name);
}

export function firstChild(node: XmlNode, name: string): XmlNode | null {
  return node.children.find((child) => child.name === name) ?? null;
}

export function deepText(node: XmlNode): string {
  let out = node.text;
  for (const child of node.children) out += deepText(child);
  return out;
}

/**
 * Decode one OOXML `_xHHHH_` escape pass over the original text.
 * `String.replace` scans the input once without rescanning replacements,
 * so `_x005F_x0041_` yields the literal `_x0041_` instead of `A`.
 */
export function decodeOoxmlEscapes(input: string): string {
  return input.replace(/_x([0-9A-Fa-f]{4})_/g, (match: string, hex: string): string => {
    const code = Number.parseInt(hex, 16);
    if (!Number.isFinite(code)) return match;
    try {
      return String.fromCodePoint(code);
    } catch {
      return match;
    }
  });
}

/** Collect displayed rich-text runs without decoding, excluding phonetic guides. */
export function spreadsheetRawText(node: XmlNode): string {
  return node.children.map((child) => {
    if (child.name === "t") return child.text;
    if (child.name === "r") return spreadsheetRawText(child);
    return "";
  }).join("");
}

/** Read displayed rich-text runs, excluding indentation and phonetic guides. */
export function spreadsheetText(node: XmlNode): string {
  return decodeOoxmlEscapes(spreadsheetRawText(node));
}
