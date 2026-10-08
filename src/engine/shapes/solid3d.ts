import type { PathCommand } from './types';

export type Solid3DGeometry = 'cube3d' | 'cuboid3d' | 'cylinder3d' | 'cone3d' | 'sphere3d' | 'pyramid3d'
  | 'tetrahedron3d' | 'rightTetrahedron3d' | 'octahedron3d' | 'triangularPrism3d' | 'quadrilateralPrism3d'
  | 'pentagonalPrism3d' | 'hexagonalPrism3d' | 'squarePrism3d' | 'pentagonalPyramid3d' | 'hexagonalPyramid3d'
  | 'quadrilateralPyramid3d' | 'pyramidFrustum3d' | 'coneFrustum3d'
  | 'rightQuadrilateralPyramid3d' | 'rightTrapezoidPyramid3d' | 'rightTrapezoidPerpendicularPyramid3d';
export type Solid3DRotationAxis = 'rotationX' | 'rotationY' | 'rotationZ';
export interface Solid3DScale { x: number; y: number; z: number; }
export interface Solid3DProjectionOptions {
  /** Object-space scale is applied to each local vertex before Euler rotation. */
  scale?: Solid3DScale;
  /** Fixed calibration dimensions keep resizing from being cancelled by viewport auto-fit. */
  referenceWidth?: number;
  referenceHeight?: number;
  /** Local 2D location of the model origin in the path's output frame. */
  center?: { x: number; y: number };
}
type Vec3 = [number, number, number];
type Vec2 = [number, number];
const radians = (degrees: number) => degrees * Math.PI / 180;
interface Mesh { vertices: Vec3[]; faces: number[][]; }
interface CurveSplit { visible: PathCommand[]; hidden: PathCommand[][]; visibleKeys: string[]; hiddenKeys: string[]; }
export interface Solid3DProjectedFace { key: string; commands: PathCommand[]; depth: number; }
export interface Solid3DModelVertex { local: Vec3; transformed: Vec3; projected: Vec2; }
export interface Solid3DModelFace { key: string; vertices: number[]; normal: Vec3; depth: number; visible: boolean; }
export interface Solid3DModelEdge { key: string; a: number; b: number; faces: number[]; depth: number; visibility: 'visible' | 'hidden' | 'silhouette'; semantic: boolean; }
export interface Solid3DModel { vertices: Solid3DModelVertex[]; faces: Solid3DModelFace[]; edges: Solid3DModelEdge[]; }

// One coherent orthographic axonometric camera. The model is Z-up: its view direction has a
// 45° azimuth in the horizontal XY plane and a 30° elevation. Screen-right and screen-up are
// derived from +Z so the camera has no roll, +Z projects vertically, and X/Y remain oblique.
export const SOLID3D_CAMERA_AZIMUTH_DEGREES = 45;
export const SOLID3D_CAMERA_ELEVATION_DEGREES = 30;
const CAMERA_AZIMUTH = SOLID3D_CAMERA_AZIMUTH_DEGREES * Math.PI / 180;
const CAMERA_ELEVATION = SOLID3D_CAMERA_ELEVATION_DEGREES * Math.PI / 180;
const CAMERA_RIGHT: Vec3 = [Math.cos(CAMERA_AZIMUTH), Math.sin(CAMERA_AZIMUTH), 0];
const CAMERA_FORWARD: Vec3 = [Math.cos(CAMERA_ELEVATION) * Math.sin(CAMERA_AZIMUTH),
  -Math.cos(CAMERA_ELEVATION) * Math.cos(CAMERA_AZIMUTH), Math.sin(CAMERA_ELEVATION)];
const CAMERA_UP: Vec3 = [-Math.sin(CAMERA_ELEVATION) * Math.sin(CAMERA_AZIMUTH),
  Math.sin(CAMERA_ELEVATION) * Math.cos(CAMERA_AZIMUTH), Math.cos(CAMERA_ELEVATION)];
// The two orthographic screen basis rows are orthonormal, so their maximum singular value is 1.
const PROJECTION_MAX_STRETCH = 1;
export const SOLID3D_CANONICAL_CUBOID_ROLL_DEGREES = 0;
export const SOLID3D_CANONICAL_CUBE_ROTATION_X_DEGREES = 0;
// Shape Picker definition parameters remain neutral; CanvasEngine applies this explicit initial
// local yaw to newly-created board objects so the main canvas shows three actual model faces.
export const SOLID3D_CANVAS_INITIAL_YAW_DEGREES = 0;
export const SOLID3D_POSE_VERSION = 2;
export const SOLID3D_CANONICAL_CUBE_ROTATION_Y_DEGREES = 0;
export const SOLID3D_CANONICAL_CUBE_ROTATION_Z_DEGREES = 0;
const canonicalPolygonPhase = (sides: number) => Math.PI / 2 - Math.PI / Math.max(3, sides);

/**
 * Canonical local 3D convention for model geometry, controls and persisted params:
 * +X is width, +Y is depth, and +Z is height/world-up. Every mesh is authored about its
 * documented, stable local origin; its model vertices, renderer paths, hit geometry and gizmo
 * pivot all use that same origin. Screen coordinates are dot(P,cameraRight) and -dot(P,cameraUp);
 * depth and face visibility use the same forward vector. The orthographic basis is derived from
 * world-up +Z, a 45° azimuth in XY and 30° elevation, so +Z remains screen-vertical without camera
 * roll. Angles are degrees; scale precedes the intrinsic Euler transform M = Rx * Ry * Rz. The
 * board's 2D `rotation` remains an independent outer transform about the model origin.
 */
export const SOLID3D_LOCAL_ORIGIN_DESCRIPTIONS: Readonly<Record<Solid3DGeometry, string>> = Object.freeze({
  cube3d: 'geometric center of the equal-edge cube',
  cuboid3d: 'geometric center of the rectangular prism',
  cylinder3d: 'midpoint between the two XY base centers on the local Z axis',
  cone3d: 'midpoint between the XY base center and the local-Z apex',
  coneFrustum3d: 'midpoint between the two XY base centers on the local Z axis',
  sphere3d: 'geometric center of the sphere',
  pyramid3d: 'mid-height point above the XY base centroid; apex offsets do not move the origin',
  tetrahedron3d: 'volume centroid of the regular tetrahedron',
  rightTetrahedron3d: 'volume centroid of the trirectangular tetrahedron',
  octahedron3d: 'geometric center of the octahedron',
  triangularPrism3d: 'midpoint between the two XY triangular-base centroids',
  quadrilateralPrism3d: 'midpoint between the two XY irregular-quadrilateral base centroids',
  pentagonalPrism3d: 'midpoint between the two XY pentagonal-base centroids',
  hexagonalPrism3d: 'midpoint between the two XY hexagonal-base centroids',
  squarePrism3d: 'midpoint between the two XY square-base centroids',
  pentagonalPyramid3d: 'mid-height point above the XY base centroid; apex offsets do not move the origin',
  hexagonalPyramid3d: 'mid-height point above the XY base centroid; apex offsets do not move the origin',
  quadrilateralPyramid3d: 'mid-height point above the irregular XY base area centroid; apex offsets do not move the origin',
  rightQuadrilateralPyramid3d: 'mid-height point above the rectangular XY base centroid',
  rightTrapezoidPyramid3d: 'mid-height point above the right-trapezoid XY base area centroid',
  rightTrapezoidPerpendicularPyramid3d: 'mid-height point above the right-trapezoid XY base area centroid; one lateral edge is the local-Z perpendicular from base vertex A',
  pyramidFrustum3d: 'midpoint between the two XY polygon-base centroids on the local Z axis',
});

export const SOLID3D_COORDINATE_CONVENTION = Object.freeze({
  axes: Object.freeze({ x: 'local width axis', y: 'local depth axis', z: 'local height/world-up axis' }),
  worldUp: Object.freeze([0, 0, 1]),
  cameraRight: Object.freeze([...CAMERA_RIGHT]),
  cameraUp: Object.freeze([...CAMERA_UP]),
  camera: 'orthographic; worldUp=+Z; azimuth=45 degrees in XY; elevation=30 degrees; no camera roll; projected world Z remains vertical',
  projection: 'dot(P,cameraRight), -dot(P,cameraUp) with an orthonormal screen basis derived from world-up +Z',
  viewDirection: Object.freeze([...CAMERA_FORWARD]),
  rotationOrder: 'scale, then local Euler X/Y/Z; point matrix Rx * Ry * Rz (apply local Z, then Y, then X); translate in board space after projection',
  angleUnit: 'degrees',
  depth: 'normalized local axial/extrusion extent; independent of canvas width and height',
  localOrigin: 'the origin is [0,0,0] in every authored mesh; the per-solid anchor is documented by SOLID3D_LOCAL_ORIGIN_DESCRIPTIONS and is never inferred from projected or axis-aligned bounds',
  planarRotation: 'independent DiagramShapeObject.rotation about the model origin',
  defaultCanvasPose: 'neutral local Euler pose; +X width, +Y depth, +Z height/world-up; the no-roll orthographic camera projects X/Y obliquely and Z vertically; board-plane rotation remains independent',
  orientationScale: 'fixed by the unrotated model radius and fixed projection; no per-orientation re-fit',
});

export interface Solid3DProjectedAxis {
  axis: Solid3DRotationAxis;
  label: 'X' | 'Y' | 'Z';
  /** Oriented and projected direction before scaling into UI pixels. */
  x: number;
  y: number;
  cameraDepth: number;
}

export interface Solid3DRotationFrame {
  axis: Solid3DRotationAxis;
  label: 'X' | 'Y' | 'Z';
  /** Positive derivative axis for the matching persisted Euler parameter. */
  direction: [number, number, number];
  /** Right-handed orthonormal basis for the parameter's actual rotation plane. */
  planeU: [number, number, number];
  planeV: [number, number, number];
}

export interface Solid3DProjection {
  /** Projected boundary used for selection and hit geometry; not a substitute for face fills. */
  outline: PathCommand[];
  /** Actual visible geometric edges/curves only; smooth solids are represented semantically. */
  visibleEdges: PathCommand[];
  /** Actual hidden geometric edge/curve runs only; every run is rendered dashed. */
  hiddenEdges: PathCommand[][];
  /** Depth-sorted projected faces for polyhedral fills only; curved solids fill one silhouette instead. */
  visibleFaces: Solid3DProjectedFace[];
  /** The same scaled/rotated mesh that generated the projected result. */
  model: Solid3DModel;
  metadata: {
    geometry: Solid3DGeometry;
    rotationX: number;
    rotationY: number;
    rotationZ: number;
    depth: number;
    visibleFaceCount: number;
    visibleEdgeCount: number;
    hiddenEdgeCount: number;
    projectedScale: number;
    visibleEdgeKeys: string[];
    hiddenEdgeKeys: string[];
    projectedBounds: { minX: number; minY: number; maxX: number; maxY: number };
    coordinateConvention: typeof SOLID3D_COORDINATE_CONVENTION;
  };
}

const command = (op: PathCommand['op'], ...values: number[]): PathCommand => ({ op, values });
const numberParam = (params: Readonly<Record<string, unknown>>, key: string, fallback: number, min: number, max: number) => {
  const value = params[key];
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
};
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const subtract = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const length3 = (point: Vec3) => Math.hypot(point[0], point[1], point[2]);
const normalize3 = (point: Vec3): Vec3 => {
  const length = Math.max(1e-12, length3(point));
  return [point[0] / length, point[1] / length, point[2] / length];
};

/** Orthographic projection of an already rotated model-space vector, in screen-right/down axes. */
export function projectSolid3DVector(point: readonly [number, number, number]): [number, number] {
  return [dot(point as Vec3, CAMERA_RIGHT), -dot(point as Vec3, CAMERA_UP)];
}

/** Signed depth along the camera's coherent forward axis; positive means toward the viewer. */
export function solid3DCameraDepth(point: readonly [number, number, number]): number {
  return dot(point as Vec3, CAMERA_FORWARD);
}

/** A unit box mesh; semantic dimensions are supplied by the pre-rotation local scale. */
function boxMesh(): Mesh {
  return { vertices: [
    [-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5],
    [-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5],
  ], faces: [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [3, 7, 6, 2], [0, 4, 7, 3], [1, 2, 6, 5]] };
}

function regularPrismMesh(sides: number, depth: number, phase = canonicalPolygonPhase(sides), radius = 0.5): Mesh {
  const safeSides = Math.round(Math.max(3, Math.min(32, sides)));
  // Bases lie in local XY and the extrusion runs along local Z. The negated section Y keeps the
  // canonical polygon phase consistent with the former right-handed Y-up mesh after coordinate migration.
  const section: Vec2[] = Array.from({ length: safeSides }, (_, index) => {
    const angle = phase + index * Math.PI * 2 / safeSides;
    return [Math.cos(angle) * radius, -Math.sin(angle) * radius];
  });
  const top: Vec3[] = section.map(([x, y]) => [x, y, depth / 2]);
  const bottom: Vec3[] = section.map(([x, y]) => [x, y, -depth / 2]);
  const faces: number[][] = [Array.from({ length: safeSides }, (_, index) => index),
    Array.from({ length: safeSides }, (_, index) => safeSides + (safeSides - 1 - index))];
  for (let index = 0; index < safeSides; index++) {
    const next = (index + 1) % safeSides;
    faces.push([index, next, safeSides + next, safeSides + index]);
  }
  return { vertices: [...top, ...bottom], faces };
}

/** A fixed, genuinely irregular convex quadrilateral, centered at its area centroid. */
const IRREGULAR_QUADRILATERAL_BASE: readonly Vec2[] = Object.freeze([
  [-0.526110007, -0.394284480], [0.301987325, -0.387993574],
  [0.367275621, 0.283740747], [0.012144288, 0.621399376],
]);

function convexQuadrilateralSection(): Vec2[] {
  return IRREGULAR_QUADRILATERAL_BASE.map(([x, y]) => [x, y]);
}

function convexQuadrilateralPrismMesh(depth: number): Mesh {
  const section = convexQuadrilateralSection();
  const top = section.map(([x, y]): Vec3 => [x, y, depth / 2]);
  const bottom = section.map(([x, y]): Vec3 => [x, y, -depth / 2]);
  const faces: number[][] = [[0, 1, 2, 3], [7, 6, 5, 4]];
  for (let index = 0; index < 4; index++) {
    const next = (index + 1) % 4;
    faces.push([index, next, 4 + next, 4 + index]);
  }
  return { vertices: [...top, ...bottom], faces };
}

function convexQuadrilateralPyramidMesh(depth: number, apexOffsetX: number, apexOffsetY: number): Mesh {
  const halfHeight = Math.max(0.15, Math.min(2.5, depth)) / 2;
  const section = convexQuadrilateralSection();
  const base: Vec3[] = section.map(([x, y]) => [x, y, -halfHeight]);
  // The local XY base is fixed and remains centered at its true area centroid. The apex offset
  // changes only the apex; the stable origin stays halfway up from the base centroid.
  const apex: Vec3 = [numberParam({ apexOffsetX }, 'apexOffsetX', 0, -1, 1) * 0.5,
    numberParam({ apexOffsetY }, 'apexOffsetY', 0, -1, 1) * 0.5, halfHeight];
  return { vertices: [...base, apex], faces: [[3, 2, 1, 0], [0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]] };
}


/** A fixed right trapezoid: AB ∥ CD and AD ⟂ AB/CD; its area centroid is recentered at XY origin. */
const RIGHT_TRAPEZOID_BASE_RAW: readonly Vec2[] = Object.freeze([
  [-0.6, -0.4], [0.6, -0.4], [0.2, 0.4], [-0.6, 0.4],
]);

function recenterPolygonAtAreaCentroid(section: readonly Vec2[]): Vec2[] {
  let twiceArea = 0, centroidX6Area = 0, centroidY6Area = 0;
  for (let index = 0; index < section.length; index++) {
    const [x0, y0] = section[index], [x1, y1] = section[(index + 1) % section.length];
    const cross = x0 * y1 - x1 * y0;
    twiceArea += cross;
    centroidX6Area += (x0 + x1) * cross;
    centroidY6Area += (y0 + y1) * cross;
  }
  if (Math.abs(twiceArea) < 1e-10) throw new Error('Pyramid base must have non-zero area');
  const centroid: Vec2 = [centroidX6Area / (3 * twiceArea), centroidY6Area / (3 * twiceArea)];
  return section.map(([x, y]) => [x - centroid[0], y - centroid[1]]);
}

function rightTrapezoidSection(): Vec2[] {
  return recenterPolygonAtAreaCentroid(RIGHT_TRAPEZOID_BASE_RAW);
}

function quadrilateralPyramidMesh(depth: number, section: readonly Vec2[], apexProjection: Vec2): Mesh {
  const halfHeight = Math.max(0.15, Math.min(2.5, depth)) / 2;
  const base: Vec3[] = section.map(([x, y]) => [x, y, -halfHeight]);
  const apex: Vec3 = [apexProjection[0], apexProjection[1], halfHeight];
  return { vertices: [...base, apex], faces: [[3, 2, 1, 0], [0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]] };
}

/** Rectangular-base right pyramid: the local-Z altitude is perpendicular to the rectangle. */
function rightQuadrilateralPyramidMesh(depth: number): Mesh {
  const rectangularBase: readonly Vec2[] = [
    [-0.5, -0.4], [0.5, -0.4], [0.5, 0.4], [-0.5, 0.4],
  ];
  return quadrilateralPyramidMesh(depth, rectangularBase, [0, 0]);
}

/** The apex projection is above the right-trapezoid area centroid; no lateral edge is vertical. */
function rightTrapezoidPyramidMesh(depth: number): Mesh {
  return quadrilateralPyramidMesh(depth, rightTrapezoidSection(), [0, 0]);
}

/** Apex is above base vertex A, making exactly lateral edge A→apex perpendicular to the XY base. */
function rightTrapezoidPerpendicularPyramidMesh(depth: number): Mesh {
  const section = rightTrapezoidSection();
  return quadrilateralPyramidMesh(depth, section, section[0]);
}

function regularPyramidMesh(
  sides: number, depth: number, radius = 0.5, phase = canonicalPolygonPhase(sides), apexOffsetX = 0, apexOffsetY = 0,
): Mesh {
  const safeSides = Math.round(Math.max(3, Math.min(32, sides)));
  // `depth` is the apex-to-base height along local Z. The base is in XY and offsets move only
  // the apex within that base plane; neither parameter changes the declared mid-height origin.
  const halfHeight = Math.max(0.15, Math.min(2.5, depth)) / 2;
  const vertices: Vec3[] = Array.from({ length: safeSides }, (_, index) => {
    const angle = phase + index * Math.PI * 2 / safeSides;
    return [Math.cos(angle) * radius, -Math.sin(angle) * radius, -halfHeight];
  });
  const apex = vertices.length;
  vertices.push([apexOffsetX, apexOffsetY, halfHeight]);
  const faces: number[][] = [Array.from({ length: safeSides }, (_, index) => safeSides - 1 - index)];
  for (let index = 0; index < safeSides; index++) faces.push([index, (index + 1) % safeSides, apex]);
  return { vertices, faces };
}

function pyramidFrustumMesh(sides: number, depth: number, topRatio: number, radius = 0.5, phase = canonicalPolygonPhase(sides)): Mesh {
  const safeSides = Math.round(Math.max(3, Math.min(32, sides)));
  const halfHeight = Math.max(0.15, Math.min(2.5, depth)) / 2;
  const base: Vec3[] = Array.from({ length: safeSides }, (_, index) => {
    const angle = phase + index * Math.PI * 2 / safeSides;
    return [Math.cos(angle) * radius, -Math.sin(angle) * radius, -halfHeight];
  });
  const top: Vec3[] = Array.from({ length: safeSides }, (_, index) => {
    const angle = phase + index * Math.PI * 2 / safeSides;
    return [Math.cos(angle) * radius * topRatio, -Math.sin(angle) * radius * topRatio, halfHeight];
  });
  const faces: number[][] = [Array.from({ length: safeSides }, (_, index) => safeSides - 1 - index),
    Array.from({ length: safeSides }, (_, index) => safeSides + index)];
  for (let index = 0; index < safeSides; index++) {
    const next = (index + 1) % safeSides;
    faces.push([index, next, safeSides + next, safeSides + index]);
  }
  return { vertices: [...base, ...top], faces };
}

/** Regular tetrahedron with a horizontal equilateral XY base and local +Z apex. */
function tetrahedronMesh(heightRatio: number): Mesh {
  const radius = 1 / Math.sqrt(3), height = Math.sqrt(2 / 3) * Math.max(0.15, Math.min(2.5, heightRatio));
  const baseZ = -height / 4, apexZ = 3 * height / 4, phase = canonicalPolygonPhase(3);
  const vertices: Vec3[] = Array.from({ length: 3 }, (_, index) => {
    const angle = phase + index * Math.PI * 2 / 3;
    return [Math.cos(angle) * radius, -Math.sin(angle) * radius, baseZ];
  });
  vertices.push([0, 0, apexZ]);
  return { vertices, faces: [[0, 2, 1], [0, 1, 3], [1, 2, 3], [2, 0, 3]] };
}

/**
 * Trirectangular tetrahedron: three pairwise-perpendicular legs meet at one lower base vertex.
 * Two legs lie in the XY base; the editable heightRatio is the perpendicular +Z altitude
 * relative to either unit base leg. The mesh is translated so its volume centroid is the origin.
 */
function rightTetrahedronMesh(heightRatio: number): Mesh {
  const legX = 1, legY = 1, legZ = Math.max(0.2, Math.min(2, heightRatio));
  const uncentered: Vec3[] = [
    [legX / 2, -legY / 2, 0],               // right-angle vertex A
    [-legX / 2, -legY / 2, 0],              // A→B: -X
    [legX / 2, legY / 2, 0],                // A→C: +Y
    [legX / 2, -legY / 2, legZ],            // A→D: +Z, perpendicular altitude
  ];
  const centroid = uncentered.reduce<Vec3>((sum, vertex) => [
    sum[0] + vertex[0] / uncentered.length,
    sum[1] + vertex[1] / uncentered.length,
    sum[2] + vertex[2] / uncentered.length,
  ], [0, 0, 0]);
  const vertices = uncentered.map(vertex => subtract(vertex, centroid));
  return { vertices, faces: [[0, 2, 1], [0, 1, 3], [1, 2, 3], [2, 0, 3]] };
}

function octahedronMesh(depth: number): Mesh {
  const radius = 0.5;
  // The legacy fixed `depth` parameter now scales local Y after the Y-up→Z-up basis conversion.
  return { vertices: [[radius, 0, 0], [-radius, 0, 0], [0, 0, radius], [0, 0, -radius],
      [0, -radius * depth, 0], [0, radius * depth, 0]],
    faces: [[2, 0, 4], [2, 4, 1], [2, 1, 5], [2, 5, 0], [3, 4, 0], [3, 1, 4], [3, 5, 1], [3, 0, 5]] };
}

export function solid3DScaleFromBounds(width: number, height: number, referenceWidth: number, referenceHeight: number, geometry?: Solid3DGeometry): Solid3DScale {
  const sx = Math.max(0.01, Math.min(64, (Number.isFinite(width) ? width : referenceWidth) / Math.max(1, referenceWidth)));
  const sz = Math.max(0.01, Math.min(64, (Number.isFinite(height) ? height : referenceHeight) / Math.max(1, referenceHeight)));
  // Legacy 2D frames are only a migration hint: width maps to X, projected height to Z, and
  // the otherwise-unknown local depth Y receives the smaller scale. New creation never uses this.
  const candidate = { x: sx, y: Math.min(sx, sz), z: sz };
  return geometry ? normalizeSolid3DScale(geometry, candidate) : candidate;
}

/** Shape-family dimension invariants enforced at every create/edit/deserialize boundary. */
export type Solid3DSizeSemantics = 'independent' | 'isotropic' | 'radial-xy' | 'regular-base-xy';
export type Solid3DSizeAxis = 'x' | 'y' | 'z';

export function solid3DSizeSemantics(geometry: Solid3DGeometry): Solid3DSizeSemantics {
  if (geometry === 'cube3d' || geometry === 'sphere3d' || geometry === 'tetrahedron3d' || geometry === 'octahedron3d')
    return 'isotropic';
  if (geometry === 'cylinder3d' || geometry === 'cone3d' || geometry === 'coneFrustum3d') return 'radial-xy';
  if (geometry === 'pyramid3d' || geometry === 'pentagonalPyramid3d' || geometry === 'hexagonalPyramid3d'
      || geometry === 'pyramidFrustum3d' || geometry === 'squarePrism3d'
      || geometry === 'pentagonalPrism3d' || geometry === 'hexagonalPrism3d') return 'regular-base-xy';
  // Cuboid, convex quadrilateral-base solids, triangular-prism base width/height, and a
  // trirectangular tetrahedron support independent orthogonal dimensions without changing topology.
  return 'independent';
}

/** The active local-axis handle's semantic dimensions, shared by the gizmo and property panel. */
export function solid3DSizeGroup(geometry: Solid3DGeometry, axis: Solid3DSizeAxis): Solid3DSizeAxis[] {
  const semantics = solid3DSizeSemantics(geometry);
  if (semantics === 'isotropic') return ['x', 'y', 'z'];
  if ((semantics === 'radial-xy' || semantics === 'regular-base-xy') && axis !== 'z') return ['x', 'y'];
  return [axis];
}

export function normalizeSolid3DScale(geometry: Solid3DGeometry, scale?: Solid3DScale): Solid3DScale {
  const safe = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? Math.max(0.01, Math.min(64, value)) : 1;
  const x = safe(scale?.x), y = safe(scale?.y), z = safe(scale?.z);
  const semantics = solid3DSizeSemantics(geometry);
  if (semantics === 'isotropic') {
    const equalEdge = Math.max(0.01, Math.min(64, Math.cbrt(x * y * z)));
    return { x: equalEdge, y: equalEdge, z: equalEdge };
  }
  if (semantics === 'radial-xy' || semantics === 'regular-base-xy') {
    const baseDimension = Math.max(0.01, Math.min(64, Math.sqrt(x * y)));
    return { x: baseDimension, y: baseDimension, z };
  }
  return { x, y, z };
}

const localSpanCache = new Map<string, [number, number, number]>();
const LOCAL_MESH_PARAMETER_KEYS = ['depth', 'sides', 'heightRatio', 'topRadiusRatio', 'apexOffsetX', 'apexOffsetY'] as const;

/** Model-space dimension spans before scale/rotation, used by properties and axis-size response. */
export function solid3DLocalAxisSpans(
  geometry: Solid3DGeometry, params: Readonly<Record<string, unknown>> = {},
): [number, number, number] {
  const meshParams = Object.fromEntries(LOCAL_MESH_PARAMETER_KEYS.flatMap(key => key in params ? [[key, params[key]]] : []));
  const key = `${geometry}|${JSON.stringify(meshParams)}`;
  const cached = localSpanCache.get(key);
  if (cached) return [...cached];
  const projection = buildSolid3DProjection(geometry, 1, 1, meshParams, {
    scale: { x: 1, y: 1, z: 1 }, referenceWidth: 1, referenceHeight: 1,
  });
  const spans = [0, 1, 2].map(axis => {
    const values = projection.model.vertices.map(vertex => vertex.local[axis]);
    return Math.max(1e-6, Math.max(...values) - Math.min(...values));
  }) as [number, number, number];
  if (localSpanCache.size > 256) localSpanCache.delete(localSpanCache.keys().next().value!);
  localSpanCache.set(key, spans);
  return [...spans];
}

export function solid3DLocalDimensions(
  geometry: Solid3DGeometry, params: Readonly<Record<string, unknown>> = {}, scale?: Solid3DScale,
): Solid3DScale {
  const spans = solid3DLocalAxisSpans(geometry, params), normalized = normalizeSolid3DScale(geometry, scale);
  return { x: spans[0] * normalized.x, y: spans[1] * normalized.y, z: spans[2] * normalized.z };
}

function normalizeScale(scale?: Solid3DScale, geometry?: Solid3DGeometry): Solid3DScale {
  const safe = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? Math.max(0.01, Math.min(64, value)) : 1;
  const normalized = { x: safe(scale?.x), y: safe(scale?.y), z: safe(scale?.z) };
  return geometry ? normalizeSolid3DScale(geometry, normalized) : normalized;
}

function sphereSurfaceMesh(longitudes = 32, latitudes = 16): Mesh {
  const radius = 0.5, vertices: Vec3[] = [[0, 0, -radius]], rings: number[][] = [];
  for (let latitude = 1; latitude < latitudes; latitude++) {
    const phi = -Math.PI / 2 + latitude * Math.PI / latitudes;
    const ring: number[] = [];
    for (let longitude = 0; longitude < longitudes; longitude++) {
      const theta = longitude * Math.PI * 2 / longitudes;
      ring.push(vertices.length);
      vertices.push([radius * Math.cos(phi) * Math.cos(theta), -radius * Math.cos(phi) * Math.sin(theta), radius * Math.sin(phi)]);
    }
    rings.push(ring);
  }
  const top = vertices.length; vertices.push([0, 0, radius]);
  const faces: number[][] = [];
  const first = rings[0], last = rings.at(-1)!;
  for (let longitude = 0; longitude < longitudes; longitude++) {
    const next = (longitude + 1) % longitudes;
    faces.push([0, first[next], first[longitude]]);
    faces.push([last[longitude], last[next], top]);
  }
  for (let latitude = 0; latitude < rings.length - 1; latitude++) {
    const lower = rings[latitude], upper = rings[latitude + 1];
    for (let longitude = 0; longitude < longitudes; longitude++) {
      const next = (longitude + 1) % longitudes;
      faces.push([lower[longitude], lower[next], upper[next], upper[longitude]]);
    }
  }
  return orientFacesOutward({ vertices, faces });
}

function revolvedSurfaceMesh(geometry: 'cylinder3d' | 'cone3d' | 'coneFrustum3d', depth: number, params: Readonly<Record<string, unknown>>, segments = 64): Mesh {
  const radius = 0.5, topZ = depth / 2, bottomZ = -depth / 2;
  const topRadius = geometry === 'coneFrustum3d' ? radius * numberParam(params, 'topRadiusRatio', 0.38, 0.05, 0.95) : radius;
  const bottomRadius = radius;
  const vertices: Vec3[] = [];
  const ring = (z: number, r: number) => Array.from({ length: segments }, (_, index) => {
    const angle = index * Math.PI * 2 / segments;
    const id = vertices.length; vertices.push([Math.cos(angle) * r, -Math.sin(angle) * r, z]); return id;
  });
  const bottom = ring(bottomZ, bottomRadius);
  const top = geometry === 'cone3d' ? [] : ring(topZ, topRadius);
  const apex = geometry === 'cone3d' ? vertices.push([0, 0, topZ]) - 1 : -1;
  const faces: number[][] = [];
  if (geometry === 'cone3d') {
    for (let index = 0; index < segments; index++) faces.push([bottom[index], bottom[(index + 1) % segments], apex]);
  } else {
    for (let index = 0; index < segments; index++) faces.push([bottom[index], bottom[(index + 1) % segments], top[(index + 1) % segments], top[index]]);
  }
  faces.push([...bottom].reverse());
  if (top.length) faces.push([...top]);
  return orientFacesOutward({ vertices, faces });
}

function projectMesh(mesh: Mesh, transform: (point: Vec3) => Vec3, project: (point: Vec3) => Vec2, semanticEdges: boolean): { model: Solid3DModel; visibleFaces: Solid3DProjectedFace[] } {
  const transformed = mesh.vertices.map(transform), projected = transformed.map(project);
  const faces = mesh.faces.map((vertices, index): Solid3DModelFace => {
    const [a, b, c] = [transformed[vertices[0]], transformed[vertices[1]], transformed[vertices[2]]];
    const normal = normalize3(cross(subtract(b, a), subtract(c, a)));
    const depth = vertices.reduce((sum, vertex) => sum + solid3DCameraDepth(transformed[vertex]) / vertices.length, 0);
    return { key: `face:${index}`, vertices, normal, depth, visible: solid3DCameraDepth(normal) > 1e-7 };
  });
  const edges = new Map<string, { a: number; b: number; faces: number[] }>();
  mesh.faces.forEach((face, faceIndex) => face.forEach((vertex, index) => {
    const next = face[(index + 1) % face.length], key = edgeKey(vertex, next), existing = edges.get(key);
    if (existing) existing.faces.push(faceIndex); else edges.set(key, { a: vertex, b: next, faces: [faceIndex] });
  }));
  const modelEdges: Solid3DModelEdge[] = [...edges.entries()].map(([key, edge]) => {
    const frontCount = edge.faces.filter(face => faces[face].visible).length;
    const visibility: Solid3DModelEdge['visibility'] = frontCount === 0 ? 'hidden'
      : frontCount < edge.faces.length ? 'silhouette' : 'visible';
    return { key, a: edge.a, b: edge.b, faces: edge.faces,
      depth: (solid3DCameraDepth(transformed[edge.a]) + solid3DCameraDepth(transformed[edge.b])) / 2,
      visibility, semantic: semanticEdges };
  });
  const visibleFaces = faces.filter(face => face.visible).map(face => ({ key: face.key,
    commands: polylineCommands(face.vertices.map(vertex => projected[vertex]), true), depth: face.depth }))
    .sort((left, right) => left.depth - right.depth);
  return { model: { vertices: mesh.vertices.map((local, index) => ({ local, transformed: transformed[index], projected: projected[index] })), faces, edges: modelEdges }, visibleFaces };
}

function createPolyhedronMesh(geometry: Solid3DGeometry, depth: number, params: Readonly<Record<string, unknown>>): Mesh {
  // Cube is always an equal-edge 3D model. Its local depth is not an editable cuboid parameter.
  if (geometry === 'cube3d' || geometry === 'cuboid3d') return boxMesh();
  if (geometry === 'tetrahedron3d') return tetrahedronMesh(depth);
  if (geometry === 'rightTetrahedron3d') return rightTetrahedronMesh(numberParam(params, 'heightRatio', 0.6, 0.2, 2));
  if (geometry === 'octahedron3d') return octahedronMesh(depth);
  if (geometry === 'quadrilateralPrism3d') return convexQuadrilateralPrismMesh(depth);
  if (geometry === 'quadrilateralPyramid3d')
    return convexQuadrilateralPyramidMesh(depth, numberParam(params, 'apexOffsetX', 0, -1, 1),
      numberParam(params, 'apexOffsetY', 0, -1, 1));
  if (geometry === 'rightQuadrilateralPyramid3d') return rightQuadrilateralPyramidMesh(depth);
  if (geometry === 'rightTrapezoidPyramid3d') return rightTrapezoidPyramidMesh(depth);
  if (geometry === 'rightTrapezoidPerpendicularPyramid3d') return rightTrapezoidPerpendicularPyramidMesh(depth);
  if (geometry === 'pyramid3d' || geometry === 'pentagonalPyramid3d' || geometry === 'hexagonalPyramid3d') {
    const defaultSides = geometry === 'pentagonalPyramid3d' ? 5 : geometry === 'hexagonalPyramid3d' ? 6 : 4;
    const sides = Math.round(numberParam(params, 'sides', defaultSides, 3, 32));
    const squareBase = sides === 4, baseRadius = squareBase ? Math.SQRT1_2 : 0.5;
    const apexOffsetX = numberParam(params, 'apexOffsetX', 0, -1, 1) * baseRadius;
    const apexOffsetY = numberParam(params, 'apexOffsetY', 0, -1, 1) * baseRadius;
    return regularPyramidMesh(sides, depth, baseRadius, canonicalPolygonPhase(sides), apexOffsetX, apexOffsetY);
  }
  if (geometry === 'pyramidFrustum3d') {
    const sides = Math.round(numberParam(params, 'sides', 4, 3, 32));
    const squareBase = sides === 4;
    return pyramidFrustumMesh(sides, depth, numberParam(params, 'topRadiusRatio', 0.38, 0.05, 0.95),
      squareBase ? Math.SQRT1_2 : 0.5, canonicalPolygonPhase(sides));
  }
  const defaultSides = geometry === 'triangularPrism3d' ? 3 : geometry === 'pentagonalPrism3d' ? 5
    : geometry === 'hexagonalPrism3d' ? 6 : 4;
  const sides = Math.round(numberParam(params, 'sides', defaultSides, 3, 32));
  const squarePrism = geometry === 'squarePrism3d' && sides === 4;
  return regularPrismMesh(sides, depth, canonicalPolygonPhase(sides), squarePrism ? Math.SQRT1_2 : 0.5);
}

/** Shared intrinsic local Euler transform for projected meshes and the local-axis basis helpers. */
export function rotateSolid3DVector(point: Vec3, rotationX: number, rotationY: number, rotationZ: number): Vec3 {
  const [x, y, z] = point;
  // M = Rx * Ry * Rz: apply local Z, then local Y, then local X in the right-handed Z-up basis.
  const cosZ = Math.cos(radians(rotationZ)), sinZ = Math.sin(radians(rotationZ));
  const x1 = x * cosZ - y * sinZ, y1 = x * sinZ + y * cosZ, z1 = z;
  const cosY = Math.cos(radians(rotationY)), sinY = Math.sin(radians(rotationY));
  const x2 = x1 * cosY + z1 * sinY, z2 = -x1 * sinY + z1 * cosY;
  const cosX = Math.cos(radians(rotationX)), sinX = Math.sin(radians(rotationX));
  return [x2, y1 * cosX - z2 * sinX, y1 * sinX + z2 * cosX];
}

/** Convert a persisted local scale from the former X-width/Y-up/Z-depth basis to Z-up. */
export function migrateSolid3DScaleFromYUp(scale: Solid3DScale): Solid3DScale {
  return { x: scale.x, y: scale.z, z: scale.y };
}

/**
 * Preserve an existing object's orientation when its local basis changes from Y-up to Z-up.
 * C maps old vectors (x,y,z) to (x,-z,y), so the migrated rotation matrix is C R C⁻¹;
 * the result is decomposed back into the repository's Rx * Ry * Rz Euler storage order.
 */
export function migrateSolid3DRotationFromYUp(params: Readonly<Record<string, unknown>> = {}) {
  const rotationX = numberParam(params, 'rotationX', 0, -360, 360);
  const rotationY = numberParam(params, 'rotationY', 0, -360, 360);
  const rotationZ = numberParam(params, 'rotationZ', 0, -360, 360);
  const toOld: (point: Vec3) => Vec3 = ([x, y, z]) => [x, z, -y];
  const toNew: (point: Vec3) => Vec3 = ([x, y, z]) => [x, -z, y];
  const migratedColumns: Vec3[] = ([ [1, 0, 0], [0, 1, 0], [0, 0, 1] ] as Vec3[]).map(axis =>
    toNew(rotateSolid3DVector(toOld(axis), rotationX, rotationY, rotationZ)));
  const [columnX, columnY, columnZ] = migratedColumns;
  const principalY = Math.asin(Math.max(-1, Math.min(1, columnZ[0])));
  const cosineY = Math.cos(principalY);
  let principalX: number, principalZ: number;
  if (Math.abs(cosineY) > 1e-8) {
    principalX = Math.atan2(-columnZ[1], columnZ[2]);
    principalZ = Math.atan2(-columnY[0], columnX[0]);
  } else {
    principalX = 0;
    principalZ = Math.atan2(columnX[1], columnY[1]);
  }
  const toDegrees = (angle: number) => {
    const degrees = angle * 180 / Math.PI;
    return Math.abs(degrees) < 1e-12 ? 0 : degrees;
  };
  return { rotationX: toDegrees(principalX), rotationY: toDegrees(principalY), rotationZ: toDegrees(principalZ) };
}

export function solid3DRotationParams(params: Readonly<Record<string, unknown>> = {}) {
  return {
    rotationX: numberParam(params, 'rotationX', 0, -360, 360),
    rotationY: numberParam(params, 'rotationY', 0, -360, 360),
    rotationZ: numberParam(params, 'rotationZ', 0, -360, 360),
  };
}

/**
 * Return the true right-handed local-axis planes of M = Rx * Ry * Rz. These basis vectors
 * share the exact transform used by the solid mesh, so numeric local-axis rotations compose
 * against model space rather than screen axes or a stale Euler frame.
 */
export function solid3DRotationFrames(params: Readonly<Record<string, unknown>> = {}): Solid3DRotationFrame[] {
  const { rotationX, rotationY, rotationZ } = solid3DRotationParams(params);
  const rotate = (point: Vec3) => rotateSolid3DVector(point, rotationX, rotationY, rotationZ);
  return [
    { axis: 'rotationX', label: 'X', direction: rotate([1, 0, 0]),
      planeU: rotate([0, 1, 0]), planeV: rotate([0, 0, 1]) },
    { axis: 'rotationY', label: 'Y', direction: rotate([0, 1, 0]),
      planeU: rotate([0, 0, 1]), planeV: rotate([1, 0, 0]) },
    { axis: 'rotationZ', label: 'Z', direction: rotate([0, 0, 1]),
      planeU: rotate([1, 0, 0]), planeV: rotate([0, 1, 0]) },
  ];
}

/** Project the rotated local XYZ basis using exactly the same Euler order as the 3D geometry. */
export function projectSolid3DAxes(params: Readonly<Record<string, unknown>> = {}): Solid3DProjectedAxis[] {
  const { rotationX, rotationY, rotationZ } = solid3DRotationParams(params);
  const basis: Array<[Solid3DRotationAxis, 'X' | 'Y' | 'Z', Vec3]> = [
    ['rotationX', 'X', [1, 0, 0]], ['rotationY', 'Y', [0, 1, 0]], ['rotationZ', 'Z', [0, 0, 1]],
  ];
  return basis.map(([axis, label, vector]) => {
    const rotated = rotateSolid3DVector(vector, rotationX, rotationY, rotationZ);
    const [x, y] = projectSolid3DVector(rotated);
    return { axis, label, x, y, cameraDepth: solid3DCameraDepth(rotated) };
  });
}

/** Compose a right-handed rotation about one of the solid's current local XYZ axes. */
export function rotateSolid3DOrientationAboutLocalAxis(
  params: Readonly<Record<string, unknown>>, axis: Solid3DRotationAxis, deltaRadians: number,
): { rotationX: number; rotationY: number; rotationZ: number } {
  const start = solid3DRotationParams(params);
  if (!Number.isFinite(deltaRadians) || Math.abs(deltaRadians) < 1e-14) return { ...start };
  const columns: Vec3[] = [
    rotateSolid3DVector([1, 0, 0], start.rotationX, start.rotationY, start.rotationZ),
    rotateSolid3DVector([0, 1, 0], start.rotationX, start.rotationY, start.rotationZ),
    rotateSolid3DVector([0, 0, 1], start.rotationX, start.rotationY, start.rotationZ),
  ];
  const cosine = Math.cos(deltaRadians), sine = Math.sin(deltaRadians), [xAxis, yAxis, zAxis] = columns;
  let nextColumns: Vec3[];
  if (axis === 'rotationX') nextColumns = [xAxis,
    yAxis.map((value, index) => value * cosine + zAxis[index] * sine) as Vec3,
    yAxis.map((value, index) => -value * sine + zAxis[index] * cosine) as Vec3];
  else if (axis === 'rotationY') nextColumns = [
    xAxis.map((value, index) => value * cosine - zAxis[index] * sine) as Vec3, yAxis,
    xAxis.map((value, index) => value * sine + zAxis[index] * cosine) as Vec3];
  else nextColumns = [
    xAxis.map((value, index) => value * cosine + yAxis[index] * sine) as Vec3,
    xAxis.map((value, index) => -value * sine + yAxis[index] * cosine) as Vec3, zAxis];
  const [nextX, nextY, nextZ] = nextColumns;
  const principalY = Math.asin(Math.max(-1, Math.min(1, nextZ[0])));
  const cosineY = Math.cos(principalY);
  let principalX: number, principalZ: number;
  if (Math.abs(cosineY) > 1e-8) {
    principalX = Math.atan2(-nextZ[1], nextZ[2]);
    principalZ = Math.atan2(-nextY[0], nextX[0]);
  } else {
    principalX = 0;
    principalZ = Math.atan2(nextX[1], nextY[1]);
  }
  const nearestDegrees = (angle: number, reference: number) => {
    const degrees = angle * 180 / Math.PI;
    return Math.max(-360, Math.min(360, degrees + 360 * Math.round((reference - degrees) / 360)));
  };
  const candidates: Array<[number, number, number]> = [[principalX, principalY, principalZ]];
  if (Math.abs(cosineY) > 1e-8) {
    // XYZ Euler decomposition has two equivalent branches. Always choose the branch closest to
    // the current field values; otherwise crossing ±90° spuriously jumps X and Z by 180° even
    // though the drag is a smooth rotation about one actual local axis.
    candidates.push([principalX + Math.PI, Math.PI - principalY, principalZ + Math.PI]);
  }
  const closest = candidates.map(([x, y, z]) => ({ rotationX: nearestDegrees(x, start.rotationX),
    rotationY: nearestDegrees(y, start.rotationY), rotationZ: nearestDegrees(z, start.rotationZ) }))
    .sort((left, right) => Math.abs(left.rotationX - start.rotationX) + Math.abs(left.rotationY - start.rotationY)
      + Math.abs(left.rotationZ - start.rotationZ) - Math.abs(right.rotationX - start.rotationX)
      - Math.abs(right.rotationY - start.rotationY) - Math.abs(right.rotationZ - start.rotationZ))[0];
  return closest;
}

function convexHull(points: Vec2[]): Vec2[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const unique = sorted.filter((point, index) => index === 0 || Math.hypot(point[0] - sorted[index - 1][0], point[1] - sorted[index - 1][1]) > 1e-8);
  if (unique.length < 3) return unique;
  const turn = (a: Vec2, b: Vec2, c: Vec2) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const lower: Vec2[] = [], upper: Vec2[] = [];
  for (const point of unique) { while (lower.length >= 2 && turn(lower.at(-2)!, lower.at(-1)!, point) <= 1e-9) lower.pop(); lower.push(point); }
  for (const point of [...unique].reverse()) { while (upper.length >= 2 && turn(upper.at(-2)!, upper.at(-1)!, point) <= 1e-9) upper.pop(); upper.push(point); }
  lower.pop(); upper.pop(); return [...lower, ...upper];
}

function orientFacesOutward(mesh: Mesh): Mesh {
  // The vertex centroid is a translation-invariant interior reference for the centered convex
  // educational meshes below. Using the global origin silently flips faces on translated or
  // offset-apex models, so orient against the actual mesh rather than an assumed world origin.
  const interior = mesh.vertices.reduce<Vec3>((sum, vertex) => [
    sum[0] + vertex[0] / Math.max(1, mesh.vertices.length),
    sum[1] + vertex[1] / Math.max(1, mesh.vertices.length),
    sum[2] + vertex[2] / Math.max(1, mesh.vertices.length),
  ], [0, 0, 0]);
  const faces = mesh.faces.map(face => {
    if (face.length < 3) return face;
    const a = mesh.vertices[face[0]], b = mesh.vertices[face[1]], c = mesh.vertices[face[2]];
    const normal = cross(subtract(b, a), subtract(c, a));
    const center = face.reduce<Vec3>((sum, index) => [sum[0] + mesh.vertices[index][0] / face.length,
      sum[1] + mesh.vertices[index][1] / face.length, sum[2] + mesh.vertices[index][2] / face.length], [0, 0, 0]);
    return dot(normal, subtract(center, interior)) < 0 ? [...face].reverse() : face;
  });
  return { ...mesh, faces };
}

const edgeKey = (a: number, b: number) => a < b ? `${a}:${b}` : `${b}:${a}`;

function polylineCommands(points: readonly Vec2[], close = false): PathCommand[] {
  if (!points.length) return [];
  return [command('moveTo', ...points[0]), ...points.slice(1).map(point => command('lineTo', ...point)), ...(close ? [command('closePath')] : [])];
}

/**
 * Split a semantic closed surface curve at exact visibility transitions. Visibility is a signed
 * front-facing margin computed from the actual adjacent surface normals after XYZ rotation.
 * The bisection places the shared front/back endpoint on the silhouette instead of classifying
 * an entire sampled segment by its midpoint.
 */
function splitParametricCurve(
  name: string,
  pointAt: (angle: number) => Vec3,
  marginAt: (angle: number) => number,
  project: (point: Vec3) => Vec2,
  samples = 128,
): CurveSplit {
  interface Run { visible: boolean; points: Vec2[]; }
  const runs: Run[] = [];
  const visibleKeys: string[] = [], hiddenKeys: string[] = [];
  const period = Math.PI * 2, step = period / samples, visibleAt = (angle: number) => marginAt(angle) >= -1e-10;
  let currentVisible = visibleAt(0), currentPoints: Vec2[] = [project(pointAt(0))];
  const flush = () => {
    if (currentPoints.length > 1) runs.push({ visible: currentVisible, points: currentPoints });
    currentPoints = [];
  };
  const crossingAngle = (start: number, end: number, startVisible: boolean) => {
    let lo = start, hi = end;
    for (let iteration = 0; iteration < 44; iteration++) {
      const mid = (lo + hi) / 2;
      if (visibleAt(mid) === startVisible) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  for (let index = 0; index < samples; index++) {
    const startAngle = index * step, endAngle = (index + 1) * step;
    const endVisible = visibleAt(endAngle), key = `${name}:${index}`;
    if (endVisible === currentVisible) {
      currentPoints.push(project(pointAt(endAngle)));
      (currentVisible ? visibleKeys : hiddenKeys).push(key);
      continue;
    }
    const angle = crossingAngle(startAngle, endAngle, currentVisible), screen = project(pointAt(angle));
    currentPoints.push(screen);
    flush();
    currentVisible = endVisible;
    currentPoints = [screen, project(pointAt(endAngle))];
    (visibleKeys).push(`${key}:visible`);
    (hiddenKeys).push(`${key}:hidden`);
  }
  flush();

  // Merge matching runs across 0/2π; the curve seam should not create an artificial cap or dash reset.
  if (runs.length > 1 && runs[0].visible === runs.at(-1)!.visible) {
    const first = runs.shift()!, last = runs.pop()!;
    runs.push({ visible: last.visible, points: [...last.points, ...first.points.slice(1)] });
  }
  const toCommands = (points: Vec2[], close: boolean) => polylineCommands(points, close);
  const allVisible = runs.length === 1 && runs[0].visible;
  const allHidden = runs.length === 1 && !runs[0].visible;
  const visible = runs.filter(run => run.visible).flatMap(run => toCommands(run.points, allVisible));
  const hidden = runs.filter(run => !run.visible).map(run => toCommands(run.points, allHidden));
  return { visible, hidden, visibleKeys, hiddenKeys };
}

/** Exact roots for a*cos(angle) + b*sin(angle) + c; tangencies and degenerate views included. */
function sinusoidRoots(a: number, b: number, c: number): number[] {
  const amplitude = Math.hypot(a, b);
  if (amplitude < 1e-10) return []; // camera-parallel axis: no distinct side generators
  const ratio = -c / amplitude;
  if (ratio < -1 - 1e-9 || ratio > 1 + 1e-9) return [];
  const phase = Math.atan2(b, a);
  const offset = Math.acos(Math.max(-1, Math.min(1, ratio)));
  const normalize = (angle: number) => ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const first = normalize(phase + offset);
  if (offset < 1e-8 || Math.PI - offset < 1e-8) return [first];
  const second = normalize(phase - offset);
  return [first, second].sort((left, right) => left - right);
}

function appendLinePath(target: PathCommand[], from: Vec2, to: Vec2) {
  target.push(command('moveTo', ...from), command('lineTo', ...to));
}

// Neutral mesh coordinates remain the semantic local X/Y/Z axes. New canvas objects use the same
// neutral mathematical orientation as their registered definition; the orthographic camera and
// true hidden-edge classification expose the geometry without baking in a compensating yaw.
const DEFAULTS: Record<Solid3DGeometry, [number, number, number, number]> = {
  cube3d: [SOLID3D_CANONICAL_CUBE_ROTATION_X_DEGREES, SOLID3D_CANONICAL_CUBE_ROTATION_Y_DEGREES,
    SOLID3D_CANONICAL_CUBE_ROTATION_Z_DEGREES, 1],
  cuboid3d: [0, 0, SOLID3D_CANONICAL_CUBOID_ROLL_DEGREES, 0.72],
  cylinder3d: [0, 0, 0, 0.78], cone3d: [0, 0, 0, 0.78], coneFrustum3d: [0, 0, 0, 0.78], sphere3d: [0, 0, 0, 1],
  pyramid3d: [0, 0, 0, 1], quadrilateralPyramid3d: [0, 0, 0, 1],
  rightQuadrilateralPyramid3d: [0, 0, 0, 1], rightTrapezoidPyramid3d: [0, 0, 0, 1],
  rightTrapezoidPerpendicularPyramid3d: [0, 0, 0, 1],
  pentagonalPyramid3d: [0, 0, 0, 1], hexagonalPyramid3d: [0, 0, 0, 1],
  pyramidFrustum3d: [0, 0, 0, 1], tetrahedron3d: [0, 0, 0, 1], rightTetrahedron3d: [0, 0, 0, 0.6],
  octahedron3d: [0, 0, 0, 1], triangularPrism3d: [0, 0, 0, 0.82], quadrilateralPrism3d: [0, 0, 0, 0.8],
  squarePrism3d: [0, 0, 0, 1.35], pentagonalPrism3d: [0, 0, 0, 0.8], hexagonalPrism3d: [0, 0, 0, 0.78],
};
const CURVE_SAMPLES = 128;

/** Build a textbook-style oblique solid with actual edge topology and dynamic visibility. */
export function buildSolid3DProjection(
  geometry: Solid3DGeometry,
  width: number,
  height: number,
  params: Readonly<Record<string, unknown>> = {},
  options: Solid3DProjectionOptions = {},
): Solid3DProjection {
  const [defaultX, defaultY, defaultZ, defaultDepth] = DEFAULTS[geometry];
  const rotationX = numberParam(params, 'rotationX', defaultX, -360, 360);
  const rotationY = numberParam(params, 'rotationY', defaultY, -360, 360);
  const rotationZ = numberParam(params, 'rotationZ', defaultZ, -360, 360);
  const depth = geometry === 'sphere3d' ? 1 : numberParam(params, 'depth', defaultDepth, 0.15, 2.5);
  const safeWidth = Math.max(1, Number.isFinite(width) ? width : 1), safeHeight = Math.max(1, Number.isFinite(height) ? height : 1);
  const hasObjectScale = Boolean(options.scale);
  const objectScale = normalizeScale(options.scale, geometry);
  const referenceWidth = Math.max(1, Number.isFinite(options.referenceWidth) ? options.referenceWidth! : safeWidth);
  const referenceHeight = Math.max(1, Number.isFinite(options.referenceHeight) ? options.referenceHeight! : safeHeight);
  const fitWidth = hasObjectScale ? referenceWidth : safeWidth;
  const fitHeight = hasObjectScale ? referenceHeight : safeHeight;
  const padding = Math.min(Math.max(1, Math.min(fitWidth, fitHeight) * 0.045), Math.max(0.24, Math.min(fitWidth, fitHeight) * 0.24));
  const center: Vec2 = [options.center?.x ?? safeWidth / 2, options.center?.y ?? safeHeight / 2];
  const projectionScaleFor = (maxRadius: number) => Math.max(0.001,
    Math.min((fitWidth - padding * 2) / (maxRadius * 2 * PROJECTION_MAX_STRETCH),
      (fitHeight - padding * 2) / (maxRadius * 2 * PROJECTION_MAX_STRETCH)));
  let modelSamples: Vec3[] = [];
  let mesh: Mesh | null = null;
  const visibleEdges: PathCommand[] = [], hiddenEdges: PathCommand[][] = [];
  const visibleEdgeKeys: string[] = [], hiddenEdgeKeys: string[] = [];
  const transform = (point: Vec3) => rotateSolid3DVector([point[0] * objectScale.x, point[1] * objectScale.y, point[2] * objectScale.z], rotationX, rotationY, rotationZ);
  const transformNormalRaw = (normal: Vec3) => rotateSolid3DVector([normal[0] / objectScale.x, normal[1] / objectScale.y, normal[2] / objectScale.z], rotationX, rotationY, rotationZ);
  const transformNormal = (normal: Vec3) => normalize3(transformNormalRaw(normal));
  const normalDepth = (normal: Vec3) => solid3DCameraDepth(transformNormalRaw(normal));
  const addCurve = (split: CurveSplit) => {
    visibleEdges.push(...split.visible); hiddenEdges.push(...split.hidden);
    visibleEdgeKeys.push(...split.visibleKeys); hiddenEdgeKeys.push(...split.hiddenKeys);
  };
  let visibleFaceCount = 0;

  if (geometry === 'sphere3d') {
    const radius = 0.5, projectedScale = projectionScaleFor(radius);
    const project = (point: Vec3): Vec2 => {
      const [screenX, screenY] = projectSolid3DVector(point);
      return [center[0] + screenX * projectedScale, center[1] + screenY * projectedScale];
    };
    // One local XY great circle perpendicular to world-up Z; its projection follows the persisted pose.
    const localEquatorPoint = (angle: number): Vec3 => [Math.cos(angle) * radius, -Math.sin(angle) * radius, 0];
    const pointAt = (angle: number) => transform(localEquatorPoint(angle));
    const normalAt = (angle: number) => transformNormal(localEquatorPoint(angle).map(value => value / radius) as Vec3);
    addCurve(splitParametricCurve('sphere:equator', pointAt, angle => dot(normalAt(angle), CAMERA_FORWARD), project, CURVE_SAMPLES));
    mesh = sphereSurfaceMesh();
    const renderedMesh = projectMesh(mesh, transform, project, false);
    // A locally scaled/rotated sphere is a true ellipsoid, whose exact orthographic silhouette is
    // still an ellipse. Compute its 2×2 projected covariance from the three transformed unit axes;
    // do not substitute a faceted mesh hull or screen-space resize for the 3D model.
    const projectedAxes = ([ [1, 0, 0], [0, 1, 0], [0, 0, 1] ] as Vec3[])
      .map(axis => projectSolid3DVector(transform(axis)));
    const covarianceXX = radius ** 2 * projectedAxes.reduce((sum, axis) => sum + axis[0] ** 2, 0);
    const covarianceYY = radius ** 2 * projectedAxes.reduce((sum, axis) => sum + axis[1] ** 2, 0);
    const covarianceXY = radius ** 2 * projectedAxes.reduce((sum, axis) => sum + axis[0] * axis[1], 0);
    const eigenDelta = Math.hypot(covarianceXX - covarianceYY, 2 * covarianceXY);
    const majorStretch = projectedScale * Math.sqrt(0.5 * (covarianceXX + covarianceYY + eigenDelta));
    const minorStretch = projectedScale * Math.sqrt(0.5 * (covarianceXX + covarianceYY - eigenDelta));
    const ellipseAngle = 0.5 * Math.atan2(2 * covarianceXY, covarianceXX - covarianceYY);
    const outline: PathCommand[] = [command('moveTo', center[0] + majorStretch * Math.cos(ellipseAngle),
        center[1] + majorStretch * Math.sin(ellipseAngle)),
      command('ellipse', center[0], center[1], majorStretch, minorStretch, ellipseAngle, 0, Math.PI * 2, 0), command('closePath')];
    visibleEdges.push(...outline);
    visibleEdgeKeys.unshift('sphere:outer-silhouette');
    const extentX = projectedScale * Math.sqrt(Math.max(0, covarianceXX));
    const extentY = projectedScale * Math.sqrt(Math.max(0, covarianceYY));
    const projectedBounds = { minX: center[0] - extentX, minY: center[1] - extentY,
      maxX: center[0] + extentX, maxY: center[1] + extentY };
    visibleFaceCount = renderedMesh.model.faces.filter(face => face.visible).length;
    return { outline, visibleEdges, hiddenEdges, visibleFaces: renderedMesh.visibleFaces, model: renderedMesh.model,
      metadata: { geometry, rotationX, rotationY, rotationZ, depth, visibleFaceCount,
        visibleEdgeCount: visibleEdgeKeys.length, hiddenEdgeCount: hiddenEdgeKeys.length, projectedScale,
        visibleEdgeKeys, hiddenEdgeKeys, projectedBounds, coordinateConvention: SOLID3D_COORDINATE_CONVENTION } };
  }

  if (geometry === 'cylinder3d' || geometry === 'cone3d' || geometry === 'coneFrustum3d') {
    const heightModel = depth, radius = 0.5;
    const ringPoint = (z: number, ringRadius: number, angle: number): Vec3 =>
      [Math.cos(angle) * ringRadius, -Math.sin(angle) * ringRadius, z];
    const ringSamples = (z: number, ringRadius: number): Vec3[] =>
      Array.from({ length: CURVE_SAMPLES }, (_, index) => ringPoint(z, ringRadius, index * Math.PI * 2 / CURVE_SAMPLES));
    const topNormal: Vec3 = [0, 0, 1], bottomNormal: Vec3 = [0, 0, -1];
    let silhouetteSamples: Vec3[] = [];
    let sideNormalAt: (angle: number) => Vec3;
    const topZ = heightModel / 2, bottomZ = -heightModel / 2;
    let topRadius = radius, bottomRadius = radius;

    if (geometry === 'cylinder3d') {
      silhouetteSamples = [...ringSamples(topZ, radius), ...ringSamples(bottomZ, radius)];
      sideNormalAt = angle => [Math.cos(angle), -Math.sin(angle), 0];
    } else if (geometry === 'cone3d') {
      silhouetteSamples = [...ringSamples(bottomZ, radius), [0, 0, topZ]];
      sideNormalAt = angle => normalize3([heightModel * Math.cos(angle), -heightModel * Math.sin(angle), radius]);
    } else {
      const ratio = numberParam(params, 'topRadiusRatio', 0.38, 0.05, 0.95);
      topRadius = radius * ratio; bottomRadius = radius;
      silhouetteSamples = [...ringSamples(topZ, topRadius), ...ringSamples(bottomZ, bottomRadius)];
      sideNormalAt = angle => normalize3([heightModel * Math.cos(angle), -heightModel * Math.sin(angle), bottomRadius - topRadius]);
    }
    modelSamples = silhouetteSamples;
    const rotatedSamples = modelSamples.map(transform);
    const maxRadius = Math.max(0.001, ...modelSamples.map(length3));
    const projectedScale = projectionScaleFor(maxRadius);
    const project = (point: Vec3): Vec2 => {
      const [screenX, screenY] = projectSolid3DVector(point);
      return [center[0] + screenX * projectedScale, center[1] + screenY * projectedScale];
    };
    const visibleMargin = (angle: number, cap: Vec3) => Math.max(normalDepth(sideNormalAt(angle)), normalDepth(cap));
    if (geometry === 'cylinder3d') {
      addCurve(splitParametricCurve('cylinder:top-rim', angle => transform(ringPoint(topZ, radius, angle)), angle => visibleMargin(angle, topNormal), project, CURVE_SAMPLES));
      addCurve(splitParametricCurve('cylinder:bottom-rim', angle => transform(ringPoint(bottomZ, radius, angle)), angle => visibleMargin(angle, bottomNormal), project, CURVE_SAMPLES));
    } else if (geometry === 'cone3d') {
      addCurve(splitParametricCurve('cone:base-rim', angle => transform(ringPoint(bottomZ, radius, angle)), angle => visibleMargin(angle, bottomNormal), project, CURVE_SAMPLES));
    } else {
      addCurve(splitParametricCurve('cone-frustum:top-rim', angle => transform(ringPoint(topZ, topRadius, angle)), angle => visibleMargin(angle, topNormal), project, CURVE_SAMPLES));
      addCurve(splitParametricCurve('cone-frustum:bottom-rim', angle => transform(ringPoint(bottomZ, bottomRadius, angle)), angle => visibleMargin(angle, bottomNormal), project, CURVE_SAMPLES));
    }
    const cameraX = normalDepth([1, 0, 0]), cameraY = normalDepth([0, 1, 0]), cameraZ = normalDepth([0, 0, 1]);
    const sideA = geometry === 'cylinder3d' ? cameraX : heightModel * cameraX;
    const sideB = geometry === 'cylinder3d' ? -cameraY : -heightModel * cameraY;
    const sideC = geometry === 'cylinder3d' ? 0
      : (geometry === 'cone3d' ? radius : bottomRadius - topRadius) * cameraZ;
    const tangentAngles = sinusoidRoots(sideA, sideB, sideC);
    tangentAngles.forEach((angle, index) => {
      const a = geometry === 'cone3d' ? [0, 0, topZ] as Vec3 : ringPoint(topZ, topRadius, angle);
      const b = ringPoint(bottomZ, bottomRadius, angle);
      appendLinePath(visibleEdges, project(transform(a)), project(transform(b)));
      visibleEdgeKeys.push(`${geometry}:silhouette-generator:${index}`);
    });
    mesh = revolvedSurfaceMesh(geometry, heightModel, params);
    const renderedMesh = projectMesh(mesh, transform, project, false);
    const visibleCaps = Number(geometry !== 'cone3d' && normalDepth(topNormal) > 1e-7)
      + Number(normalDepth(bottomNormal) > 1e-7);
    visibleFaceCount = renderedMesh.model.faces.filter(face => face.visible).length || visibleCaps;
    const outlinePoints = rotatedSamples.map(project), hull = convexHull(outlinePoints);
    const outline = polylineCommands(hull, true);
    const projectedBounds = { minX: Math.min(...hull.map(point => point[0])), minY: Math.min(...hull.map(point => point[1])),
      maxX: Math.max(...hull.map(point => point[0])), maxY: Math.max(...hull.map(point => point[1]) ) };
    return { outline, visibleEdges, hiddenEdges, visibleFaces: renderedMesh.visibleFaces, model: renderedMesh.model,
      metadata: { geometry, rotationX, rotationY, rotationZ, depth, visibleFaceCount,
        visibleEdgeCount: visibleEdgeKeys.length, hiddenEdgeCount: hiddenEdgeKeys.length, projectedScale,
        visibleEdgeKeys, hiddenEdgeKeys, projectedBounds, coordinateConvention: SOLID3D_COORDINATE_CONVENTION } };
  }

  mesh = orientFacesOutward(createPolyhedronMesh(geometry, depth, params));
  const maxRadius = Math.max(0.001, ...mesh.vertices.map(length3));
  const projectedScale = projectionScaleFor(maxRadius);
  const project = (point: Vec3): Vec2 => {
    const [screenX, screenY] = projectSolid3DVector(point);
    return [center[0] + screenX * projectedScale, center[1] + screenY * projectedScale];
  };
  const renderedMesh = projectMesh(mesh, transform, project, true);
  visibleFaceCount = renderedMesh.model.faces.filter(face => face.visible).length;
  const projected = renderedMesh.model.vertices.map(vertex => vertex.projected);
  const sortedEdges = [...renderedMesh.model.edges].sort((a, b) => a.depth - b.depth);
  for (const edge of sortedEdges) {
    const line = [command('moveTo', ...projected[edge.a]), command('lineTo', ...projected[edge.b])];
    if (edge.visibility === 'hidden') { hiddenEdges.push(line); hiddenEdgeKeys.push(edge.key); }
    else { visibleEdges.push(...line); visibleEdgeKeys.push(edge.key); }
  }
  const hull = convexHull(projected), outline = polylineCommands(hull, true);
  const projectedBounds = { minX: Math.min(...hull.map(point => point[0])), minY: Math.min(...hull.map(point => point[1])),
    maxX: Math.max(...hull.map(point => point[0])), maxY: Math.max(...hull.map(point => point[1])) };
  return { outline, visibleEdges, hiddenEdges, visibleFaces: renderedMesh.visibleFaces, model: renderedMesh.model,
    metadata: { geometry, rotationX, rotationY, rotationZ, depth, visibleFaceCount,
      visibleEdgeCount: visibleEdgeKeys.length, hiddenEdgeCount: hiddenEdgeKeys.length, projectedScale,
      visibleEdgeKeys, hiddenEdgeKeys, projectedBounds, coordinateConvention: SOLID3D_COORDINATE_CONVENTION } };
}

export function isSolid3DGeometry(value: string): value is Solid3DGeometry {
  return ['cube3d', 'cuboid3d', 'cylinder3d', 'cone3d', 'coneFrustum3d', 'sphere3d', 'pyramid3d',
    'quadrilateralPyramid3d', 'pyramidFrustum3d', 'pentagonalPyramid3d', 'hexagonalPyramid3d',
    'tetrahedron3d', 'rightTetrahedron3d', 'octahedron3d', 'triangularPrism3d', 'quadrilateralPrism3d',
    'squarePrism3d', 'pentagonalPrism3d', 'hexagonalPrism3d', 'rightQuadrilateralPyramid3d',
    'rightTrapezoidPyramid3d', 'rightTrapezoidPerpendicularPyramid3d'].includes(value);
}
