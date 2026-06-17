import { describe, expect, it } from "vitest";
import {
  DIMMED_SELECTION_OPACITY,
  FULL_SELECTION_OPACITY,
  clearSelectionGroup,
  createSelectionBucketState,
  deriveOpacity,
  makeKey,
  parseKey,
  removeSelection,
  selectionVisualState,
  setFocus,
  setHover,
  toggleExpansion,
  toggleSelection,
} from "./selection-bucket.js";

describe("selection bucket keys", () => {
  it("round-trips ids with spaces and separators", () => {
    const key = makeKey("lot", "4 516:943");

    expect(key).toBe("lot:4%20516%3A943");
    expect(parseKey(key)).toEqual({ kind: "lot", id: "4 516:943" });
  });

  it("rejects malformed keys", () => {
    expect(parseKey("lot")).toBeNull();
    expect(parseKey("unknown:abc")).toBeNull();
    expect(parseKey("lot:%E0%A4%A")).toBeNull();
  });
});

describe("selection bucket state", () => {
  it("toggles selected keys without mutating the original Set", () => {
    const cityKey = makeKey("municipality", "salaberry-de-valleyfield");
    const zoneKey = makeKey("zone", "salaberry-de-valleyfield/H-609");
    const original = createSelectionBucketState({ selectedKeys: [cityKey] });

    const next = toggleSelection(original, zoneKey);

    expect(original.selectedKeys.has(zoneKey)).toBe(false);
    expect(next.selectedKeys.has(cityKey)).toBe(true);
    expect(next.selectedKeys.has(zoneKey)).toBe(true);
    expect(next.selectedKeys).not.toBe(original.selectedKeys);
  });

  it("selects only the explicit key, not descendants", () => {
    const cityKey = makeKey("municipality", "salaberry-de-valleyfield");
    const zoneKey = makeKey("zone", "salaberry-de-valleyfield/H-609");
    const lotKey = makeKey("lot", "salaberry-de-valleyfield/4 516 943");

    const next = toggleSelection(createSelectionBucketState(), cityKey);

    expect(next.selectedKeys).toEqual(new Set([cityKey]));
    expect(next.selectedKeys.has(zoneKey)).toBe(false);
    expect(next.selectedKeys.has(lotKey)).toBe(false);
  });

  it("removes a selected key and clears focus/hover for that key only", () => {
    const cityKey = makeKey("municipality", "salaberry-de-valleyfield");
    const signalKey = makeKey("signal", "sig-1");
    const original = createSelectionBucketState({
      selectedKeys: [cityKey, signalKey],
      focusedKey: cityKey,
      hoveredKey: signalKey,
      expandedKeys: [cityKey, signalKey],
    });

    const next = removeSelection(original, cityKey);

    expect(original.selectedKeys.has(cityKey)).toBe(true);
    expect(next.selectedKeys.has(cityKey)).toBe(false);
    expect(next.selectedKeys.has(signalKey)).toBe(true);
    expect(next.focusedKey).toBeNull();
    expect(next.hoveredKey).toBe(signalKey);
    expect(next.expandedKeys.has(cityKey)).toBe(false);
    expect(original.expandedKeys.has(cityKey)).toBe(true);
  });

  it("clears a kind group without mutating selected or expanded Sets", () => {
    const cityKey = makeKey("municipality", "salaberry-de-valleyfield");
    const zoneKey = makeKey("zone", "salaberry-de-valleyfield/H-609");
    const lotKey = makeKey("lot", "salaberry-de-valleyfield/4 516 943");
    const original = createSelectionBucketState({
      selectedKeys: [cityKey, zoneKey, lotKey],
      focusedKey: zoneKey,
      hoveredKey: lotKey,
      expandedKeys: [zoneKey, lotKey],
    });

    const next = clearSelectionGroup(original, "zone");

    expect(next.selectedKeys.has(cityKey)).toBe(true);
    expect(next.selectedKeys.has(zoneKey)).toBe(false);
    expect(next.selectedKeys.has(lotKey)).toBe(true);
    expect(next.expandedKeys.has(zoneKey)).toBe(false);
    expect(next.expandedKeys.has(lotKey)).toBe(true);
    expect(next.focusedKey).toBeNull();
    expect(next.hoveredKey).toBe(lotKey);
    expect(next.selectedKeys).not.toBe(original.selectedKeys);
    expect(next.expandedKeys).not.toBe(original.expandedKeys);
    expect(original.selectedKeys.has(zoneKey)).toBe(true);
  });

  it("sets focus, hover, and expansion immutably", () => {
    const zoneKey = makeKey("zone", "salaberry-de-valleyfield/H-609");
    const empty = createSelectionBucketState();

    const focused = setFocus(empty, zoneKey);
    const hovered = setHover(focused, zoneKey);
    const expanded = toggleExpansion(hovered, zoneKey);
    const collapsed = toggleExpansion(expanded, zoneKey);

    expect(empty.focusedKey).toBeNull();
    expect(focused.focusedKey).toBe(zoneKey);
    expect(hovered.hoveredKey).toBe(zoneKey);
    expect(expanded.expandedKeys.has(zoneKey)).toBe(true);
    expect(collapsed.expandedKeys.has(zoneKey)).toBe(false);
    expect(expanded.expandedKeys).not.toBe(hovered.expandedKeys);
    expect(collapsed.expandedKeys).not.toBe(expanded.expandedKeys);
  });
});

describe("selection bucket visual state", () => {
  it("keeps full opacity while the bucket is empty", () => {
    const state = createSelectionBucketState();
    const cityKey = makeKey("municipality", "salaberry-de-valleyfield");

    expect(deriveOpacity(state, cityKey)).toBe(FULL_SELECTION_OPACITY);
    expect(selectionVisualState(state, cityKey)).toMatchObject({
      selected: false,
      dimmed: false,
      opacity: FULL_SELECTION_OPACITY,
    });
  });

  it("dims unselected entities to 50 percent once the bucket is non-empty", () => {
    const selectedKey = makeKey("signal", "sig-1");
    const otherKey = makeKey("zone", "salaberry-de-valleyfield/H-609");
    const state = createSelectionBucketState({
      selectedKeys: [selectedKey],
      focusedKey: selectedKey,
      hoveredKey: otherKey,
    });

    expect(deriveOpacity(state, selectedKey)).toBe(FULL_SELECTION_OPACITY);
    expect(deriveOpacity(state, otherKey)).toBe(DIMMED_SELECTION_OPACITY);
    expect(selectionVisualState(state, selectedKey)).toMatchObject({
      selected: true,
      focused: true,
      opacity: FULL_SELECTION_OPACITY,
    });
    expect(selectionVisualState(state, otherKey)).toMatchObject({
      selected: false,
      hovered: true,
      dimmed: true,
      opacity: DIMMED_SELECTION_OPACITY,
    });
  });
});
