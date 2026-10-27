/** Allocation limits shared by every parsed part of one capture. */
export const MAX_XML_ELEMENTS = 500_000;
export const MAX_XML_CELLS = 250_000;
export const MAX_XML_ATTRIBUTES = 1_000_000;
export const MAX_XML_ATTRIBUTES_PER_ELEMENT = 256;

export interface XmlBudget {
  elements: number;
  cells: number;
  attributes: number;
}

export function createXmlBudget(): XmlBudget {
  return { elements: 0, cells: 0, attributes: 0 };
}
