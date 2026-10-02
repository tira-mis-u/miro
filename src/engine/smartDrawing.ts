export type SmartDrawingPoint = [number, number, number?];
export type SmartDrawingKind = 'line' | 'curve' | 'rectangle' | 'ellipse' | 'triangle' | 'unchanged';

export interface SmartDrawingResult {
  kind: SmartDrawingKind;
  confidence: number;
  points: SmartDrawingPoint[];
  bounds?: { x: number; y: number; w: number; h: number };
  vertices?: [number, number][];
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const distance = (a: SmartDrawingPoint, b: SmartDrawingPoint) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function boundsOf(points: SmartDrawingPoint[]) {
  const xs = points.map(point => point[0]);
  const ys = points.map(point => point[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  const maxX = Math.max(...xs), maxY = Math.max(...ys);
  return { x, y, w: maxX - x, h: maxY - y };
}

function pathLength(points: SmartDrawingPoint[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index++) length += distance(points[index - 1], points[index]);
  return length;
}

function pointLineDistance(point: SmartDrawingPoint, a: SmartDrawingPoint, b: SmartDrawingPoint): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const denominator = Math.hypot(dx, dy);
  if (denominator < 1e-9) return distance(point, a);
  return Math.abs(dy * point[0] - dx * point[1] + b[0] * a[1] - b[1] * a[0]) / denominator;
}

function pointSegmentDistance(point: SmartDrawingPoint, a: SmartDrawingPoint, b: SmartDrawingPoint): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const denominator = dx * dx + dy * dy;
  if (!denominator) return distance(point, a);
  const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / denominator));
  return Math.hypot(point[0] - (a[0] + t * dx), point[1] - (a[1] + t * dy));
}

function perpendicularDistance(point: SmartDrawingPoint, a: SmartDrawingPoint, b: SmartDrawingPoint): number {
  return pointLineDistance(point, a, b);
}

function simplifyOpen(points: SmartDrawingPoint[], epsilon: number): SmartDrawingPoint[] {
  if (points.length <= 2) return points.slice();
  let maximum = 0, index = -1;
  for (let candidate = 1; candidate < points.length - 1; candidate++) {
    const deviation = pointSegmentDistance(points[candidate], points[0], points[points.length - 1]);
    if (deviation > maximum) { maximum = deviation; index = candidate; }
  }
  if (maximum <= epsilon || index < 0) return [points[0], points[points.length - 1]];
  const left = simplifyOpen(points.slice(0, index + 1), epsilon);
  const right = simplifyOpen(points.slice(index), epsilon);
  return [...left.slice(0, -1), ...right];
}

function simplifyClosed(points: SmartDrawingPoint[], epsilon: number): SmartDrawingPoint[] {
  const ring = points.slice();
  if (ring.length > 2 && distance(ring[0], ring[ring.length - 1]) < epsilon * 0.2) ring.pop();
  if (ring.length < 3) return [];
  let pivot = 1, farthest = 0;
  for (let index = 1; index < ring.length; index++) {
    const candidate = distance(ring[0], ring[index]);
    if (candidate > farthest) { farthest = candidate; pivot = index; }
  }
  if (pivot === 0 || pivot === ring.length - 1) return [];
  const firstArc = ring.slice(0, pivot + 1);
  const secondArc = [...ring.slice(pivot), ring[0]];
  const a = simplifyOpen(firstArc, epsilon);
  const b = simplifyOpen(secondArc, epsilon);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

function orientation(a: SmartDrawingPoint, b: SmartDrawingPoint, c: SmartDrawingPoint): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function segmentsCross(a: SmartDrawingPoint, b: SmartDrawingPoint, c: SmartDrawingPoint, d: SmartDrawingPoint): boolean {
  const abC = orientation(a, b, c), abD = orientation(a, b, d);
  const cdA = orientation(c, d, a), cdB = orientation(c, d, b);
  return abC * abD < 0 && cdA * cdB < 0;
}

function hasSelfIntersection(points: SmartDrawingPoint[], closed: boolean): boolean {
  if (points.length > 160) {
    const sampled = Array.from({ length: 160 }, (_, index) => points[Math.round(index * (points.length - 1) / 159)]);
    return hasSelfIntersection(sampled, closed);
  }
  const edgeCount = closed ? points.length : points.length - 1;
  for (let first = 0; first < edgeCount; first++) {
    const a = points[first], b = points[(first + 1) % points.length];
    for (let second = first + 1; second < edgeCount; second++) {
      if (Math.abs(first - second) <= 1 || (closed && first === 0 && second === edgeCount - 1)) continue;
      const c = points[second], d = points[(second + 1) % points.length];
      if (segmentsCross(a, b, c, d)) return true;
    }
  }
  return false;
}

function polygonArea(points: SmartDrawingPoint[]): number {
  let twiceArea = 0;
  for (let index = 0; index < points.length; index++) {
    const current = points[index], next = points[(index + 1) % points.length];
    twiceArea += current[0] * next[1] - next[0] * current[1];
  }
  return Math.abs(twiceArea) / 2;
}

function fitOrientedRectangle(
  points: SmartDrawingPoint[],
  roughVertices: SmartDrawingPoint[],
  diagonal: number,
  strokeSize: number,
): { confidence: number; vertices: SmartDrawingPoint[]; bounds: { x: number; y: number; w: number; h: number } } | null {
  if (roughVertices.length !== 4) return null;
  const angles: number[] = [];
  for (let index = 0; index < 4; index++) {
    const start = roughVertices[index], end = roughVertices[(index + 1) % 4];
    if (distance(start, end) < diagonal * 0.12) return null;
    angles.push(Math.atan2(end[1] - start[1], end[0] - start[0]));
  }
  const candidates = [...angles];
  for (const [first, second] of [[0, 2], [1, 3]]) {
    const doubledSin = Math.sin(2 * angles[first]) + Math.sin(2 * angles[second]);
    const doubledCos = Math.cos(2 * angles[first]) + Math.cos(2 * angles[second]);
    if (Math.hypot(doubledSin, doubledCos) > 1e-6) candidates.push(0.5 * Math.atan2(doubledSin, doubledCos));
  }

  const tolerance = Math.max(strokeSize * 2.1, diagonal * 0.052);
  let best: { score: number; rms: number; p90: number; max: number; corners: SmartDrawingPoint[] } | null = null;
  for (const angle of candidates) {
    const ux = Math.cos(angle), uy = Math.sin(angle);
    const vx = -uy, vy = ux;
    const projected = points.map(point => ({ u: point[0] * ux + point[1] * uy, v: point[0] * vx + point[1] * vy }));
    const minU = Math.min(...projected.map(point => point.u));
    const maxU = Math.max(...projected.map(point => point.u));
    const minV = Math.min(...projected.map(point => point.v));
    const maxV = Math.max(...projected.map(point => point.v));
    const width = maxU - minU, height = maxV - minV;
    if (width < strokeSize * 2 || height < strokeSize * 2) continue;
    const aspect = width / Math.max(1, height);
    if (aspect < 0.12 || aspect > 8.3) continue;
    const corners: SmartDrawingPoint[] = [
      [minU * ux + minV * vx, minU * uy + minV * vy, 0.5],
      [maxU * ux + minV * vx, maxU * uy + minV * vy, 0.5],
      [maxU * ux + maxV * vx, maxU * uy + maxV * vy, 0.5],
      [minU * ux + maxV * vx, minU * uy + maxV * vy, 0.5],
    ];
    const errors = points.map(point => Math.min(
      ...corners.map((corner, index) => pointSegmentDistance(point, corner, corners[(index + 1) % corners.length])),
    ));
    const ordered = errors.slice().sort((a, b) => a - b);
    const rms = Math.sqrt(errors.reduce((sum, error) => sum + error * error, 0) / Math.max(1, errors.length));
    const p90 = ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * 0.9))] ?? 0;
    const max = ordered.at(-1) ?? 0;
    if (rms > tolerance * 0.72 || p90 > tolerance * 1.15 || max > tolerance * 2.7) continue;
    const score = rms + p90 * 0.2 + max * 0.035;
    if (!best || score < best.score) best = { score, rms, p90, max, corners };
  }
  if (!best) return null;
  const confidence = clamp01(0.96 - best.rms / (tolerance * 2.4) - best.p90 / (tolerance * 7) - best.max / Math.max(1, diagonal * 0.8));
  if (confidence < 0.68) return null;
  return { confidence, vertices: best.corners, bounds: boundsOf(best.corners) };
}

function regularizeCurve(points: SmartDrawingPoint[], strokeSize: number): SmartDrawingPoint[] {
  if (points.length < 4) return points.slice();
  const segmentLengths: number[] = [];
  const cumulative: number[] = [0];
  for (let index = 1; index < points.length; index++) {
    const length = distance(points[index - 1], points[index]);
    segmentLengths.push(length);
    cumulative.push(cumulative[index - 1] + length);
  }
  const totalLength = cumulative[cumulative.length - 1];
  if (totalLength < 1e-6) return points.slice();
  const sampleCount = Math.max(8, Math.min(64, Math.ceil(totalLength / Math.max(4, strokeSize * 1.25))));
  const resampled: SmartDrawingPoint[] = [];
  let segment = 0;
  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
    const target = totalLength * sampleIndex / (sampleCount - 1);
    while (segment < segmentLengths.length - 1 && cumulative[segment + 1] < target) segment++;
    const start = points[segment], end = points[segment + 1];
    const length = Math.max(1e-6, segmentLengths[segment]);
    const fraction = clamp01((target - cumulative[segment]) / length);
    resampled.push([
      start[0] + (end[0] - start[0]) * fraction,
      start[1] + (end[1] - start[1]) * fraction,
      (start[2] ?? 0.5) + ((end[2] ?? 0.5) - (start[2] ?? 0.5)) * fraction,
    ]);
  }
  return resampled.map((point, index) => {
    if (index === 0 || index === resampled.length - 1) return point;
    const before = resampled[index - 1], after = resampled[index + 1];
    return [
      before[0] * 0.18 + point[0] * 0.64 + after[0] * 0.18,
      before[1] * 0.18 + point[1] * 0.64 + after[1] * 0.18,
      point[2] ?? 0.5,
    ];
  });
}

function classifyClosedShape(
  points: SmartDrawingPoint[],
  bounds: { x: number; y: number; w: number; h: number },
  diagonal: number,
  size: number,
): SmartDrawingResult | null {
  const length = pathLength(points);
  const ratio = length / Math.max(1, diagonal);
  if (ratio < 1.7 || ratio > 5.5 || bounds.w < size * 2 || bounds.h < size * 2) return null;
  if (hasSelfIntersection(points, true)) return null;

  const epsilon = Math.max(size * 1.15, diagonal * 0.055);
  const vertices = simplifyClosed(points, epsilon);
  if (vertices.length < 3 || vertices.length > 12) return null;
  const area = polygonArea(vertices);
  if (area < bounds.w * bounds.h * 0.16) return null;

  if (vertices.length === 4) {
    const rectangle = fitOrientedRectangle(points, vertices, diagonal, size);
    if (rectangle) {
      return {
        kind: 'rectangle', confidence: rectangle.confidence, points,
        bounds: rectangle.bounds,
        vertices: rectangle.vertices.map(point => [point[0], point[1]]),
      };
    }
  }

  if (vertices.length === 3) {
    const sideLengths = vertices.map((point, index) => distance(point, vertices[(index + 1) % 3]));
    if (Math.min(...sideLengths) < diagonal * 0.18) return null;
    const confidence = clamp01(0.72 + Math.min(0.22, area / Math.max(1, bounds.w * bounds.h) * 0.38));
    if (confidence >= 0.78) return { kind: 'triangle', confidence, points, bounds, vertices: vertices.map(point => [point[0], point[1]]) };
  }

  const aspect = bounds.w / Math.max(1, bounds.h);
  if (aspect < 0.28 || aspect > 3.6) return null;
  let squaredError = 0, maxError = 0;
  for (const point of points) {
    const nx = (point[0] - (bounds.x + bounds.w / 2)) / Math.max(1, bounds.w / 2);
    const ny = (point[1] - (bounds.y + bounds.h / 2)) / Math.max(1, bounds.h / 2);
    const error = Math.abs(Math.hypot(nx, ny) - 1);
    squaredError += error * error;
    maxError = Math.max(maxError, error);
  }
  const rmsError = Math.sqrt(squaredError / points.length);
  const confidence = clamp01(1 - rmsError / 0.34 - maxError * 0.22);
  if (rmsError <= 0.18 && maxError <= 0.42 && confidence >= 0.58) {
    return { kind: 'ellipse', confidence, points, bounds };
  }
  return null;
}

/** Deterministic, conservative local recognition for the Pen tool's Smart Drawing mode. */
export function recognizeSmartDrawing(input: number[][], strokeSize = 6): SmartDrawingResult {
  const originalPoints: SmartDrawingPoint[] = input
    .filter(point => Number.isFinite(point[0]) && Number.isFinite(point[1]))
    .map(point => [point[0], point[1], Number.isFinite(point[2]) ? point[2] : 0.5]);
  const points: SmartDrawingPoint[] = [];
  for (const point of originalPoints) {
    if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) continue;
    const normalized: SmartDrawingPoint = [point[0], point[1], Number.isFinite(point[2]) ? point[2] : 0.5];
    if (!points.length || distance(points[points.length - 1], normalized) >= 0.5) points.push(normalized);
  }
  if (points.length < 3) return { kind: 'unchanged', confidence: 0, points: originalPoints };

  const bounds = boundsOf(points);
  const diagonal = Math.hypot(bounds.w, bounds.h);
  const length = pathLength(points);
  if (diagonal < Math.max(5, strokeSize * 1.4) || length < strokeSize * 2.2) {
    return { kind: 'unchanged', confidence: 0, points: originalPoints };
  }

  const endpointGap = distance(points[0], points[points.length - 1]);
  const closeThreshold = Math.max(strokeSize * 2.3, diagonal * 0.105);
  const closed = endpointGap <= closeThreshold && length / Math.max(diagonal, 1) <= 5.5;
  if (closed) {
    const shape = classifyClosedShape(points, bounds, diagonal, strokeSize);
    if (shape) return shape;
    // Closed, tangled, or low-confidence doodles remain untouched.
    return { kind: 'unchanged', confidence: 0, points: originalPoints };
  }

  const maxDeviation = Math.max(...points.map(point => perpendicularDistance(point, points[0], points[points.length - 1])));
  const directness = diagonal / Math.max(1, length);
  const lineTolerance = Math.max(strokeSize * 1.35, diagonal * 0.026);
  const lineConfidence = clamp01(0.7 + directness * 0.3 - maxDeviation / Math.max(1, lineTolerance * 4));
  if (maxDeviation <= lineTolerance && directness >= 0.94 && lineConfidence >= 0.72) {
    const pressure = points.reduce((sum, point) => sum + (point[2] ?? 0.5), 0) / points.length;
    return {
      kind: 'line', confidence: lineConfidence,
      points: [[points[0][0], points[0][1], pressure], [points[points.length - 1][0], points[points.length - 1][1], pressure]],
    };
  }

  const tortuosity = length / Math.max(1, diagonal);
  const sampled = points.length > 180
    ? Array.from({ length: 180 }, (_, index) => points[Math.round(index * (points.length - 1) / 179)])
    : points;
  const selfCrossing = hasSelfIntersection(sampled, false);
  let totalTurn = 0, signChanges = 0, previousSign = 0;
  for (let index = 1; index < sampled.length - 1; index++) {
    const a = sampled[index - 1], b = sampled[index], c = sampled[index + 1];
    const ux = b[0] - a[0], uy = b[1] - a[1], vx = c[0] - b[0], vy = c[1] - b[1];
    const lengths = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    if (lengths < 1) continue;
    const angle = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    if (Math.abs(angle) < 0.025) continue;
    totalTurn += Math.abs(angle);
    const sign = Math.sign(angle);
    if (previousSign && sign !== previousSign) signChanges++;
    previousSign = sign;
  }
  const curveConfidence = clamp01(1 - Math.max(0, tortuosity - 1.15) * 0.36 - Math.max(0, totalTurn - Math.PI) * 0.065 - signChanges * 0.075);
  if (!selfCrossing && tortuosity <= 3.0 && totalTurn >= 0.12 && totalTurn <= Math.PI * 5 && signChanges <= 6 && curveConfidence >= 0.56) {
    return { kind: 'curve', confidence: curveConfidence, points: regularizeCurve(points, strokeSize) };
  }
  return { kind: 'unchanged', confidence: 0, points: originalPoints };
}
