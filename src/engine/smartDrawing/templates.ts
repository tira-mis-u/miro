import type { Point2, RecognizedShapeKind } from './types';
import { TEMPLATE_SAMPLE_COUNT } from './types';
import { boundsOf, distance, pathLength, resampleByArcLength } from './preprocess';

interface ShapeTemplate {
  id: string;
  kind: RecognizedShapeKind;
  points: Point2[];
  aspect: number;
  pathRatio: number;
  cornerCount: number;
}

export interface TemplateMatch {
  score: number;
  distance: number;
  templateId: string;
}

function normalizeTemplatePath(points: Point2[]): ShapeTemplate['points'] {
  const bounds = boundsOf(points);
  const diagonal = Math.hypot(bounds.w, bounds.h) || 1;
  const centerX = bounds.x + bounds.w / 2, centerY = bounds.y + bounds.h / 2;
  return resampleByArcLength(points.map(point => [(point[0] - centerX) / diagonal, (point[1] - centerY) / diagonal]), TEMPLATE_SAMPLE_COUNT);
}

function closedPath(vertices: Point2[], count = TEMPLATE_SAMPLE_COUNT): Point2[] {
  const ring = [...vertices, [...vertices[0]] as Point2];
  return resampleByArcLength(ring, count);
}

function template(kind: RecognizedShapeKind, id: string, points: Point2[], aspect: number, cornerCount: number, closed = true): ShapeTemplate {
  const diagonalNormalized = normalizeTemplatePath(points);
  const bounds = boundsOf(points);
  const diagonal = Math.hypot(bounds.w, bounds.h) || 1;
  const path = closed ? [...points, [...points[0]] as Point2] : points;
  return { id, kind, points: diagonalNormalized, aspect,
    pathRatio: pathLength(path) / diagonal, cornerCount };
}

function createLineTemplates(): ShapeTemplate[] {
  const templates: ShapeTemplate[] = [];
  for (const bend of [0, -0.018, 0.018, -0.035, 0.035]) {
    const points = Array.from({ length: TEMPLATE_SAMPLE_COUNT }, (_, index) => {
      const t = index / (TEMPLATE_SAMPLE_COUNT - 1);
      return [t - 0.5, bend * Math.sin(Math.PI * t)] as Point2;
    });
    templates.push(template('line', `line-bend-${bend}`, points, Infinity, 0, false));
  }
  return templates;
}

function createRectangleTemplates(): ShapeTemplate[] {
  const templates: ShapeTemplate[] = [];
  for (const aspect of [0.35, 0.48, 0.65, 0.82, 1, 1.22, 1.55, 2, 2.8, 4]) {
    const width = Math.sqrt(aspect * aspect / (aspect * aspect + 1));
    const height = width / aspect;
    const vertices: Point2[] = [[-width / 2, -height / 2], [width / 2, -height / 2],
      [width / 2, height / 2], [-width / 2, height / 2]];
    templates.push(template('rectangle', `rect-${aspect}`, closedPath(vertices), aspect, 4));
  }
  return templates;
}

function createTriangleTemplates(): ShapeTemplate[] {
  const templates: ShapeTemplate[] = [];
  for (const heightRatio of [0.35, 0.5, 0.72, 0.95, 1.25, 1.7, 2.25]) {
    for (const apexFraction of [0.22, 0.5, 0.78]) {
      const vertices: Point2[] = [[-0.5, 0], [0.5, 0], [apexFraction - 0.5, heightRatio]];
      templates.push(template('triangle', `tri-h${heightRatio}-a${apexFraction}`, closedPath(vertices), Infinity, 3));
    }
  }
  return templates;
}

function createEllipseTemplates(): ShapeTemplate[] {
  const templates: ShapeTemplate[] = [];
  for (const aspect of [0.35, 0.5, 0.72, 1, 1.4, 2, 2.8]) {
    const width = Math.sqrt(aspect * aspect / (aspect * aspect + 1));
    const height = width / aspect;
    const rx = width / 2, ry = height / 2;
    const points = Array.from({ length: TEMPLATE_SAMPLE_COUNT + 1 }, (_, index) => {
      const angle = index / TEMPLATE_SAMPLE_COUNT * Math.PI * 2;
      return [rx * Math.cos(angle), ry * Math.sin(angle)] as Point2;
    });
    templates.push(template('ellipse', `ellipse-${aspect}`, points, aspect, 0));
  }
  return templates;
}

function createDiamondTemplates(): ShapeTemplate[] {
  const templates: ShapeTemplate[] = [];
  for (const aspect of [0.65, 0.85, 1, 1.25, 1.55]) {
    const width = Math.sqrt(aspect * aspect / (aspect * aspect + 1));
    const height = width / aspect;
    const vertices: Point2[] = [
      [0, -height / 2],
      [width / 2, 0],
      [0, height / 2],
      [-width / 2, 0],
    ];
    templates.push(template('diamond', `diamond-${aspect}`, closedPath(vertices), aspect, 4));
  }
  return templates;
}

function createArrowTemplates(): ShapeTemplate[] {
  const templates: ShapeTemplate[] = [];
  for (const headAngle of [0.45, 0.6]) {
    const points: Point2[] = [
      [0, 0],
      [0.8, 0],
      [0.6, -headAngle * 0.3],
      [0.8, 0],
      [0.6, headAngle * 0.3],
    ];
    templates.push(template('arrow', `arrow-${headAngle}`, points, Infinity, 2, false));
  }
  return templates;
}

function createStarTemplates(): ShapeTemplate[] {
  const templates: ShapeTemplate[] = [];
  const points: Point2[] = [];
  for (let i = 0; i <= 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? 0.5 : 0.22;
    points.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  templates.push(template('star', 'star-5p', points, 1, 5, true));
  return templates;
}

function createHeartTemplates(): ShapeTemplate[] {
  const templates: ShapeTemplate[] = [];
  for (const aspect of [0.85, 1.0, 1.15]) {
    const points: Point2[] = [];
    const count = 64;
    for (let i = 0; i < count; i++) {
      const t = (i / count) * Math.PI * 2;
      const x = 16 * Math.pow(Math.sin(t), 3);
      const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
      points.push([x / 16 * aspect, y / 16]);
    }
    templates.push(template('heart', `heart-${aspect}`, closedPath(points), aspect, 2));
  }
  return templates;
}

function createParallelogramTemplates(): ShapeTemplate[] {
  const templates: ShapeTemplate[] = [];
  for (const aspect of [1.0, 1.35, 1.7]) {
    const width = Math.sqrt(aspect * aspect / (aspect * aspect + 1));
    const height = width / aspect;
    for (const skewSign of [1, -1]) {
      const skew = width * 0.24 * skewSign;
      const vertices: Point2[] = [
        [-width / 2 + skew, -height / 2],
        [width / 2, -height / 2],
        [width / 2 - skew, height / 2],
        [-width / 2, height / 2],
      ];
      templates.push(template('parallelogram', `parallelogram-${aspect}-${skewSign}`, closedPath(vertices), aspect, 4));
    }
  }
  return templates;
}

function createTrapezoidTemplates(): ShapeTemplate[] {
  const templates: ShapeTemplate[] = [];
  for (const aspect of [1.0, 1.35, 1.7]) {
    const width = Math.sqrt(aspect * aspect / (aspect * aspect + 1));
    const height = width / aspect;
    for (const topRatio of [0.55, 0.72]) {
      const topW = width * topRatio;
      const vertices: Point2[] = [
        [-topW / 2, -height / 2],
        [topW / 2, -height / 2],
        [width / 2, height / 2],
        [-width / 2, height / 2],
      ];
      templates.push(template('trapezoid', `trapezoid-${aspect}-${topRatio}`, closedPath(vertices), aspect, 4));
    }
  }
  return templates;
}

/** Small, bounded, deterministic template bank; no network or learned parameters. */
export const SMART_DRAWING_TEMPLATES: readonly ShapeTemplate[] = Object.freeze([
  ...createLineTemplates(),
  ...createArrowTemplates(),
  ...createRectangleTemplates(),
  ...createParallelogramTemplates(),
  ...createTrapezoidTemplates(),
  ...createTriangleTemplates(),
  ...createEllipseTemplates(),
  ...createDiamondTemplates(),
  ...createStarTemplates(),
  ...createHeartTemplates(),
]);

function meanNearestDistance(a: Point2[], b: Point2[]): number {
  let sum = 0;
  for (const point of a) {
    let nearest = Infinity;
    for (const candidate of b) nearest = Math.min(nearest, distance(point, candidate));
    sum += nearest;
  }
  return a.length ? sum / a.length : Infinity;
}

function symmetricChamfer(a: Point2[], b: Point2[]): number {
  return (meanNearestDistance(a, b) + meanNearestDistance(b, a)) / 2;
}

function alignedPathDistance(obs: Point2[], ref: Point2[], closed: boolean): number {
  if (!obs.length || !ref.length) return Infinity;
  let best = Infinity;
  const shifts = closed ? TEMPLATE_SAMPLE_COUNT : 1;
  for (let direction = 0; direction < 2; direction++) {
    for (let shift = 0; shift < shifts; shift++) {
      let sum = 0;
      for (let index = 0; index < TEMPLATE_SAMPLE_COUNT; index++) {
        const refIndex = direction === 0
          ? (index + shift) % TEMPLATE_SAMPLE_COUNT
          : (shift - index + TEMPLATE_SAMPLE_COUNT * 2) % TEMPLATE_SAMPLE_COUNT;
        sum += distance(obs[index], ref[refIndex]);
      }
      best = Math.min(best, sum / TEMPLATE_SAMPLE_COUNT);
    }
  }
  return best;
}

function templateFeatureDistance(candidate: { aspect?: number; pathRatio: number; cornerCount: number }, reference: ShapeTemplate): number {
  const aspect = Number.isFinite(candidate.aspect) ? Math.max(1e-4, candidate.aspect!) : reference.aspect;
  const aspectDistance = Number.isFinite(reference.aspect) ? Math.abs(Math.log(aspect / reference.aspect)) : 0;
  const pathDistance = Math.abs(candidate.pathRatio - reference.pathRatio) / Math.max(0.75, reference.pathRatio);
  const cornerDistance = Math.abs(candidate.cornerCount - reference.cornerCount) / Math.max(3, reference.cornerCount);
  return 0.5 * Math.min(2, aspectDistance) + 0.32 * Math.min(2, pathDistance) + 0.18 * Math.min(1, cornerDistance);
}

/** Match normalized shape traces by bidirectional/cyclic path distance plus explicit geometric features. */
export function matchSmartTemplate(
  kind: RecognizedShapeKind,
  canonicalSamples: Point2[],
  features: { pathRatio: number; cornerCount: number },

  candidateAspect?: number,
): TemplateMatch {
  const candidates = SMART_DRAWING_TEMPLATES.filter(candidate => candidate.kind === kind);
  const observed = resampleByArcLength(canonicalSamples, TEMPLATE_SAMPLE_COUNT);
  const closed = kind !== 'line';
  let best: TemplateMatch = { score: 0, distance: Infinity, templateId: 'none' };
  for (const reference of candidates) {
    const pathDistance = 0.58 * alignedPathDistance(observed, reference.points, closed) +
      0.42 * symmetricChamfer(observed, reference.points);
    const featureDistance = templateFeatureDistance({ ...features, aspect: candidateAspect }, reference);
    const distanceScore = Math.exp(-pathDistance / 0.105);
    const featureScore = Math.exp(-featureDistance / 0.62);
    const score = Math.max(0, Math.min(1, 0.78 * distanceScore + 0.22 * featureScore));
    if (score > best.score) best = { score, distance: pathDistance, templateId: reference.id };
  }
  return best;
}
