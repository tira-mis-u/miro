export { recognizeSmartDrawing } from './smartDrawing/recognizer';
export { preprocessSmartStroke } from './smartDrawing/preprocess';
export { analyzeSmartStroke, generateGeometryCandidates, DETERMINISTIC_SHAPE_RECOGNIZERS } from './smartDrawing/geometry';
export { matchSmartTemplate, SMART_DRAWING_TEMPLATES } from './smartDrawing/templates';
export { SMART_DRAWING_THRESHOLDS } from './smartDrawing/types';
export type {
  Bounds,
  CandidateDiagnostic,
  GeometryAnalysis,
  GeometryProposal,
  Point2,
  PreparedStroke,
  RecognizedShapeKind,
  SmartDrawingKind,
  SmartDrawingPoint,
  SmartDrawingResult,
  SmartShapeRecognizer,
  GeometryFitAttempt,
  StrokeFeatures,
} from './smartDrawing/types';
