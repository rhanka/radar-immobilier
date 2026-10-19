import { describe, expect, it } from "vitest";
import { parseXml } from "./xml.js";
import { createXmlBudget, MAX_XML_ATTRIBUTES, MAX_XML_CELLS, MAX_XML_ELEMENTS } from "./xml-budget.js";

describe("XML attribute allocation budgets", () => {
  it("accepts 256 attributes and rejects the next before storing it", () => {
    const attrs = Array.from({ length: 256 }, (_, i) => ` a${String(i)}="v"`).join("");
    expect(() => parseXml(`<a${attrs}/>`)).not.toThrow();
    expect(() => parseXml(`<a${attrs} overflow="v"/>`)).toThrow(/256-attribute per-element limit/);
  });

  it("counts elements, cells and attributes across parser calls", () => {
    const budget = createXmlBudget();
    parseXml('<a x="1"><c/></a>', budget);
    parseXml('<c y="2"/>', budget);
    expect(budget).toEqual({ elements: 3, cells: 2, attributes: 2 });
    expect(createXmlBudget()).toEqual({ elements: 0, cells: 0, attributes: 0 });
  });

  it.each([
    ["elements", MAX_XML_ELEMENTS, "<a/>", "element"],
    ["cells", MAX_XML_CELLS, "<c/>", "cell"],
    ["attributes", MAX_XML_ATTRIBUTES, '<a x=""/>', "attribute"],
  ] as const)("accepts the cumulative %s boundary and rejects the next part", (key, limit, xml, kind) => {
    const budget = createXmlBudget();
    budget[key] = limit - 1;
    expect(() => parseXml(xml, budget)).not.toThrow();
    expect(budget[key]).toBe(limit);
    expect(() => parseXml(xml, budget)).toThrow(`XML capture exceeds the ${String(limit)}-${kind} limit`);
  });
});
