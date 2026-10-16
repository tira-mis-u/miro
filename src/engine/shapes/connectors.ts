import type { ConnectorRouteKind, ConnectorShapeObject, EndpointMarker, PathCommand, ShapeDefinition } from './types';

export interface ConnectorRouteInput {
  routeKind?: ConnectorRouteKind;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  waypoints: readonly [number, number][];
  parallelLane?: number;
  parallelLaneSpacing?: number;
  selfLoopKind?: 'sequence' | 'behavioral';
  selfLoopSide?: string;
}

const command = (op: PathCommand['op'], ...values: number[]): PathCommand => ({ op, values });

/** Extra room for parallel UML relationship routes and their independent labels. */
export const UML_RELATIONSHIP_LANE_SPACING = 40;
export const UML_RELATIONSHIP_LABEL_LANE_SPACING = 24;
/** Sequence lanes need enough visual separation to remain individually targetable at normal zoom. */
export const UML_SEQUENCE_LANE_SPACING = 40;

export function parallelConnectorLabelOffset(offset: number, lane: number | undefined, isUmlRelationship: boolean): number {
  return offset + (isUmlRelationship ? (lane ?? 0) * UML_RELATIONSHIP_LABEL_LANE_SPACING : 0);
}

/** Shared deterministic route construction used by live connectors, hit testing, bounds and previews. */
export function buildConnectorRoute(connector: ConnectorRouteInput): [number, number][] {
  const start: [number, number] = [connector.x1, connector.y1], end: [number, number] = [connector.x2, connector.y2];
  const routeKind = connector.routeKind ?? 'straight';
  if (connector.selfLoopKind && connector.waypoints.length === 0) {
    const laneOffset = (connector.parallelLane ?? 0) * 18;
    const offset = Math.max(22, 34 + laneOffset);
    if (connector.selfLoopKind === 'sequence') {
      const loopX = Math.max(start[0], end[0]) + offset;
      return [start, [loopX, start[1]], [loopX, end[1]], end];
    }
    const side = connector.selfLoopSide ?? '';
    if (/(^|:)(n|nw|ne|top)(:|$)/.test(side)) {
      const loopY = Math.min(start[1], end[1]) - offset;
      return [start, [start[0], loopY], [end[0], loopY], end];
    }
    if (/(^|:)(s|sw|se|bottom)(:|$)/.test(side)) {
      const loopY = Math.max(start[1], end[1]) + offset;
      return [start, [start[0], loopY], [end[0], loopY], end];
    }
    if (/(^|:)(w|left)(:|$)/.test(side)) {
      const loopX = Math.min(start[0], end[0]) - offset;
      return [start, [loopX, start[1]], [loopX, end[1]], end];
    }
    const loopX = Math.max(start[0], end[0]) + offset;
    return [start, [loopX, start[1]], [loopX, end[1]], end];
  }
  if (routeKind === 'straight' && connector.waypoints.length === 0 && Math.abs(connector.parallelLane ?? 0) > 1e-6) {
    const dx = end[0] - start[0], dy = end[1] - start[1], length = Math.hypot(dx, dy);
    if (length > 1e-8) {
      const spacing = connector.parallelLaneSpacing ?? 18;
      const offset = (connector.parallelLane ?? 0) * spacing, nx = -dy / length, ny = dx / length;
      const control: [number, number] = [(start[0] + end[0]) / 2 + nx * offset, (start[1] + end[1]) / 2 + ny * offset];
      return Array.from({ length: 17 }, (_, index): [number, number] => {
        const t = index / 16, u = 1 - t;
        return [u * u * start[0] + 2 * u * t * control[0] + t * t * end[0],
          u * u * start[1] + 2 * u * t * control[1] + t * t * end[1]];
      });
    }
  }
  if ((routeKind === 'orthogonal' || routeKind === 'elbow') && connector.waypoints.length === 0
    && Math.abs(connector.parallelLane ?? 0) > 1e-6) {
    const spacing = connector.parallelLaneSpacing ?? 18;
    const laneOffset = (connector.parallelLane ?? 0) * spacing;
    if (Math.abs(end[0] - start[0]) >= Math.abs(end[1] - start[1])) {
      const middleY = (start[1] + end[1]) / 2 + laneOffset;
      const path: [number, number][] = [start, [start[0], middleY], [end[0], middleY], end];
      return path.filter((point, index) => index === 0 || Math.hypot(point[0] - path[index - 1][0], point[1] - path[index - 1][1]) > 1e-8);
    }
    const middleX = (start[0] + end[0]) / 2 + laneOffset;
    const path: [number, number][] = [start, [middleX, start[1]], [middleX, end[1]], end];
    return path.filter((point, index) => index === 0 || Math.hypot(point[0] - path[index - 1][0], point[1] - path[index - 1][1]) > 1e-8);
  }
  if (routeKind === 'curved') {
    const anchors: [number, number][] = [start, ...connector.waypoints, end];
    if (anchors.length === 2) {
      const dx = end[0] - start[0], dy = end[1] - start[1], offset = Math.min(80, Math.hypot(dx, dy) * 0.35), length = Math.max(1, Math.hypot(dx, dy));
      const nx = -dy / length * offset, ny = dx / length * offset;
      const c1: [number, number] = [start[0] + dx / 3 + nx, start[1] + dy / 3 + ny];
      const c2: [number, number] = [start[0] + dx * 2 / 3 + nx, start[1] + dy * 2 / 3 + ny];
      return Array.from({ length: 25 }, (_, index): [number, number] => {
        const t = index / 24, u = 1 - t;
        return [u ** 3 * start[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t ** 3 * end[0],
          u ** 3 * start[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t ** 3 * end[1]];
      });
    }
    const points: [number, number][] = [];
    for (let index = 0; index < anchors.length - 1; index++) {
      const p0 = anchors[Math.max(0, index - 1)], p1 = anchors[index], p2 = anchors[index + 1], p3 = anchors[Math.min(anchors.length - 1, index + 2)];
      for (let sample = 0; sample < 12; sample++) {
        const t = sample / 12, t2 = t * t, t3 = t2 * t;
        points.push([0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
          0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)]);
      }
    }
    points.push(end);
    return points;
  }
  const anchors: [number, number][] = [start, ...connector.waypoints, end];
  if (routeKind !== 'orthogonal' && routeKind !== 'elbow') return anchors;
  const result: [number, number][] = [anchors[0]];
  for (let index = 1; index < anchors.length; index++) {
    const previous = anchors[index - 1], next = anchors[index];
    if (Math.abs(previous[0] - next[0]) < 1e-7 || Math.abs(previous[1] - next[1]) < 1e-7) result.push(next);
    else if (routeKind === 'elbow') result.push([next[0], previous[1]], next);
    else if (Math.abs(next[0] - previous[0]) >= Math.abs(next[1] - previous[1])) {
      const middleX = (previous[0] + next[0]) / 2; result.push([middleX, previous[1]], [middleX, next[1]], next);
    } else {
      const middleY = (previous[1] + next[1]) / 2; result.push([previous[0], middleY], [next[0], middleY], next);
    }
  }
  return result.filter((point, index) => index === 0 || Math.hypot(point[0] - result[index - 1][0], point[1] - result[index - 1][1]) > 1e-8);
}

/** One rendered line, optionally ellipsized to a fixed point/width budget; storage remains lossless. */
export const CONNECTOR_LABEL_MAX_CHARS = 160;
export const CONNECTOR_LABEL_MAX_WIDTH = 280;
export const CONNECTOR_LABEL_HEIGHT = 18;
export const CONNECTOR_LABEL_PADDING_X = 4;
export const CONNECTOR_LABEL_PADDING_Y = 2;

export function fitConnectorLabel(
  value: string,
  measure: (text: string) => number = text => [...text].reduce((sum, character) => sum + (character.codePointAt(0)! > 0x2fff ? 12 : /[ilI.,'`:;!|]/.test(character) ? 3.6 : /[MW@#%&]/.test(character) ? 10 : 7), 0),
): string {
  if (value.includes('\n')) {
    return value.split('\n').map(line => fitConnectorLabel(line, measure)).join('\n');
  }
  const source = [...value.trim()];
  if (!source.length) return '';
  const truncated = source.length > CONNECTOR_LABEL_MAX_CHARS;
  let visible = source.slice(0, truncated ? CONNECTOR_LABEL_MAX_CHARS - 1 : CONNECTOR_LABEL_MAX_CHARS).join('') + (truncated ? '…' : '');
  while (visible.length > 1 && measure(visible) > CONNECTOR_LABEL_MAX_WIDTH) {
    const chars = [...visible];
    if (chars.at(-1) === '…') chars.pop();
    chars.pop();
    visible = `${chars.join('')}…`;
  }
  return visible;
}

/** The displayed string remains owned by its connector; State and Activity notation stay distinct. */
export function connectorDisplayLabel(connector: Pick<ConnectorShapeObject, 'shapeId' | 'label' | 'stateTransition' | 'activityFlow' | 'usecaseExtend'>): string {
  if (connector.shapeId === 'uml.include') return '«include»';
  if (connector.shapeId === 'uml.extend') {
    const lines = ['«extend»'];
    if (connector.usecaseExtend?.condition?.trim()) {
      lines.push(`condition: [${connector.usecaseExtend.condition.trim()}]`);
    }
    if (connector.usecaseExtend?.extensionPoint?.trim()) {
      lines.push(`extension point: ${connector.usecaseExtend.extensionPoint.trim()}`);
    }
    return lines.join('\n');
  }
  if (connector.shapeId === 'uml-usage') return '«use»';
  if (connector.shapeId === 'uml.state-transition' && connector.stateTransition) {
    const { trigger = '', guard = '', effect = '' } = connector.stateTransition;
    const prefix = [trigger.trim(), guard.trim() ? `[${guard.trim()}]` : ''].filter(Boolean).join(' ');
    return `${prefix}${effect.trim() ? `${prefix ? ' ' : ''}/ ${effect.trim()}` : ''}`.trim();
  }
  if ((connector.shapeId === 'uml.activity-flow' || connector.shapeId === 'uml.object-flow')
    && typeof connector.activityFlow?.guard === 'string' && connector.activityFlow.guard.trim())
    return `[${connector.activityFlow.guard.trim()}]`;
  return connector.label ?? '';
}

export interface ConnectorLabelLayoutOptions {
  startMarker?: EndpointMarker;
  endMarker?: EndpointMarker;
  sourceCardinality?: string;
  targetCardinality?: string;
  strokeWidth?: number;
  labelWidth: number;
  labelHeight?: number;
  /** Persisted route-relative location in permille; omitted means the automatically balanced point. */
  labelPosition?: number;
  /** Signed world-unit offset perpendicular to the route. */
  labelOffset?: number;
}
export interface ConnectorLabelLayout {
  x: number;
  y: number;
  width: number;
  height: number;
  distance: number;
  totalLength: number;
  tangent: [number, number];
  offset: number;
}

/** Approximate the drawn marker envelope from the same minimum-size/stroke rules used by Canvas. */
export function connectorMarkerOccupancy(marker: EndpointMarker | undefined, cardinality: string | undefined, strokeWidth = 2): number {
  const width = Math.max(0, Number.isFinite(strokeWidth) ? strokeWidth : 0);
  if (cardinality) {
    const size = Math.max(9, width * 3);
    return size * (cardinality === 'zero-or-one' || cardinality === 'zero-or-many' ? 1.55 : 1.35);
  }
  if (!marker || marker === 'none') return 0;
  const size = Math.max(8, width * 3.1);
  if (marker === 'diamond' || marker === 'filledDiamond') return size * 1.8;
  if (marker === 'openArrow' || marker === 'hollowTriangle') return size * 1.55;
  if (marker === 'circle' || marker === 'filledCircle' || marker === 'zeroOrOne') return size * 0.8;
  if (marker === 'crowFoot' || marker === 'oneOrMany' || marker === 'zeroOrMany') return size * 1.2;
  if (marker === 'bar') return size * 0.55;
  return size;
}

function pointAtRouteDistance(route: readonly [number, number][], distance: number) {
  let remaining = distance;
  for (let index = 1; index < route.length; index++) {
    const a = route[index - 1], b = route[index], length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length <= 1e-9) continue;
    if (remaining <= length || index === route.length - 1) {
      const ratio = Math.max(0, Math.min(1, remaining / length));
      return { x: a[0] + (b[0] - a[0]) * ratio, y: a[1] + (b[1] - a[1]) * ratio,
        tangent: [(b[0] - a[0]) / length, (b[1] - a[1]) / length] as [number, number] };
    }
    remaining -= length;
  }
  const last = route.at(-1) ?? [0, 0], previous = route.at(-2) ?? last;
  const length = Math.max(1e-9, Math.hypot(last[0] - previous[0], last[1] - previous[1]));
  return { x: last[0], y: last[1], tangent: [(last[0] - previous[0]) / length, (last[1] - previous[1]) / length] as [number, number] };
}

function applyLabelNormalOffset(point: { x: number; y: number; tangent: [number, number] }, offset: number) {
  const bounded = Number.isFinite(offset) ? Math.max(-2000, Math.min(2000, offset)) : 0;
  const normal: [number, number] = [-point.tangent[1], point.tangent[0]];
  return { x: point.x + normal[0] * bounded, y: point.y + normal[1] * bounded, offset: bounded };
}

export function defaultConnectorCenterOffset(
  tangent: readonly [number, number],
  labelWidth: number,
  labelHeight: number,
  strokeWidth = 1.5,
  gap = 6,
): number {
  const halfW = labelWidth / 2;
  const halfH = labelHeight / 2;
  // Normal vector is [-tangent[1], tangent[0]].
  // Project the label's half-box onto the normal axis:
  const projectedHalf = Math.abs(tangent[1]) * halfW + Math.abs(tangent[0]) * halfH;
  const clearance = projectedHalf + strokeWidth / 2 + gap;

  // If the segment is not strictly vertical, offset upwards in screen coords (-y)
  // Normal y-component is tangent[0]. For normal[1] * offset < 0, offset must have opposite sign of tangent[0].
  if (Math.abs(tangent[0]) >= 0.15) {
    return (tangent[0] >= 0 ? -1 : 1) * clearance;
  }
  // For vertical segments, offset to the right in screen coords (+x)
  // Normal x-component is -tangent[1]. For normal[0] * offset > 0, offset must have opposite sign of tangent[1].
  return (tangent[1] >= 0 ? -1 : 1) * clearance;
}

/**
 * Route-aware, screen-horizontal label location. Candidate positions are arc-length samples
 * scored against the real start/end marker envelopes; route-relative position and normal offset
 * remain persistent through connector movement, waypoints, and rerouting.
 */
export function connectorLabelLayout(routeInput: readonly [number, number][], options: ConnectorLabelLayoutOptions): ConnectorLabelLayout {
  const route = routeInput.filter((point, index) => index === 0 || Math.hypot(point[0] - routeInput[index - 1][0], point[1] - routeInput[index - 1][1]) > 1e-8);
  const fallback = route[0] ?? [0, 0];
  const segmentLengths = route.slice(1).map((point, index) => Math.hypot(point[0] - route[index][0], point[1] - route[index][1]));
  const totalLength = segmentLengths.reduce((sum, length) => sum + length, 0);
  const width = Math.max(0, Math.min(CONNECTOR_LABEL_MAX_WIDTH, options.labelWidth)) + CONNECTOR_LABEL_PADDING_X * 2;
  const height = Math.max(1, options.labelHeight ?? CONNECTOR_LABEL_HEIGHT) + CONNECTOR_LABEL_PADDING_Y * 2;
  const resolveOffset = (tangent: readonly [number, number]) => {
    if (Number.isFinite(options.labelOffset)) {
      return Math.max(-2000, Math.min(2000, options.labelOffset!));
    }
    return defaultConnectorCenterOffset(tangent, width, height, options.strokeWidth ?? 1.5);
  };
  if (route.length < 2 || totalLength <= 1e-8) {
    const positioned = applyLabelNormalOffset({ x: fallback[0], y: fallback[1], tangent: [1, 0] }, resolveOffset([1, 0]));
    return { ...positioned, width, height, distance: 0, totalLength, tangent: [1, 0] };
  }
  if (Number.isFinite(options.labelPosition)) {
    const distance = totalLength * Math.max(0, Math.min(1000, options.labelPosition!)) / 1000;
    const point = pointAtRouteDistance(route, distance), positioned = applyLabelNormalOffset(point, resolveOffset(point.tangent));
    return { ...positioned, width, height, distance, totalLength, tangent: point.tangent };
  }
  const startClearance = connectorMarkerOccupancy(options.startMarker, options.sourceCardinality, options.strokeWidth) + 3;
  const endClearance = connectorMarkerOccupancy(options.endMarker, options.targetCardinality, options.strokeWidth) + 3;
  const candidates = [0.5, 0.42, 0.58, 0.34, 0.66, 0.25, 0.75, 0.16, 0.84]
    .map(fraction => fraction * totalLength);
  let best = pointAtRouteDistance(route, totalLength / 2), bestDistance = totalLength / 2, bestScore = -Infinity;
  for (const distance of candidates) {
    const point = pointAtRouteDistance(route, distance);
    const projectedHalfExtent = (Math.abs(point.tangent[0]) * width + Math.abs(point.tangent[1]) * height) / 2;
    const score = Math.min(distance - startClearance - projectedHalfExtent, totalLength - distance - endClearance - projectedHalfExtent);
    if (score > bestScore) { best = point; bestDistance = distance; bestScore = score; }
  }
  const positioned = applyLabelNormalOffset(best, resolveOffset(best.tangent));
  return { ...positioned, width, height, distance: bestDistance, totalLength, tangent: best.tangent };
}

export interface ConnectorLabelPlacement { labelPosition: number; labelOffset: number; }

/** Store a label drag as route-relative distance plus signed normal offset. */
export function connectorLabelPlacementAtPoint(routeInput: readonly [number, number][], point: [number, number]): ConnectorLabelPlacement | undefined {
  const route = routeInput.filter((candidate, index) => index === 0 || Math.hypot(candidate[0] - routeInput[index - 1][0], candidate[1] - routeInput[index - 1][1]) > 1e-8);
  if (route.length < 2) return undefined;
  const lengths = route.slice(1).map((candidate, index) => Math.hypot(candidate[0] - route[index][0], candidate[1] - route[index][1]));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  if (total <= 1e-8) return undefined;
  let bestDistance = 0, bestError = Infinity, bestOffset = 0, traversed = 0;
  for (let index = 1; index < route.length; index++) {
    const a = route[index - 1], b = route[index], length = lengths[index - 1];
    if (length <= 1e-8) continue;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const fraction = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / (length * length)));
    const x = a[0] + dx * fraction, y = a[1] + dy * fraction;
    const error = (point[0] - x) ** 2 + (point[1] - y) ** 2;
    if (error < bestError) {
      bestError = error; bestDistance = traversed + fraction * length;
      bestOffset = ((point[0] - x) * -dy + (point[1] - y) * dx) / length;
    }
    traversed += length;
  }
  return {
    labelPosition: Math.round(Math.max(0, Math.min(1000, bestDistance / total * 1000))),
    labelOffset: Math.round(Math.max(-2000, Math.min(2000, bestOffset))),
  };
}

/** Backward-compatible fraction-only helper for callers that do not use normal offsets. */
export function connectorLabelPositionAtPoint(routeInput: readonly [number, number][], point: [number, number]): number | undefined {
  return connectorLabelPlacementAtPoint(routeInput, point)?.labelPosition;
}

export interface ConnectorPreviewPath { commands: PathCommand[]; fill: 'none' | 'currentColor' | 'surface'; }
export interface ConnectorPreviewGeometry {
  width: number;
  height: number;
  route: PathCommand[];
  markers: ConnectorPreviewPath[];
  lineStyle: 'solid' | 'dashed' | 'dotted';
}

function pathFromPoints(points: readonly [number, number][], close = false): PathCommand[] {
  if (!points.length) return [];
  return [command('moveTo', ...points[0]), ...points.slice(1).map(([x, y]) => command('lineTo', x, y)), ...(close ? [command('closePath')] : [])];
}

function markerPath(marker: string, point: [number, number], neighbor: [number, number], size: number): ConnectorPreviewPath[] {
  if (marker === 'none' || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) return [];
  const dx = point[0] - neighbor[0], dy = point[1] - neighbor[1], length = Math.max(1e-6, Math.hypot(dx, dy));
  const ux = dx / length, uy = dy / length, nx = -uy, ny = ux;
  const base = (distance: number, side: number) => [point[0] - ux * distance + nx * size * side, point[1] - uy * distance + ny * size * side] as [number, number];
  const line = (a: [number, number], b: [number, number]) => ({ commands: pathFromPoints([a, b]), fill: 'none' as const });
  const polygon = (points: [number, number][], fill: ConnectorPreviewPath['fill']) => ({ commands: pathFromPoints(points, true), fill });
  const triangle = (fill: ConnectorPreviewPath['fill']) => polygon([point, base(size * 1.55, 0.58), base(size * 1.55, -0.58)], fill);
  const diamond = (filled: boolean) => polygon([point, base(size * 0.85, 0.72), base(size * 1.7, 0), base(size * 0.85, -0.72)], filled ? 'currentColor' : 'surface');
  if (marker === 'arrow' || marker === 'blockArrow') return [triangle('currentColor')];
  if (marker === 'openArrow') return [line(base(size * 1.55, 0.60), point), line(point, base(size * 1.55, -0.60))];
  if (marker === 'hollowTriangle') return [triangle('surface')];
  if (marker === 'diamond' || marker === 'filledDiamond') return [diamond(marker === 'filledDiamond')];
  if (marker === 'circle' || marker === 'filledCircle') return [{ commands: [command('moveTo', point[0] + size * 0.45, point[1]),
    command('ellipse', point[0], point[1], size * 0.45, size * 0.45, 0, 0, Math.PI * 2, 0), command('closePath')], fill: marker === 'filledCircle' ? 'currentColor' : 'surface' }];
  if (marker === 'bar') return [line([point[0] + nx * size * 0.55, point[1] + ny * size * 0.55], [point[0] - nx * size * 0.55, point[1] - ny * size * 0.55])];
  if (marker === 'crowFoot') return [line(point, base(size * 1.6, 0.62)), line(point, base(size * 1.6, 0)), line(point, base(size * 1.6, -0.62))];
  return [];
}

function cardinalityPaths(cardinality: string | undefined, point: [number, number], neighbor: [number, number], size: number): ConnectorPreviewPath[] {
  if (!cardinality) return [];
  const dx = point[0] - neighbor[0], dy = point[1] - neighbor[1], length = Math.max(1e-6, Math.hypot(dx, dy));
  const ux = dx / length, uy = dy / length;
  const at = (distance: number): [number, number] => [point[0] - ux * distance, point[1] - uy * distance];
  const hasMany = cardinality === 'many' || cardinality === 'one-or-many' || cardinality === 'zero-or-many';
  const hasZero = cardinality === 'zero-or-one' || cardinality === 'zero-or-many';
  const paths: ConnectorPreviewPath[] = [];
  if (hasMany) paths.push(...markerPath('crowFoot', point, neighbor, size * 0.9));
  if (cardinality === 'one') {
    paths.push(...markerPath('bar', point, neighbor, size * 0.72));
    paths.push(...markerPath('bar', at(size * 0.45), neighbor, size * 0.72));
  } else if (cardinality === 'one-or-many') {
    paths.push(...markerPath('bar', at(size * 0.7), neighbor, size * 0.72));
  }
  if (hasZero) {
    const center = at(cardinality === 'zero-or-one' ? size * 0.45 : size * 0.85);
    paths.push({ commands: [command('moveTo', center[0] + size * 0.22, center[1]), command('ellipse', center[0], center[1], size * 0.22, size * 0.22, 0, 0, Math.PI * 2, 0), command('closePath')], fill: 'surface' });
    if (cardinality === 'zero-or-one') paths.push(...markerPath('bar', at(size * 1.05), neighbor, size * 0.72));
  }
  return paths;
}

/** Small connector preview derived from the same route function and endpoint semantics as the live tool. */
export function buildConnectorPreviewGeometry(definition: ShapeDefinition, width = 28, height = 22): ConnectorPreviewGeometry {
  const margin = Math.min(4, Math.max(2, Math.min(width, height) * 0.12));
  const start: [number, number] = [margin, height * 0.76];
  const end: [number, number] = [width - margin, height * 0.24];
  const connector = definition.connector;
  if (connector?.erdParticipation === 'total') {
    const dx = end[0] - start[0], dy = end[1] - start[1], length = Math.max(1e-6, Math.hypot(dx, dy));
    const nx = -dy / length * 1.75, ny = dx / length * 1.75;
    const path1 = pathFromPoints([[start[0] + nx, start[1] + ny], [end[0] + nx, end[1] + ny]]);
    const path2 = pathFromPoints([[start[0] - nx, start[1] - ny], [end[0] - nx, end[1] - ny]]);
    return { width, height, route: [...path1, ...path2], markers: [], lineStyle: connector?.lineStyle ?? 'solid' };
  }
  const route = buildConnectorRoute({ routeKind: definition.routeKind, x1: start[0], y1: start[1], x2: end[0], y2: end[1], waypoints: [] });
  const routePath = pathFromPoints(route);
  const startNeighbor = route[1] ?? end, endNeighbor = route[route.length - 2] ?? start;
  const size = Math.max(2.2, Math.min(width, height) * 0.19);
  const markers = [
    ...(connector?.sourceCardinality ? [] : markerPath(connector?.startMarker ?? 'none', start, startNeighbor, size)),
    ...(connector?.targetCardinality ? [] : markerPath(connector?.endMarker ?? 'none', end, endNeighbor, size)),
    ...cardinalityPaths(connector?.sourceCardinality, start, startNeighbor, size),
    ...cardinalityPaths(connector?.targetCardinality, end, endNeighbor, size),
  ];
  return { width, height, route: routePath, markers, lineStyle: connector?.lineStyle ?? 'solid' };
}
