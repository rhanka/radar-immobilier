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

/** Read displayed rich-text runs, excluding indentation and phonetic guides. */
export function spreadsheetText(node: XmlNode): string {
  return node.children.map((child) => {
    if (child.name === "t") return child.text;
    if (child.name === "r") return spreadsheetText(child);
    return "";
  }).join("");
}
