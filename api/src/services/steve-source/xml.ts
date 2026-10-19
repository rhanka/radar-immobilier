/**
 * Minimal XML parser for OOXML workbook parts.
 *
 * The api package has no XML dependency, so this module implements the small
 * subset needed for spreadsheet parts: elements, attributes, self-closing
 * tags, comments, processing instructions, CDATA and entity references.
 * Namespaces are stripped from element names; attribute names are kept whole
 * (relationship ids arrive as `r:id`).
 */

import { SteveCaptureError } from "./types.js";
import type { XmlNode } from "./types.js";
export type { XmlNode } from "./types.js";

import { decodeEntities, findTagEnd, localName, parseTag } from "./xml-token.js";

/** Deepest element nesting accepted; deeper input is rejected, not recursed. */
export const MAX_XML_DEPTH = 64;

export function parseXml(source: string): XmlNode {
  const root: XmlNode = {
    name: "#document",
    attrs: Object.create(null) as Record<string, string>,
    children: [],
    text: "",
  };
  const stack: XmlNode[] = [root];
  const current = (): XmlNode => {
    const node = stack[stack.length - 1];
    if (node === undefined) throw new SteveCaptureError("XML parser stack underflow");
    return node;
  };
  let i = 0;
  while (i < source.length) {
    const lt = source.indexOf("<", i);
    if (lt === -1) {
      current().text += decodeEntities(source.slice(i));
      break;
    }
    if (lt > i) current().text += decodeEntities(source.slice(i, lt));
    if (source.startsWith("<!--", lt)) {
      const end = source.indexOf("-->", lt + 4);
      if (end === -1) throw new SteveCaptureError("unterminated XML comment");
      i = end + 3;
    } else if (source.startsWith("<![CDATA[", lt)) {
      const end = source.indexOf("]]>", lt + 9);
      if (end === -1) throw new SteveCaptureError("unterminated CDATA section");
      current().text += source.slice(lt + 9, end);
      i = end + 3;
    } else if (source.startsWith("<?", lt)) {
      const end = source.indexOf("?>", lt + 2);
      if (end === -1) throw new SteveCaptureError("unterminated processing instruction");
      i = end + 2;
    } else if (source.startsWith("<!", lt)) {
      throw new SteveCaptureError("unsupported XML declaration");
    } else if (source.startsWith("</", lt)) {
      const end = source.indexOf(">", lt + 2);
      if (end === -1) throw new SteveCaptureError("unterminated closing tag");
      const name = localName(source.slice(lt + 2, end).trim());
      const node = stack.pop();
      if (node === undefined || node.name !== name) {
        throw new SteveCaptureError(`mismatched closing tag: "${name}"`);
      }
      i = end + 1;
    } else {
      const end = findTagEnd(source, lt + 1);
      if (end === -1) throw new SteveCaptureError("unterminated opening tag");
      let inner = source.slice(lt + 1, end);
      const selfClosing = inner.endsWith("/");
      if (selfClosing) inner = inner.slice(0, -1);
      const { tagName, attrs } = parseTag(inner);
      if (tagName === "") throw new SteveCaptureError("empty tag name");
      if (stack.length > MAX_XML_DEPTH) {
        throw new SteveCaptureError(
          `XML element nesting exceeds the ${String(MAX_XML_DEPTH)}-level limit`,
        );
      }
      const node: XmlNode = { name: tagName, attrs, children: [], text: "" };
      current().children.push(node);
      if (!selfClosing) {
        stack.push(node);
      }
      i = end + 1;
    }
  }
  if (stack.length !== 1) throw new SteveCaptureError("unterminated element in XML");
  if (root.children.length !== 1 || root.text.trim() !== "") {
    throw new SteveCaptureError("expected exactly one XML document element");
  }
  return root;
}

export { childElements, deepText, documentElement, firstChild } from "./xml-query.js";
