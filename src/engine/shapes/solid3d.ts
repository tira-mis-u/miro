import type { PathCommand } from './types';

export type Solid3DGeometry = 'cube3d' | 'cuboid3d' | 'cylinder3d' | 'cone3d' | 'sphere3d' | 'pyramid3d'
  | 'tetrahedron3d' | 'rightTetrahedron3d' | 'octahedron3d' | 'triangularPrism3d' | 'quadrilateralPrism3d'
  | 'pentagonalPrism3d' | 'hexagonalPrism3d' | 'squarePrism3d' | 'pentagonalPyramid3d' | 'hexagonalPyramid3d'
  | 'quadrilateralPyramid3d' | 'pyramidFrustum3d' | 'coneFrustum3d';
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

// One shared cabinet-style oblique projection keeps the schoolbook box axes exact: local +X is
// screen-horizontal, local +Y is screen-vertical, and local +Z recedes diagonally left/down. This
// is one affine 3D view transform (with a consistent null-ray for visibility), not a 2D path
// rotation or per-solid correction. Its +Z camera-depth is 0.875, preserving a legible corner reveal.
const OBLIQUE_X_PER_Z = -0.478;
const OBLIQUE_SCREEN_Y_PER_Z = 0.279;
const CAMERA: Vec3 = (() => {
  const length = Math.hypot(-OBLIQUE_X_PER_Z, OBLIQUE_SCREEN_Y_PER_Z, 1);
  return [-OBLIQUE_X_PER_Z / length, OBLIQUE_SCREEN_Y_PER_Z / length, 1 / length];
})();
// Covariance of the shared projection for a unit sphere. This yields its continuous elliptical
// silhouette under the same 3D view transform used by polyhedra and revolved surfaces.
const PROJECTION_XX = 1 + OBLIQUE_X_PER_Z ** 2;
const PROJECTION_YY = 1 + OBLIQUE_SCREEN_Y_PER_Z ** 2;
const PROJECTION_XY = OBLIQUE_X_PER_Z * OBLIQUE_SCREEN_Y_PER_Z;
const PROJECTION_MAX_STRETCH = Math.sqrt(0.5 * (PROJECTION_XX + PROJECTION_YY
  + Math.hypot(PROJECTION_XX - PROJECTION_YY, 2 * PROJECTION_XY)));
export const SOLID3D_CANONICAL_CUBOID_ROLL_DEGREES = 0;
export const SOLID3D_CANONICAL_CUBE_ROTATION_X_DEGREES = 0;
// The front face is XY, so no local yaw is needed: X stays exactly horizontal and Y exactly vertical.
export const SOLID3D_CANONICAL_CUBE_ROTATION_Y_DEGREES = 0;
export const SOLID3D_CANONICAL_CUBE_ROTATION_Z_DEGREES = 0;
const canonicalPolygonPhase = (sides: number) => Math.PI / 2 - Math.PI / Math.max(3, sides);

/**
 * Canonical local 3D convention for model geometry, controls and persisted params:
 * +X points screen-right, +Y points screen-up, and +Z points toward/out of the screen. One fixed
 * cabinet-style oblique parallel view maps +X exactly horizontal, +Y exactly vertical, and +Z
 * diagonally left/down. Its depth ray is the null direction of the affine projection, so face
 * visibility and projected geometry share the same 3D view. Angles are degrees; scale precedes the
 * intrinsic Euler transform M = Rx * Ry * Rz, then view depth/occlusion and projection. `rotationZ`
 * turns about the current local depth axis. The board's 2D `rotation` remains an independent outer transform.
 */
export const SOLID3D_COORDINATE_CONVENTION = Object.freeze({
  axes: Object.freeze({ x: 'right', y: 'up', z: 'toward-camera' }),
  camera: 'fixed cabinet-style oblique parallel view; +Z depth ray has +X and +Y components',
  projection: 'affine cabinet projection; +X exactly right, +Y exactly up, +Z diagonally left/down',
  viewDirection: Object.freeze([...CAMERA]),
  rotationOrder: 'scale, then local Euler X/Y/Z; point matrix Rx * Ry * Rz (apply local Z, then Y, then X); translate in board space after projection',
  angleUnit: 'degrees',
  depth: 'normalized local axial/extrusion extent; independent of canvas width and height',
  planarRotation: 'independent DiagramShapeObject.rotation',
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

/** Apply the shared fixed screen projection to a vector in already-rotated model coordinates. */
export function projectSolid3DVector(point: readonly [number, number, number]): [number, number] {
  // Screen coordinates are right/down; local X and Y therefore project exactly horizontal/vertical.
  return [point[0] + OBLIQUE_X_PER_Z * point[2], -point[1] + OBLIQUE_SCREEN_Y_PER_Z * point[2]];
}

/** Signed oblique-view depth: positive values face the camera; negative values recede behind it. */
export function solid3DCameraDepth(point: readonly [number, number, number]): number {
  return point[0] * CAMERA[0] + point[1] * CAMERA[1] + point[2] * CAMERA[2];
}

function boxMesh(depth: number, baseRatio = 1): Mesh {
  const halfX = Math.max(0.25, Math.min(2.5, baseRatio)) / 2;
  return { vertices: [
    [-halfX, -0.5, -depth / 2], [halfX, -0.5, -depth / 2], [halfX, 0.5, -depth / 2], [-halfX, 0.5, -depth / 2],
    [-halfX, -0.5, depth / 2], [halfX, -0.5, depth / 2], [halfX, 0.5, depth / 2], [-halfX, 0.5, depth / 2],
  ], faces: [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [3, 7, 6, 2], [0, 4, 7, 3], [1, 2, 6, 5]] };
}

function regularPrismMesh(sides: number, depth: number, phase = canonicalPolygonPhase(sides), radius = 0.5): Mesh {
  const safeSides = Math.round(Math.max(3, Math.min(32, sides)));
  // Put both congruent polygon bases on horizontal XZ planes. The extrusion/height runs along
  // model +Y so triangular, pentagonal and hexagonal prism bases read as textbook top/bottom faces.
  const section: Vec2[] = Array.from({ length: safeSides }, (_, index) => {
    const angle = phase + index * Math.PI * 2 / safeSides;
    return [Math.cos(angle) * radius, Math.sin(angle) * radius];
  });
  const top: Vec3[] = section.map(([x, z]) => [x, depth / 2, z]);
  const bottom: Vec3[] = section.map(([x, z]) => [x, -depth / 2, z]);
  const faces: number[][] = [Array.from({ length: safeSides }, (_, index) => index),
    Array.from({ length: safeSides }, (_, index) => safeSides + (safeSides - 1 - index))];
  for (let index = 0; index < safeSides; index++) {
    const next = (index + 1) % safeSides;
    faces.push([index, next, safeSides + next, safeSides + index]);
  }
  return { vertices: [...top, ...bottom], faces };
}

const QUADRILATERAL_BASE_HALF_DEPTH = 0.8;

function convexQuadrilateralSection(insetRatio: number): Vec2[] {
  const inset = numberParam({ insetRatio }, 'insetRatio', 0.68, 0.25, 0.95);
  // A symmetric trapezoid lies in the true horizontal XZ plane. Its front and back edges are
  // local-X edges, so the shared cabinet projection renders both exactly level without rotating
  // or regularizing the requested base geometry.
  const halfDepth = QUADRILATERAL_BASE_HALF_DEPTH;
  return [[-0.5, halfDepth], [0.5, halfDepth], [inset / 2, -halfDepth], [-inset / 2, -halfDepth]];
}

function convexQuadrilateralPrismMesh(depth: number, insetRatio: number): Mesh {
  const section = convexQuadrilateralSection(insetRatio);
  const top = section.map(([x, z]): Vec3 => [x, depth / 2, z]);
  const bottom = section.map(([x, z]): Vec3 => [x, -depth / 2, z]);
  const faces: number[][] = [[0, 1, 2, 3], [7, 6, 5, 4]];
  for (let index = 0; index < 4; index++) {
    const next = (index + 1) % 4;
    faces.push([index, next, 4 + next, 4 + index]);
  }
  return { vertices: [...top, ...bottom], faces };
}

function convexQuadrilateralPyramidMesh(
  depth: number, insetRatio: number, apexOffsetX: number, apexOffsetZ: number,
): Mesh {
  const inset = numberParam({ insetRatio }, 'insetRatio', 0.68, 0.25, 0.95);
  const halfHeight = Math.max(0.15, Math.min(2.5, depth)) / 2;
  const section = convexQuadrilateralSection(inset);
  const base: Vec3[] = section.map(([x, z]) => [x, -halfHeight, z]);
  // Place an unshifted apex over the polygon's area centroid; explicit offsets then move only
  // the true apex in X/Z, without modifying/regularizing the base.
  const centroidZ = QUADRILATERAL_BASE_HALF_DEPTH
    - QUADRILATERAL_BASE_HALF_DEPTH * (1 + 2 * inset) / (3 * (1 + inset));
  const baseCenterX = 0;
  const baseCenterZ = centroidZ;
  const apex: Vec3 = [baseCenterX + numberParam({ apexOffsetX }, 'apexOffsetX', 0, -1, 1) * 0.5,
    halfHeight, baseCenterZ + numberParam({ apexOffsetZ }, 'apexOffsetZ', 0, -1, 1) * 0.5];
  return { vertices: [...base, apex], faces: [[3, 2, 1, 0], [0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]] };
}

function regularPyramidMesh(
  sides: number, depth: number, radius = 0.5, phase = canonicalPolygonPhase(sides), apexOffsetX = 0, apexOffsetZ = 0,
): Mesh {
  const safeSides = Math.round(Math.max(3, Math.min(32, sides)));
  // `depth` is the apex-to-base height, not a scale applied to one horizontal base axis.
  // The default is centered, but explicit X/Z offsets preserve useful oblique/non-right pyramids.
  const halfHeight = Math.max(0.15, Math.min(2.5, depth)) / 2;
  const vertices: Vec3[] = Array.from({ length: safeSides }, (_, index) => {
    const angle = phase + index * Math.PI * 2 / safeSides;
    return [Math.cos(angle) * radius, -halfHeight, Math.sin(angle) * radius];
  });
  const apex = vertices.length;
  vertices.push([apexOffsetX, halfHeight, apexOffsetZ]);
  const faces: number[][] = [Array.from({ length: safeSides }, (_, index) => safeSides - 1 - index)];
  for (let index = 0; index < safeSides; index++) faces.push([index, (index + 1) % safeSides, apex]);
  return { vertices, faces };
}

function pyramidFrustumMesh(sides: number, depth: number, topRatio: number, radius = 0.5, phase = canonicalPolygonPhase(sides)): Mesh {
  const safeSides = Math.round(Math.max(3, Math.min(32, sides)));
  const halfHeight = Math.max(0.15, Math.min(2.5, depth)) / 2;
  const base: Vec3[] = Array.from({ length: safeSides }, (_, index) => {
    const angle = phase + index * Math.PI * 2 / safeSides;
    return [Math.cos(angle) * radius, -halfHeight, Math.sin(angle) * radius];
  });
  const top: Vec3[] = Array.from({ length: safeSides }, (_, index) => {
    const angle = phase + index * Math.PI * 2 / safeSides;
    return [Math.cos(angle) * radius * topRatio, halfHeight, Math.sin(angle) * radius * topRatio];
  });
  const faces: number[][] = [Array.from({ length: safeSides }, (_, index) => safeSides - 1 - index),
    Array.from({ length: safeSides }, (_, index) => safeSides + index)];
  for (let index = 0; index < safeSides; index++) {
    const next = (index + 1) % safeSides;
    faces.push([index, next, safeSides + next, safeSides + index]);
  }
  return { vertices: [...base, ...top], faces };
}

/** Regular tetrahedron with a horizontal equilateral XZ base and one horizontal front edge. */
function tetrahedronMesh(heightRatio: number): Mesh {
  const radius = 1 / Math.sqrt(3), height = Math.sqrt(2 / 3) * Math.max(0.15, Math.min(2.5, heightRatio));
  const baseY = -height / 4, apexY = 3 * height / 4, phase = canonicalPolygonPhase(3);
  const vertices: Vec3[] = Array.from({ length: 3 }, (_, index) => {
    const angle = phase + index * Math.PI * 2 / 3;
    return [Math.cos(angle) * radius, baseY, Math.sin(angle) * radius];
  });
  vertices.push([0, apexY, 0]);
  return { vertices, faces: [[0, 2, 1], [0, 1, 3], [1, 2, 3], [2, 0, 3]] };
}

/**
 * Trirectangular tetrahedron: three pairwise-perpendicular legs meet at one lower base vertex.
 * The two horizontal legs form a right-triangular XZ base; the editable heightRatio is the
 * perpendicular +Y leg length relative to either unit base leg. Centering by the solid centroid
 * keeps the object's 3D pivot stable without moving the mathematically right-angle vertex.
 */
function rightTetrahedronMesh(heightRatio: number): Mesh {
  const legX = 1, legZ = 1, legY = Math.max(0.2, Math.min(2, heightRatio));
  const uncentered: Vec3[] = [
    [legX / 2, 0, legZ / 2],                 // right-angle vertex A
    [-legX / 2, 0, legZ / 2],                // A→B: -X
    [legX / 2, 0, -legZ / 2],                // A→C: -Z
    [legX / 2, legY, legZ / 2],              // A→D: +Y, perpendicular altitude
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
  return { vertices: [[radius, 0, 0], [-radius, 0, 0], [0, radius, 0], [0, -radius, 0], [0, 0, radius * depth], [0, 0, -radius * depth]],
    faces: [[2, 0, 4], [2, 4, 1], [2, 1, 5], [2, 5, 0], [3, 4, 0], [3, 1, 4], [3, 5, 1], [3, 0, 5]] };
}

export function solid3DScaleFromBounds(width: number, height: number, referenceWidth: number, referenceHeight: number, _geometry?: Solid3DGeometry): Solid3DScale {
  const sx = Math.max(0.01, Math.min(64, (Number.isFinite(width) ? width : referenceWidth) / Math.max(1, referenceWidth)));
  const sy = Math.max(0.01, Math.min(64, (Number.isFinite(height) ? height : referenceHeight) / Math.max(1, referenceHeight)));
  // Old records without a local scale still preserve independent canvas width and height. Their
  // unspecified receding axis uses the narrower ratio as a conservative depth fallback; new
  // objects persist all three independent local factors explicitly.
  return { x: sx, y: sy, z: Math.min(sx, sy) };
}

function normalizeScale(scale?: Solid3DScale, _geometry?: Solid3DGeometry): Solid3DScale {
  const safe = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? Math.max(0.01, Math.min(64, value)) : 1;
  // These are true pre-rotation local-axis scale factors, not a screen-space fit hint. Never
  // collapse them to a uniform value: X, Y and Z dimensions remain independently editable.
  return { x: safe(scale?.x), y: safe(scale?.y), z: safe(scale?.z) };
}

function sphereSurfaceMesh(longitudes = 32, latitudes = 16): Mesh {
  const radius = 0.5, vertices: Vec3[] = [[0, -radius, 0]], rings: number[][] = [];
  for (let latitude = 1; latitude < latitudes; latitude++) {
    const phi = -Math.PI / 2 + latitude * Math.PI / latitudes;
    const ring: number[] = [];
    for (let longitude = 0; longitude < longitudes; longitude++) {
      const theta = longitude * Math.PI * 2 / longitudes;
      ring.push(vertices.length);
      vertices.push([radius * Math.cos(phi) * Math.cos(theta), radius * Math.sin(phi), radius * Math.cos(phi) * Math.sin(theta)]);
    }
    rings.push(ring);
  }
  const top = vertices.length; vertices.push([0, radius, 0]);
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
  const radius = 0.5, topY = depth / 2, bottomY = -depth / 2;
  const topRadius = geometry === 'coneFrustum3d' ? radius * numberParam(params, 'topRadiusRatio', 0.38, 0.05, 0.95) : radius;
  const bottomRadius = radius;
  const vertices: Vec3[] = [];
  const ring = (y: number, r: number) => Array.from({ length: segments }, (_, index) => {
    const angle = index * Math.PI * 2 / segments;
    const id = vertices.length; vertices.push([Math.cos(angle) * r, y, Math.sin(angle) * r]); return id;
  });
  const bottom = ring(bottomY, bottomRadius);
  const top = geometry === 'cone3d' ? [] : ring(topY, topRadius);
  const apex = geometry === 'cone3d' ? vertices.push([0, topY, 0]) - 1 : -1;
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
  if (geometry === 'cube3d') return boxMesh(1, 1);
  if (geometry === 'cuboid3d') return boxMesh(depth, numberParam(params, 'baseRatio', 1.28, 0.5, 2.5));
  if (geometry === 'tetrahedron3d') return tetrahedronMesh(depth);
  if (geometry === 'rightTetrahedron3d') return rightTetrahedronMesh(numberParam(params, 'heightRatio', 0.6, 0.2, 2));
  if (geometry === 'octahedron3d') return octahedronMesh(depth);
  if (geometry === 'quadrilateralPrism3d')
    return convexQuadrilateralPrismMesh(depth, numberParam(params, 'baseInsetRatio', 0.68, 0.25, 0.95));
  if (geometry === 'quadrilateralPyramid3d')
    return convexQuadrilateralPyramidMesh(depth, numberParam(params, 'baseInsetRatio', 0.68, 0.25, 0.95),
      numberParam(params, 'apexOffsetX', 0, -1, 1), numberParam(params, 'apexOffsetZ', 0, -1, 1));
  if (geometry === 'pyramid3d' || geometry === 'pentagonalPyramid3d' || geometry === 'hexagonalPyramid3d') {
    const defaultSides = geometry === 'pentagonalPyramid3d' ? 5 : geometry === 'hexagonalPyramid3d' ? 6 : 4;
    const sides = Math.round(numberParam(params, 'sides', defaultSides, 3, 32));
    const squareBase = sides === 4, baseRadius = squareBase ? Math.SQRT1_2 : 0.5;
    const apexOffsetX = numberParam(params, 'apexOffsetX', 0, -1, 1) * baseRadius;
    const apexOffsetZ = numberParam(params, 'apexOffsetZ', 0, -1, 1) * baseRadius;
    return regularPyramidMesh(sides, depth, baseRadius, canonicalPolygonPhase(sides), apexOffsetX, apexOffsetZ);
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
  // M = Rx * Ry * Rz: apply a depth-axis roll in model coordinates, then local Y, then local X.
  const cosZ = Math.cos(radians(rotationZ)), sinZ = Math.sin(radians(rotationZ));
  const x1 = x * cosZ - y * sinZ, y1 = x * sinZ + y * cosZ, z1 = z;
  const cosY = Math.cos(radians(rotationY)), sinY = Math.sin(radians(rotationY));
  const x2 = x1 * cosY + z1 * sinY, z2 = -x1 * sinY + z1 * cosY;
  const cosX = Math.cos(radians(rotationX)), sinX = Math.sin(radians(rotationX));
  return [x2, y1 * cosX - z2 * sinX, y1 * sinX + z2 * cosX];
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
  const rotationY = Math.asin(Math.max(-1, Math.min(1, nextZ[0])));
  const cosineY = Math.cos(rotationY);
  let rotationX: number, rotationZ: number;
  if (Math.abs(cosineY) > 1e-8) {
    rotationX = Math.atan2(-nextZ[1], nextZ[2]);
    rotationZ = Math.atan2(-nextY[0], nextX[0]);
  } else {
    rotationX = 0;
    rotationZ = Math.atan2(nextX[1], nextY[1]);
  }
  const nearestDegrees = (angle: number, reference: number) => {
    const degrees = angle * 180 / Math.PI;
    return Math.max(-360, Math.min(360, degrees + 360 * Math.round((reference - degrees) / 360)));
  };
  return { rotationX: nearestDegrees(rotationX, start.rotationX), rotationY: nearestDegrees(rotationY, start.rotationY),
    rotationZ: nearestDegrees(rotationZ, start.rotationZ) };
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

// Canonical poses are geometry-aligned: model X/Y remain screen-horizontal/vertical and +Z
// supplies the coherent receding depth. Family-specific base/apex axes live in the mesh itself.
const DEFAULTS: Record<Solid3DGeometry, [number, number, number, number]> = {
  cube3d: [SOLID3D_CANONICAL_CUBE_ROTATION_X_DEGREES, SOLID3D_CANONICAL_CUBE_ROTATION_Y_DEGREES,
    SOLID3D_CANONICAL_CUBE_ROTATION_Z_DEGREES, 1],
  cuboid3d: [0, 0, SOLID3D_CANONICAL_CUBOID_ROLL_DEGREES, 0.72],
  cylinder3d: [0, 0, 0, 0.78], cone3d: [0, 0, 0, 0.78], coneFrustum3d: [0, 0, 0, 0.78], sphere3d: [0, 0, 0, 1],
  pyramid3d: [0, 0, 0, 1], quadrilateralPyramid3d: [0, 0, 0, 1],
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
    // One local XZ great circle: its projection is governed solely by the persisted XYZ pose.
    const localEquatorPoint = (angle: number): Vec3 => [Math.cos(angle) * radius, 0, Math.sin(angle) * radius];
    const pointAt = (angle: number) => transform(localEquatorPoint(angle));
    const normalAt = (angle: number) => transformNormal(localEquatorPoint(angle).map(value => value / radius) as Vec3);
    addCurve(splitParametricCurve('sphere:equator', pointAt, angle => dot(normalAt(angle), CAMERA), project, CURVE_SAMPLES));
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
    const ringPoint = (y: number, ringRadius: number, angle: number): Vec3 => [Math.cos(angle) * ringRadius, y, Math.sin(angle) * ringRadius];
    const ringSamples = (y: number, ringRadius: number): Vec3[] => Array.from({ length: CURVE_SAMPLES }, (_, index) => ringPoint(y, ringRadius, index * Math.PI * 2 / CURVE_SAMPLES));
    const topNormal: Vec3 = [0, 1, 0], bottomNormal: Vec3 = [0, -1, 0];
    let silhouetteSamples: Vec3[] = [];
    let sideNormalAt: (angle: number) => Vec3;
    let topY = heightModel / 2, bottomY = -heightModel / 2, topRadius = radius, bottomRadius = radius;

    if (geometry === 'cylinder3d') {
      topY = heightModel / 2; bottomY = -heightModel / 2;
      silhouetteSamples = [...ringSamples(topY, radius), ...ringSamples(bottomY, radius)];
      sideNormalAt = angle => [Math.cos(angle), 0, Math.sin(angle)];
    } else if (geometry === 'cone3d') {
      topY = heightModel / 2; bottomY = -heightModel / 2;
      silhouetteSamples = [...ringSamples(bottomY, radius), [0, topY, 0]];
      sideNormalAt = angle => normalize3([heightModel * Math.cos(angle), radius, heightModel * Math.sin(angle)]);
    } else {
      const ratio = numberParam(params, 'topRadiusRatio', 0.38, 0.05, 0.95);
      topRadius = radius * ratio; bottomRadius = radius;
      silhouetteSamples = [...ringSamples(topY, topRadius), ...ringSamples(bottomY, bottomRadius)];
      sideNormalAt = angle => normalize3([heightModel * Math.cos(angle), bottomRadius - topRadius, heightModel * Math.sin(angle)]);
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
      addCurve(splitParametricCurve('cylinder:top-rim', angle => transform(ringPoint(topY, radius, angle)), angle => visibleMargin(angle, topNormal), project, CURVE_SAMPLES));
      addCurve(splitParametricCurve('cylinder:bottom-rim', angle => transform(ringPoint(bottomY, radius, angle)), angle => visibleMargin(angle, bottomNormal), project, CURVE_SAMPLES));
    } else if (geometry === 'cone3d') {
      addCurve(splitParametricCurve('cone:base-rim', angle => transform(ringPoint(bottomY, radius, angle)), angle => visibleMargin(angle, bottomNormal), project, CURVE_SAMPLES));
    } else {
      addCurve(splitParametricCurve('cone-frustum:top-rim', angle => transform(ringPoint(topY, topRadius, angle)), angle => visibleMargin(angle, topNormal), project, CURVE_SAMPLES));
      addCurve(splitParametricCurve('cone-frustum:bottom-rim', angle => transform(ringPoint(bottomY, bottomRadius, angle)), angle => visibleMargin(angle, bottomNormal), project, CURVE_SAMPLES));
    }
    const cameraX = normalDepth([1, 0, 0]), cameraY = normalDepth([0, 1, 0]), cameraZ = normalDepth([0, 0, 1]);
    const sideA = geometry === 'cylinder3d' ? cameraX : heightModel * cameraX;
    const sideB = geometry === 'cylinder3d' ? cameraZ : heightModel * cameraZ;
    const sideC = geometry === 'cylinder3d' ? 0
      : (geometry === 'cone3d' ? radius : bottomRadius - topRadius) * cameraY;
    const tangentAngles = sinusoidRoots(sideA, sideB, sideC);
    tangentAngles.forEach((angle, index) => {
      const a = geometry === 'cone3d' ? [0, topY, 0] as Vec3 : ringPoint(topY, topRadius, angle);
      const b = ringPoint(bottomY, bottomRadius, angle);
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
      maxX: Math.max(...hull.map(point => point[0])), maxY: Math.max(...hull.map(point => point[1])) };
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
    'squarePrism3d', 'pentagonalPrism3d', 'hexagonalPrism3d'].includes(value);
}
