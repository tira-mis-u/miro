import type { Bounds, CandidateDiagnostic, GeometryAnalysis, GeometryProposal, Point2, PreparedStroke, RecognizedShapeKind, SmartShapeRecognizer, StrokeBounds, StrokeFeatures } from './types';
import { SMART_DRAWING_THRESHOLDS } from './types';
import { boundsOf, distance, pathLength } from './preprocess';

interface ErrorStats { rms: number; p90: number; max: number; }
interface CornerFeature { point: Point2; angle: number; index: number; }

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const wrapPi = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

function quantile(values: number[], fraction: number): number {
  if (!values.length) return 0;
  const ordered = values.slice().sort((a, b) => a - b);
  return ordered[Math.max(0, Math.min(ordered.length - 1, Math.round((ordered.length - 1) * fraction)))];
}

function segmentDistance(point: Point2, a: Point2, b: Point2): { distance: number; amount: number } {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 1e-14) return { distance: distance(point, a), amount: 0 };
  const amount = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSquared));
  return { distance: Math.hypot(point[0] - a[0] - amount * dx, point[1] - a[1] - amount * dy), amount };
}

function errorStats(errors: number[]): ErrorStats {
  if (!errors.length) return { rms: Infinity, p90: Infinity, max: Infinity };
  const sorted = errors.slice().sort((a, b) => a - b);
  const rms = Math.sqrt(errors.reduce((sum, error) => sum + error * error, 0) / errors.length);
  return { rms, p90: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.9) - 1)], max: sorted[sorted.length - 1] };
}

function signedLocalTurn(a: Point2, b: Point2, c: Point2): number {
  const ux = b[0] - a[0], uy = b[1] - a[1];
  const vx = c[0] - b[0], vy = c[1] - b[1];
  if (Math.hypot(ux, uy) <= 1e-12 || Math.hypot(vx, vy) <= 1e-12) return 0;
  return Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
}

function detectCorners(points: Point2[], closed: boolean): { turns: number[]; corners: CornerFeature[] } {
  const count = points.length;
  const turns = new Array<number>(count).fill(0);
  const window = 2;
  const start = closed ? 0 : window;
  const end = closed ? count : count - window;
  for (let index = start; index < end; index++) {
    const before = points[(index - window + count) % count];
    const here = points[index];
    const after = points[(index + window) % count];
    turns[index] = signedLocalTurn(before, here, after);
  }

  const threshold = 0.43;
  const marked = turns.map(angle => Math.abs(angle) >= threshold);
  const groups: number[][] = [];
  let current: number[] = [];
  const linearStart = closed ? 0 : start;
  const linearEnd = closed ? count : end;
  for (let index = linearStart; index < linearEnd; index++) {
    if (marked[index]) current.push(index);
    else if (current.length) { groups.push(current); current = []; }
  }
  if (current.length) groups.push(current);
  if (closed && groups.length > 1 && groups[0][0] === 0 && groups[groups.length - 1].at(-1) === count - 1) {
    const wrapped = [...groups.pop()!, ...groups.shift()!];
    groups.unshift(wrapped);
  }

  const corners = groups.map(group => {
    let weight = 0, x = 0, y = 0, angle = 0, strongest = group[0], strongestMagnitude = 0;
    for (const index of group) {
      const magnitude = Math.abs(turns[index]);
      weight += magnitude; x += points[index][0] * magnitude; y += points[index][1] * magnitude; angle += turns[index];
      if (magnitude > strongestMagnitude) { strongestMagnitude = magnitude; strongest = index; }
    }
    return { point: [weight ? x / weight : points[strongest][0], weight ? y / weight : points[strongest][1]] as Point2,
      angle: wrapPi(angle / window), index: strongest };
  }).sort((a, b) => a.index - b.index);
  return { turns, corners };
}

function polygonArea(points: Point2[]): number {
  if (points.length < 3) return 0;
  const originX = points[0][0], originY = points[0][1];
  let twice = 0;
  for (let index = 0; index < points.length; index++) {
    const current = points[index], next = points[(index + 1) % points.length];
    twice += (current[0] - originX) * (next[1] - originY) - (next[0] - originX) * (current[1] - originY);
  }
  return Math.abs(twice) / 2;
}

function hasSelfIntersection(points: Point2[], closed: boolean): boolean {
  const count = points.length;
  const edgeCount = closed ? count : count - 1;
  const orientation = (a: Point2, b: Point2, c: Point2) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const crosses = (a: Point2, b: Point2, c: Point2, d: Point2) => {
    const abC = orientation(a, b, c), abD = orientation(a, b, d);
    const cdA = orientation(c, d, a), cdB = orientation(c, d, b);
    const tolerance = 1e-9;
    return ((abC > tolerance && abD < -tolerance) || (abC < -tolerance && abD > tolerance)) &&
      ((cdA > tolerance && cdB < -tolerance) || (cdA < -tolerance && cdB > tolerance));
  };
  for (let first = 0; first < edgeCount; first++) {
    const a = points[first], b = points[(first + 1) % count];
    for (let second = first + 1; second < edgeCount; second++) {
      if (second === first + 1 || (closed && first === 0 && second === edgeCount - 1)) continue;
      if (crosses(a, b, points[second], points[(second + 1) % count])) return true;
    }
  }
  return false;
}

function angularCoverage(points: Point2[], center: Point2): number {
  if (points.length < 3) return 0;
  const angles = points.map(point => (Math.atan2(point[1] - center[1], point[0] - center[0]) + Math.PI * 2) % (Math.PI * 2)).sort((a, b) => a - b);
  let largestGap = 0;
  for (let index = 1; index < angles.length; index++) largestGap = Math.max(largestGap, angles[index] - angles[index - 1]);
  largestGap = Math.max(largestGap, angles[0] + Math.PI * 2 - angles[angles.length - 1]);
  return Math.max(0, Math.PI * 2 - largestGap);
}

export function analyzeSmartStroke(stroke: PreparedStroke): StrokeFeatures {
  const rawBounds = boundsOf(stroke.normalizedSource);
  const diagonal = Math.max(1e-9, Math.hypot(rawBounds.w, rawBounds.h));
  const gap = distance(stroke.normalizedSource[0], stroke.normalizedSource[stroke.normalizedSource.length - 1]);
  const closed = Boolean(stroke.closedSamples);
  const path = closed ? stroke.closedSamples! : stroke.samples;
  const ring = closed ? path.slice(0, -1) : path;
  const perimeter = pathLength(path);
  const pathRatio = perimeter / diagonal;
  const directness = gap / Math.max(1e-9, stroke.traceLength);
  const cornerInfo = detectCorners(ring, closed);
  const area = closed ? polygonArea(ring) : 0;
  const shapeCenter: Point2 = [ring.reduce((sum, point) => sum + point[0], 0) / Math.max(1, ring.length),
    ring.reduce((sum, point) => sum + point[1], 0) / Math.max(1, ring.length)];
  const circularity = perimeter > 1e-9 ? Math.min(1, 4 * Math.PI * area / (perimeter * perimeter)) : 0;
  const sortedAspect = [rawBounds.w, rawBounds.h].sort((a, b) => b - a);
  const bounds: StrokeBounds = { ...rawBounds, diagonal };
  return {
    pathLength: perimeter,
    pathRatio,
    endpointGap: gap,
    closureRatio: gap / diagonal,
    directness,
    isNearClosed: closed && pathRatio >= 1.55 && pathRatio <= 5.8,
    selfIntersects: hasSelfIntersection(ring, closed),
    signedTurn: cornerInfo.turns.reduce((sum, value) => sum + value, 0),
    absoluteTurn: cornerInfo.turns.reduce((sum, value) => sum + Math.abs(value), 0),
    cornerCount: cornerInfo.corners.length,
    cornerPoints: cornerInfo.corners.map(corner => corner.point),
    cornerAngles: cornerInfo.corners.map(corner => Math.abs(corner.angle)),
    area,
    circularity,
    angularCoverage: angularCoverage(ring, shapeCenter),
    aspectRatio: sortedAspect[1] > 1e-9 ? sortedAspect[0] / sortedAspect[1] : Infinity,
    bounds,
  };
}

function simplifyOpen(points: Point2[], epsilon: number): Point2[] {
  if (points.length <= 2) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1; keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop()!;
    let farthest = epsilon, selected = -1;
    for (let index = start + 1; index < end; index++) {
      const deviation = segmentDistance(points[index], points[start], points[end]).distance;
      if (deviation > farthest) { farthest = deviation; selected = index; }
    }
    if (selected >= 0) { keep[selected] = 1; stack.push([start, selected], [selected, end]); }
  }
  return points.filter((_point, index) => keep[index]);
}

function closedSplit(points: Point2[]): { ring: Point2[]; arcA: Point2[]; arcB: Point2[] } | null {
  const ring = points.slice();
  if (ring.length > 2 && distance(ring[0], ring[ring.length - 1]) < 1e-8) ring.pop();
  if (ring.length < 3) return null;
  let first = 0, second = 1, farthest = 0;
  for (let left = 0; left < ring.length; left++) for (let right = left + 1; right < ring.length; right++) {
    const span = distance(ring[left], ring[right]);
    if (span > farthest) { farthest = span; first = left; second = right; }
  }
  return { ring, arcA: ring.slice(first, second + 1), arcB: [...ring.slice(second), ...ring.slice(0, first + 1)] };
}

function simplifyClosed(split: { arcA: Point2[]; arcB: Point2[] }, epsilon: number): Point2[] {
  const sideA = simplifyOpen(split.arcA, epsilon), sideB = simplifyOpen(split.arcB, epsilon);
  const output = [...sideA.slice(0, -1), ...sideB.slice(0, -1)];
  const unique: Point2[] = [];
  for (const point of output) if (!unique.length || distance(point, unique[unique.length - 1]) > 1e-5) unique.push(point);
  return unique;
}

function polygonVariants(ring: Point2[]): Point2[][] {
  const split = closedSplit(ring);
  if (!split) return [];
  const output: Point2[][] = [];
  const signatures = new Set<string>();
  for (const epsilon of [0.012, 0.018, 0.026, 0.038, 0.052, 0.07, 0.09]) {
    const vertices = simplifyClosed(split, epsilon);
    if (vertices.length < 3 || vertices.length > 8) continue;
    const signature = vertices.map(point => `${Math.round(point[0] * 80)},${Math.round(point[1] * 80)}`).join(';');
    if (!signatures.has(signature)) { signatures.add(signature); output.push(vertices); }
  }
  return output;
}

function edgeFit(points: Point2[], vertices: Point2[], supportTolerance = 0.055): { errors: number[]; coverages: number[]; counts: number[] } {
  const coverages: number[] = [];
  const counts: number[] = [];
  for (let edge = 0; edge < vertices.length; edge++) {
    const start = vertices[edge], end = vertices[(edge + 1) % vertices.length];
    const supported: number[] = [];
    let count = 0;
    for (const point of points) {
      const result = segmentDistance(point, start, end);
      if (result.distance <= supportTolerance) { supported.push(result.amount); count++; }
    }
    coverages.push(supported.length ? Math.max(...supported) - Math.min(...supported) : 0);
    counts.push(count);
  }
  const pointErrors = points.map(point => {
    let best = Infinity;
    for (let edge = 0; edge < vertices.length; edge++) best = Math.min(best, segmentDistance(point, vertices[edge], vertices[(edge + 1) % vertices.length]).distance);
    return best;
  });
  return { errors: pointErrors, coverages, counts };
}

function cornerSupportScore(vertices: Point2[], features: StrokeFeatures): number {
  if (!features.cornerPoints.length) return 0;
  const supports = vertices.map(vertex => {
    let nearest = Infinity, nearestAngle = 0;
    for (let index = 0; index < features.cornerPoints.length; index++) {
      const gap = distance(vertex, features.cornerPoints[index]);
      if (gap < nearest) { nearest = gap; nearestAngle = features.cornerAngles[index] ?? 0; }
    }
    const positional = Math.exp(-nearest / 0.09);
    const angle = Math.exp(-Math.abs(nearestAngle - Math.PI / 2) / 0.75);
    return positional * (0.58 + 0.42 * angle);
  });
  return supports.reduce((sum, value) => sum + value, 0) / supports.length;
}

function nearestCornerAngleScore(vertices: Point2[], features: StrokeFeatures): number {
  if (!features.cornerPoints.length) return 0;
  const scores = vertices.map(vertex => {
    let best = 0;
    for (let index = 0; index < features.cornerPoints.length; index++) {
      const positional = distance(vertex, features.cornerPoints[index]);
      const angular = Math.exp(-Math.abs((features.cornerAngles[index] ?? 0) - Math.PI / 2) / 0.78);
      best = Math.max(best, Math.exp(-positional / 0.10) * angular);
    }
    return best;
  });
  return scores.reduce((sum, value) => sum + value, 0) / scores.length;
}

function polygonComplexityScore(variants: Point2[][], target: number): number {
  if (!variants.length) return 0;
  const difference = Math.min(...variants.map(vertices => Math.abs(vertices.length - target)));
  return Math.exp(-difference * 0.38);
}

function rectangleAngles(ring: Point2[], variants: Point2[][]): number[] {
  const candidates: number[] = [];
  for (const polygon of variants) {
    if (polygon.length > 6) continue;
    for (let index = 0; index < polygon.length; index++) {
      const a = polygon[index], b = polygon[(index + 1) % polygon.length];
      if (distance(a, b) > 0.065) candidates.push(Math.atan2(b[1] - a[1], b[0] - a[0]));
    }
  }
  let xx = 0, yy = 0, xy = 0, cx = 0, cy = 0;
  for (const point of ring) { cx += point[0]; cy += point[1]; }
  cx /= Math.max(1, ring.length); cy /= Math.max(1, ring.length);
  for (const point of ring) { const dx = point[0] - cx, dy = point[1] - cy; xx += dx * dx; yy += dy * dy; xy += dx * dy; }
  candidates.push(Math.atan2(2 * xy, xx - yy) / 2);

  const normalized: number[] = [];
  for (const angle of candidates) {
    let reduced = angle % (Math.PI / 2);
    if (reduced < 0) reduced += Math.PI / 2;
    if (normalized.every(previous => Math.abs(wrapPi((reduced - previous) * 2)) / 2 > 0.035)) normalized.push(reduced);
    if (normalized.length >= 16) break;
  }
  return normalized;
}

function project(point: Point2, ux: number, uy: number, vx: number, vy: number): [number, number] {
  return [point[0] * ux + point[1] * uy, point[0] * vx + point[1] * vy];
}

function unproject(u: number, v: number, ux: number, uy: number, vx: number, vy: number): Point2 {
  return [u * ux + v * vx, u * uy + v * vy];
}

function canonicalSamples(points: Point2[], center: Point2, ux: number, uy: number, scale: number): Point2[] {
  const vx = -uy, vy = ux;
  return points.map(point => {
    const dx = point[0] - center[0], dy = point[1] - center[1];
    return [(dx * ux + dy * uy) / scale, (dx * vx + dy * vy) / scale];
  });
}

function scoreDescending(value: number, ideal: number, tolerance: number): number {
  return clamp01(1 - Math.max(0, value - ideal) / tolerance);
}

function rejected(kind: RecognizedShapeKind, reason: string, metrics: Record<string, number> = {}): CandidateDiagnostic {
  return { kind, geometryScore: 0, templateScore: 0, confidence: 0, threshold: SMART_DRAWING_THRESHOLDS[kind], accepted: false,
    fitError: metrics.fitError, reasons: [reason] };
}

function fitLine(stroke: PreparedStroke, features: StrokeFeatures): { fit?: GeometryProposal; diagnostic?: CandidateDiagnostic } {
  const kind: RecognizedShapeKind = 'line';
  if (features.isNearClosed || features.selfIntersects) return { diagnostic: rejected(kind, features.isNearClosed ? 'closed-path-not-line' : 'self-intersection') };
  if (features.directness < 0.865 || features.pathRatio > 1.32) return { diagnostic: rejected(kind, 'low-endpoint-directness', { directness: features.directness }) };
  if (features.cornerCount > 1 || features.cornerAngles.some(angle => angle > 0.78)) return { diagnostic: rejected(kind, 'distinct-hook-or-corner') };

  let centerX = 0, centerY = 0;
  for (const point of stroke.samples) { centerX += point[0]; centerY += point[1]; }
  centerX /= stroke.samples.length; centerY /= stroke.samples.length;
  let xx = 0, yy = 0, xy = 0;
  for (const point of stroke.samples) { const dx = point[0] - centerX, dy = point[1] - centerY; xx += dx * dx; yy += dy * dy; xy += dx * dy; }
  const angle = Math.atan2(2 * xy, xx - yy) / 2;
  let ux = Math.cos(angle), uy = Math.sin(angle);
  const first = stroke.samples[0], last = stroke.samples[stroke.samples.length - 1];
  if ((last[0] - first[0]) * ux + (last[1] - first[1]) * uy < 0) { ux = -ux; uy = -uy; }
  const vx = -uy, vy = ux;
  const along = stroke.samples.map(point => (point[0] - centerX) * ux + (point[1] - centerY) * uy);
  const cross = stroke.samples.map(point => (point[0] - centerX) * vx + (point[1] - centerY) * vy);
  const min = along[0], max = along[along.length - 1];
  const start = [centerX + min * ux, centerY + min * uy] as Point2;
  const end = [centerX + max * ux, centerY + max * uy] as Point2;
  const stats = errorStats(cross);
  const toleranceRms = 0.052, toleranceP90 = 0.083, toleranceMax = 0.17;
  if (stats.rms > toleranceRms || stats.p90 > toleranceP90 || stats.max > toleranceMax) {
    return { diagnostic: rejected(kind, 'line-residual-too-large', { fitError: stats.rms, p90: stats.p90, max: stats.max }) };
  }
  const residualScore = 0.42 * scoreDescending(stats.rms, 0, toleranceRms) + 0.23 * scoreDescending(stats.p90, 0, toleranceP90) +
    0.12 * scoreDescending(stats.max, 0, toleranceMax);
  const directScore = scoreDescending(1 - features.directness, 0, 0.16);
  const bendScore = features.cornerCount === 0 ? 1 : 0.58;
  const geometryScore = clamp01(residualScore + directScore * 0.18 + bendScore * 0.05 + 0.12);
  const lineLength = Math.max(1e-9, max - min);
  return { fit: {
    kind, geometryScore, fitError: stats.rms,
    reasons: ['PCA line fit', `directness=${features.directness.toFixed(3)}`, `rms=${stats.rms.toFixed(4)}`],
    canonicalSamples: canonicalSamples(stroke.samples, [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2], ux, uy, lineLength),
    normalizedLine: [start, end],
    metrics: { directness: features.directness, rms: stats.rms, p90: stats.p90, max: stats.max, lineLength, cornerCount: features.cornerCount },
  } };
}

function fitRectangleAtAngle(points: Point2[], features: StrokeFeatures, angle: number, cornerCountScore: number): GeometryProposal | null {
  const ux = Math.cos(angle), uy = Math.sin(angle), vx = -uy, vy = ux;
  const projections = points.map(point => project(point, ux, uy, vx, vy));
  const minU = quantile(projections.map(point => point[0]), 0.01), maxU = quantile(projections.map(point => point[0]), 0.99);
  const minV = quantile(projections.map(point => point[1]), 0.01), maxV = quantile(projections.map(point => point[1]), 0.99);
  const width = maxU - minU, height = maxV - minV, diagonal = Math.hypot(width, height);
  if (width < 0.08 || height < 0.08 || diagonal < 0.45 || width / height > 12 || height / width > 12) return null;
  const corners = [unproject(minU, minV, ux, uy, vx, vy), unproject(maxU, minV, ux, uy, vx, vy),
    unproject(maxU, maxV, ux, uy, vx, vy), unproject(minU, maxV, ux, uy, vx, vy)];
  const edge = edgeFit(points, corners, 0.055);
  const stats = errorStats(edge.errors);
  const minCoverage = Math.min(...edge.coverages), meanCoverage = edge.coverages.reduce((sum, item) => sum + item, 0) / edge.coverages.length;
  if (stats.rms > 0.062 || stats.p90 > 0.11 || stats.max > 0.21 || minCoverage < 0.50 || meanCoverage < 0.68 || Math.min(...edge.counts) < 3) return null;
  const cornerSupport = cornerSupportScore(corners, features);
  const angleScore = nearestCornerAngleScore(corners, features);
  const closureScore = clamp01(1 - features.closureRatio / 0.20);
  const residualScore = 0.40 * scoreDescending(stats.rms, 0, 0.062) + 0.22 * scoreDescending(stats.p90, 0, 0.11) +
    0.12 * scoreDescending(stats.max, 0, 0.21);
  const geometryScore = clamp01(residualScore + 0.11 * minCoverage + 0.06 * meanCoverage + 0.08 * cornerSupport +
    0.09 * cornerCountScore + 0.10 * angleScore + 0.06 * closureScore - 0.12);
  const center = unproject((minU + maxU) / 2, (minV + maxV) / 2, ux, uy, vx, vy);
  const canonical = points.map(point => {
    const [u, v] = project([point[0] - center[0], point[1] - center[1]], ux, uy, vx, vy);
    return [u / diagonal, v / diagonal] as Point2;
  });
  return {
    kind: 'rectangle', geometryScore, fitError: stats.rms,
    reasons: ['oriented-boundary fit', `edge-coverage=${minCoverage.toFixed(2)}`, `corner-support=${cornerSupport.toFixed(2)}`],
    canonicalSamples: canonical, normalizedBounds: boundsOf(corners), normalizedVertices: corners,
    metrics: { rms: stats.rms, p90: stats.p90, max: stats.max, minEdgeCoverage: minCoverage, meanEdgeCoverage: meanCoverage,
      cornerSupport, cornerCount: features.cornerCount, rightAngleScore: angleScore, closureRatio: features.closureRatio, aspect: width / height },
  };
}

function fitRectangle(stroke: PreparedStroke, features: StrokeFeatures): { fit?: GeometryProposal; diagnostic?: CandidateDiagnostic } {
  const kind: RecognizedShapeKind = 'rectangle';
  if (!features.isNearClosed) return { diagnostic: rejected(kind, 'stroke-not-closed-enough', { closureRatio: features.closureRatio }) };
  if (features.selfIntersects) return { diagnostic: rejected(kind, 'self-intersection') };
  if (features.pathRatio < 1.7 || features.pathRatio > 5.4) return { diagnostic: rejected(kind, 'implausible-perimeter-to-diagonal', { pathRatio: features.pathRatio }) };
  const ring = stroke.closedSamples!.slice(0, -1);
  const variants = polygonVariants(ring);
  if (!variants.length) return { diagnostic: rejected(kind, 'no-usable-corner-polygon') };
  const complexity = polygonComplexityScore(variants, 4);
  const angles = rectangleAngles(ring, variants);
  let best: GeometryProposal | undefined;
  for (const angle of angles) {
    const proposal = fitRectangleAtAngle(stroke.samples, features, angle, complexity);
    if (proposal && (!best || proposal.geometryScore > best.geometryScore)) best = proposal;
  }
  if (!best) return { diagnostic: rejected(kind, variants.length ? 'rectangle-boundary-or-edge-coverage-poor' : 'no-usable-corner-polygon') };
  if (best.metrics.rightAngleScore < 0.43) return { diagnostic: rejected(kind, 'corner-turns-not-rectangular', { fitError: best.fitError }) };
  return { fit: best };
}

function interiorAngles(vertices: Point2[]): number[] {
  return vertices.map((vertex, index) => {
    const previous = vertices[(index - 1 + vertices.length) % vertices.length];
    const next = vertices[(index + 1) % vertices.length];
    const a = [previous[0] - vertex[0], previous[1] - vertex[1]], b = [next[0] - vertex[0], next[1] - vertex[1]];
    const denominator = Math.hypot(...a) * Math.hypot(...b);
    return denominator > 1e-12 ? Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1]) / denominator))) : 0;
  });
}

function canonicalTriangle(points: Point2[], vertices: Point2[]): Point2[] {
  let longestA = vertices[0], longestB = vertices[1], longest = 0;
  for (let index = 0; index < vertices.length; index++) {
    const a = vertices[index], b = vertices[(index + 1) % vertices.length], length = distance(a, b);
    if (length > longest) { longest = length; longestA = a; longestB = b; }
  }
  const ux = (longestB[0] - longestA[0]) / longest, uy = (longestB[1] - longestA[1]) / longest;
  const apex = vertices.find(vertex => vertex !== longestA && vertex !== longestB)!;
  const cross = ux * (apex[1] - longestA[1]) - uy * (apex[0] - longestA[0]);
  const sign = cross >= 0 ? 1 : -1;
  const vx = -uy * sign, vy = ux * sign;
  const center: Point2 = [(vertices[0][0] + vertices[1][0] + vertices[2][0]) / 3, (vertices[0][1] + vertices[1][1] + vertices[2][1]) / 3];
  const box = boundsOf(vertices), scale = Math.hypot(box.w, box.h);
  return points.map(point => {
    const dx = point[0] - center[0], dy = point[1] - center[1];
    return [(dx * ux + dy * uy) / scale, (dx * vx + dy * vy) / scale];
  });
}

function fitTriangle(stroke: PreparedStroke, features: StrokeFeatures): { fit?: GeometryProposal; diagnostic?: CandidateDiagnostic } {
  const kind: RecognizedShapeKind = 'triangle';
  if (!features.isNearClosed) return { diagnostic: rejected(kind, 'stroke-not-closed-enough', { closureRatio: features.closureRatio }) };
  if (features.selfIntersects) return { diagnostic: rejected(kind, 'self-intersection') };
  if (features.pathRatio < 1.55 || features.pathRatio > 5.6) return { diagnostic: rejected(kind, 'implausible-perimeter-to-diagonal', { pathRatio: features.pathRatio }) };
  const ring = stroke.closedSamples!.slice(0, -1);
  const variants = polygonVariants(ring).filter(vertices => vertices.length === 3);
  let best: GeometryProposal | undefined;
  for (const vertices of variants) {
    const bounds = boundsOf(vertices), diagonal = Math.hypot(bounds.w, bounds.h);
    if (diagonal < 0.45 || polygonArea(vertices) < bounds.w * bounds.h * 0.10) continue;
    const sides = vertices.map((vertex, index) => distance(vertex, vertices[(index + 1) % 3]));
    if (Math.min(...sides) < diagonal * 0.075) continue;
    const angles = interiorAngles(vertices);
    if (Math.min(...angles) < 0.12 || Math.max(...angles) > Math.PI - 0.10) continue;
    const edge = edgeFit(stroke.samples, vertices, 0.06), stats = errorStats(edge.errors);
    const minCoverage = Math.min(...edge.coverages), meanCoverage = edge.coverages.reduce((sum, item) => sum + item, 0) / 3;
    if (stats.rms > 0.068 || stats.p90 > 0.12 || stats.max > 0.23 || minCoverage < 0.43 || meanCoverage < 0.62 || Math.min(...edge.counts) < 3) continue;
    const cornerSupport = cornerSupportScore(vertices, features);
    const cornerCountScore = Math.exp(-Math.abs(features.cornerCount - 3) * 0.38);
    const closureScore = clamp01(1 - features.closureRatio / 0.20);
    const angleBalance = angles.reduce((sum, angle) => sum + (angle >= 0.20 && angle <= Math.PI - 0.18 ? 1 : 0), 0) / 3;
    const residualScore = 0.40 * scoreDescending(stats.rms, 0, 0.068) + 0.22 * scoreDescending(stats.p90, 0, 0.12) +
      0.12 * scoreDescending(stats.max, 0, 0.23);
    const geometryScore = clamp01(residualScore + 0.10 * minCoverage + 0.06 * meanCoverage + 0.10 * cornerSupport +
      0.12 * cornerCountScore + 0.09 * angleBalance + 0.06 * closureScore - 0.12);
    const proposal: GeometryProposal = {
      kind, geometryScore, fitError: stats.rms,
      reasons: ['three-side polygon fit', `edge-coverage=${minCoverage.toFixed(2)}`, `corner-support=${cornerSupport.toFixed(2)}`],
      canonicalSamples: canonicalTriangle(stroke.samples, vertices), normalizedBounds: bounds, normalizedVertices: vertices,
      metrics: { rms: stats.rms, p90: stats.p90, max: stats.max, minEdgeCoverage: minCoverage, meanEdgeCoverage: meanCoverage,
        cornerSupport, cornerCount: features.cornerCount, closureRatio: features.closureRatio, minAngle: Math.min(...angles), maxAngle: Math.max(...angles) },
    };
    if (!best || proposal.geometryScore > best.geometryScore) best = proposal;
  }
  if (!best) return { diagnostic: rejected(kind, variants.length ? 'triangle-boundary-or-corner-fit-poor' : 'no-three-corner-candidate') };
  return { fit: best };
}

function fitEllipse(stroke: PreparedStroke, features: StrokeFeatures): { fit?: GeometryProposal; diagnostic?: CandidateDiagnostic } {
  const kind: RecognizedShapeKind = 'ellipse';
  if (!features.isNearClosed) return { diagnostic: rejected(kind, 'stroke-not-closed-enough', { closureRatio: features.closureRatio }) };
  if (features.selfIntersects) return { diagnostic: rejected(kind, 'self-intersection') };
  if (features.pathRatio < 2.0 || features.pathRatio > 4.8) return { diagnostic: rejected(kind, 'implausible-ellipse-perimeter', { pathRatio: features.pathRatio }) };
  const points = stroke.samples;
  const xs = points.map(point => point[0]), ys = points.map(point => point[1]);
  const minX = quantile(xs, 0.015), maxX = quantile(xs, 0.985), minY = quantile(ys, 0.015), maxY = quantile(ys, 0.985);
  const rx = (maxX - minX) / 2, ry = (maxY - minY) / 2;
  if (rx < 0.12 || ry < 0.12 || Math.max(rx, ry) / Math.min(rx, ry) > 3.2) return { diagnostic: rejected(kind, 'ellipse-axis-ratio-out-of-range') };
  const center: Point2 = [(minX + maxX) / 2, (minY + maxY) / 2];
  const errors = points.map(point => Math.abs(Math.hypot((point[0] - center[0]) / rx, (point[1] - center[1]) / ry) - 1) * Math.sqrt((rx * rx + ry * ry) / 2));
  const stats = errorStats(errors);
  const angular = angularCoverage(points, center);
  const angularGap = Math.PI * 2 - angular;
  if (stats.rms > 0.060 || stats.p90 > 0.105 || stats.max > 0.22 || angular < Math.PI * 1.72 || angularGap > 0.90) {
    return { diagnostic: rejected(kind, 'radial-or-angular-fit-poor', { fitError: stats.rms, p90: stats.p90, max: stats.max, angularCoverage: angular }) };
  }
  const radialScore = 0.48 * scoreDescending(stats.rms, 0, 0.060) + 0.25 * scoreDescending(stats.p90, 0, 0.105) +
    0.12 * scoreDescending(stats.max, 0, 0.22);
  const coverageScore = clamp01((angular - Math.PI * 1.72) / (Math.PI * 0.28));
  const closureScore = clamp01(1 - features.closureRatio / 0.20);
  const cornerScore = Math.exp(-Math.max(0, features.cornerCount - 2) * 0.10);
  const geometryScore = clamp01(radialScore + 0.10 * coverageScore + 0.10 * closureScore + 0.10 * cornerScore - 0.10);
  const bounds: Bounds = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  const diagonal = Math.hypot(bounds.w, bounds.h);
  const canonical = points.map(point => {
    const dx = (point[0] - center[0]) / diagonal, dy = (point[1] - center[1]) / diagonal;
    return rx >= ry ? [dx, dy] as Point2 : [dy, dx] as Point2;
  });
  return { fit: {
    kind, geometryScore, fitError: stats.rms,
    reasons: ['axis-aligned ellipse radial fit', `radial-rms=${stats.rms.toFixed(4)}`, `angular-coverage=${(angular * 180 / Math.PI).toFixed(0)}deg`],
    canonicalSamples: canonical, normalizedBounds: bounds,
    metrics: { rms: stats.rms, p90: stats.p90, max: stats.max, angularCoverage: angular, angularGap, axisRatio: Math.max(rx, ry) / Math.min(rx, ry),
      circularity: features.circularity, closureRatio: features.closureRatio, cornerCount: features.cornerCount },
  } };
}

function emptyDiagnostic(kind: RecognizedShapeKind): CandidateDiagnostic {
  return { kind, geometryScore: 0, templateScore: 0, confidence: 0, threshold: SMART_DRAWING_THRESHOLDS[kind], accepted: false, reasons: ['no-geometric-candidate'] };
}

export const DETERMINISTIC_SHAPE_RECOGNIZERS: readonly SmartShapeRecognizer[] = Object.freeze([
  { kind: 'line', propose: fitLine },
  { kind: 'rectangle', propose: fitRectangle },
  { kind: 'triangle', propose: fitTriangle },
  { kind: 'ellipse', propose: fitEllipse },
]);

/** Run independent complete-stroke fitters; new deterministic providers can join the same ranking contract. */
export function generateGeometryCandidates(
  stroke: PreparedStroke,
  features = analyzeSmartStroke(stroke),
  recognizers: readonly SmartShapeRecognizer[] = DETERMINISTIC_SHAPE_RECOGNIZERS,
): GeometryAnalysis {
  const diagnostics: CandidateDiagnostic[] = [];
  const fits: GeometryProposal[] = [];
  for (const recognizer of recognizers) {
    const attempt = recognizer.propose(stroke, features);
    if (attempt.fit) fits.push(attempt.fit);
    else diagnostics.push(attempt.diagnostic ?? emptyDiagnostic(recognizer.kind));
  }
  return { features, fits, diagnostics };
}
