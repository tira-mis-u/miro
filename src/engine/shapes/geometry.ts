import type { GeometryKind, PathCommand, ShapeDefinition, StrokeStyle } from './types';
import { buildSolid3DProjection, isSolid3DGeometry, type Solid3DProjection, type Solid3DProjectionOptions } from './solid3d';

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
const n = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;

function command(op: PathCommand['op'], ...values: number[]): PathCommand { return { op, values }; }
function poly(points: readonly (readonly [number, number])[], close = true): PathCommand[] {
  if (!points.length) return [];
  return [command('moveTo', ...points[0]), ...points.slice(1).map(point => command('lineTo', ...point)), ...(close ? [command('closePath')] : [])];
}

function roundedRectPath(width: number, height: number, radius: number): PathCommand[] {
  const w = Math.max(1, width), h = Math.max(1, height), r = clamp(radius, 0, Math.min(w, h) / 2);
  return [command('moveTo', r, 0), command('lineTo', w - r, 0), command('quadraticCurveTo', w, 0, w, r),
    command('lineTo', w, h - r), command('quadraticCurveTo', w, h, w - r, h), command('lineTo', r, h),
    command('quadraticCurveTo', 0, h, 0, h - r), command('lineTo', 0, r), command('quadraticCurveTo', 0, 0, r, 0), command('closePath')];
}

function actorCommands(width: number, height: number): PathCommand[] {
  const w = Math.max(1, width), h = Math.max(1, height), cx = w / 2;
  const radius = Math.min(w * 0.12, h * 0.085);
  const headCenterY = radius + h * 0.06;
  const neckY = headCenterY + radius;
  const shoulderY = h * 0.36;
  const torsoBottom = h * 0.70;
  return [command('moveTo', cx + radius, headCenterY), command('ellipse', cx, headCenterY, radius, radius, 0, 0, Math.PI * 2, 0),
    command('closePath'), command('moveTo', cx, neckY), command('lineTo', cx, torsoBottom),
    command('moveTo', w * 0.12, h * 0.50), command('lineTo', cx, shoulderY), command('lineTo', w * 0.88, h * 0.50),
    command('moveTo', cx, torsoBottom), command('lineTo', w * 0.20, h * 0.96),
    command('moveTo', cx, torsoBottom), command('lineTo', w * 0.80, h * 0.96)];
}

function ellipsePath(cx: number, cy: number, rx: number, ry = rx): PathCommand[] {
  return [command('moveTo', cx + rx, cy), command('ellipse', cx, cy, rx, ry, 0, 0, Math.PI * 2, 0), command('closePath')];
}

/** Return native local-space outline commands. Width/height remain live shape parameters. */
export function buildGeometryCommands(
  geometry: GeometryKind,
  width: number,
  height: number,
  params: Readonly<Record<string, unknown>> = {},
  solidOptions?: Solid3DProjectionOptions,
): PathCommand[] {
  const w = Math.max(1, n(width, 1)), h = Math.max(1, n(height, 1));
  const cx = w / 2, cy = h / 2;
  const rect = () => poly([[0, 0], [w, 0], [w, h], [0, h]]);
  if (isSolid3DGeometry(geometry)) return buildSolid3DProjection(geometry, w, h, params, solidOptions).outline;
  switch (geometry) {
    case 'rect': case 'table': case 'column': case 'pool': case 'lane': case 'umlBoundary': case 'activityPartition':
      return rect();
    case 'roundedRect': case 'umlState': case 'umlActivity': case 'group': case 'umlCompositeState': {
      const minSide = Math.min(w, h);
      const absoluteRadius = n(params.cornerRadius, Number.NaN);
      const ratio = geometry === 'group' ? 0.065 : geometry === 'umlCompositeState' ? 0.14 : n(params.cornerRadiusRatio, 0.175);
      const radius = geometry === 'group' ? minSide * ratio : Number.isFinite(absoluteRadius)
        ? clamp(absoluteRadius, 0, minSide / 2) : clamp(ratio, 0, 0.5) * minSide;
      return roundedRectPath(w, h, radius);
    }
    case 'callout': {
      const radius = Math.min(w, h) * 0.09, base = h * 0.76, tailX = clamp(n(params.tailPosition, 0.24), 0.1, 0.8) * w;
      return [command('moveTo', radius, 0), command('lineTo', w - radius, 0), command('quadraticCurveTo', w, 0, w, radius),
        command('lineTo', w, base - radius), command('quadraticCurveTo', w, base, w - radius, base),
        command('lineTo', tailX + w * 0.08, base), command('lineTo', tailX, h), command('lineTo', tailX - w * 0.08, base),
        command('lineTo', radius, base), command('quadraticCurveTo', 0, base, 0, base - radius), command('lineTo', 0, radius),
        command('quadraticCurveTo', 0, 0, radius, 0), command('closePath')];
    }
    case 'capsule': {
      const radius = Math.min(w, h) / 2;
      return [command('moveTo', radius, 0), command('lineTo', w - radius, 0), command('quadraticCurveTo', w, 0, w, radius),
        command('lineTo', w, h - radius), command('quadraticCurveTo', w, h, w - radius, h), command('lineTo', radius, h),
        command('quadraticCurveTo', 0, h, 0, h - radius), command('lineTo', 0, radius),
        command('quadraticCurveTo', 0, 0, radius, 0), command('closePath')];
    }
    case 'ellipse': case 'useCase': case 'junction': case 'summingJunction':
      return [command('moveTo', w, cy), command('ellipse', cx, cy, cx, cy, 0, 0, Math.PI * 2, 0), command('closePath')];
    case 'triangle': return poly([[cx, 0], [w, h], [0, h]]);
    case 'rightTriangle': return poly([[0, 0], [w, h], [0, h]]);
    case 'diamond': return poly([[cx, 0], [w, cy], [cx, h], [0, cy]]);
    case 'parallelogram': {
      const skew = clamp(n(params.skew, 0.2), 0, 0.46) * w;
      return poly([[skew, 0], [w, 0], [w - skew, h], [0, h]]);
    }
    case 'trapezoid': {
      const ratio = clamp(n(params.topRatio, 0.58), 0.18, 1);
      const inset = (1 - ratio) * w / 2;
      return poly([[inset, 0], [w - inset, 0], [w, h], [0, h]]);
    }
    case 'regularPolygon': {
      const sides = Math.round(clamp(n(params.sides, 6), 3, 32)), radius = Math.min(w, h) / 2;
      return poly(Array.from({ length: sides }, (_, index): [number, number] => {
        const angle = index * Math.PI * 2 / sides - Math.PI / 2;
        return [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius];
      }));
    }
    case 'star': {
      const points = Math.round(clamp(n(params.points, 5), 3, 24)), radius = Math.min(w, h) / 2;
      const inner = clamp(n(params.innerRatio, 0.42), 0.12, 0.88);
      return poly(Array.from({ length: points * 2 }, (_, index): [number, number] => {
        const scale = index % 2 ? inner : 1;
        const angle = index * Math.PI / points - Math.PI / 2;
        return [cx + Math.cos(angle) * radius * scale, cy + Math.sin(angle) * radius * scale];
      }));
    }
    case 'cross': {
      const arm = clamp(n(params.armRatio, 0.34), 0.16, 0.72);
      const x0 = (1 - arm) * w / 2, x1 = (1 + arm) * w / 2;
      const y0 = (1 - arm) * h / 2, y1 = (1 + arm) * h / 2;
      return poly([[x0, 0], [x1, 0], [x1, y0], [w, y0], [w, y1], [x1, y1], [x1, h], [x0, h], [x0, y1], [0, y1], [0, y0], [x0, y0]]);
    }
    case 'heart':
      return [command('moveTo', cx, h * 0.92), command('bezierCurveTo', w * 0.36, h * 0.72, 0, h * 0.48, 0, h * 0.28),
        command('bezierCurveTo', 0, h * 0.02, w * 0.36, 0, cx, h * 0.20),
        command('bezierCurveTo', w * 0.64, 0, w, h * 0.02, w, h * 0.28),
        command('bezierCurveTo', w, h * 0.48, w * 0.64, h * 0.72, cx, h * 0.92), command('closePath')];
    case 'cloud':
      return [command('moveTo', w * 0.18, h * 0.78),
        command('bezierCurveTo', w * 0.02, h * 0.78, 0, h * 0.60, w * 0.08, h * 0.48),
        command('bezierCurveTo', w * 0.08, h * 0.30, w * 0.25, h * 0.20, w * 0.40, h * 0.29),
        command('bezierCurveTo', w * 0.48, h * 0.06, w * 0.78, h * 0.08, w * 0.82, h * 0.34),
        command('bezierCurveTo', w * 0.96, h * 0.30, w, h * 0.45, w * 0.94, h * 0.60),
        command('bezierCurveTo', w * 0.92, h * 0.78, w * 0.70, h * 0.93, w * 0.52, h * 0.83),
        command('bezierCurveTo', w * 0.39, h * 0.98, w * 0.20, h * 0.94, w * 0.18, h * 0.78), command('closePath')];
    case 'cylinder': case 'dataStore': {
      const cap = Math.min(h * 0.20, w * 0.22);
      return [command('moveTo', 0, cap), command('lineTo', 0, h - cap), command('bezierCurveTo', 0, h, w, h, w, h - cap),
        command('lineTo', w, cap), command('bezierCurveTo', w, 0, 0, 0, 0, cap), command('closePath')];
    }
    case 'document': {
      const wave = h * 0.18;
      return [command('moveTo', 0, 0), command('lineTo', w, 0), command('lineTo', w, h - wave),
        command('quadraticCurveTo', w * 0.76, h, w * 0.50, h - wave * 0.15),
        command('quadraticCurveTo', w * 0.24, h - wave * 0.65, 0, h - wave * 0.05), command('closePath')];
    }
    case 'dataObject': {
      if (params.messageEnvelope === true) return poly([[0, 0], [w, 0], [w, h], [0, h]]);
      const fold = Math.min(w, h) * 0.20;
      return [command('moveTo', 0, 0), command('lineTo', w - fold, 0), command('lineTo', w, fold),
        command('lineTo', w, h), command('lineTo', 0, h), command('closePath')];
    }
    case 'multipleDocuments': {
      const dx = w * 0.09, dy = h * 0.08;
      const commands = [command('moveTo', dx * 2, dy), command('lineTo', w - dx * 2, dy), command('lineTo', w - dx * 2, h - dy * 2), command('lineTo', dx * 2, h - dy * 2), command('closePath'),
        command('moveTo', dx, dy * 1.5), command('lineTo', w - dx, dy * 1.5), command('lineTo', w - dx, h - dy), command('lineTo', dx, h - dy), command('closePath'),
        command('moveTo', 0, dy * 2), command('lineTo', w - dx * 2, dy * 2), command('lineTo', w - dx * 2, h - dy),
        command('quadraticCurveTo', w * 0.52, h, 0, h - dy * 0.14), command('closePath')];
      return commands;
    }
    case 'actor': return actorCommands(w, h);
    case 'umlActorParticipant': {
      const actorHeight = h * 0.28;
      return actorCommands(w, actorHeight);
    }
    case 'umlRole':
      return [command('moveTo', cx, h * 0.45), command('ellipse', cx, h * 0.24, w * 0.28, h * 0.22, 0, Math.PI, Math.PI * 2, 0), command('moveTo', cx, h * 0.46), command('lineTo', cx, h * 0.96)];
    case 'frame':
      return [command('moveTo', 0, 0), command('lineTo', w * 0.38, 0), command('lineTo', w * 0.45, h * 0.14), command('lineTo', w, h * 0.14),
        command('lineTo', w, h), command('lineTo', 0, h), command('closePath')];
    case 'package': {
      const tabH = h * 0.22, tabW = w * 0.38, tabStep = w * 0.08;
      return [command('moveTo', 0, tabH), command('lineTo', 0, 0), command('lineTo', tabW, 0), command('lineTo', tabW + tabStep, tabH),
        command('lineTo', w, tabH), command('lineTo', w, h), command('lineTo', 0, h), command('closePath')];
    }
    case 'note': {
      const fold = Math.min(w, h) * 0.22;
      return [command('moveTo', 0, 0), command('lineTo', w - fold, 0), command('lineTo', w, fold), command('lineTo', w, h), command('lineTo', 0, h), command('closePath'),
        command('moveTo', w - fold, 0), command('lineTo', w - fold, fold), command('lineTo', w, fold)];
    }
    case 'blockArrow': {
      const shaft = clamp(n(params.shaftRatio, 0.38), 0.16, 0.72) * h;
      const y0 = (h - shaft) / 2, y1 = y0 + shaft, neck = w * 0.62;
      return poly([[0, y0], [neck, y0], [neck, 0], [w, cy], [neck, h], [neck, y1], [0, y1]]);
    }
    case 'internalStorage': case 'predefinedProcess': return rect();
    case 'manualInput': return poly([[0, h * 0.20], [w, 0], [w, h], [0, h]]);
    case 'manualOperation': return poly([[w * 0.14, 0], [w * 0.86, 0], [w, h], [0, h]]);
    case 'preparation': return poly([[w * 0.22, 0], [w * 0.78, 0], [w, cy], [w * 0.78, h], [w * 0.22, h], [0, cy]]);
    case 'display':
      return [command('moveTo', 0, 0), command('lineTo', w * 0.82, 0), command('quadraticCurveTo', w, cy, w * 0.82, h), command('lineTo', 0, h), command('lineTo', w * 0.12, cy), command('closePath')];
    case 'delay':
      return [command('moveTo', 0, 0), command('lineTo', w * 0.62, 0), command('bezierCurveTo', w, 0, w, h, w * 0.62, h), command('lineTo', 0, h), command('closePath')];
    case 'offPage': return poly([[0, 0], [w, 0], [w, h * 0.72], [cx, h], [0, h * 0.72]]);
    case 'magneticDisk': {
      const left = w * 0.08, right = w * 0.92, top = h * 0.28, base = h * 0.72;
      return [command('moveTo', left, top), command('bezierCurveTo', left, h * 0.08, right, h * 0.08, right, top),
        command('lineTo', right, base), command('bezierCurveTo', right, h * 0.92, left, h * 0.92, left, base), command('closePath')];
    }
    case 'magneticTape':
      return [command('moveTo', 0, 0), command('lineTo', w, 0), command('quadraticCurveTo', w * 0.82, cy, w, h), command('lineTo', 0, h), command('quadraticCurveTo', w * 0.18, cy, 0, 0), command('closePath')];
    case 'collate': return poly([[0, 0], [w, 0], [cx, h]]);
    case 'sort': return poly([[cx, 0], [w, cy], [cx, h], [0, cy]]);
    case 'extract': return poly([[0, 0], [w, 0], [cx, h]]);
    case 'merge': return poly([[cx, 0], [w, h], [0, h]]);
    case 'umlLifeline': {
      const headH = h * 0.22;
      return poly([[0, 0], [w, 0], [w, headH], [0, headH]]);
    }
    case 'umlActivation': return rect();
    case 'umlDestroy': return [command('moveTo', 0, 0), command('lineTo', w, h), command('moveTo', w, 0), command('lineTo', 0, h)];
    case 'umlInitialState': case 'umlFinalState': case 'umlHistory': case 'umlEntryPoint': case 'umlExitPoint': case 'bpmnEvent':
      return ellipsePath(cx, cy, cx, cy);
    case 'umlPseudoChoice': return poly([[cx, 0], [w, cy], [cx, h], [0, cy]]);
    case 'umlProvidedInterface': {
      const radius = Math.min(w, h) * 0.27, ringX = w * 0.42;
      return [...ellipsePath(ringX, cy, radius), command('moveTo', ringX + radius, cy), command('lineTo', w, cy)];
    }
    case 'umlRequiredInterface': {
      const radius = Math.min(w, h) * 0.31, socketX = w * 0.62;
      return [command('moveTo', socketX, cy - radius), command('ellipse', socketX, cy, radius, radius, 0, Math.PI * 1.5, Math.PI * 0.5, 1),
        command('moveTo', socketX, cy - radius), command('lineTo', w, cy - radius), command('moveTo', socketX, cy + radius), command('lineTo', w, cy + radius)];
    }
    case 'umlFork': return rect();
    case 'bpmnTask': {
      const radius = Math.min(w, h) * 0.14;
      return [command('moveTo', radius, 0), command('lineTo', w - radius, 0), command('quadraticCurveTo', w, 0, w, radius),
        command('lineTo', w, h - radius), command('quadraticCurveTo', w, h, w - radius, h), command('lineTo', radius, h),
        command('quadraticCurveTo', 0, h, 0, h - radius), command('lineTo', 0, radius), command('quadraticCurveTo', 0, 0, radius, 0), command('closePath')];
    }
    case 'bpmnGateway': return poly([[cx, 0], [w, cy], [cx, h], [0, cy]]);
    case 'annotation': return [command('moveTo', w * 0.18, h * 0.05), command('lineTo', w * 0.18, h * 0.95), command('moveTo', w * 0.22, h * 0.05), command('lineTo', w, h * 0.05), command('moveTo', w * 0.22, h * 0.95), command('lineTo', w, h * 0.95)];
    case 'keyMarker': {
      const r = Math.min(w * 0.22, h * 0.24);
      return [command('moveTo', r, cy), command('ellipse', r, cy, r, r, 0, 0, Math.PI * 2, 0), command('closePath'),
        command('moveTo', r * 2, cy), command('lineTo', w, cy), command('lineTo', w * 0.82, cy), command('lineTo', w * 0.82, cy + r * 0.55), command('moveTo', w * 0.68, cy), command('lineTo', w * 0.68, cy + r * 0.55)];
    }
    case 'waypoint':
      return [command('moveTo', w, cy), command('ellipse', cx, cy, cx, cy, 0, 0, Math.PI * 2, 0), command('closePath')];
    default: return rect();
  }
}

export interface ShapeGeometryPaths {
  width: number;
  height: number;
  outline: PathCommand[];
  decorations: PathCommand[][];
  /** Decoration-specific stroke overrides; unassigned paths inherit the shape's line style. */
  decorationStyles: Array<StrokeStyle | undefined>;
  /** Semantic marks that are filled even while the shape's editable fill remains transparent. */
  intrinsicFills: PathCommand[][];
  hiddenEdges: PathCommand[][];
  /** Polyhedral face-fill paths; curved solids fill the continuous outline silhouette instead. */
  visibleFaces?: Solid3DProjection['visibleFaces'];
  projection?: Solid3DProjection['metadata'];
}

export interface StructuredTableLayout {
  rowCount: number;
  rowHeight: number;
  dividerYs: number[];
  rowCenters: number[];
}

/** One shared row model aligns ER table dividers, data labels, and the header. */
export function structuredTableLayout(height: number, rowCount: number): StructuredTableLayout {
  const safeHeight = Math.max(1, n(height, 1));
  const safeRows = Math.round(clamp(n(rowCount, 2), 2, 33));
  const rowHeight = safeHeight / safeRows;
  return {
    rowCount: safeRows,
    rowHeight,
    dividerYs: Array.from({ length: safeRows - 1 }, (_, index) => rowHeight * (index + 1)),
    rowCenters: Array.from({ length: safeRows }, (_, index) => rowHeight * (index + 0.5)),
  };
}

/** Semantic fill paths share the same canonical coordinate system as outlines/decorations. */
export function buildGeometryIntrinsicFills(geometry: GeometryKind, width: number, height: number, params: Readonly<Record<string, unknown>> = {}): PathCommand[][] {
  const w = Math.max(1, n(width, 1)), h = Math.max(1, n(height, 1)), cx = w / 2, cy = h / 2;
  if (geometry === 'umlInitialState') return [buildGeometryCommands(geometry, w, h, params)];
  if (geometry === 'umlFinalState') {
    const radius = Math.min(w, h) * 0.29;
    return [ellipsePath(cx, cy, radius)];
  }
  if (geometry === 'umlFork') return [buildGeometryCommands(geometry, w, h, params)];
  return [];
}

function buildGeometryDecorationStyles(geometry: GeometryKind, count: number): Array<StrokeStyle | undefined> {
  const styles: Array<StrokeStyle | undefined> = Array.from({ length: count }, () => undefined);
  if (geometry === 'umlLifeline' || geometry === 'umlActorParticipant') styles[0] = 'dashed';
  return styles;
}

/** The one canonical path bundle consumed by the Canvas renderer, hit testing, and previews. */
export function buildShapeGeometry(
  definition: ShapeDefinition,
  width = definition.width,
  height = definition.height,
  params: Readonly<Record<string, unknown>> = definition.defaultParams ?? {},
  solidOptions?: Solid3DProjectionOptions,
): ShapeGeometryPaths {
  const safeWidth = Math.max(1, n(width, 1)), safeHeight = Math.max(1, n(height, 1));
  if (isSolid3DGeometry(definition.geometry)) {
    const projection = buildSolid3DProjection(definition.geometry, safeWidth, safeHeight, params, solidOptions);
    return { width: safeWidth, height: safeHeight, outline: projection.outline, decorations: [projection.visibleEdges],
      decorationStyles: [undefined], intrinsicFills: [], hiddenEdges: projection.hiddenEdges,
      visibleFaces: projection.visibleFaces, projection: projection.metadata };
  }
  const outline = buildGeometryCommands(definition.geometry, safeWidth, safeHeight, params);
  const decorations = buildGeometryDecorations(definition.geometry, safeWidth, safeHeight, params);
  return {
    width: safeWidth,
    height: safeHeight,
    outline,
    decorations,
    decorationStyles: buildGeometryDecorationStyles(definition.geometry, decorations.length),
    intrinsicFills: buildGeometryIntrinsicFills(definition.geometry, safeWidth, safeHeight, params),
    hiddenEdges: [],
  };
}

/** Flatten all local path subpaths with deterministic curve sampling for audits and hit geometry. */
export function flattenGeometryCommands(commands: readonly PathCommand[], steps = 12): [number, number][][] {
  const output: [number, number][][] = [];
  let path: [number, number][] = [];
  let current: [number, number] = [0, 0];
  let start: [number, number] = [0, 0];
  const safeSteps = Math.max(2, Math.min(64, Math.floor(Number.isFinite(steps) ? steps : 12)));
  const finish = () => { if (path.length) output.push(path); path = []; };
  const move = (point: [number, number]) => { finish(); path = [point]; current = point; start = point; };
  const add = (point: [number, number]) => { path.push(point); current = point; };
  for (const item of commands) {
    const [a, b, c, d, e, f, g, h] = item.values;
    if (item.op === 'moveTo') move([a, b]);
    else if (item.op === 'lineTo') add([a, b]);
    else if (item.op === 'quadraticCurveTo') {
      const from = current;
      for (let index = 1; index <= safeSteps; index++) {
        const t = index / safeSteps, inverse = 1 - t;
        add([inverse * inverse * from[0] + 2 * inverse * t * a + t * t * c,
          inverse * inverse * from[1] + 2 * inverse * t * b + t * t * d]);
      }
    } else if (item.op === 'bezierCurveTo') {
      const from = current;
      for (let index = 1; index <= safeSteps; index++) {
        const t = index / safeSteps, inverse = 1 - t;
        add([inverse ** 3 * from[0] + 3 * inverse ** 2 * t * a + 3 * inverse * t ** 2 * c + t ** 3 * e,
          inverse ** 3 * from[1] + 3 * inverse ** 2 * t * b + 3 * inverse * t ** 2 * d + t ** 3 * f]);
      }
    } else if (item.op === 'ellipse') {
      const sweep = h ? (g <= f ? g - f : g - f - Math.PI * 2) : (g >= f ? g - f : g - f + Math.PI * 2);
      const count = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI * 2) * safeSteps * 4));
      const cosine = Math.cos(e), sine = Math.sin(e);
      for (let index = 0; index <= count; index++) {
        const angle = f + sweep * index / count;
        const x = c * Math.cos(angle), y = d * Math.sin(angle);
        const point: [number, number] = [a + x * cosine - y * sine, b + x * sine + y * cosine];
        if (index === 0 && (!path.length || Math.hypot(current[0] - point[0], current[1] - point[1]) > 1e-7)) add(point);
        else if (index > 0) add(point);
      }
    } else if (item.op === 'closePath') {
      if (path.length && Math.hypot(current[0] - start[0], current[1] - start[1]) > 1e-9) add(start);
      current = start;
    }
  }
  finish();
  return output;
}

/** Preserve the definition's aspect ratio and place its canonical paths in a preview viewport. */
export function shapePreviewGeometry(
  definition: ShapeDefinition,
  viewportWidth = 28,
  viewportHeight = 22,
  params: Readonly<Record<string, unknown>> = definition.defaultParams ?? {},
): ShapeGeometryPaths {
  // Build from the same canonical native model used by the canvas. Ordinary shapes fit their
  // definition box; 3D models instead fit their true projected semantic-path bounds so projection
  // padding cannot make the thumbnail look collapsed. The 3D fit is uniform and never rolls or
  // independently stretches screen axes.
  const source = buildShapeGeometry(definition, definition.width, definition.height, params);
  let scale = Math.min(viewportWidth / Math.max(1, definition.width), viewportHeight / Math.max(1, definition.height));
  let offsetX = (viewportWidth - definition.width * scale) / 2;
  let offsetY = (viewportHeight - definition.height * scale) / 2;
  if (isSolid3DGeometry(definition.geometry)) {
    const semanticPaths = [source.outline, ...source.decorations, ...source.intrinsicFills, ...source.hiddenEdges];
    const points = semanticPaths.flatMap(commands => flattenGeometryCommands(commands, 48).flat());
    if (points.length) {
      const minX = Math.min(...points.map(point => point[0])), maxX = Math.max(...points.map(point => point[0]));
      const minY = Math.min(...points.map(point => point[1])), maxY = Math.max(...points.map(point => point[1]));
      const boundsWidth = Math.max(1e-6, maxX - minX), boundsHeight = Math.max(1e-6, maxY - minY);
      scale = Math.min(viewportWidth * 0.88 / boundsWidth, viewportHeight * 0.88 / boundsHeight);
      offsetX = (viewportWidth - boundsWidth * scale) / 2 - minX * scale;
      offsetY = (viewportHeight - boundsHeight * scale) / 2 - minY * scale;
    }
  }
  const transform = (item: PathCommand): PathCommand => {
    const values = [...item.values];
    if (item.op === 'moveTo' || item.op === 'lineTo') { values[0] = values[0] * scale + offsetX; values[1] = values[1] * scale + offsetY; }
    else if (item.op === 'quadraticCurveTo') { values[0] = values[0] * scale + offsetX; values[1] = values[1] * scale + offsetY; values[2] = values[2] * scale + offsetX; values[3] = values[3] * scale + offsetY; }
    else if (item.op === 'bezierCurveTo') { for (const index of [0, 2, 4]) values[index] = values[index] * scale + offsetX; for (const index of [1, 3, 5]) values[index] = values[index] * scale + offsetY; }
    else if (item.op === 'ellipse') { values[0] = values[0] * scale + offsetX; values[1] = values[1] * scale + offsetY; values[2] *= scale; values[3] *= scale; }
    return { op: item.op, values };
  };
  return { width: viewportWidth, height: viewportHeight, outline: source.outline.map(transform),
    decorations: source.decorations.map(path => path.map(transform)), decorationStyles: [...source.decorationStyles],
    intrinsicFills: source.intrinsicFills.map(path => path.map(transform)), hiddenEdges: source.hiddenEdges.map(path => path.map(transform)),
    ...(source.visibleFaces ? { visibleFaces: source.visibleFaces.map(face => ({ ...face, commands: face.commands.map(transform) })) } : {}),
    ...(source.projection ? { projection: source.projection } : {}) };
}

function pathSupportsCommands(path: Path2D, commands: readonly PathCommand[]): boolean {
  return commands.every(({ op }) => {
    if (op === 'moveTo') return typeof path.moveTo === 'function';
    if (op === 'lineTo') return typeof path.lineTo === 'function';
    if (op === 'quadraticCurveTo') return typeof path.quadraticCurveTo === 'function';
    if (op === 'bezierCurveTo') return typeof path.bezierCurveTo === 'function';
    if (op === 'ellipse') return typeof path.ellipse === 'function';
    return typeof path.closePath === 'function';
  });
}

export function drawPathCommands(ctx: CanvasRenderingContext2D, commands: readonly PathCommand[], path?: Path2D): Path2D | undefined {
  let result = path;
  if (!result && typeof Path2D !== 'undefined') {
    const candidate = new Path2D();
    if (pathSupportsCommands(candidate, commands)) result = candidate;
  }
  if (result && !pathSupportsCommands(result, commands)) result = undefined;
  if (!result) {
    ctx.beginPath();
    for (const item of commands) applyCommand(ctx, item);
    return undefined;
  }
  for (const item of commands) applyCommand(result, item);
  return result;
}

function applyCommand(target: Path2D | CanvasRenderingContext2D, item: PathCommand) {
  const [a, b, c, d, e, f, g, h] = item.values;
  if (item.op === 'moveTo') target.moveTo(a, b);
  else if (item.op === 'lineTo') target.lineTo(a, b);
  else if (item.op === 'quadraticCurveTo') target.quadraticCurveTo(a, b, c, d);
  else if (item.op === 'bezierCurveTo') target.bezierCurveTo(a, b, c, d, e, f);
  else if (item.op === 'ellipse') target.ellipse(a, b, c, d, e, f, g, Boolean(h));
  else target.closePath();
}

export function geometryCommandsToSvg(commands: readonly PathCommand[]): string {
  const output: string[] = [];
  const cubicEllipse = (cx: number, cy: number, rx: number, ry: number, rotation: number, start: number, end: number, anticlockwise: boolean) => {
    let sweep = end - start;
    if (anticlockwise && sweep > 0) sweep -= Math.PI * 2;
    if (!anticlockwise && sweep < 0) sweep += Math.PI * 2;
    const segments = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2)));
    const delta = sweep / segments;
    const cosR = Math.cos(rotation), sinR = Math.sin(rotation);
    const point = (angle: number, scale = 1) => {
      const x = rx * Math.cos(angle) * scale, y = ry * Math.sin(angle) * scale;
      return [cx + x * cosR - y * sinR, cy + x * sinR + y * cosR];
    };
    for (let index = 0; index < segments; index++) {
      const a0 = start + delta * index, a1 = a0 + delta;
      const k = 4 / 3 * Math.tan((a1 - a0) / 4);
      const p0 = point(a0), p3 = point(a1);
      const p1 = point(a0, 1); const p2 = point(a1, 1);
      const tangent0 = [-rx * Math.sin(a0) * cosR - ry * Math.cos(a0) * sinR, -rx * Math.sin(a0) * sinR + ry * Math.cos(a0) * cosR];
      const tangent1 = [-rx * Math.sin(a1) * cosR - ry * Math.cos(a1) * sinR, -rx * Math.sin(a1) * sinR + ry * Math.cos(a1) * cosR];
      output.push(`C ${p0[0] + tangent0[0] * k} ${p0[1] + tangent0[1] * k} ${p3[0] - tangent1[0] * k} ${p3[1] - tangent1[1] * k} ${p3[0]} ${p3[1]}`);
      void p1; void p2;
    }
  };
  for (const item of commands) {
    const [a, b, c, d, e, f, g, h] = item.values;
    switch (item.op) {
      case 'moveTo': output.push(`M ${a} ${b}`); break;
      case 'lineTo': output.push(`L ${a} ${b}`); break;
      case 'quadraticCurveTo': output.push(`Q ${a} ${b} ${c} ${d}`); break;
      case 'bezierCurveTo': output.push(`C ${a} ${b} ${c} ${d} ${e} ${f}`); break;
      case 'ellipse': {
        const endPoint = (angle: number) => [a + c * Math.cos(angle) * Math.cos(e) - d * Math.sin(angle) * Math.sin(e), b + c * Math.cos(angle) * Math.sin(e) + d * Math.sin(angle) * Math.cos(e)];
        const point = endPoint(f);
        output.push(`M ${point[0]} ${point[1]}`);
        cubicEllipse(a, b, c, d, e, f, g, Boolean(h));
        break;
      }
      case 'closePath': output.push('Z'); break;
    }
  }
  return output.join(' ');
}

export function shapePreviewPath(definition: ShapeDefinition, width = 28, height = 22, params: Readonly<Record<string, unknown>> = definition.defaultParams ?? {}): string {
  return geometryCommandsToSvg(shapePreviewGeometry(definition, width, height, params).outline);
}

export function geometryUsesFill(geometry: GeometryKind): boolean {
  return !['actor', 'umlActorParticipant', 'umlDestroy', 'annotation', 'umlLifeline', 'umlRole', 'umlRequiredInterface'].includes(geometry);
}

/** Additional native Canvas paths reused by semantic families (not duplicated per shape id). */
export function buildGeometryDecorations(geometry: GeometryKind, width: number, height: number, params: Readonly<Record<string, unknown>> = {}, solidOptions?: Solid3DProjectionOptions): PathCommand[][] {
  const w = Math.max(1, n(width, 1)), h = Math.max(1, n(height, 1)), cx = w / 2, cy = h / 2;
  if (isSolid3DGeometry(geometry)) return [buildSolid3DProjection(geometry, w, h, params, solidOptions).visibleEdges];
  const path = (...items: PathCommand[]) => items;
  const line = (x1: number, y1: number, x2: number, y2: number) => path(command('moveTo', x1, y1), command('lineTo', x2, y2));
  const result: PathCommand[][] = [];
  if (geometry === 'cylinder' || geometry === 'dataStore') {
    const cap = Math.min(h * 0.20, w * 0.22);
    result.push([command('moveTo', 0, cap), command('bezierCurveTo', 0, cap * 2, w, cap * 2, w, cap)]);
    result.push([command('moveTo', 0, h - cap), command('bezierCurveTo', 0, h - cap * 0.2, w, h - cap * 0.2, w, h - cap)]);
  }
  if (geometry === 'magneticDisk') {
    const rx = w * 0.40, ry = h * 0.13, topY = h * 0.30;
    result.push(ellipsePath(cx, topY, rx, ry));
    result.push([command('moveTo', w * 0.10, h * 0.52), command('bezierCurveTo', w * 0.10, h * 0.68, w * 0.90, h * 0.68, w * 0.90, h * 0.52)]);
    result.push([command('moveTo', w * 0.10, h * 0.64), command('bezierCurveTo', w * 0.10, h * 0.80, w * 0.90, h * 0.80, w * 0.90, h * 0.64)]);
  }
  if (geometry === 'internalStorage') {
    result.push(line(w * 0.26, 0, w * 0.26, h));
    result.push(line(w * 0.26, h * 0.24, w, h * 0.24));
  }
  if (geometry === 'predefinedProcess') {
    result.push(line(w * 0.12, 0, w * 0.12, h));
    result.push(line(w * 0.88, 0, w * 0.88, h));
  }
  if (geometry === 'frame' && params.componentGlyph === true) {
    result.push(line(w * 0.12, h * 0.38, w * 0.12, h * 0.62));
    result.push(line(w * 0.12, h * 0.38, w * 0.24, h * 0.38));
    result.push(line(w * 0.12, h * 0.62, w * 0.24, h * 0.62));
  }
  if (geometry === 'table') {
    const requestedRows = Math.round(clamp(n(params.rowCount, 0), 0, 32));
    const compartments = Math.round(clamp(n(params.compartments, 2), 1, 5));
    const rowCount = requestedRows >= 2 ? requestedRows : compartments;
    const layout = structuredTableLayout(h, Math.max(2, rowCount));
    layout.dividerYs.forEach(y => result.push(line(0, y, w, y)));
    if (params.keyColumns) result.push(line(w * 0.20, 0, w * 0.20, h));
  }
  if (geometry === 'column') result.push(line(w * 0.32, 0, w * 0.32, h));
  if (geometry === 'pool') result.push(line(w * 0.13, 0, w * 0.13, h));
  if (geometry === 'lane') result.push(line(w * 0.15, 0, w * 0.15, h));
  if (geometry === 'activityPartition') result.push(line(0, h * 0.24, w, h * 0.24));
  if (geometry === 'umlLifeline') result.push(line(cx, h * 0.22, cx, h));
  if (geometry === 'umlActorParticipant') result.push(line(cx, h * 0.42, cx, h));
  if (geometry === 'umlCompositeState') {
    const inset = Math.min(w, h) * 0.14;
    result.push(line(inset, h * 0.29, w - inset, h * 0.29));
  }
  if (geometry === 'umlExitPoint') {
    const radius = Math.min(w, h) * 0.25;
    result.push(line(cx - radius * 0.52, cy - radius * 0.52, cx + radius * 0.52, cy + radius * 0.52));
    result.push(line(cx + radius * 0.52, cy - radius * 0.52, cx - radius * 0.52, cy + radius * 0.52));
  }
  if (geometry === 'summingJunction') {
    const radius = Math.min(w, h) * 0.24;
    result.push(line(cx - radius, cy, cx + radius, cy));
    result.push(line(cx, cy - radius, cx, cy + radius));
  }
  if (geometry === 'bpmnEvent') {
    const marker = String(params.marker ?? 'none');
    if (params.eventKind === 'intermediate') {
      const radius = Math.min(w, h) * 0.39;
      result.push(ellipsePath(cx, cy, radius));
    }
    if (marker === 'message') {
      const r = Math.min(w, h) * 0.25;
      result.push(poly([[cx - r, cy - r * 0.55], [cx + r, cy - r * 0.55], [cx + r, cy + r * 0.55], [cx - r, cy + r * 0.55]]));
      result.push(line(cx - r, cy - r * 0.55, cx, cy + r * 0.04));
      result.push(line(cx + r, cy - r * 0.55, cx, cy + r * 0.04));
    } else if (marker === 'timer') {
      const r = Math.min(w, h) * 0.24;
      result.push(ellipsePath(cx, cy, r));
      result.push(line(cx, cy, cx, cy - r * 0.62)); result.push(line(cx, cy, cx + r * 0.5, cy));
    } else if (marker === 'error') {
      result.push(poly([[cx - w * 0.08, cy - h * 0.28], [cx + w * 0.10, cy - h * 0.05], [cx, cy - h * 0.03], [cx + w * 0.08, cy + h * 0.28], [cx - w * 0.10, cy + h * 0.04], [cx, cy + h * 0.03]]));
    } else if (marker === 'signal') {
      result.push(poly([[cx, cy - h * 0.27], [cx + w * 0.24, cy + h * 0.20], [cx - w * 0.24, cy + h * 0.20]]));
    }
  }
  if (geometry === 'bpmnTask') {
    const marker = String(params.taskMarker ?? '');
    const x = w * 0.11, y = h * 0.13, s = Math.min(w, h) * 0.20;
    if (marker === 'user') {
      result.push([command('moveTo', x + s / 2, y + s * 0.24), command('ellipse', x + s / 2, y + s * 0.24, s * 0.22, s * 0.22, 0, 0, Math.PI * 2, 0), command('closePath')]);
      result.push(line(x + s * 0.12, y + s * 0.92, x + s * 0.88, y + s * 0.92));
      result.push([command('moveTo', x + s * 0.12, y + s * 0.92), command('quadraticCurveTo', x + s / 2, y + s * 0.42, x + s * 0.88, y + s * 0.92)]);
    } else if (marker === 'manual') {
      result.push(line(x, y + s * 0.78, x + s, y + s * 0.18));
      result.push(line(x + s * 0.1, y + s * 0.2, x + s * 0.88, y + s * 0.2));
    } else if (marker === 'service') {
      result.push(ellipsePath(x + s / 2, y + s / 2, s * 0.3));
      for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4;
        result.push(line(x + s / 2 + Math.cos(a) * s * 0.34, y + s / 2 + Math.sin(a) * s * 0.34,
          x + s / 2 + Math.cos(a) * s * 0.48, y + s / 2 + Math.sin(a) * s * 0.48));
      }
    } else if (marker === 'script' || marker === 'rule') {
      result.push(poly([[x, y], [x + s * 0.68, y], [x + s, y + s * 0.30], [x + s, y + s], [x, y + s]]));
      result.push(line(x + s * 0.16, y + s * 0.53, x + s * 0.82, y + s * 0.53));
      result.push(line(x + s * 0.16, y + s * 0.76, x + s * 0.72, y + s * 0.76));
    } else if (marker === 'receive' || marker === 'send') {
      result.push(poly([[x, y + s * 0.2], [x + s, y + s * 0.2], [x + s, y + s * 0.82], [x, y + s * 0.82]]));
      result.push(line(x, y + s * 0.2, x + s / 2, y + s * 0.58));
      result.push(line(x + s, y + s * 0.2, x + s / 2, y + s * 0.58));
    }
    if (params.subprocess === true) {
      const px = cx, py = h * 0.88, r = Math.min(w, h) * 0.06;
      result.push(line(px - r, py, px + r, py)); result.push(line(px, py - r, px, py + r));
    }
  }
  if (geometry === 'bpmnGateway') {
    const marker = String(params.gatewayMarker ?? 'x'), r = Math.min(w, h) * 0.22;
    if (marker === 'x') { result.push(line(cx - r, cy - r, cx + r, cy + r)); result.push(line(cx + r, cy - r, cx - r, cy + r)); }
    else if (marker === 'plus') { result.push(line(cx - r, cy, cx + r, cy)); result.push(line(cx, cy - r, cx, cy + r)); }
    else if (marker === 'circle') result.push(ellipsePath(cx, cy, r));
    else if (marker === 'event') result.push(poly(Array.from({ length: 5 }, (_, index): [number, number] => {
      const angle = -Math.PI / 2 + index * Math.PI * 2 / 5;
      return [cx + Math.cos(angle) * r, cy + Math.sin(angle) * r];
    })));
  }
  if (geometry === 'extract' || geometry === 'merge' || geometry === 'collate') result.push(line(0, h * 0.68, w, h * 0.68));
  if (geometry === 'sort') result.push(line(w * 0.25, cy, w * 0.75, cy));
  if (geometry === 'annotation') result.push(line(w * 0.22, h * 0.18, w, h * 0.18));
  if (geometry === 'dataObject') {
    if (params.messageEnvelope === true) {
      result.push(line(0, 0, cx, h * 0.62)); result.push(line(w, 0, cx, h * 0.62));
    } else {
      const fold = Math.min(w, h) * 0.20;
      result.push(line(w - fold, 0, w - fold, fold)); result.push(line(w - fold, fold, w, fold));
    }
  }
  if (geometry === 'ellipse' && params.underline === true) {
    const halfWidth = Math.min(w * 0.12, h * 0.40), y = cy + h * 0.16;
    result.push(line(cx - halfWidth, y, cx + halfWidth, y));
  }
  if (params.doubleBorder === true || params.innerDiamond === true) {
    if (geometry === 'diamond') {
      const inset = Math.min(w, h) * 0.15;
      result.push(poly([[cx, inset], [w - inset, cy], [cx, h - inset], [inset, cy]]));
    } else if (geometry === 'ellipse' || geometry === 'useCase') {
      const inset = Math.min(w, h) * 0.10;
      result.push(ellipsePath(cx, cy, Math.max(0.5, w / 2 - inset), Math.max(0.5, h / 2 - inset)));
    } else {
      const inset = Math.min(w, h) * 0.08;
      result.push(poly([[inset, inset], [w - inset, inset], [w - inset, h - inset], [inset, h - inset]]));
    }
  }
  return result;
}

export function buildGeometryHiddenEdges(geometry: GeometryKind, width: number, height: number, params: Readonly<Record<string, unknown>> = {}): PathCommand[][] {
  return isSolid3DGeometry(geometry) ? buildSolid3DProjection(geometry, width, height, params).hiddenEdges : [];
}

export function shapeDecorationSvgPaths(definition: ShapeDefinition, width = 28, height = 22, params: Readonly<Record<string, unknown>> = definition.defaultParams ?? {}): string[] {
  return shapePreviewGeometry(definition, width, height, params).decorations.map(geometryCommandsToSvg);
}

export function shapeHiddenEdgeSvgPaths(definition: ShapeDefinition, width = 28, height = 22, params: Readonly<Record<string, unknown>> = definition.defaultParams ?? {}): string[] {
  return shapePreviewGeometry(definition, width, height, params).hiddenEdges.map(geometryCommandsToSvg);
}
