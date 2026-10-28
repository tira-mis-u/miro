import { getShapeDefinition, getShapeDefinitionForLegacyType, getShapeDefinitionByToolId } from './registry';
import { diagramCapabilitiesFor } from './diagramContext';
import { buildShapeGeometry, flattenGeometryCommands, structuredTableLayout, sequenceParticipantHeaderHeight } from './geometry';
import { buildConnectorRoute, CONNECTOR_LABEL_HEIGHT, CONNECTOR_LABEL_MAX_WIDTH, connectorDisplayLabel, connectorLabelLayout, connectorMarkerOccupancy, fitConnectorLabel, parallelConnectorLabelOffset, UML_RELATIONSHIP_LANE_SPACING } from './connectors';
import { isSolid3DGeometry, migrateSolid3DRotationFromYUp, migrateSolid3DScaleFromYUp,
  normalizeSolid3DScale, solid3DScaleFromBounds, SOLID3D_POSE_VERSION } from './solid3d';
import { UML_DIAGRAM_FAMILIES, UML_FOUNDATION_SCHEMA_VERSION } from './types';
import { normalizeUmlStructuredData } from './classifier';
import { normalizeSequenceDiagramData, normalizeSequenceMessageEvent } from './sequence';
import { normalizeActivityFlowData, normalizeBehavioralDiagramData, normalizeStateTransitionData } from './behavioralData';
import { normalizeExtendRelationshipData, normalizeUseCaseDiagramData } from './usecaseData';
import type { BehavioralNodeRole, Cardinality, ConnectionPointKind, ConnectorShapeObject, DiagramShapeObject, EndpointIntent, EndpointMarker, EndpointReferenceIssue, ShapeConnectionPoint, ShapeDefinition, ShapeEndpointReference, ShapeResizePolicy, StateTransitionParts, UMLDiagramFamily } from './types';

/** Supported pre-registry board record types. Unknown map records are retained as opaque data. */
export const LEGACY_RAW_TYPES = [
  'pen', 'line', 'curve', 'rect', 'rounded-rect', 'ellipse', 'triangle', 'diamond', 'star', 'callout',
  'pentagon', 'hexagon', 'parallelogram', 'trapezoid', 'right-triangle', 'document', 'arrow', 'sticky', 'text', 'math', 'code', 'image',
  'video', 'link-card',
] as const;
export type LegacyRawType = typeof LEGACY_RAW_TYPES[number];
const OLD_SHAPE_TYPES = new Set<string>(LEGACY_RAW_TYPES);
const MARKERS = new Set<EndpointMarker>(['none', 'arrow', 'openArrow', 'blockArrow', 'hollowTriangle', 'diamond', 'filledDiamond', 'circle', 'filledCircle', 'bar', 'crowFoot', 'zeroOrOne', 'oneOrMany', 'zeroOrMany']);
const CARDINALITIES = new Set<Cardinality>(['one', 'zero-or-one', 'many', 'one-or-many', 'zero-or-many']);
const BEHAVIORAL_NODE_ROLES = new Set<BehavioralNodeRole>(['decision', 'merge', 'fork', 'join', 'choice', 'junction']);
const isBehavioralNodeRole = (value: unknown): value is BehavioralNodeRole => typeof value === 'string' && BEHAVIORAL_NODE_ROLES.has(value as BehavioralNodeRole);
const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
const safeSize = (value: unknown) => finite(value) ? Math.max(1, Math.min(1_000_000, Math.abs(value))) : 1;
const safeColor = (value: unknown, fallback: string) => typeof value === 'string' && value.length <= 128 ? value : fallback;
const normalizeRotation = (value: unknown) => finite(value) ? ((value % 360) + 360) % 360 : 0;

function sanitizeData(value: unknown, depth = 0): unknown {
  if (depth > 8) return undefined;
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.slice(0, 200_000);
  if (finite(value)) return value;
  if (Array.isArray(value)) return value.map(item => sanitizeData(item, depth + 1)).filter(item => item !== undefined);
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
  if (definition.geometry === 'activityPartition') {
    const partition = isObject(data.activityPartition) ? data.activityPartition : null;
    return { ...params, activityOrientation: partition?.orientation === 'horizontal' ? 'horizontal' : 'vertical' };
  }
  if (definition.geometry === 'umlState' || definition.geometry === 'umlCompositeState') {
    const behavior = isObject(data.stateBehavior) ? data.stateBehavior : null;
    const behaviorRows = behavior ? ['entry', 'doActivity', 'exit'].filter(key =>
      typeof behavior[key] === 'string' && (behavior[key] as string).trim()).length : 0;
    const composite = isObject(data.stateComposite) ? data.stateComposite : null;
    const regions = Array.isArray(composite?.regions) ? composite.regions.length : 1;
    return { ...params, stateBehaviorRows: behaviorRows, stateRegionCount: Math.max(1, regions),
      stateHeaderFraction: definition.geometry === 'umlCompositeState' ? (behaviorRows ? 0.46 : 0.29) : 0 };
  }
  if (definition.geometry !== 'table') return params;
  const table = isObject(data.table) ? data.table : null;
  const classifier = isObject(data.classifier) ? data.classifier : null;
  const tableColumns = Array.isArray(table?.columns) ? table.columns : null;
  const classifierCompartments = Array.isArray(classifier?.compartments) ? classifier.compartments : null;
  const instance = isObject(data.instance) ? data.instance : null;
  const instanceValues = Array.isArray(instance?.values) ? instance.values : null;
  if (definition.dataCapabilities?.includes('table') && tableColumns) {
    const safeRowCount = Math.max(2, Math.min(33, tableColumns.length + 1));
    return { ...params, rowCount: safeRowCount };
  }
  if (definition.dataCapabilities?.includes('classifier') && classifierCompartments) {
    return { ...params, classifierLayout: true, compartments: classifierCompartments.length + 1 };
  }
  if (definition.dataCapabilities?.includes('instance') && instanceValues) {
    return { ...params, instanceLayout: true, compartments: 2 };
  }
  return params;
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
  if (policy.mode === 'vertical' || policy.mode === 'horizontal') {
    const vertical = policy.mode === 'vertical';
    if (vertical ? (handle !== 'n' && handle !== 's') : (handle !== 'e' && handle !== 'w')) return null;
    const local = worldPointToObject(shape, worldPointer);
    const mouse = vertical ? local.y - shape.h / 2 : local.x - shape.w / 2;
    const signAxis = vertical ? sy : sx;
    const oldSize = vertical ? shape.h : shape.w;
    const fixed = -signAxis * oldSize / 2;
    const size = Math.max(vertical ? minHeight : minWidth, signAxis * (mouse - fixed));
    const centerOffset = signAxis * (size - oldSize) / 2;
    const centerX = shape.x + shape.w / 2, centerY = shape.y + shape.h / 2;
    const [newCenterX, newCenterY] = vertical
      ? rotatePoint(centerX, centerY + centerOffset, centerX, centerY, normalizeRotation(shape.rotation))
      : rotatePoint(centerX + centerOffset, centerY, centerX, centerY, normalizeRotation(shape.rotation));
    return vertical
      ? { x: newCenterX - shape.w / 2, y: newCenterY - size / 2, w: shape.w, h: size }
      : { x: newCenterX - size / 2, y: newCenterY - shape.h / 2, w: size, h: shape.h };
  }
  const local = worldPointToObject(shape, worldPointer);
  const mouseX = local.x - shape.w / 2, mouseY = local.y - shape.h / 2;
  let width = shape.w, height = shape.h;
  if (sx !== 0) {
    const fixedX = -sx * shape.w / 2;
    width = Math.max(minWidth, sx * (mouseX - fixedX));
  }
  if (sy !== 0) {
    const fixedY = -sy * shape.h / 2;
    height = Math.max(minHeight, sy * (mouseY - fixedY));
  }
  if (policy.mode === 'aspect') {
    const ratio = policy.mode === 'aspect' && Number.isFinite(policy.aspectRatio) && policy.aspectRatio > 0 ? policy.aspectRatio : 1;
    const aspectWidth = Math.max(sx ? width : shape.w, (sy ? height : shape.h) * ratio,
      minWidth, minHeight * ratio);
    width = aspectWidth;
    height = aspectWidth / ratio;
  }
  const centerOffsetX = sx !== 0 ? sx * (width - shape.w) / 2 : 0;
  const centerOffsetY = sy !== 0 ? sy * (height - shape.h) / 2 : 0;
  const centerX = shape.x + shape.w / 2, centerY = shape.y + shape.h / 2;
  const [newCenterX, newCenterY] = rotatePoint(centerX + centerOffsetX, centerY + centerOffsetY,
    centerX, centerY, normalizeRotation(shape.rotation));
  return { x: newCenterX - width / 2, y: newCenterY - height / 2, w: width, h: height };
}

export function normalizeDragBox(
  origin: { x: number; y: number },
  pointer: { x: number; y: number },
  resizePolicy: ShapeResizePolicy = { mode: 'free' },
  definition?: ShapeDefinition,
) {
  let x = Math.min(origin.x, pointer.x), y = Math.min(origin.y, pointer.y);
  let w = Math.abs(pointer.x - origin.x), h = Math.abs(pointer.y - origin.y);

  if (resizePolicy.mode === 'aspect' || definition?.aspectLocked) {
    const defW = definition?.width || 1;
    const defH = definition?.height || 1;
    const ratio = resizePolicy.mode === 'aspect' && Number.isFinite(resizePolicy.aspectRatio) && resizePolicy.aspectRatio > 0
      ? resizePolicy.aspectRatio
      : (defW / Math.max(1, defH));
    const width = Math.max(w, h * ratio, 10);
    h = width / ratio;
    w = width;
    x = pointer.x < origin.x ? origin.x - w : origin.x;
    y = pointer.y < origin.y ? origin.y - h : origin.y;
    return { x, y, w, h };
  }

  if (definition) {
    const isSequenceParticipant = definition.semantic?.family === 'uml.sequence-participant'
      || ['uml.lifeline', 'uml.sequence-actor', 'uml.boundary', 'uml.control', 'uml.entity'].includes(definition.id);

    if (isSequenceParticipant) {
      // Standard sequence participant sizing:
      // Width is anchored to the standard participant width (defW, 75 for actor matching use-case actor, 118 for lifeline).
      // Height follows user drag naturally with the default height as the baseline (e.g. 210 for actor, 220 for lifeline).
      const defW = definition.width || 75;
      const defH = definition.height || 210;
      const targetW = defW;
      const targetH = Math.max(defH, h);

      const nextX = pointer.x < origin.x ? origin.x - targetW : origin.x;
      const nextY = pointer.y < origin.y ? origin.y - targetH : origin.y;
      return { x: nextX, y: nextY, w: targetW, h: targetH };
    }

    if (definition.id === 'uml.activation') {
      const defW = definition.width || 24;
      const targetH = Math.max(40, h);
      const nextX = pointer.x < origin.x ? origin.x - defW : origin.x;
      const nextY = pointer.y < origin.y ? origin.y - targetH : origin.y;
      return { x: nextX, y: nextY, w: defW, h: targetH };
    }

    if (['uml.frame', 'uml.package', 'uml.component'].includes(definition.id)) {
      const minW = 140;
      const minH = 90;
      const targetW = Math.max(minW, w);
      const targetH = Math.max(minH, h);
      const nextX = pointer.x < origin.x ? origin.x - targetW : origin.x;
      const nextY = pointer.y < origin.y ? origin.y - targetH : origin.y;
      return { x: nextX, y: nextY, w: targetW, h: targetH };
    }
  }

  w = Math.max(10, w);
  h = Math.max(10, h);
  return { x, y, w, h };
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
  & Partial<Pick<ConnectorShapeObject, 'sw' | 'sourceCardinality' | 'targetCardinality' | 'sourceMultiplicity' | 'targetMultiplicity'
    | 'sourceLabel' | 'targetLabel' | 'labelPosition' | 'labelOffset' | 'sourceLabelPosition' | 'sourceLabelOffset'
    | 'targetLabelPosition' | 'targetLabelOffset' | 'sourceRef' | 'targetRef' | 'parallelLane' | 'stateTransition' | 'activityFlow' | 'usecaseExtend' | 'diagramContext'>>) {
  const definition = getShapeDefinition(shape.shapeId);
  const sameOwner = Boolean(shape.sourceRef && shape.targetRef && shape.sourceRef.shapeId === shape.targetRef.shapeId);
  const selfLoopKind = sameOwner && definition?.semantic?.family === 'uml.sequence-edge' ? 'sequence'
    : sameOwner && (definition?.semantic?.family === 'uml.activity-edge' || definition?.semantic?.family === 'uml.state-edge') ? 'behavioral' : undefined;
  const isUmlRelationship = definition?.semantic?.family === 'uml.relationship-edge'
    || definition?.semantic?.family === 'uml.usecase-dependency';
  const route = buildConnectorRoute({ routeKind: definition?.routeKind, x1: shape.x1, y1: shape.y1, x2: shape.x2, y2: shape.y2,
    waypoints: shape.waypoints, parallelLane: shape.parallelLane,
    ...(isUmlRelationship ? { parallelLaneSpacing: UML_RELATIONSHIP_LANE_SPACING } : {}), selfLoopKind,
    selfLoopSide: shape.sourceRef?.pointId });
  const points = route.length ? route : [[shape.x1, shape.y1], [shape.x2, shape.y2]] as [number, number][];
  const contextCapabilities = shape.diagramContext ? definition?.semantic?.contextCapabilities?.[shape.diagramContext] : undefined;
  const connectorCapabilities = { ...definition?.semantic?.capabilities?.connector, ...contextCapabilities?.connector };
  const multiplicityEditable = connectorCapabilities.multiplicityEditable === true;
  const legacyMultiplicity = (value: Cardinality | undefined) => value === 'one' ? '1'
    : value === 'zero-or-one' ? '0..1' : value === 'many' ? '*' : value === 'one-or-many' ? '1..*'
      : value === 'zero-or-many' ? '0..*' : '';
  const sourceMultiplicity = shape.sourceMultiplicity ?? (multiplicityEditable ? legacyMultiplicity(shape.sourceCardinality) : '');
  const targetMultiplicity = shape.targetMultiplicity ?? (multiplicityEditable ? legacyMultiplicity(shape.targetCardinality) : '');
  const strokePad = Math.max(0.5, (shape.sw ?? 2) / 2);
  const markerPad = Math.max(
    connectorMarkerOccupancy(shape.startMarker, multiplicityEditable || shape.sourceMultiplicity ? undefined : shape.sourceCardinality, shape.sw ?? 2),
    connectorMarkerOccupancy(shape.endMarker, multiplicityEditable || shape.targetMultiplicity ? undefined : shape.targetCardinality, shape.sw ?? 2),
  );
  const relationshipLabel = connectorDisplayLabel(shape as Pick<ConnectorShapeObject, 'shapeId' | 'label' | 'stateTransition' | 'activityFlow' | 'usecaseExtend'>);
  const laneAwareOffset = (value: number) => parallelConnectorLabelOffset(value, shape.parallelLane, isUmlRelationship);
  const labelEntries = [
    { text: connectorCapabilities.labelMode === 'none' ? '' : relationshipLabel, position: shape.labelPosition, offset: shape.labelOffset !== undefined ? laneAwareOffset(shape.labelOffset) : undefined },
    { text: connectorCapabilities.sourceLabelEditable ? shape.sourceLabel ?? '' : '', position: shape.sourceLabelPosition ?? 180, offset: laneAwareOffset(shape.sourceLabelOffset ?? 12) },
    { text: connectorCapabilities.targetLabelEditable ? shape.targetLabel ?? '' : '', position: shape.targetLabelPosition ?? 820, offset: laneAwareOffset(shape.targetLabelOffset ?? 12) },
    { text: multiplicityEditable ? sourceMultiplicity : '', position: 100, offset: laneAwareOffset(-12) },
    { text: multiplicityEditable ? targetMultiplicity : '', position: 900, offset: laneAwareOffset(-12) },
  ].filter(entry => entry.text.trim());
  const labelBounds = labelEntries.map(entry => {
    const visible = fitConnectorLabel(entry.text);
    const lines = visible.split('\n');
    const width = Math.min(CONNECTOR_LABEL_MAX_WIDTH, Math.max(12, ...lines.map(line => line.length * 7.5)));
    const height = Math.max(CONNECTOR_LABEL_HEIGHT, lines.length * 16);
    const layout = connectorLabelLayout(points, { startMarker: shape.startMarker, endMarker: shape.endMarker,
      sourceCardinality: multiplicityEditable ? undefined : shape.sourceCardinality,
      targetCardinality: multiplicityEditable ? undefined : shape.targetCardinality,
      strokeWidth: shape.sw, labelWidth: width, labelHeight: height,
      ...(entry.position !== undefined ? { labelPosition: entry.position } : {}),
      ...(entry.offset !== undefined ? { labelOffset: entry.offset } : {}) });
    return { minX: layout.x - layout.width / 2, minY: layout.y - layout.height / 2,
      maxX: layout.x + layout.width / 2, maxY: layout.y + layout.height / 2 };
  });
  // Include all independent route-relative labels plus the stroke and marker envelope in hit-test bounds.
  const base = {
    minX: Math.min(...points.map(point => point[0])) - Math.max(strokePad, markerPad),
    minY: Math.min(...points.map(point => point[1])) - Math.max(strokePad, markerPad),
    maxX: Math.max(...points.map(point => point[0])) + Math.max(strokePad, markerPad),
    maxY: Math.max(...points.map(point => point[1])) + Math.max(strokePad, markerPad),
  };
  return labelBounds.reduce((bounds, label) => ({ minX: Math.min(bounds.minX, label.minX), minY: Math.min(bounds.minY, label.minY),
    maxX: Math.max(bounds.maxX, label.maxX), maxY: Math.max(bounds.maxY, label.maxY) }), base);
}

const CONNECTION_POINT_KINDS = new Set<ConnectionPointKind>(['fixed', 'floating', 'relative', 'structured', 'sequence-time', 'special']);
const ENDPOINT_REFERENCE_ISSUES = new Set<EndpointReferenceIssue>(['malformed', 'missing-shape-id', 'missing-point-id', 'oversized']);

function normalizeRef(value: unknown): ShapeEndpointReference | undefined {
  if (!isObject(value) || typeof value.shapeId !== 'string' || typeof value.pointId !== 'string') return undefined;
  if (value.shapeId.length > 256 || value.pointId.length > 64) return undefined;
  const kind = CONNECTION_POINT_KINDS.has(value.kind as ConnectionPointKind) ? value.kind as ConnectionPointKind : undefined;
  return { shapeId: value.shapeId, pointId: value.pointId, ...(kind ? { kind } : {}) };
}

function endpointRefIssue(value: unknown): EndpointReferenceIssue | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isObject(value)) return 'malformed';
  if (typeof value.shapeId !== 'string' || !value.shapeId.trim()) return 'missing-shape-id';
  if (value.shapeId.length > 256) return 'oversized';
  if (typeof value.pointId !== 'string' || !value.pointId.trim()) return 'missing-point-id';
  if (value.pointId.length > 64) return 'oversized';
  if (value.kind !== undefined && !CONNECTION_POINT_KINDS.has(value.kind as ConnectionPointKind)) return 'malformed';
  return undefined;
}

function normalizeEndpointIntent(value: unknown, hasReference: boolean): EndpointIntent {
  return value === 'attached' || value === 'free' || value === 'pending' ? value : hasReference ? 'attached' : 'free';
}

function normalizeDiagramContext(value: unknown, definition: ShapeDefinition): UMLDiagramFamily | undefined {
  return definition.semantic?.notation === 'uml' && typeof value === 'string'
    && UML_DIAGRAM_FAMILIES.includes(value as UMLDiagramFamily)
    && (definition.semantic.diagramFamilies ?? []).includes(value as UMLDiagramFamily)
    ? value as UMLDiagramFamily : undefined;
}

function normalizeStateTransition(value: unknown): StateTransitionParts | undefined {
  return normalizeStateTransitionData(value);
}

function stateTransitionFromLegacyLabel(value: unknown): StateTransitionParts | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  let expression = value.trim(), effect = '';
  const slash = expression.indexOf('/');
  if (slash >= 0) { effect = expression.slice(slash + 1).trim(); expression = expression.slice(0, slash).trim(); }
  const guardMatch = expression.match(/\[([^\]]*)\]/);
  const guard = guardMatch?.[1]?.trim() ?? '';
  const trigger = guardMatch ? expression.slice(0, guardMatch.index).trim() : expression;
  const parts: StateTransitionParts = {
    ...(trigger ? { trigger: trigger.slice(0, 2000) } : {}),
    ...(guard ? { guard: guard.slice(0, 2000) } : {}),
    ...(effect ? { effect: effect.slice(0, 2000) } : {}),
  };
  return Object.keys(parts).length ? parts : undefined;
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
    referenceWidth: definition.width, referenceHeight: definition.height, center: { x: 0, y: 0 },
  }).projection?.projectedBounds;
  if (!projectionBounds) return rotatedBoxBounds({ x, y, w, h, rotation });
  // For a solid, x/y are the projected location of its authored local origin, not a box corner.
  const corners = [[projectionBounds.minX, projectionBounds.minY], [projectionBounds.maxX, projectionBounds.minY],
    [projectionBounds.maxX, projectionBounds.maxY], [projectionBounds.minX, projectionBounds.maxY]].map(([px, py]) =>
    rotatePoint(x + px, y + py, x, y, rotation));
  const xs = corners.map(point => point[0]), ys = corners.map(point => point[1]);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

/**
 * Resize typography through the same component-size change used by geometry. Uniform resizing is
 * exact; for non-uniform boxes the square-root-of-area scale preserves glyph proportions instead
 * of distorting letterforms on one axis.
 */
export function resizeDiagramEmbeddedTextScale(
  shape: Pick<DiagramShapeObject, 'w' | 'h' | 'embeddedTextScale'>,
  width: number,
  height: number,
): number {
  const previous = finite(shape.embeddedTextScale) ? Math.max(0.01, Math.min(64, shape.embeddedTextScale)) : 1;
  const scaleX = Math.max(0.01, width / Math.max(1, shape.w));
  const scaleY = Math.max(0.01, height / Math.max(1, shape.h));
  return Math.max(0.01, Math.min(64, previous * Math.sqrt(scaleX * scaleY)));
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
    let x = raw.x, y = raw.y;
    const w = safeSize(raw.w), h = safeSize(raw.h), rotation = normalizeRotation(raw.rotation);
    let params: Record<string, unknown> = isObject(raw.params) ? { ...(definition.defaultParams ?? {}), ...raw.params } : { ...(definition.defaultParams ?? {}) };
    let scale3d: { x: number; y: number; z: number } | undefined;
    let solid3dPoseVersion: number | undefined;
    if (isSolid3DGeometry(definition.geometry)) {
      const rawScale = isObject(raw.scale3d) ? raw.scale3d : null;
      const safeScale = (value: unknown) => finite(value) ? Math.max(0.01, Math.min(64, value)) : 1;
      const legacyParams = isObject(raw.params) ? raw.params : {};
      const storedPoseVersion = finite(raw.solid3dPoseVersion) ? Math.floor(raw.solid3dPoseVersion) : 0;
      const migrateYUp = storedPoseVersion < SOLID3D_POSE_VERSION;
      const frameScaleX = Math.max(0.01, Math.min(64, w / Math.max(1, definition.width)));
      const frameScaleY = Math.max(0.01, Math.min(64, h / Math.max(1, definition.height)));
      let candidateScale: { x: number; y: number; z: number };
      if (rawScale) {
        candidateScale = { x: safeScale(rawScale.x), y: safeScale(rawScale.y), z: safeScale(rawScale.z) };
      } else if (migrateYUp) {
        // Pre-v2 frame migration: old local Y was height and old local Z was inferred depth.
        candidateScale = definition.geometry === 'tetrahedron3d'
          ? { ...(definition.defaultScale3d ?? { x: 1, y: 1, z: 1 }) }
          : { x: frameScaleX, y: frameScaleY, z: Math.min(frameScaleX, frameScaleY) };
      } else {
        candidateScale = definition.geometry === 'tetrahedron3d'
          ? { ...(definition.defaultScale3d ?? { x: 1, y: 1, z: 1 }) }
          : solid3DScaleFromBounds(w, h, definition.width, definition.height, definition.geometry);
      }
      if (definition.geometry === 'cuboid3d' && ((!rawScale && migrateYUp)
          || 'baseRatio' in legacyParams || 'depth' in legacyParams)) {
        // Legacy cuboids encoded proportions a second time in parameters. Apply them in the old
        // basis exactly once, then the v2 migration below swaps old height/depth into Z-up axes.
        candidateScale.x *= finite(legacyParams.baseRatio) ? Math.max(0.25, Math.min(2.5, legacyParams.baseRatio)) : 1.35;
        candidateScale.z *= finite(legacyParams.depth) ? Math.max(0.15, Math.min(2.5, legacyParams.depth)) : 0.72;
        delete params.baseRatio;
        delete params.depth;
      }
      if (migrateYUp) {
        candidateScale = migrateSolid3DScaleFromYUp(candidateScale);
        Object.assign(params, migrateSolid3DRotationFromYUp(params));
        // Old pyramid offsets used local Z for the second in-plane direction; in the new
        // right-handed XY base that coordinate is -Y. Keep an explicit new value if supplied.
        if ('apexOffsetZ' in legacyParams && !('apexOffsetY' in legacyParams)) {
          params.apexOffsetY = -(finite(legacyParams.apexOffsetZ) ? legacyParams.apexOffsetZ : 0);
        }
        // The trapezoid-only parameter has no meaning for the fixed irregular quadrilateral mesh.
        delete params.baseInsetRatio;
        delete params.apexOffsetZ;
        // Old x/y stored the projected box's top-left; in v2 they store the true model origin,
        // which was exactly the old box center. This keeps existing objects visually anchored.
        x += w / 2;
        y += h / 2;
      } else {
        delete params.baseInsetRatio;
        delete params.apexOffsetZ;
      }
      scale3d = normalizeSolid3DScale(definition.geometry, candidateScale);
      // Only persist semantic height where this definition actually owns one. In particular the
      // tetrahedron's registered depth=1 is shared by fresh construction and reload; no generic
      // .72 fallback is injected into shapes that do not define depth.
      const defaults = definition.defaultParams ?? {};
      if (definition.geometry === 'sphere3d' || definition.geometry === 'cube3d' || definition.geometry === 'cuboid3d') {
        delete params.depth;
      } else if ('depth' in defaults || 'depth' in params) {
        const fallbackDepth = finite(defaults.depth) ? defaults.depth : 1;
        params.depth = finite(params.depth) ? Math.max(0.15, Math.min(2.5, params.depth)) : fallbackDepth;
      }
      for (const axis of ['rotationX', 'rotationY', 'rotationZ'] as const) {
        params[axis] = finite(params[axis]) ? Math.max(-360, Math.min(360, params[axis] as number)) : Number(defaults[axis] ?? 0);
      }
      solid3dPoseVersion = Math.max(SOLID3D_POSE_VERSION, storedPoseVersion);
    }
    const rawContainerId = typeof raw.containerId === 'string' && raw.containerId.length <= 256 && raw.containerId !== id
      ? raw.containerId : undefined;
    const rawData = isObject(raw.data) ? raw.data : {};
    const sanitizedRawData = sanitizeData(rawData) as Record<string, unknown>;
    const sanitizedData = sanitizeData({ ...(definition.defaultData ?? {}), ...sanitizedRawData }) as Record<string, unknown>;
    const diagramContext = normalizeDiagramContext(raw.diagramContext, definition);
    let data = definition.semantic?.notation === 'uml'
      ? normalizeUmlStructuredData(definition, sanitizedData, sanitizedRawData) : sanitizedData;
    if (definition.semantic?.notation === 'uml')
      data = normalizeBehavioralDiagramData(definition, id, data, diagramContext,
        rawContainerId) as typeof data;
    if (definition.semantic?.notation === 'uml')
      data = normalizeUseCaseDiagramData(definition, data) as typeof data;
    if (definition.semantic?.family?.startsWith('uml.sequence-') || definition.id === 'uml.frame')
      data = normalizeSequenceDiagramData(data, definition.id, id, rawContainerId, h, y + h / 2) as Record<string, unknown>;
    params = deriveStructuredShapeParameters(definition, data, params);
    const bounds = diagramBounds(definition, x, y, w, h, rotation, params, scale3d);
    return {
      id, type: 'diagram', shapeId: definition.id, x, y, w, h, rotation,
      fill: safeColor(raw.fill, 'transparent'), stroke: safeColor(raw.stroke, '#1e40af'), sw: finite(raw.sw) ? Math.max(0, Math.min(64, raw.sw)) : 2,
      ...(typeof raw.text === 'string' ? { text: raw.text.slice(0, 200_000) } : definition.defaultText !== undefined ? { text: definition.defaultText } : {}),
      ...(finite(raw.fs) ? { fs: Math.max(6, Math.min(96, raw.fs)) } : {}),
      ...(finite(raw.embeddedTextScale) ? { embeddedTextScale: Math.max(0.01, Math.min(64, raw.embeddedTextScale)) } : {}),
      ...(typeof raw.textColor === 'string' ? { textColor: safeColor(raw.textColor, '#1f2937') } : {}),
      params,
      ...(definition.semantic?.notation === 'uml' ? { umlSchemaVersion: UML_FOUNDATION_SCHEMA_VERSION } : {}),
      ...(diagramContext ? { diagramContext } : {}),
      ...(isBehavioralNodeRole(raw.behavioralRole) && definition.semantic?.behavioralNodeRoles?.includes(raw.behavioralRole)
        ? { behavioralRole: raw.behavioralRole } : {}),
      ...(scale3d ? { scale3d } : {}),
      ...(solid3dPoseVersion ? { solid3dPoseVersion } : {}),
      ...(Object.keys(data).length ? { data } : {}),
      ...(rawContainerId ? { containerId: rawContainerId } : {}),
      ...bounds,
    } satisfies DiagramShapeObject as unknown as Record<string, unknown>;
  }
  if (raw.type === 'connector') {
    if (typeof raw.shapeId !== 'string') return null;
    const definition = getShapeDefinition(raw.shapeId);
    if (!definition || definition.kind !== 'connector') return null;
    if (!finite(raw.x1) || !finite(raw.y1) || !finite(raw.x2) || !finite(raw.y2)) return null;
    const waypoints = Array.isArray(raw.waypoints) ? raw.waypoints.slice(0, 64).filter((point: unknown): point is [number, number] => Array.isArray(point) && finite(point[0]) && finite(point[1])).map((point: [number, number]): [number, number] => [point[0], point[1]]) : [];
    const isUmlConnector = definition.semantic?.notation === 'uml';
    const startMarker = isUmlConnector ? definition.connector?.startMarker ?? 'none'
      : normalizedStringEnum(raw.startMarker, MARKERS, definition.connector?.startMarker ?? 'none');
    const endMarker = isUmlConnector ? definition.connector?.endMarker ?? 'none'
      : normalizedStringEnum(raw.endMarker, MARKERS, definition.connector?.endMarker ?? 'none');
    const sourceRef = normalizeRef(raw.sourceRef), targetRef = normalizeRef(raw.targetRef);
    const sourceIssue = endpointRefIssue(raw.sourceRef), targetIssue = endpointRefIssue(raw.targetRef);
    const storedIssues = isObject(raw.invalidEndpointRefs) ? raw.invalidEndpointRefs : {};
    const invalidEndpointRefs = {
      ...(ENDPOINT_REFERENCE_ISSUES.has(storedIssues.source as EndpointReferenceIssue) ? { source: storedIssues.source as EndpointReferenceIssue } : {}),
      ...(ENDPOINT_REFERENCE_ISSUES.has(storedIssues.target as EndpointReferenceIssue) ? { target: storedIssues.target as EndpointReferenceIssue } : {}),
      ...(sourceIssue ? { source: sourceIssue } : {}), ...(targetIssue ? { target: targetIssue } : {}),
    };
    const diagramContext = normalizeDiagramContext(raw.diagramContext, definition);
    const stateTransition = definition.id === 'uml.state-transition'
      ? normalizeStateTransition(raw.stateTransition) ?? stateTransitionFromLegacyLabel(raw.label) ?? {} : undefined;
    const activityFlow = definition.id === 'uml.activity-flow' || definition.id === 'uml.object-flow'
      ? normalizeActivityFlowData(raw.activityFlow, definition.id) : undefined;
    const usecaseExtend = definition.id === 'uml.extend'
      ? normalizeExtendRelationshipData(raw.usecaseExtend) : undefined;
    const sequenceEvent = normalizeSequenceMessageEvent(raw.sequenceEvent, id, definition.id,
      sourceRef ? raw.y1 : targetRef ? raw.y2 : raw.y1,
      finite(raw.sequenceTime) ? raw.sequenceTime : undefined, sourceRef, targetRef, raw.y2);
    const connector = {
      id, type: 'connector', shapeId: definition.id,
      x1: raw.x1, y1: raw.y1, x2: raw.x2, y2: raw.y2, waypoints,
      color: safeColor(raw.color, '#1e40af'), sw: finite(raw.sw) ? Math.max(0, Math.min(64, raw.sw)) : 2,
      lineStyle: isUmlConnector ? definition.connector?.lineStyle ?? 'solid'
        : raw.lineStyle === 'dashed' || raw.lineStyle === 'dotted' ? raw.lineStyle : definition.connector?.lineStyle ?? 'solid',
      startMarker, endMarker,
      ...(isCardinality(raw.sourceCardinality) ? { sourceCardinality: raw.sourceCardinality } : definition.connector?.sourceCardinality ? { sourceCardinality: definition.connector.sourceCardinality } : {}),
      ...(isCardinality(raw.targetCardinality) ? { targetCardinality: raw.targetCardinality } : definition.connector?.targetCardinality ? { targetCardinality: definition.connector.targetCardinality } : {}),
      ...(typeof raw.sourceMultiplicity === 'string' ? { sourceMultiplicity: raw.sourceMultiplicity.slice(0, 200_000) } : {}),
      ...(typeof raw.targetMultiplicity === 'string' ? { targetMultiplicity: raw.targetMultiplicity.slice(0, 200_000) } : {}),
      ...(typeof raw.sourceLabel === 'string' ? { sourceLabel: raw.sourceLabel.slice(0, 200_000) } : {}),
      ...(typeof raw.targetLabel === 'string' ? { targetLabel: raw.targetLabel.slice(0, 200_000) } : {}),
      ...(sourceRef ? { sourceRef } : {}),
      ...(targetRef ? { targetRef } : {}),
      ...(Object.keys(invalidEndpointRefs).length ? { invalidEndpointRefs } : {}),
      sourceIntent: normalizeEndpointIntent(raw.sourceIntent, Boolean(sourceRef)),
      targetIntent: normalizeEndpointIntent(raw.targetIntent, Boolean(targetRef)),

      ...(definition.semantic?.notation === 'uml' ? { umlSchemaVersion: UML_FOUNDATION_SCHEMA_VERSION } : {}),
      ...(diagramContext ? { diagramContext } : {}),
      ...(typeof raw.label === 'string' ? { label: raw.label.slice(0, 200_000) } : definition.defaultLabel !== undefined ? { label: definition.defaultLabel } : {}),
      ...(finite(raw.labelPosition) ? { labelPosition: Math.round(clamp(raw.labelPosition, 0, 1000)) } : {}),
      ...(finite(raw.labelOffset) ? { labelOffset: Math.round(clamp(raw.labelOffset, -2000, 2000)) } : {}),
      ...(finite(raw.sourceLabelPosition) ? { sourceLabelPosition: Math.round(clamp(raw.sourceLabelPosition, 0, 1000)) } : {}),
      ...(finite(raw.sourceLabelOffset) ? { sourceLabelOffset: Math.round(clamp(raw.sourceLabelOffset, -2000, 2000)) } : {}),
      ...(finite(raw.targetLabelPosition) ? { targetLabelPosition: Math.round(clamp(raw.targetLabelPosition, 0, 1000)) } : {}),
      ...(finite(raw.targetLabelOffset) ? { targetLabelOffset: Math.round(clamp(raw.targetLabelOffset, -2000, 2000)) } : {}),
      ...(finite(raw.sequenceTime) ? { sequenceTime: Math.round(clamp(raw.sequenceTime, -1_000_000, 1_000_000) * 1000) / 1000 } : {}),
      ...(sequenceEvent ? { sequenceEvent } : {}),
      ...(typeof raw.containerId === 'string' && raw.containerId.length <= 256 && raw.containerId !== id ? { containerId: raw.containerId } : {}),
      ...(finite(raw.parallelOrder) ? { parallelOrder: Math.max(0, Math.min(2_147_483_647, Math.floor(raw.parallelOrder))) } : {}),
      ...(finite(raw.parallelLane) ? { parallelLane: Math.max(-8, Math.min(8, raw.parallelLane)) } : {}),
      ...(stateTransition ? { stateTransition } : {}),
      ...(activityFlow ? { activityFlow } : {}),
      ...(usecaseExtend ? { usecaseExtend } : {}),
      ...(raw.erdParticipation === 'total' || raw.erdParticipation === 'partial'
        ? { erdParticipation: raw.erdParticipation }
        : definition.connector?.erdParticipation ? { erdParticipation: definition.connector.erdParticipation } : {}),
      ...connectorBounds({ shapeId: definition.id, x1: raw.x1, y1: raw.y1, x2: raw.x2, y2: raw.y2, waypoints, startMarker, endMarker,
        sourceCardinality: isCardinality(raw.sourceCardinality) ? raw.sourceCardinality : definition.connector?.sourceCardinality,
        targetCardinality: isCardinality(raw.targetCardinality) ? raw.targetCardinality : definition.connector?.targetCardinality,
        sourceMultiplicity: typeof raw.sourceMultiplicity === 'string' ? raw.sourceMultiplicity : undefined,
        targetMultiplicity: typeof raw.targetMultiplicity === 'string' ? raw.targetMultiplicity : undefined,
        sourceLabel: typeof raw.sourceLabel === 'string' ? raw.sourceLabel : undefined,
        targetLabel: typeof raw.targetLabel === 'string' ? raw.targetLabel : undefined,
        sourceLabelPosition: finite(raw.sourceLabelPosition) ? Math.round(clamp(raw.sourceLabelPosition, 0, 1000)) : undefined,
        sourceLabelOffset: finite(raw.sourceLabelOffset) ? Math.round(clamp(raw.sourceLabelOffset, -2000, 2000)) : undefined,
        targetLabelPosition: finite(raw.targetLabelPosition) ? Math.round(clamp(raw.targetLabelPosition, 0, 1000)) : undefined,
        targetLabelOffset: finite(raw.targetLabelOffset) ? Math.round(clamp(raw.targetLabelOffset, -2000, 2000)) : undefined,
        labelPosition: finite(raw.labelPosition) ? Math.round(clamp(raw.labelPosition, 0, 1000)) : undefined,
        labelOffset: finite(raw.labelOffset) ? Math.round(clamp(raw.labelOffset, -2000, 2000)) : undefined,
        sourceRef: normalizeRef(raw.sourceRef), targetRef: normalizeRef(raw.targetRef),
        parallelLane: finite(raw.parallelLane) ? Math.max(-8, Math.min(8, raw.parallelLane)) : undefined,
        diagramContext,
        stateTransition,
        activityFlow,
        usecaseExtend,
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
  if (['rect', 'rounded-rect', 'ellipse', 'triangle', 'diamond', 'star', 'callout', 'pentagon', 'hexagon', 'parallelogram', 'trapezoid', 'right-triangle', 'document'].includes(type) || ['sticky', 'text', 'math', 'code', 'image', 'video', 'link-card'].includes(type)) {
    if (!finite(raw.x) || !finite(raw.y)) return null;
    const x = raw.x, y = raw.y, w = safeSize(raw.w), h = safeSize(raw.h);
    const rotation = normalizeRotation(raw.rotation);
    const bounds = rotatedBoxBounds({ x, y, w, h, rotation });
    const definition = getShapeDefinitionForLegacyType(type);
    const legacyVertices = Array.isArray(raw.vertices) ? raw.vertices.slice(0, 64).filter((point: unknown): point is [number, number] => Array.isArray(point) && finite(point[0]) && finite(point[1])).map((point: [number, number]) => [point[0], point[1]] as [number, number]) : undefined;
    const legacyRaw = { ...raw };
    delete legacyRaw.embeddedTextScale;
    return { ...legacyRaw, id, type, x, y, w, h, rotation,
      ...(definition?.kind === 'shape' && finite(raw.embeddedTextScale) ? { embeddedTextScale: Math.max(0.01, Math.min(64, raw.embeddedTextScale)) } : {}),
      ...(type === 'image' && typeof raw.src !== 'string' ? { src: '' } : {}),
      ...(type === 'image' && !finite(raw.naturalW) ? { naturalW: w } : {}),
      ...(type === 'image' && !finite(raw.naturalH) ? { naturalH: h } : {}),
      ...(type === 'video' && typeof raw.src !== 'string' ? { src: '' } : {}),
      ...(type === 'link-card' && typeof raw.url !== 'string' ? { url: '' } : {}),
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
  shapeId?: string; type?: string; params?: Readonly<Record<string, unknown>>; data?: Readonly<Record<string, unknown>>;
  scale3d?: { x: number; y: number; z: number };
}, toward?: Point2D): ShapeConnectionPoint[] {
  const definition = shape.shapeId ? getShapeDefinition(shape.shapeId) : shape.type ? getShapeDefinitionForLegacyType(shape.type) : undefined;
  const solidOrigin = Boolean(definition?.solid3d);
  const geometry = definition ? buildShapeGeometry(definition, shape.w, shape.h, shape.params ?? definition.defaultParams ?? {},
    definition.solid3d ? { scale: shape.scale3d ?? solid3DScaleFromBounds(shape.w, shape.h, definition.width, definition.height, definition.geometry as import('./solid3d').Solid3DGeometry),
      referenceWidth: definition.width, referenceHeight: definition.height, center: { x: 0, y: 0 } } : undefined) : null;
  const silhouettePaths = geometry ? flattenGeometryCommands(geometry.outline, 24) : [];
  const paths = geometry ? [
    ...silhouettePaths,
    ...(definition?.solid3d ? [] : [
      ...geometry.decorations.flatMap(commands => flattenGeometryCommands(commands, 24)),
      ...geometry.hiddenEdges.flatMap(commands => flattenGeometryCommands(commands, 24)),
    ]),
  ] : [];
  const points = paths.flat();
  const localBounds = points.length ? {
    minX: Math.min(...points.map(point => point[0])), maxX: Math.max(...points.map(point => point[0])),
    minY: Math.min(...points.map(point => point[1])), maxY: Math.max(...points.map(point => point[1])),
  } : { minX: 0, maxX: shape.w, minY: 0, maxY: shape.h };
  const localCenterX = solidOrigin ? (localBounds.minX + localBounds.maxX) / 2 : shape.w / 2;
  const localCenterY = solidOrigin ? (localBounds.minY + localBounds.maxY) / 2 : shape.h / 2;
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
      ? (direction === 'min' ? y <= localCenterY + 1e-7 : y >= localCenterY - 1e-7)
      : (direction === 'min' ? x <= localCenterX + 1e-7 : x >= localCenterX - 1e-7));
    if (!outward.length) return null;
    const compareIndex = axis === 'x' ? 1 : 0;
    return outward.reduce((best, point) => direction === 'min'
      ? point[compareIndex] < best[compareIndex] ? point : best
      : point[compareIndex] > best[compareIndex] ? point : best);
  };
  const fallbackExtreme = (axis: 'x' | 'y', direction: 'min' | 'max'): [number, number] => {
    if (!points.length) return axis === 'x'
      ? [direction === 'min' ? localBounds.minX : localBounds.maxX, localCenterY]
      : [localCenterX, direction === 'min' ? localBounds.minY : localBounds.maxY];
    const primary = (point: [number, number]) => point[axis === 'x' ? 0 : 1];
    const lateral = (point: [number, number]) => point[axis === 'x' ? 1 : 0];
    const center = axis === 'x' ? localCenterY : localCenterX;
    const extreme = points.reduce((value, point) => direction === 'min' ? Math.min(value, primary(point)) : Math.max(value, primary(point)), direction === 'min' ? Infinity : -Infinity);
    return points.filter(point => Math.abs(primary(point) - extreme) < 1e-6)
      .reduce((best, point) => Math.abs(lateral(point) - center) < Math.abs(lateral(best) - center) ? point : best);
  };
  const rayToSilhouette = (dx: number, dy: number): [number, number] | null => {
    let bestT = Infinity, best: [number, number] | null = null;
    for (const path of silhouettePaths) for (let index = 1; index < path.length; index++) {
      const a = path[index - 1], b = path[index], sx = b[0] - a[0], sy = b[1] - a[1];
      const denominator = dx * sy - dy * sx;
      if (Math.abs(denominator) < 1e-9) continue;
      const ax = a[0] - localCenterX, ay = a[1] - localCenterY;
      const t = (ax * sy - ay * sx) / denominator;
      const u = (ax * dy - ay * dx) / denominator;
      if (t >= 0 && u >= -1e-8 && u <= 1 + 1e-8 && t < bestT) {
        bestT = t; best = [localCenterX + dx * t, localCenterY + dy * t];
      }
    }
    return best;
  };
  const local = [
    { id: 'top', kind: 'fixed' as const, point: rayIntersection('x', localCenterX, 'min') ?? fallbackExtreme('y', 'min') },
    { id: 'right', kind: 'fixed' as const, point: rayIntersection('y', localCenterY, 'max') ?? fallbackExtreme('x', 'max') },
    { id: 'bottom', kind: 'fixed' as const, point: rayIntersection('x', localCenterX, 'max') ?? fallbackExtreme('y', 'max') },
    { id: 'left', kind: 'fixed' as const, point: rayIntersection('y', localCenterY, 'min') ?? fallbackExtreme('x', 'min') },
    { id: 'center', kind: 'fixed' as const, point: (solidOrigin ? [0, 0] : [shape.w / 2, shape.h / 2]) as [number, number] },
  ];
  const toWorld = (id: string, x: number, y: number, kind: ConnectionPointKind = 'fixed'): ShapeConnectionPoint => {
    const world = solidOrigin
      ? (() => { const [wx, wy] = rotatePoint(shape.x + x, shape.y + y, shape.x, shape.y, shape.rotation ?? 0); return { x: wx, y: wy }; })()
      : objectPointToWorld(shape, { x, y });
    return { id, x: world.x, y: world.y, kind };
  };
  const result = local.map(({ id, kind, point: [x, y] }) => toWorld(id, x, y, kind));
  if (definition?.geometry === 'actor') {
    const glyphH = shape.h * 0.68;
    result.push(
      toWorld('torso', shape.w / 2, glyphH * 0.44, 'fixed'),
      toWorld('hand:left', shape.w * 0.14, glyphH * 0.40, 'fixed'),
      toWorld('hand:right', shape.w * 0.86, glyphH * 0.40, 'fixed'),
      toWorld('feet', shape.w / 2, glyphH * 0.98, 'fixed'),
    );
  }
  const provider = definition?.semantic?.connectionPointProvider;
  if (provider === 'structured-table-rows') {
    const table = shape.data && isObject(shape.data.table) ? shape.data.table : null;
    const columns = Array.isArray(table?.columns) ? table.columns.slice(0, 32) : [];
    const layout = structuredTableLayout(shape.h, columns.length + 1);
    columns.forEach((column, index) => {
      const record = isObject(column) ? column : {};
      const rawId = typeof record.id === 'string' && record.id.trim() ? record.id.trim() : `row-${index}`;
      const safeId = rawId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 44) || `row-${index}`;
      const y = layout.rowCenters[index + 1];
      result.push(toWorld(`table-row:${safeId}:left`, 0, y, 'structured'), toWorld(`table-row:${safeId}:right`, shape.w, y, 'structured'));
    });
  }
  if (provider === 'sequence-lifeline') {
    // Header size is fixed in board space. New attachment IDs store local board-unit time rather
    // than a fraction of the current height, so length edits cannot move an existing event.
    const startY = Math.min(shape.h, sequenceParticipantHeaderHeight(definition?.geometry));
    const bodyHeight = Math.max(1, shape.h - startY);
    const destroyedAt = Math.round(clamp(finite(shape.params?.sequenceDestroyPermille) ? shape.params.sequenceDestroyPermille : 1000, 0, 1000));
    const visibleEndY = startY + bodyHeight * (destroyedAt / 1000);
    const pointAtLocalY = (localY: number) => toWorld(`lifeline-time:${Math.round(localY * 1000)}`,
      shape.w / 2, localY, 'sequence-time');
    const legacyPointAt = (permille: number) => toWorld(`lifeline:${permille}`,
      shape.w / 2, startY + bodyHeight * (permille / 1000), 'sequence-time');
    result.push(toWorld('participant:create', shape.w / 2, 0, 'special'));
    if (toward) {
      const localToward = worldPointToObject(shape, toward);
      result.push(pointAtLocalY(clamp(localToward.y, startY, visibleEndY)));
    } else {
      // Keep legacy normalized points discoverable for older integrations; new attachments use
      // the stable lifeline-time IDs produced above.
      result.push(legacyPointAt(0), legacyPointAt(Math.round(destroyedAt / 2)), legacyPointAt(destroyedAt));
    }
  }
  if (provider === 'sequence-activation') {
    const pointAtLocalY = (side: 'left' | 'right', localY: number) => toWorld(
      `activation-time:${side}:${Math.round(localY * 1000)}`, side === 'left' ? 0 : shape.w, localY, 'sequence-time');
    const legacyPointAt = (side: 'left' | 'right', permille: number) => toWorld(
      `activation:${side}:${permille}`, side === 'left' ? 0 : shape.w, shape.h * (permille / 1000), 'sequence-time');
    if (toward) {
      const localToward = worldPointToObject(shape, toward);
      const side = localToward.x <= shape.w / 2 ? 'left' : 'right';
      result.push(pointAtLocalY(side, clamp(localToward.y, 0, shape.h)));
    } else {
      for (const side of ['left', 'right'] as const) {
        result.push(legacyPointAt(side, 0), legacyPointAt(side, 500), legacyPointAt(side, 1000));
      }
    }
  }
  if (provider === 'uml-behavior-vertex') {
    const directions: Array<[string, number, number]> = [
      ['n', 0, -1], ['ne', 1, -1], ['e', 1, 0], ['se', 1, 1],
      ['s', 0, 1], ['sw', -1, 1], ['w', -1, 0], ['nw', -1, -1],
    ];
    for (const [id, dx, dy] of directions) {
      const point = rayToSilhouette(dx, dy);
      if (point) result.push(toWorld(`behavior:${id}`, point[0], point[1], 'relative'));
    }
  }
  // Generic box attachments may float anywhere on the silhouette. The normalized local
  // coordinates remain stable across shape movement/resizing and are not arbitrary world points.
  if (toward && !provider) {
    const localToward = worldPointToObject(shape, toward);
    let dx = localToward.x - localCenterX, dy = localToward.y - localCenterY;
    if (Math.hypot(dx, dy) < 1e-7) { dx = 1; dy = 0; }
    const point = rayToSilhouette(dx, dy);
    if (point) {
      const u = Math.round(clamp(point[0] / Math.max(1, shape.w), 0, 1) * 1000);
      const v = Math.round(clamp(point[1] / Math.max(1, shape.h), 0, 1) * 1000);
      result.push(toWorld(`floating:${u}:${v}`, point[0], point[1], 'floating'));
    }
  }
  return result;
}

/** Resolve stable structured row and normalized lifeline IDs after either endpoint owner transforms. */
export function connectionPointById(shape: {
  x: number; y: number; w: number; h: number; rotation?: number;
  shapeId?: string; type?: string; params?: Readonly<Record<string, unknown>>; data?: Readonly<Record<string, unknown>>;
  scale3d?: { x: number; y: number; z: number };
}, pointId: string): ShapeConnectionPoint | undefined {
  const definition = shape.shapeId ? getShapeDefinition(shape.shapeId) : undefined;
  const floating = pointId.match(/^floating:(\d{1,4}):(\d{1,4})$/);
  if (floating && !definition?.semantic?.connectionPointProvider) {
    const u = Math.max(0, Math.min(1000, Number(floating[1]))) / 1000;
    const v = Math.max(0, Math.min(1000, Number(floating[2]))) / 1000;
    const toward = objectPointToWorld(shape, { x: shape.w * u, y: shape.h * v });
    const point = connectionPointsForBox(shape, toward).find(candidate => candidate.kind === 'floating');
    return point ? { ...point, id: pointId, kind: 'floating' } : undefined;
  }
  if (pointId === 'participant:create' && definition?.semantic?.connectionPointProvider === 'sequence-lifeline') {
    const world = objectPointToWorld(shape, { x: shape.w / 2, y: 0 });
    return { id: pointId, x: world.x, y: world.y, kind: 'special' };
  }
  const dynamicLifelineTime = pointId.match(/^lifeline-time:(-?\d{1,12})$/);
  if (dynamicLifelineTime) {
    if (definition?.semantic?.connectionPointProvider !== 'sequence-lifeline') return undefined;
    const localY = Number(dynamicLifelineTime[1]) / 1000;
    const startY = Math.min(shape.h, sequenceParticipantHeaderHeight(definition?.geometry));
    const bodyHeight = Math.max(1, shape.h - startY);
    const destroyedAt = clamp(finite(shape.params?.sequenceDestroyPermille) ? shape.params.sequenceDestroyPermille : 1000, 0, 1000);
    const visibleEndY = startY + bodyHeight * (destroyedAt / 1000);
    if (localY < startY - 0.001 || localY > visibleEndY + 0.001) return undefined;
    const world = objectPointToWorld(shape, { x: shape.w / 2, y: localY });
    return { id: pointId, x: world.x, y: world.y, kind: 'sequence-time' };
  }
  const dynamicActivationTime = pointId.match(/^activation-time:(left|right):(-?\d{1,12})$/);
  if (dynamicActivationTime) {
    if (definition?.semantic?.connectionPointProvider !== 'sequence-activation') return undefined;
    const side = dynamicActivationTime[1] as 'left' | 'right', localY = Number(dynamicActivationTime[2]) / 1000;
    if (localY < -0.001 || localY > shape.h + 0.001) return undefined;
    const world = objectPointToWorld(shape, { x: side === 'left' ? 0 : shape.w, y: localY });
    return { id: pointId, x: world.x, y: world.y, kind: 'sequence-time' };
  }
  const dynamicLifeline = pointId.match(/^lifeline:(\d{1,4})$/);
  if (dynamicLifeline) {
    if (definition?.semantic?.connectionPointProvider !== 'sequence-lifeline') return undefined;
    const permille = Math.max(0, Math.min(1000, Number(dynamicLifeline[1])));
    const startY = Math.min(shape.h, sequenceParticipantHeaderHeight(definition?.geometry));
    const world = objectPointToWorld(shape, { x: shape.w / 2, y: startY + (shape.h - startY) * (permille / 1000) });
    return { id: pointId, x: world.x, y: world.y, kind: 'sequence-time' };
  }
  const dynamicActivation = pointId.match(/^activation:(left|right):(\d{1,4})$/);
  if (dynamicActivation) {
    if (definition?.semantic?.connectionPointProvider !== 'sequence-activation') return undefined;
    const side = dynamicActivation[1] as 'left' | 'right';
    const permille = Math.max(0, Math.min(1000, Number(dynamicActivation[2])));
    const world = objectPointToWorld(shape, { x: side === 'left' ? 0 : shape.w, y: shape.h * (permille / 1000) });
    return { id: pointId, x: world.x, y: world.y, kind: 'sequence-time' };
  }
  if (pointId.startsWith('behavior:')) {
    const point = connectionPointsForBox(shape).find(candidate => candidate.id === pointId);
    return point ? { ...point, kind: 'relative' } : undefined;
  }
  if (pointId.startsWith('table-row:')) {
    const point = connectionPointsForBox(shape).find(candidate => candidate.id === pointId);
    return point ? { ...point, kind: 'structured' } : undefined;
  }
  return connectionPointsForBox(shape).find(point => point.id === pointId);
}

export function connectionPointsAtSequenceTime(
  shape: Parameters<typeof connectionPointById>[0], worldY: number,
): ShapeConnectionPoint[] {
  const definition = shape.shapeId ? getShapeDefinition(shape.shapeId) : undefined;
  const provider = definition?.semantic?.connectionPointProvider;
  if ((provider !== 'sequence-lifeline' && provider !== 'sequence-activation') || !finite(worldY)) return [];
  const radians = normalizeRotation(shape.rotation) * Math.PI / 180, cos = Math.cos(radians);
  if (Math.abs(cos) < 1e-5) return [];
  // UML Sequence participants are time-vertical. Solving on the owner's local centerline keeps
  // the same board ordinate across differently sized participant headers and lifeline lengths.
  const localY = shape.h / 2 + (worldY - (shape.y + shape.h / 2)) / cos;
  const ids = provider === 'sequence-lifeline'
    ? [`lifeline-time:${Math.round(localY * 1000)}`]
    : (['left', 'right'] as const).map(side => `activation-time:${side}:${Math.round(localY * 1000)}`);
  return ids.map(id => connectionPointById(shape, id)).filter((point): point is ShapeConnectionPoint =>
    Boolean(point && Math.abs(point.y - worldY) <= 0.01));
}

/** Convert old normalized Sequence refs to a stable owner-local time anchor during board migration. */
export function persistentSequencePointId(
  shape: Parameters<typeof connectionPointById>[0], oldPointId: string, point: Pick<ShapeConnectionPoint, 'x' | 'y'>,
): string | undefined {
  const definition = shape.shapeId ? getShapeDefinition(shape.shapeId) : undefined;
  const provider = definition?.semantic?.connectionPointProvider;
  if (provider !== 'sequence-lifeline' && provider !== 'sequence-activation') return undefined;
  const local = worldPointToObject(shape, point);
  if (provider === 'sequence-lifeline') {
    if (!/^(?:lifeline:\d{1,4}|lifeline-time:-?\d{1,12})$/.test(oldPointId)) return undefined;
    return `lifeline-time:${Math.round(local.y * 1000)}`;
  }
  if (!/^(?:activation:(?:left|right):\d{1,4}|activation-time:(?:left|right):-?\d{1,12})$/.test(oldPointId)) return undefined;
  const match = oldPointId.match(/(?:activation|activation-time):(left|right)(?::|:)(?:-?\d+)/);
  const side = (match?.[1] ?? (local.x <= shape.w / 2 ? 'left' : 'right')) as 'left' | 'right';
  return `activation-time:${side}:${Math.round(local.y * 1000)}`;
}

/** Backward-compatible parser for normalized IDs written by schema version 1 boards. */
export function sequenceAnchorPermille(pointId: string | undefined): number | undefined {
  if (!pointId) return undefined;
  const lifeline = pointId.match(/^lifeline:(\d{1,4})$/);
  if (lifeline) return Math.max(0, Math.min(1000, Number(lifeline[1])));
  const activation = pointId.match(/^activation:(?:left|right):(\d{1,4})$/);
  if (activation) return Math.max(0, Math.min(1000, Number(activation[1])));
  return undefined;
}

export function hasDiagramDefinition(shape: unknown): shape is DiagramShapeObject {
  return isObject(shape) && shape.type === 'diagram' && typeof shape.shapeId === 'string' && Boolean(getShapeDefinition(shape.shapeId));
}

export function hasConnectorDefinition(shape: unknown): shape is ConnectorShapeObject {
  return isObject(shape) && shape.type === 'connector' && typeof shape.shapeId === 'string' && getShapeDefinition(shape.shapeId)?.kind === 'connector';
}

export function isDoubleClickTextEditableShape(shape: unknown): boolean {
  if (!isObject(shape) || typeof shape.type !== 'string') return false;
  if (['sticky', 'text', 'math', 'code'].includes(shape.type)) return true;
  if (shape.type === 'diagram' && typeof shape.shapeId === 'string') {
    const definition = getShapeDefinition(shape.shapeId);
    if (!definition || definition.kind !== 'shape') return false;
    const capabilities = diagramCapabilitiesFor(definition);
    return capabilities.text.editable !== false && 'x' in shape && 'w' in shape;
  }
  const definition = getShapeDefinitionForLegacyType(shape.type) ?? getShapeDefinitionByToolId(shape.type);
  return definition?.category === 'Basic' && definition.kind === 'shape'
    && 'x' in shape && 'w' in shape;
}

