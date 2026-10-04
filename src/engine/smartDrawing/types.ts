export type SmartDrawingPoint = [number, number, number?];
export type Point2 = [number, number];
export type SmartDrawingKind = 'line' | 'rectangle' | 'ellipse' | 'triangle' | 'unchanged';
export type RecognizedShapeKind = Exclude<SmartDrawingKind, 'unchanged'>;

export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CandidateDiagnostic {
  kind: RecognizedShapeKind;
  geometryScore: number;
  templateScore: number;
  confidence: number;
  threshold: number;
  accepted: boolean;
  fitError?: number;
  reasons: string[];
}

export interface SmartDrawingResult {
  kind: SmartDrawingKind;
  confidence: number;
  /** Fitted endpoints for a line; otherwise the untouched source samples. */
  points: SmartDrawingPoint[];
  bounds?: Bounds;
  /** World-space vertices for polygonal editable shapes. */
  vertices?: Point2[];
  diagnostics?: CandidateDiagnostic[];
}

export interface StrokeBounds extends Bounds {
  diagonal: number;
}

export interface StrokeFeatures {
  pathLength: number;
  pathRatio: number;
  endpointGap: number;
  closureRatio: number;
  directness: number;
  isNearClosed: boolean;
  selfIntersects: boolean;
  signedTurn: number;
  absoluteTurn: number;
  cornerCount: number;
  cornerPoints: Point2[];
  cornerAngles: number[];
  area: number;
  circularity: number;
  angularCoverage: number;
  aspectRatio: number;
  bounds: StrokeBounds;
}

/** A normalized, bounded-cost copy; sourcePoints stay in untouched board coordinates. */
export interface PreparedStroke {
  sourcePoints: SmartDrawingPoint[];
  normalizedSource: Point2[];
  samples: Point2[];
  closedSamples: Point2[] | null;
  centerX: number;
  centerY: number;
  scale: number;
  sourceBounds: Bounds;
  endpointGap: number;
  traceLength: number;
  closedCandidate: boolean;
}

export interface GeometryProposal {
  kind: RecognizedShapeKind;
  geometryScore: number;
  fitError: number;
  reasons: string[];
  /** Candidate observations in its canonical, orientation-invariant template frame. */
  canonicalSamples: Point2[];
  normalizedBounds?: Bounds;
  normalizedVertices?: Point2[];
  normalizedLine?: [Point2, Point2];
  metrics: Record<string, number>;
}

export interface GeometryFitAttempt {
  fit?: GeometryProposal;
  diagnostic?: CandidateDiagnostic;
}

/** Implemented by the deterministic shape-specific stages; proposals share one ranking contract. */
export interface SmartShapeRecognizer {
  readonly kind: RecognizedShapeKind;
  propose(stroke: PreparedStroke, features: StrokeFeatures): GeometryFitAttempt;
}

export interface GeometryAnalysis {
  features: StrokeFeatures;
  fits: GeometryProposal[];
  diagnostics: CandidateDiagnostic[];
}

export const RECOGNITION_SAMPLE_COUNT = 96;
export const TEMPLATE_SAMPLE_COUNT = 64;
export const SMART_DRAWING_THRESHOLDS: Record<RecognizedShapeKind, number> = {
  line: 0.70,
  rectangle: 0.69,
  triangle: 0.68,
  ellipse: 0.71,
};
