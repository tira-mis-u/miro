import type { ConnectorRouteKind, EndpointMarker, PathCommand, ShapeDefinition } from './types';

export interface ConnectorRouteInput {
  routeKind?: ConnectorRouteKind;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  waypoints: readonly [number, number][];
}

const command = (op: PathCommand['op'], ...values: number[]): PathCommand => ({ op, values });

/** Shared deterministic route construction used by live connectors, hit testing, bounds and previews. */
export function buildConnectorRoute(connector: ConnectorRouteInput): [number, number][] {
  const start: [number, number] = [connector.x1, connector.y1], end: [number, number] = [connector.x2, connector.y2];
  const routeKind = connector.routeKind ?? 'straight';
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

export interface ConnectorLabelLayoutOptions {
  startMarker?: EndpointMarker;
  endMarker?: EndpointMarker;
  sourceCardinality?: string;
  targetCardinality?: string;
  strokeWidth?: number;
  labelWidth: number;
  labelHeight?: number;
}
export interface ConnectorLabelLayout {
  x: number;
  y: number;
  width: number;
  height: number;
  distance: number;
  totalLength: number;
  tangent: [number, number];
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
  if (marker === 'circle' || marker === 'zeroOrOne') return size * 0.8;
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

/**
 * Route-aware, screen-horizontal label location. Candidate positions are arc-length samples
 * scored against the real start/end marker envelopes, so long labels avoid arrowheads whenever
 * the route has enough room; the canvas keeps endpoint markers above the plate as a final guard.
 */
export function connectorLabelLayout(routeInput: readonly [number, number][], options: ConnectorLabelLayoutOptions): ConnectorLabelLayout {
  const route = routeInput.filter((point, index) => index === 0 || Math.hypot(point[0] - routeInput[index - 1][0], point[1] - routeInput[index - 1][1]) > 1e-8);
  const fallback = route[0] ?? [0, 0];
  const segmentLengths = route.slice(1).map((point, index) => Math.hypot(point[0] - route[index][0], point[1] - route[index][1]));
  const totalLength = segmentLengths.reduce((sum, length) => sum + length, 0);
  const width = Math.max(0, Math.min(CONNECTOR_LABEL_MAX_WIDTH, options.labelWidth)) + CONNECTOR_LABEL_PADDING_X * 2;
  const height = Math.max(1, options.labelHeight ?? CONNECTOR_LABEL_HEIGHT) + CONNECTOR_LABEL_PADDING_Y * 2;
  if (route.length < 2 || totalLength <= 1e-8) return { x: fallback[0], y: fallback[1], width, height, distance: 0, totalLength, tangent: [1, 0] };
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
  return { x: best.x, y: best.y, width, height, distance: bestDistance, totalLength, tangent: best.tangent };
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
  if (marker === 'circle') return [{ commands: [command('moveTo', point[0] + size * 0.45, point[1]),
    command('ellipse', point[0], point[1], size * 0.45, size * 0.45, 0, 0, Math.PI * 2, 0), command('closePath')], fill: 'surface' }];
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
  const hasOne = cardinality === 'one' || cardinality === 'one-or-many';
  const hasZero = cardinality === 'zero-or-one' || cardinality === 'zero-or-many';
  const paths: ConnectorPreviewPath[] = [];
  if (hasMany) paths.push(...markerPath('crowFoot', point, neighbor, size * 0.9));
  if (hasOne) paths.push(...markerPath('bar', at(cardinality === 'one-or-many' ? size * 0.7 : 0), neighbor, size * 0.72));
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
  const route = buildConnectorRoute({ routeKind: definition.routeKind, x1: start[0], y1: start[1], x2: end[0], y2: end[1], waypoints: [] });
  const routePath = pathFromPoints(route);
  const startNeighbor = route[1] ?? end, endNeighbor = route[route.length - 2] ?? start;
  const size = Math.max(2.2, Math.min(width, height) * 0.19);
  const connector = definition.connector;
  const markers = [
    ...markerPath(connector?.startMarker ?? 'none', start, startNeighbor, size),
    ...markerPath(connector?.endMarker ?? 'none', end, endNeighbor, size),
    ...cardinalityPaths(connector?.sourceCardinality, start, startNeighbor, size),
    ...cardinalityPaths(connector?.targetCardinality, end, endNeighbor, size),
  ];
  return { width, height, route: routePath, markers, lineStyle: connector?.lineStyle ?? 'solid' };
}
