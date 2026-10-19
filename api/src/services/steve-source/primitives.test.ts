import { describe, expect, it } from "vitest";
import { parseA1, columnIndexToLetters } from "./cell-ref.js";
import { SteveCaptureError } from "./types.js";

describe("workbook coordinates", () => {
  it("round-trips the final Excel column", () => {
    expect(parseA1("XFD1048576")).toEqual({ row: 1048576, col: 16384 });
    expect(columnIndexToLetters(16384)).toBe("XFD");
  });
  it.each(["A0", "A1048577", "XFE1", "A9007199254740992"])("rejects %s", (ref) => {
    expect(() => parseA1(ref)).toThrow(SteveCaptureError);
  });
});

import { decodeEntities } from "./xml-token.js";

describe("XML text", () => {
  it("decodes accents, escaped markup and numeric references once", () => {
    expect(decodeEntities("&#xCE;le &amp; fa&#231;ade &amp;lt;"))
      .toBe("Île & façade &lt;");
  });
  it.each(["&unknown;", "&amp", "&#0;", "&#x110000;"])("rejects %s", (text) => {
    expect(() => decodeEntities(text)).toThrow(SteveCaptureError);
  });
});

import { parseXml } from "./xml.js";
import { documentElement, spreadsheetText } from "./xml-query.js";

describe("OOXML parsing", () => {
  it("reads namespaces, comments, CDATA, escaped attributes and rich runs", () => {
    const node = documentElement(parseXml(`<?xml version="1.0"?><!--test-->
      <s:si xmlns:s="urn:test" label="A &gt; B"><r><t><![CDATA[Île & façade]]></t></r></s:si>`));
    expect(node?.attrs["label"]).toBe("A > B");
    expect(node === null ? null : spreadsheetText(node)).toBe("Île & façade");
  });
  it.each(["<a/><b/>", "<a></b>", "<a>", '<a x="1" x="2"/>', "<a x=no/>", "<!DOCTYPE a><a/>"])(
    "rejects malformed or unsupported XML %s", (xml) => {
      expect(() => parseXml(xml)).toThrow(SteveCaptureError);
    },
  );
});

import { crc32 } from "./crc32.js";

it("matches the standard ZIP CRC-32 reference vector", () => {
  expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
});
