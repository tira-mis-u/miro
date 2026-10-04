import { getShapeDefinition, getShapeDefinitionForLegacyType } from './registry';
import { buildShapeGeometry, flattenGeometryCommands } from './geometry';
import { buildConnectorRoute, CONNECTOR_LABEL_HEIGHT, CONNECTOR_LABEL_MAX_WIDTH, CONNECTOR_LABEL_PADDING_X, CONNECTOR_LABEL_PADDING_Y, connectorMarkerOccupancy, fitConnectorLabel } from './connectors';
import { isSolid3DGeometry, solid3DScaleFromBounds } from './solid3d';
import type { Cardinality, ConnectorShapeObject, DiagramShapeObject, EndpointMarker, ShapeConnectionPoint, ShapeDefinition, ShapeEndpointReference, ShapeResizePolicy } from './types';

/** Supported pre-registry board record types. Unknown map records are retained as opaque data. */
export const LEGACY_RAW_TYPES = [
  'pen', 'line', 'curve', 'rect', 'rounded-rect', 'ellipse', 'triangle', 'diamond', 'star', 'callout',
  'pentagon', 'hexagon', 'parallelogram', 'trapezoid', 'right-triangle', 'document', 'arrow', 'sticky', 'text', 'math', 'code', 'image',
] as const;
export type LegacyRawType = typeof LEGACY_RAW_TYPES[number];
const OLD_SHAPE_TYPES = new Set<string>(LEGACY_RAW_TYPES);
const MARKERS = new Set<EndpointMarker>(['none', 'arrow', 'openArrow', 'blockArrow', 'hollowTriangle', 'diamond', 'filledDiamond', 'circle', 'bar', 'crowFoot', 'zeroOrOne', 'oneOrMany', 'zeroOrMany']);
const CARDINALITIES = new Set<Cardinality>(['one', 'zero-or-one', 'many', 'one-or-many', 'zero-or-many']);
const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const safeSize = (value: unknown) => finite(value) ? Math.max(1, Math.min(1_000_000, Math.abs(value))) : 1;
const safeColor = (value: unknown, fallback: string) => typeof value === 'string' && value.length <= 128 ? value : fallback;
const normalizeRotation = (value: unknown) => finite(value) ? ((value % 360) + 360) % 360 : 0;

function sanitizeData(value: unknown, depth = 0): unknown {
  if (depth > 8) return undefined;
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.slice(0, 200_000);
  if (finite(value)) return value;
  if (Array.isArray(value)) return value.slice(0, 1000).map(item => sanitizeData(item, depth + 1)).filter(item => item !== undefined);
  if (!isObject(value)) return undefined;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value).slice(0, 128)) {
    if (!key || key.length > 128 || ['__proto__', 'constructor', 'prototype'].includes(key)) continue;
    const safe = sanitizeData(item, depth + 1);
    if (safe !== undefined) output[key] = safe;
  }
  return output;
}

/** Keep layout-only parameters in sync with the semantic table/classifier data they summarize. */
export function deriveStructuredShapeParameters(
  definition: ShapeDefinition,
  data: Record<string, unknown>,
  params: Record<string, unknown>,
): Record<string, unknown> {
  if (definition.geometry !== 'table') return params;
  const table = isObject(data.table) ? data.table : null;
  const classifier = isObject(data.classifier) ? data.classifier : null;
  const tableColumns = Array.isArray(table?.columns) ? table.columns : null;
  const classifierCompartments = Array.isArray(classifier?.compartments) ? classifier.compartments : null;
  const rowCount = definition.dataCapabilities?.includes('table') && tableColumns
    ? tableColumns.length + 1
    : definition.dataCapabilities?.includes('classifier') && classifierCompartments
      ? classifierCompartments.length + 1 : null;
  if (rowCount === null) return params;
  const safeRowCount = Math.max(2, Math.min(33, rowCount));
  return {
    ...params,
    rowCount: safeRowCount,
    ...(definition.dataCapabilities?.includes('classifier') && classifierCompartments
      ? { compartments: Math.max(1, Math.min(5, safeRowCount)) } : {}),
  };
}

export function rotatePoint(x: number, y: number, cx: number, cy: number, degrees: number): [number, number] {
  const radians = degrees * Math.PI / 180, cos = Math.cos(radians), sin = Math.sin(radians);
  return [cx + (x - cx) * cos - (y - cy) * sin, cy + (x - cx) * sin + (y - cy) * cos];
}

export function unrotatePoint(x: number, y: number, cx: number, cy: number, degrees: number): [number, number] {
  return rotatePoint(x, y, cx, cy, -degrees);
}

export interface Point2D { x: number; y: number; }
export type BoxTransform = { x: number; y: number; w: number; h: number; rotation?: number };

/** Object-local (origin at the unrotated top-left) to world coordinates. */
export function objectPointToWorld(shape: BoxTransform, point: Point2D): Point2D {
  const centerX = shape.x + shape.w / 2, centerY = shape.y + shape.h / 2;
  const [x, y] = rotatePoint(shape.x + point.x, shape.y + point.y, centerX, centerY, normalizeRotation(shape.rotation));
  return { x, y };
}

/** World coordinates to the box's object-local coordinate space. */
export function worldPointToObject(shape: BoxTransform, point: Point2D): Point2D {
  const centerX = shape.x + shape.w / 2, centerY = shape.y + shape.h / 2;
  const [x, y] = unrotatePoint(point.x, point.y, centerX, centerY, normalizeRotation(shape.rotation));
  return { x: x - shape.x, y: y - shape.y };
}

const RESIZE_SIGNS: Readonly<Record<string, readonly [number, number]>> = {
  nw: [-1, -1], n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0],
};

/** Resize a rotated object box from one of its semantic local handles. */
export function resizeBoxFromHandle(
  shape: BoxTransform,
  handle: string,
  worldPointer: Point2D,
  policy: ShapeResizePolicy = { mode: 'free' },
  minWidth = 20,
  minHeight = 20,
): Pick<BoxTransform, 'x' | 'y' | 'w' | 'h'> | null {
  const sign = RESIZE_SIGNS[handle];
  if (!sign) return null;
  const [sx, sy] = sign;
  const local = worldPointToObject(shape, worldPointer);
  const mouseX = local.x - shape.w / 2, mouseY = local.y - shape.h / 2;
  let width = shape.w, height = shape.h, centerOffsetX = 0, centerOffsetY = 0;
  if (sx !== 0) {
    const fixedX = -sx * shape.w / 2;
    width = Math.max(minWidth, sx * (mouseX - fixedX));
    centerOffsetX = (mouseX + fixedX) / 2;
  }
  if (sy !== 0) {
    const fixedY = -sy * shape.h / 2;
    height = Math.max(minHeight, sy * (mouseY - fixedY));
    centerOffsetY = (mouseY + fixedY) / 2;
  }
  if (policy.mode === 'aspect') {
    const ratio = Number.isFinite(policy.aspectRatio) && policy.aspectRatio > 0 ? policy.aspectRatio : 1;
    const aspectWidth = Math.max(sx ? width : shape.w, (sy ? height : shape.h) * ratio,
      minWidth, minHeight * ratio);
    width = aspectWidth;
    height = aspectWidth / ratio;
    centerOffsetX = sx ? sx * (width - shape.w) / 2 : 0;
    centerOffsetY = sy ? sy * (height - shape.h) / 2 : 0;
  }
  const centerX = shape.x + shape.w / 2, centerY = shape.y + shape.h / 2;
  const [newCenterX, newCenterY] = rotatePoint(centerX + centerOffsetX, centerY + centerOffsetY,
    centerX, centerY, normalizeRotation(shape.rotation));
  return { x: newCenterX - width / 2, y: newCenterY - height / 2, w: width, h: height };
}

export function rotatedBoxCorners(shape: BoxTransform): [number, number][] {
  return [[0, 0], [shape.w, 0], [shape.w, shape.h], [0, shape.h]].map(([x, y]) => {
    const point = objectPointToWorld(shape, { x, y });
    return [point.x, point.y];
  });
}

export function rotatedBoxBounds(shape: { x: number; y: number; w: number; h: number; rotation?: number }) {
  const corners = rotatedBoxCorners(shape);
  return {
    minX: Math.min(...corners.map(point => point[0])), minY: Math.min(...corners.map(point => point[1])),
    maxX: Math.max(...corners.map(point => point[0])), maxY: Math.max(...corners.map(point => point[1])),
  };
}

export function connectorBounds(shape: Pick<ConnectorShapeObject, 'shapeId' | 'x1' | 'y1' | 'x2' | 'y2' | 'waypoints' | 'startMarker' | 'endMarker' | 'label'>
  & Partial<Pick<ConnectorShapeObject, 'sw' | 'sourceCardinality' | 'targetCardinality'>>) {
  const definition = getShapeDefinition(shape.shapeId);
  const route = buildConnectorRoute({ routeKind: definition?.routeKind, x1: shape.x1, y1: shape.y1, x2: shape.x2, y2: shape.y2, waypoints: shape.waypoints });
  const points = route.length ? route : [[shape.x1, shape.y1], [shape.x2, shape.y2]] as [number, number][];
  const strokePad = Math.max(0.5, (shape.sw ?? 2) / 2);
  const markerPad = Math.max(
    connectorMarkerOccupancy(shape.startMarker, shape.sourceCardinality, shape.sw ?? 2),
    connectorMarkerOccupancy(shape.endMarker, shape.targetCardinality, shape.sw ?? 2),
  );
  const label = fitConnectorLabel(shape.label ?? '');
  const labelPadX = label ? CONNECTOR_LABEL_MAX_WIDTH / 2 + CONNECTOR_LABEL_PADDING_X : 0;
  const labelPadY = label ? CONNECTOR_LABEL_HEIGHT / 2 + CONNECTOR_LABEL_PADDING_Y : 0;
  // Bounds conservatively cover every route-aware label position, its plate, stroke and the
  // actual marker family envelope; route extrema already include curves and orthogonal detours.
  const padX = Math.max(strokePad, markerPad, labelPadX);
  const padY = Math.max(strokePad, markerPad, labelPadY);
  return {
    minX: Math.min(...points.map(point => point[0])) - padX,
    minY: Math.min(...points.map(point => point[1])) - padY,
    maxX: Math.max(...points.map(point => point[0])) + padX,
    maxY: Math.max(...points.map(point => point[1])) + padY,
  };
}

function normalizeRef(value: unknown): ShapeEndpointReference | undefined {
  if (!isObject(value) || typeof value.shapeId !== 'string' || typeof value.pointId !== 'string') return undefined;
  if (value.shapeId.length > 256 || value.pointId.length > 64) return undefined;
  return { shapeId: value.shapeId, pointId: value.pointId };
}

function normalizedStringEnum<T extends string>(value: unknown, choices: ReadonlySet<T>, fallback: T): T {
  return typeof value === 'string' && choices.has(value as T) ? value as T : fallback;
}

function isCardinality(value: unknown): value is Cardinality {
  return typeof value === 'string' && CARDINALITIES.has(value as Cardinality);
}

function diagramBounds(definition: ShapeDefinition, x: number, y: number, w: number, h: number, rotation: number,
  params: Readonly<Record<string, unknown>>, scale3d?: { x: number; y: number; z: number }) {
  if (!definition.solid3d) return rotatedBoxBounds({ x, y, w, h, rotation });
  const projectionBounds = buildShapeGeometry(definition, w, h, params, {
    scale: scale3d ?? solid3DScaleFromBounds(w, h, definition.width, definition.height, definition.geometry as import('./solid3d').Solid3DGeometry),
    referenceWidth: definition.width, referenceHeight: definition.height,
  }).projection?.projectedBounds;
  if (!projectionBounds) return rotatedBoxBounds({ x, y, w, h, rotation });
  const centerX = x + w / 2, centerY = y + h / 2;
  const corners = [[projectionBounds.minX, projectionBounds.minY], [projectionBounds.maxX, projectionBounds.minY],
    [projectionBounds.maxX, projectionBounds.maxY], [projectionBounds.minX, projectionBounds.maxY]].map(([px, py]) =>
    rotatePoint(x + px, y + py, centerX, centerY, rotation));
  const xs = corners.map(point => point[0]), ys = corners.map(point => point[1]);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

/** Validate and upgrade incoming Yjs/history objects without rewriting unknown records in the Y.Map. */
export function deserializeBoardShape(mapKey: string, raw: unknown): Record<string, unknown> | null {
  if (!isObject(raw) || typeof raw.id !== 'string' || raw.id.length > 256) return null;
  const id = mapKey || raw.id;
  if (raw.type === 'diagram') {
    if (typeof raw.shapeId !== 'string') return null;
    const definition = getShapeDefinition(raw.shapeId);
    if (!definition || definition.kind !== 'shape') return null;
    if (!finite(raw.x) || !finite(raw.y)) return null;
    const x = raw.x, y = raw.y, w = safeSize(raw.w), h = safeSize(raw.h), rotation = normalizeRotation(raw.rotation);
    let params: Record<string, unknown> = isObject(raw.params) ? { ...(definition.defaultParams ?? {}), ...raw.params } : { ...(definition.defaultParams ?? {}) };
    let scale3d: { x: number; y: number; z: number } | undefined;
    if (isSolid3DGeometry(definition.geometry)) {
      const rawScale = isObject(raw.scale3d) ? raw.scale3d : null;
      const safeScale = (value: unknown) => finite(value) ? Math.max(0.01, Math.min(64, value)) : 1;
      scale3d = rawScale
        ? { x: safeScale(rawScale.x), y: safeScale(rawScale.y), z: safeScale(rawScale.z) }
        : solid3DScaleFromBounds(w, h, definition.width, definition.height, definition.geometry);
      // Persisted XYZ factors are true local dimensions. Preserve all axes independently on load;
      // normalizing their geometric mean here would silently erase user resizing/history.
      const defaults = definition.defaultParams ?? {};
      if (definition.geometry === 'sphere3d' || definition.geometry === 'cube3d') {
        // Retain one isotropic sphere radius / equal Cube edge length; old depth values must not
        // resurrect an ellipsoid or stretch the Cube into a cuboid.
        delete params.depth;
      } else {
        const depth = finite(params.depth) ? Math.max(0.15, Math.min(2.5, params.depth)) : Number(defaults.depth ?? 0.72);
        params.depth = depth;
      }
      for (const axis of ['rotationX', 'rotationY', 'rotationZ'] as const) {
        params[axis] = finite(params[axis]) ? Math.max(-360, Math.min(360, params[axis] as number)) : Number(defaults[axis] ?? 0);
      }
    }
    const rawData = isObject(raw.data) ? raw.data : {};
    const data = sanitizeData({ ...(definition.defaultData ?? {}), ...rawData }) as Record<string, unknown>;
    params = deriveStructuredShapeParameters(definition, data, params);
    const bounds = diagramBounds(definition, x, y, w, h, rotation, params, scale3d);
    return {
      id, type: 'diagram', shapeId: definition.id, x, y, w, h, rotation,
      fill: safeColor(raw.fill, 'transparent'), stroke: safeColor(raw.stroke, '#1e40af'), sw: finite(raw.sw) ? Math.max(0, Math.min(64, raw.sw)) : 2,
      ...(typeof raw.text === 'string' ? { text: raw.text.slice(0, 200_000) } : definition.defaultText !== undefined ? { text: definition.defaultText } : {}),
      ...(finite(raw.fs) ? { fs: Math.max(6, Math.min(96, raw.fs)) } : {}),
      ...(typeof raw.textColor === 'string' ? { textColor: safeColor(raw.textColor, '#1f2937') } : {}),
      params,
      ...(scale3d ? { scale3d } : {}),
      ...(Object.keys(data).length ? { data } : {}),
      ...(typeof raw.containerId === 'string' && raw.containerId.length <= 256 && raw.containerId !== id ? { containerId: raw.containerId } : {}),
      ...bounds,
    } satisfies DiagramShapeObject as unknown as Record<string, unknown>;
  }
  if (raw.type === 'connector') {
    if (typeof raw.shapeId !== 'string') return null;
    const definition = getShapeDefinition(raw.shapeId);
    if (!definition || definition.kind !== 'connector') return null;
    if (!finite(raw.x1) || !finite(raw.y1) || !finite(raw.x2) || !finite(raw.y2)) return null;
    const waypoints = Array.isArray(raw.waypoints) ? raw.waypoints.slice(0, 64).filter((point: unknown): point is [number, number] => Array.isArray(point) && finite(point[0]) && finite(point[1])).map((point: [number, number]): [number, number] => [point[0], point[1]]) : [];
    const startMarker = normalizedStringEnum(raw.startMarker, MARKERS, definition.connector?.startMarker ?? 'none');
    const endMarker = normalizedStringEnum(raw.endMarker, MARKERS, definition.connector?.endMarker ?? 'none');
    const connector = {
      id, type: 'connector', shapeId: definition.id,
      x1: raw.x1, y1: raw.y1, x2: raw.x2, y2: raw.y2, waypoints,
      color: safeColor(raw.color, '#1e40af'), sw: finite(raw.sw) ? Math.max(0, Math.min(64, raw.sw)) : 2,
      lineStyle: raw.lineStyle === 'dashed' || raw.lineStyle === 'dotted' ? raw.lineStyle : definition.connector?.lineStyle ?? 'solid',
      startMarker, endMarker,
      ...(isCardinality(raw.sourceCardinality) ? { sourceCardinality: raw.sourceCardinality } : definition.connector?.sourceCardinality ? { sourceCardinality: definition.connector.sourceCardinality } : {}),
      ...(isCardinality(raw.targetCardinality) ? { targetCardinality: raw.targetCardinality } : definition.connector?.targetCardinality ? { targetCardinality: definition.connector.targetCardinality } : {}),
      ...(normalizeRef(raw.sourceRef) ? { sourceRef: normalizeRef(raw.sourceRef) } : {}),
      ...(normalizeRef(raw.targetRef) ? { targetRef: normalizeRef(raw.targetRef) } : {}),
      ...(typeof raw.label === 'string' ? { label: raw.label.slice(0, 200_000) } : definition.defaultLabel !== undefined ? { label: definition.defaultLabel } : {}),
      ...connectorBounds({ shapeId: definition.id, x1: raw.x1, y1: raw.y1, x2: raw.x2, y2: raw.y2, waypoints, startMarker, endMarker,
        sourceCardinality: isCardinality(raw.sourceCardinality) ? raw.sourceCardinality : definition.connector?.sourceCardinality,
        targetCardinality: isCardinality(raw.targetCardinality) ? raw.targetCardinality : definition.connector?.targetCardinality,
        label: typeof raw.label === 'string' ? raw.label : definition.defaultLabel,
        sw: finite(raw.sw) ? Math.max(0, Math.min(64, raw.sw)) : 2 }),
    } satisfies ConnectorShapeObject as unknown as Record<string, unknown>;
    return connector;
  }
  if (typeof raw.type !== 'string' || !OLD_SHAPE_TYPES.has(raw.type)) return null;
  const type = raw.type;
  if (type === 'pen') {
    if (!Array.isArray(raw.pts)) return null;
    const pts: number[][] = raw.pts.filter((point: unknown): point is number[] => Array.isArray(point) && finite(point[0]) && finite(point[1])).slice(0, 100_000)
      .map((point: number[]) => [point[0], point[1], ...(finite(point[2]) ? [point[2]] : [])]);
    if (!pts.length) return null;
    const xs = pts.map(point => point[0]!), ys = pts.map(point => point[1]!);
    return { ...raw, id, type, pts, color: safeColor(raw.color, '#1e293b'), size: finite(raw.size) ? Math.max(0.1, Math.min(100, raw.size)) : 6,
      minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
  }
  if (type === 'line' || type === 'arrow') {
    const { x1, y1, x2, y2 } = raw;
    if (!finite(x1) || !finite(y1) || !finite(x2) || !finite(y2)) return null;
    const definition = getShapeDefinitionForLegacyType(type);
    return { ...raw, id, type, x1, y1, x2, y2, color: safeColor(raw.color, '#1e40af'), sw: finite(raw.sw) ? Math.max(0, Math.min(64, raw.sw)) : 2,
      ...(definition ? { shapeId: definition.id } : {}),
      minX: Math.min(x1, x2), minY: Math.min(y1, y2), maxX: Math.max(x1, x2), maxY: Math.max(y1, y2) };
  }
  if (type === 'curve') {
    if (!Array.isArray(raw.pts)) return null;
    const pts = raw.pts.filter((point: unknown): point is number[] => Array.isArray(point) && finite(point[0]) && finite(point[1])).slice(0, 100_000);
    if (pts.length < 2) return null;
    const xs = pts.map((point: number[]) => point[0]), ys = pts.map((point: number[]) => point[1]);
    return { ...raw, id, type, pts, color: safeColor(raw.color, '#1e40af'), sw: finite(raw.sw) ? Math.max(0, Math.min(64, raw.sw)) : 2,
      minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
  }
  if (['rect', 'rounded-rect', 'ellipse', 'triangle', 'diamond', 'star', 'callout', 'pentagon', 'hexagon', 'parallelogram', 'trapezoid', 'right-triangle', 'document'].includes(type) || ['sticky', 'text', 'math', 'code', 'image'].includes(type)) {
    if (!finite(raw.x) || !finite(raw.y)) return null;
    const x = raw.x, y = raw.y, w = safeSize(raw.w), h = safeSize(raw.h);
    const rotation = normalizeRotation(raw.rotation);
    const bounds = rotatedBoxBounds({ x, y, w, h, rotation });
    const definition = getShapeDefinitionForLegacyType(type);
    const legacyVertices = Array.isArray(raw.vertices) ? raw.vertices.slice(0, 64).filter((point: unknown): point is [number, number] => Array.isArray(point) && finite(point[0]) && finite(point[1])).map((point: [number, number]) => [point[0], point[1]] as [number, number]) : undefined;
    return { ...raw, id, type, x, y, w, h, rotation,
      ...(type === 'image' && typeof raw.src !== 'string' ? { src: '' } : {}),
      ...(type === 'image' && !finite(raw.naturalW) ? { naturalW: w } : {}),
      ...(type === 'image' && !finite(raw.naturalH) ? { naturalH: h } : {}),
      ...(['rect', 'rounded-rect', 'ellipse', 'triangle', 'diamond', 'star', 'callout', 'pentagon', 'hexagon', 'parallelogram', 'trapezoid', 'right-triangle', 'document'].includes(type) ? {
        fill: safeColor(raw.fill, 'transparent'), stroke: safeColor(raw.stroke, '#1e40af'), sw: finite(raw.sw) ? Math.max(0, Math.min(64, raw.sw)) : 2,
        ...(legacyVertices?.length ? { vertices: legacyVertices } : { vertices: undefined }),
      } : {}),
      ...(['sticky', 'text', 'math', 'code'].includes(type) ? { text: typeof raw.text === 'string' ? raw.text : '', fs: finite(raw.fs) ? Math.max(6, Math.min(96, raw.fs)) : 14 } : {}),
      ...(type === 'sticky' ? { bg: safeColor(raw.bg, '#fef08a') } : {}),
      ...(type === 'text' ? { color: safeColor(raw.color, '#1e293b') } : {}),
      ...(type === 'code' ? { language: typeof raw.language === 'string' ? raw.language : 'javascript' } : {}),
      ...(definition ? { shapeId: definition.id } : {}), ...bounds };
  }
  return null;
}

export function serializeBoardShape(shape: Record<string, unknown> & { id: string }): Record<string, unknown> | null {
  const valid = deserializeBoardShape(shape.id, shape);
  return valid ? { ...valid } : null;
}

export function connectionPointsForBox(shape: {
  x: number; y: number; w: number; h: number; rotation?: number;
  shapeId?: string; type?: string; params?: Readonly<Record<string, unknown>>; scale3d?: { x: number; y: number; z: number };
}): ShapeConnectionPoint[] {
  const definition = shape.shapeId ? getShapeDefinition(shape.shapeId) : shape.type ? getShapeDefinitionForLegacyType(shape.type) : undefined;
  const geometry = definition ? buildShapeGeometry(definition, shape.w, shape.h, shape.params ?? definition.defaultParams ?? {},
    definition.solid3d ? { scale: shape.scale3d ?? solid3DScaleFromBounds(shape.w, shape.h, definition.width, definition.height),
      referenceWidth: definition.width, referenceHeight: definition.height } : undefined) : null;
  const paths = geometry ? [
    ...flattenGeometryCommands(geometry.outline, 24),
    ...(definition?.solid3d ? [] : [
      ...geometry.decorations.flatMap(commands => flattenGeometryCommands(commands, 24)),
      ...geometry.hiddenEdges.flatMap(commands => flattenGeometryCommands(commands, 24)),
    ]),
  ] : [];
  const points = paths.flat();
  const rayIntersection = (axis: 'x' | 'y', coordinate: number, direction: 'min' | 'max'): [number, number] | null => {
    const candidates: [number, number][] = [];
    for (const path of paths) {
      for (let index = 1; index < path.length; index++) {
        const a = path[index - 1], b = path[index];
        if (axis === 'x') {
          if (Math.abs(a[0] - b[0]) < 1e-9) {
            if (Math.abs(a[0] - coordinate) < 1e-7) candidates.push(a, b);
          } else if (coordinate >= Math.min(a[0], b[0]) - 1e-8 && coordinate <= Math.max(a[0], b[0]) + 1e-8) {
            const t = (coordinate - a[0]) / (b[0] - a[0]);
            candidates.push([coordinate, a[1] + (b[1] - a[1]) * t]);
          }
        } else if (Math.abs(a[1] - b[1]) < 1e-9) {
          if (Math.abs(a[1] - coordinate) < 1e-7) candidates.push(a, b);
        } else if (coordinate >= Math.min(a[1], b[1]) - 1e-8 && coordinate <= Math.max(a[1], b[1]) + 1e-8) {
          const t = (coordinate - a[1]) / (b[1] - a[1]);
          candidates.push([a[0] + (b[0] - a[0]) * t, coordinate]);
        }
      }
    }
    const outward = candidates.filter(([x, y]) => axis === 'x'
      ? (direction === 'min' ? y <= shape.h / 2 + 1e-7 : y >= shape.h / 2 - 1e-7)
      : (direction === 'min' ? x <= shape.w / 2 + 1e-7 : x >= shape.w / 2 - 1e-7));
    if (!outward.length) return null;
    const compareIndex = axis === 'x' ? 1 : 0;
    return outward.reduce((best, point) => direction === 'min'
      ? point[compareIndex] < best[compareIndex] ? point : best
      : point[compareIndex] > best[compareIndex] ? point : best);
  };
  const fallbackExtreme = (axis: 'x' | 'y', direction: 'min' | 'max'): [number, number] => {
    if (!points.length) return axis === 'x'
      ? [direction === 'min' ? 0 : shape.w, shape.h / 2]
      : [shape.w / 2, direction === 'min' ? 0 : shape.h];
    const primary = (point: [number, number]) => point[axis === 'x' ? 0 : 1];
    const lateral = (point: [number, number]) => point[axis === 'x' ? 1 : 0];
    const center = axis === 'x' ? shape.w / 2 : shape.h / 2;
    const extreme = points.reduce((value, point) => direction === 'min' ? Math.min(value, primary(point)) : Math.max(value, primary(point)), direction === 'min' ? Infinity : -Infinity);
    return points.filter(point => Math.abs(primary(point) - extreme) < 1e-6)
      .reduce((best, point) => Math.abs(lateral(point) - center) < Math.abs(lateral(best) - center) ? point : best);
  };
  const local = [
    { id: 'top', point: rayIntersection('x', shape.w / 2, 'min') ?? fallbackExtreme('y', 'min') },
    { id: 'right', point: rayIntersection('y', shape.h / 2, 'max') ?? fallbackExtreme('x', 'max') },
    { id: 'bottom', point: rayIntersection('x', shape.w / 2, 'max') ?? fallbackExtreme('y', 'max') },
    { id: 'left', point: rayIntersection('y', shape.h / 2, 'min') ?? fallbackExtreme('x', 'min') },
    { id: 'center', point: [shape.w / 2, shape.h / 2] as [number, number] },
  ];
  return local.map(({ id, point: [x, y] }) => {
    const world = objectPointToWorld(shape, { x, y });
    return { id, x: world.x, y: world.y };
  });
}

export function hasDiagramDefinition(shape: unknown): shape is DiagramShapeObject {
  return isObject(shape) && shape.type === 'diagram' && typeof shape.shapeId === 'string' && Boolean(getShapeDefinition(shape.shapeId));
}

export function hasConnectorDefinition(shape: unknown): shape is ConnectorShapeObject {
  return isObject(shape) && shape.type === 'connector' && typeof shape.shapeId === 'string' && getShapeDefinition(shape.shapeId)?.kind === 'connector';
}
