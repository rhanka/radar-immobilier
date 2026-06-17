import {
  makeKey,
  type BucketEntity,
  type BucketGeometryState,
  type BucketKind,
  type SelectionKey,
} from "./selection-bucket.js";
import type { CityMapEntry } from "./maps-data.js";
import type { GraphSignalNode } from "$lib/signals/graph-signal-detail-client.js";
import type {
  CadastreCityLayers,
  GeoJsonGeometry,
} from "./cadastre-geojson-source.js";
import type { LotFeatureCollection, LotGeometry } from "./lots-client.js";

type ByCity<T> = ReadonlyMap<string, T> | Readonly<Record<string, T | undefined>>;

export interface BuildSignauxMapEntitiesInput {
  municipalities: readonly CityMapEntry[];
  signalNodesByCity?: ByCity<readonly GraphSignalNode[]>;
  cadastreLayersByCity?: ByCity<CadastreCityLayers | null>;
  lotCollectionsByCity?: ByCity<LotFeatureCollection | null>;
}

export interface SignauxMapEntity extends BucketEntity {
  geometry?: GeoJsonGeometry | LotGeometry | null;
  source: "city-map-entry" | "graph-signal-node" | "cadastre-layers" | "lots-client";
}

export type EntityChildrenByKind = Readonly<Record<BucketKind, readonly SelectionKey[]>>;
export type EntitiesByKind = Readonly<Record<BucketKind, readonly SignauxMapEntity[]>>;

export interface GeometryAvailability {
  zones: BucketGeometryState;
  lots: BucketGeometryState;
}

export interface SignauxMapEntities {
  rootKeys: readonly SelectionKey[];
  byKey: ReadonlyMap<SelectionKey, SignauxMapEntity>;
  byKind: EntitiesByKind;
  childrenByKey: ReadonlyMap<SelectionKey, EntityChildrenByKind>;
  availabilityByMunicipality: ReadonlyMap<SelectionKey, GeometryAvailability>;
}

const EMPTY_CHILDREN: EntityChildrenByKind = Object.freeze({
  municipality: Object.freeze([]),
  signal: Object.freeze([]),
  zone: Object.freeze([]),
  lot: Object.freeze([]),
});

export function buildSignauxMapEntities(
  input: BuildSignauxMapEntitiesInput,
): SignauxMapEntities {
  const byKey = new Map<SelectionKey, Omit<SignauxMapEntity, "childKeys">>();
  const orderedKeysByKind: Record<BucketKind, SelectionKey[]> = {
    municipality: [],
    signal: [],
    zone: [],
    lot: [],
  };
  const childKeysByParent = new Map<SelectionKey, SelectionKey[]>();
  const typedChildrenByParent = new Map<SelectionKey, Record<BucketKind, SelectionKey[]>>();
  const rootKeys: SelectionKey[] = [];
  const availabilityByMunicipality = new Map<SelectionKey, GeometryAvailability>();

  function addEntity(entity: Omit<SignauxMapEntity, "childKeys">): void {
    if (byKey.has(entity.key)) return;
    byKey.set(entity.key, entity);
    orderedKeysByKind[entity.kind].push(entity.key);
    childKeysByParent.set(entity.key, []);
    typedChildrenByParent.set(entity.key, createMutableChildren());
  }

  function addChild(
    parentKey: SelectionKey,
    kind: BucketKind,
    childKey: SelectionKey,
  ): void {
    const flatChildren = childKeysByParent.get(parentKey) ?? [];
    if (!flatChildren.includes(childKey)) flatChildren.push(childKey);
    childKeysByParent.set(parentKey, flatChildren);

    const typedChildren = typedChildrenByParent.get(parentKey) ?? createMutableChildren();
    if (!typedChildren[kind].includes(childKey)) typedChildren[kind].push(childKey);
    typedChildrenByParent.set(parentKey, typedChildren);
  }

  for (const entry of input.municipalities) {
    const citySlug = entry.municipality.slug;
    const cityKey = makeKey("municipality", citySlug);
    rootKeys.push(cityKey);
    addEntity({
      key: cityKey,
      kind: "municipality",
      id: citySlug,
      label: entry.municipality.name,
      parentKey: null,
      geometryState: "present",
      source: "city-map-entry",
      meta: {
        mrc: entry.municipality.mrc,
        signalCount6m: entry.signalCount6m,
      },
    });

    let hasZoneGeometry = false;
    let hasZoneText = false;
    let hasLotGeometry = false;
    let hasLotText = false;

    const cadastre = getByCity(input.cadastreLayersByCity, citySlug) ?? null;
    const zoneRefs = new Set<string>();

    for (const zone of cadastre?.zones.features ?? []) {
      const zoneRef = normalizeRef(zone.properties.zone);
      if (!zoneRef) continue;
      zoneRefs.add(zoneRef);
      hasZoneGeometry = hasZoneGeometry || Boolean(zone.geometry);
      hasZoneText = true;
      addZoneEntity({
        addChild,
        addEntity,
        cityKey,
        citySlug,
        geometry: zone.geometry,
        geometryState: zone.geometry ? "present" : "text-only",
        label: zone.properties.nom || zoneRef,
        source: "cadastre-layers",
        zoneRef,
      });
    }

    const signals = getByCity(input.signalNodesByCity, citySlug) ?? [];
    signals.forEach((node, index) => {
      const signalId = normalizeRef(node.id) || `${citySlug}/signal-${index + 1}`;
      const signalKey = makeKey("signal", signalId);
      addEntity({
        key: signalKey,
        kind: "signal",
        id: signalId,
        label: node.label,
        parentKey: cityKey,
        geometryState: "text-only",
        source: "graph-signal-node",
        meta: {
          nodeType: node.type,
          sourceRef: node.sourceRef,
          createdAt: node.createdAt,
        },
      });
      addChild(cityKey, "signal", signalKey);

      for (const zoneRef of extractSignalZoneRefs(node)) {
        zoneRefs.add(zoneRef);
        hasZoneText = true;
        addZoneEntity({
          addChild,
          addEntity,
          cityKey,
          citySlug,
          geometry: null,
          geometryState: "text-only",
          label: zoneRef,
          source: "graph-signal-node",
          zoneRef,
        });
      }
    });

    for (const lot of cadastre?.lots.features ?? []) {
      const noLot = normalizeRef(lot.properties.noLot);
      const zoneRef = normalizeRef(lot.properties.zone);
      if (!noLot || !zoneRef) continue;
      hasLotGeometry = hasLotGeometry || Boolean(lot.geometry);
      hasLotText = true;
      if (!zoneRefs.has(zoneRef)) {
        hasZoneText = true;
        addZoneEntity({
          addChild,
          addEntity,
          cityKey,
          citySlug,
          geometry: null,
          geometryState: "text-only",
          label: zoneRef,
          source: "cadastre-layers",
          zoneRef,
        });
      }
      addLotEntity({
        addChild,
        addEntity,
        citySlug,
        geometry: lot.geometry,
        geometryState: lot.geometry ? "present" : "text-only",
        noLot,
        parentZoneKey: makeZoneKey(citySlug, zoneRef),
        properties: lot.properties,
        source: "cadastre-layers",
      });
    }

    const lotCollection = getByCity(input.lotCollectionsByCity, citySlug) ?? null;
    for (const lot of lotCollection?.features ?? []) {
      const noLot = normalizeRef(lot.properties.noLot);
      const zoneRef = extractLotZoneRef(lot.properties);
      if (!noLot || !zoneRef) continue;
      hasLotGeometry = hasLotGeometry || Boolean(lot.geometry);
      hasLotText = true;
      if (!zoneRefs.has(zoneRef)) {
        hasZoneText = true;
        addZoneEntity({
          addChild,
          addEntity,
          cityKey,
          citySlug,
          geometry: null,
          geometryState: "text-only",
          label: zoneRef,
          source: "lots-client",
          zoneRef,
        });
      }
      addLotEntity({
        addChild,
        addEntity,
        citySlug,
        geometry: lot.geometry,
        geometryState: lot.geometry ? "present" : "text-only",
        noLot,
        parentZoneKey: makeZoneKey(citySlug, zoneRef),
        properties: lot.properties,
        source: "lots-client",
      });
    }

    availabilityByMunicipality.set(cityKey, {
      zones: geometryStateFromSignals(hasZoneGeometry, hasZoneText),
      lots: geometryStateFromSignals(hasLotGeometry, hasLotText),
    });
  }

  const finalByKey = new Map<SelectionKey, SignauxMapEntity>();
  for (const [key, entity] of byKey) {
    finalByKey.set(
      key,
      Object.freeze({
        ...entity,
        childKeys: Object.freeze([...(childKeysByParent.get(key) ?? [])]),
      }),
    );
  }

  const childrenByKey = new Map<SelectionKey, EntityChildrenByKind>();
  for (const [key, children] of typedChildrenByParent) {
    childrenByKey.set(key, freezeChildren(children));
  }

  return {
    rootKeys: Object.freeze([...rootKeys]),
    byKey: finalByKey,
    byKind: {
      municipality: freezeEntities(orderedKeysByKind.municipality, finalByKey),
      signal: freezeEntities(orderedKeysByKind.signal, finalByKey),
      zone: freezeEntities(orderedKeysByKind.zone, finalByKey),
      lot: freezeEntities(orderedKeysByKind.lot, finalByKey),
    },
    childrenByKey,
    availabilityByMunicipality,
  };
}

export function getEntityChildren(
  entities: SignauxMapEntities,
  parentKey: SelectionKey,
  kind: BucketKind,
): readonly SelectionKey[] {
  return entities.childrenByKey.get(parentKey)?.[kind] ?? EMPTY_CHILDREN[kind];
}

function addZoneEntity(args: {
  addChild: (parentKey: SelectionKey, kind: BucketKind, childKey: SelectionKey) => void;
  addEntity: (entity: Omit<SignauxMapEntity, "childKeys">) => void;
  cityKey: SelectionKey;
  citySlug: string;
  geometry: GeoJsonGeometry | null;
  geometryState: BucketGeometryState;
  label: string;
  source: SignauxMapEntity["source"];
  zoneRef: string;
}): void {
  const zoneKey = makeZoneKey(args.citySlug, args.zoneRef);
  args.addEntity({
    key: zoneKey,
    kind: "zone",
    id: `${args.citySlug}/${args.zoneRef}`,
    label: args.label,
    parentKey: args.cityKey,
    geometryState: args.geometryState,
    geometry: args.geometry,
    source: args.source,
    meta: { zoneRef: args.zoneRef, citySlug: args.citySlug },
  });
  args.addChild(args.cityKey, "zone", zoneKey);
}

function addLotEntity(args: {
  addChild: (parentKey: SelectionKey, kind: BucketKind, childKey: SelectionKey) => void;
  addEntity: (entity: Omit<SignauxMapEntity, "childKeys">) => void;
  citySlug: string;
  geometry: GeoJsonGeometry | LotGeometry | null;
  geometryState: BucketGeometryState;
  noLot: string;
  parentZoneKey: SelectionKey;
  properties: object;
  source: SignauxMapEntity["source"];
}): void {
  const lotId = `${args.citySlug}/${args.noLot}`;
  const lotKey = makeKey("lot", lotId);
  args.addEntity({
    key: lotKey,
    kind: "lot",
    id: lotId,
    label: args.noLot,
    parentKey: args.parentZoneKey,
    geometryState: args.geometryState,
    geometry: args.geometry,
    source: args.source,
    meta: {
      citySlug: args.citySlug,
      noLot: args.noLot,
      potentialScore: readPotentialScore(args.properties),
    },
  });
  args.addChild(args.parentZoneKey, "lot", lotKey);
}

function makeZoneKey(citySlug: string, zoneRef: string): SelectionKey {
  return makeKey("zone", `${citySlug}/${zoneRef}`);
}

function getByCity<T>(source: ByCity<T> | undefined, citySlug: string): T | undefined {
  if (!source) return undefined;
  const maybeMap = source as { get?: unknown };
  if (typeof maybeMap.get === "function") {
    return (source as ReadonlyMap<string, T>).get(citySlug);
  }
  return (source as Readonly<Record<string, T | undefined>>)[citySlug];
}

function normalizeRef(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function extractSignalZoneRefs(node: GraphSignalNode): string[] {
  const props = node.props ?? {};
  return uniqueRefs([
    ...extractRefs(props.zone_ref),
    ...extractRefs(props.zoneRef),
    ...extractRefs(props.zone),
    ...extractRefs(props.zone_refs),
    ...extractRefs(props.zones),
  ]);
}

function extractLotZoneRef(properties: object): string | null {
  const record = properties as Readonly<Record<string, unknown>>;
  return (
    normalizeRef(record.zone) ??
    normalizeRef(record.zone_ref) ??
    normalizeRef(record.zoneRef)
  );
}

function extractRefs(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(extractRefs);
  const normalized = normalizeRef(value);
  if (!normalized) return [];
  return normalized
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function uniqueRefs(values: readonly string[]): string[] {
  return Array.from(new Set(values));
}

function readPotentialScore(properties: object): number | null {
  const value = (properties as Readonly<Record<string, unknown>>).potentialScore;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function geometryStateFromSignals(
  hasGeometry: boolean,
  hasText: boolean,
): BucketGeometryState {
  if (hasGeometry) return "present";
  return hasText ? "text-only" : "missing";
}

function createMutableChildren(): Record<BucketKind, SelectionKey[]> {
  return {
    municipality: [],
    signal: [],
    zone: [],
    lot: [],
  };
}

function freezeChildren(
  children: Record<BucketKind, SelectionKey[]>,
): EntityChildrenByKind {
  return Object.freeze({
    municipality: Object.freeze([...children.municipality]),
    signal: Object.freeze([...children.signal]),
    zone: Object.freeze([...children.zone]),
    lot: Object.freeze([...children.lot]),
  });
}

function freezeEntities(
  keys: readonly SelectionKey[],
  byKey: ReadonlyMap<SelectionKey, SignauxMapEntity>,
): readonly SignauxMapEntity[] {
  return Object.freeze(keys.flatMap((key) => byKey.get(key) ?? []));
}
