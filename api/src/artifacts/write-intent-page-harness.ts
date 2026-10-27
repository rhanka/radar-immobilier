// Shared vm harness for the PW-C page script tests: executes the exact
// served bytes with stub browser globals and drives clicks and timers.
import { runInNewContext } from "node:vm";
import { PW_PAGE_SCRIPT } from "./write-intent-page.js";

export const HEX64 = "a".repeat(64);
export const UUID = "11111111-1111-4111-8111-111111111111";

export interface GestureDataset {
  pwOperation: string;
  pwWorkspace: string;
  pwCity: string;
  pwType: string;
  pwId: string;
  pwBasket?: string;
  pwReason?: string;
  pwDeselect?: string;
  pwExpectedHead?: string;
  pwExpectedHeads?: string;
  pwFingerprint: string;
  pwToken: string;
}

const SELECT = { pwWorkspace: UUID, pwCity: "demo-town", pwType: "Signal",
  pwFingerprint: HEX64, pwToken: HEX64 };
export const GESTURES: GestureDataset[] = [
  { ...SELECT, pwOperation: "facets.signals.personal.select.v1", pwId: "sig-1", pwBasket: "pertinent" },
  { ...SELECT, pwOperation: "facets.signals.personal.deselect.v1", pwId: "sig-1", pwBasket: "a_surveiller" },
  { ...SELECT, pwOperation: "facets.signals.personal.discard.v1", pwId: "sig-1",
    pwReason: "NON-PERTINENT", pwDeselect: "pertinent",
    pwExpectedHeads: JSON.stringify({ pertinent: null }) },
  { ...SELECT, pwOperation: "facets.signals.personal.restore.v1", pwId: "sig-1" },
  { ...SELECT, pwOperation: "facets.signals.workspace.discard.v1", pwId: "sig-2",
    pwType: "DesignationEvent", pwReason: "NON-PERTINENT" },
  { ...SELECT, pwOperation: "facets.signals.workspace.restore.v1", pwId: "sig-3" },
];

export class FakeElement {
  dataset: Record<string, unknown> = {};
  disabled = false;
  hidden = true;
  textContent = "";
  children: unknown[] = [];
  listeners: Record<string, Array<(event: unknown) => void>> = {};
  selector: string | null = null;
  href = "";
  target = "";
  rel = "";
  constructor(public id: string | null = null) {}
  closest(sel: string): FakeElement | null {
    return sel === this.selector ? this : null;
  }
  addEventListener(type: string, fn: (event: unknown) => void): void {
    (this.listeners[type] ??= []).push(fn);
  }
  appendChild(child: unknown): void {
    this.children.push(child);
  }
  removeChild(child: unknown): void {
    this.children = this.children.filter((entry) => entry !== child);
  }
  get firstChild(): unknown {
    return this.children[0] ?? null;
  }
}

export interface FetchCall {
  url: string;
  options: { method?: string; headers?: Record<string, string>; body?: string };
}

