import type { Bounds, Point2, PreparedStroke, SmartDrawingPoint } from './types';
import { RECOGNITION_SAMPLE_COUNT } from './types';

export interface PreprocessOptions {
  sampleCount?: number;
  duplicateTolerance?: number;
  closureTolerance?: number;
}

export function distance(a: Point2, b: Point2): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

export function boundsOf(points: Point2[]): Bounds {
  if (!points.length) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = points[0][0], maxX = points[0][0];
  let minY = points[0][1], maxY = points[0][1];
  for (let index = 1; index < points.length; index++) {
    minX = Math.min(minX, points[index][0]);
    maxX = Math.max(maxX, points[index][0]);
    minY = Math.min(minY, points[index][1]);
    maxY = Math.max(maxY, points[index][1]);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function pathLength(points: Point2[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index++) length += distance(points[index - 1], points[index]);
  return length;
}

export function resampleByArcLength(points: Point2[], count: number): Point2[] {
  if (!points.length || count <= 0) return [];
  if (points.length === 1 || count === 1) return Array.from({ length: count }, () => [...points[0]] as Point2);
  const cumulative = new Array<number>(points.length).fill(0);
  for (let index = 1; index < points.length; index++) {
    cumulative[index] = cumulative[index - 1] + distance(points[index - 1], points[index]);
  }
  const total = cumulative[cumulative.length - 1];
  if (total <= 1e-12) return Array.from({ length: count }, () => [...points[0]] as Point2);

  const output: Point2[] = [];
  let segment = 0;
  for (let sample = 0; sample < count; sample++) {
    const target = total * sample / (count - 1);
    while (segment < points.length - 2 && cumulative[segment + 1] < target) segment++;
    const start = points[segment], end = points[segment + 1];
    const length = cumulative[segment + 1] - cumulative[segment];
    const amount = length > 1e-12 ? (target - cumulative[segment]) / length : 0;
    output.push([start[0] + (end[0] - start[0]) * amount, start[1] + (end[1] - start[1]) * amount]);
  }
  return output;
}

function pointSegmentDistance(point: Point2, a: Point2, b: Point2): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 1e-15) return distance(point, a);
  const amount = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSquared));
  return Math.hypot(point[0] - a[0] - amount * dx, point[1] - a[1] - amount * dy);
}

function localTurn(a: Point2, b: Point2, c: Point2): number {
  const ux = b[0] - a[0], uy = b[1] - a[1];
  const vx = c[0] - b[0], vy = c[1] - b[1];
  const firstLength = Math.hypot(ux, uy), secondLength = Math.hypot(vx, vy);
  if (firstLength <= 1e-12 || secondLength <= 1e-12) return 0;
  return Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
}

/**
 * One conservative pass that attenuates sub-pixel-scale zigzag in the normalized
 * recognition copy. Strong direction changes and corner-adjacent samples are left
 * untouched; source ink is never modified.
 */
function smoothJitter(points: Point2[], closed: boolean): Point2[] {
  if (points.length < 5) return points.map(point => [...point] as Point2);
  const result = points.map(point => [...point] as Point2);
  const first = closed ? 0 : 2;
  const last = closed ? points.length : points.length - 2;
  for (let index = first; index < last; index++) {
    const previousIndex = (index - 1 + points.length) % points.length;
    const nextIndex = (index + 1) % points.length;
    if (!closed && (index <= 1 || index >= points.length - 2)) continue;
    const previous = points[previousIndex], current = points[index], next = points[nextIndex];
    const turn = Math.abs(localTurn(previous, current, next));
    const deviation = pointSegmentDistance(current, previous, next);
    if (turn > 0.58 || deviation > 0.035) continue;
    result[index] = [current[0] * 0.62 + (previous[0] + next[0]) * 0.19,
      current[1] * 0.62 + (previous[1] + next[1]) * 0.19];
  }
  return result;
}

function copySource(input: number[][]): SmartDrawingPoint[] {
  return input.map(point => {
    const [x, y, pressure] = point;
    return Number.isFinite(pressure) ? [x, y, pressure] : [x, y];
  });
}

/** Translate/scale to a unit-diagonal board-space frame and equalize sample spacing. */
export function preprocessSmartStroke(input: number[][], options: PreprocessOptions = {}): PreparedStroke | null {
  const sourcePoints = copySource(input);
  const finite = sourcePoints.filter(point => Number.isFinite(point[0]) && Number.isFinite(point[1]));
  if (finite.length < 2) return null;
  const raw: Point2[] = finite.map(point => [point[0], point[1]]);
  const sourceBounds = boundsOf(raw);
  const scale = Math.hypot(sourceBounds.w, sourceBounds.h);
  if (!Number.isFinite(scale) || scale <= 1e-9) return null;
  const centerX = sourceBounds.x + sourceBounds.w / 2;
  const centerY = sourceBounds.y + sourceBounds.h / 2;
  const normalizedSource = raw.map(point => [(point[0] - centerX) / scale, (point[1] - centerY) / scale] as Point2);
  const tolerance = options.duplicateTolerance ?? 0.0012;
  const deduplicated: Point2[] = [];
  for (const point of normalizedSource) {
    if (!deduplicated.length || distance(point, deduplicated[deduplicated.length - 1]) > tolerance) deduplicated.push(point);
  }
  if (deduplicated.length < 2) return null;

  const traceLength = pathLength(deduplicated);
  const endpointGap = distance(deduplicated[0], deduplicated[deduplicated.length - 1]);
  const closedCandidate = endpointGap <= (options.closureTolerance ?? 0.18) && traceLength + endpointGap >= 1.5;
  const sampleCount = Math.max(24, Math.min(128, Math.round(options.sampleCount ?? RECOGNITION_SAMPLE_COUNT)));
  const samples = smoothJitter(resampleByArcLength(deduplicated, sampleCount), false);
  let closedSamples: Point2[] | null = null;
  if (closedCandidate) {
    const ring = deduplicated.slice();
    if (distance(ring[0], ring[ring.length - 1]) > 1e-9) ring.push([...ring[0]]);
    closedSamples = smoothJitter(resampleByArcLength(ring, sampleCount), true);
  }
  return { sourcePoints, normalizedSource, samples, closedSamples, centerX, centerY, scale, sourceBounds,
    endpointGap, traceLength, closedCandidate };
}

export function toWorldPoint(stroke: PreparedStroke, point: Point2): Point2 {
  return [stroke.centerX + point[0] * stroke.scale, stroke.centerY + point[1] * stroke.scale];
}

export function toWorldBounds(stroke: PreparedStroke, bounds: Bounds): Bounds {
  const topLeft = toWorldPoint(stroke, [bounds.x, bounds.y]);
  return { x: topLeft[0], y: topLeft[1], w: bounds.w * stroke.scale, h: bounds.h * stroke.scale };
}
