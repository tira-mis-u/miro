import type { CandidateDiagnostic, GeometryProposal, Point2, SmartDrawingPoint, SmartDrawingResult } from './types';
import { SMART_DRAWING_THRESHOLDS } from './types';
import { analyzeSmartStroke, generateGeometryCandidates } from './geometry';
import { preprocessSmartStroke, toWorldBounds, toWorldPoint } from './preprocess';
import { matchSmartTemplate } from './templates';

interface ScoredCandidate {
  fit: GeometryProposal;
  diagnostic: CandidateDiagnostic;
  confidence: number;
  templateId: string;
}

function sourceCopy(input: number[][]): SmartDrawingPoint[] {
  return input.map(point => {
    const [x, y, pressure] = point;
    return Number.isFinite(pressure) ? [x, y, pressure] : [x, y];
  });
}

function candidateAspect(fit: GeometryProposal): number | undefined {
  if (fit.kind === 'line') return undefined;
  if (fit.kind === 'ellipse') return fit.metrics.axisRatio;
  if (fit.kind === 'rectangle' || fit.kind === 'parallelogram' || fit.kind === 'trapezoid') {
    const aspect = fit.metrics.aspect;
    return Number.isFinite(aspect) && aspect > 0 ? Math.max(aspect, 1 / aspect) : undefined;
  }
  if (fit.normalizedBounds) {
    const aspect = fit.normalizedBounds.w / Math.max(1e-9, fit.normalizedBounds.h);
    return Math.max(aspect, 1 / aspect);
  }
  return undefined;
}

function scoredDiagnostic(fit: GeometryProposal, templateScore: number, templateId: string): CandidateDiagnostic {
  const threshold = SMART_DRAWING_THRESHOLDS[fit.kind];
  const confidence = Math.max(0, Math.min(1, fit.geometryScore * 0.64 + templateScore * 0.36));
  const reasons = [...fit.reasons, `template=${templateId}`, `geometry=${fit.geometryScore.toFixed(3)}`,
    `template-score=${templateScore.toFixed(3)}`, `confidence=${confidence.toFixed(3)}`];
  if (fit.geometryScore < 0.42) reasons.push('geometry-score-below-floor');
  const templateFloor = 0.25;
  const templatePass = templateScore >= templateFloor || fit.geometryScore >= 0.70;
  if (!templatePass) reasons.push('template-similarity-below-floor');
  if (confidence < threshold) reasons.push('shape-threshold-not-met');
  return { kind: fit.kind, geometryScore: fit.geometryScore, templateScore, confidence, threshold,
    accepted: confidence >= threshold && fit.geometryScore >= 0.42 && templatePass,
    fitError: fit.fitError, reasons };
}

function unchanged(points: SmartDrawingPoint[], diagnostics: CandidateDiagnostic[] = [], confidence = 0): SmartDrawingResult {
  return { kind: 'unchanged', confidence, points, diagnostics };
}

/** Deterministic geometry + feature-template recognizer. No learned or remote model is used. */
export function recognizeSmartDrawing(input: number[][], strokeSize = 6): SmartDrawingResult {
  // Stroke width is styling, not a geometric threshold: board-space normalization
  // keeps classification invariant to zoom, translation, and the selected pen size.
  void strokeSize;
  const original = sourceCopy(input);
  const prepared = preprocessSmartStroke(input);
  if (!prepared) return unchanged(original);
  const features = analyzeSmartStroke(prepared);
  const analysis = generateGeometryCandidates(prepared, features);
  const scored: ScoredCandidate[] = [];
  const diagnostics = [...analysis.diagnostics];

  for (const fit of analysis.fits) {
    const template = matchSmartTemplate(fit.kind, fit.canonicalSamples,
      { pathRatio: features.pathRatio, cornerCount: features.cornerCount }, candidateAspect(fit));
    const diagnostic = scoredDiagnostic(fit, template.score, template.templateId);
    diagnostics.push(diagnostic);
    scored.push({ fit, diagnostic, confidence: diagnostic.confidence, templateId: template.templateId });
  }
  scored.sort((left, right) => right.confidence - left.confidence || left.fit.kind.localeCompare(right.fit.kind));

  const accepted = scored.filter(c => c.diagnostic.accepted);
  if (!accepted.length) return unchanged(original, diagnostics, scored[0]?.confidence ?? 0);

  let best = accepted[0];
  const runnerUp = accepted[1];

  const isQuad = (kind: string) => kind === 'rectangle' || kind === 'diamond' || kind === 'parallelogram' || kind === 'trapezoid';

  // 1. Decisive Curved (Ellipse) vs Polygonal quad (Rect / Parallelogram / Trapezoid / Diamond):
  // A curved shape (circle/oval) must NEVER be mistaken for a quad.
  const ellipseCandidate = accepted.find(c => c.fit.kind === 'ellipse');
  if (ellipseCandidate && isQuad(best.fit.kind)) {
    const sharpCorners = features.cornerAngles.filter(a => a >= 0.75).length;
    if (sharpCorners < 3 || features.circularity >= 0.65 || ellipseCandidate.fit.fitError <= 0.125) {
      best = ellipseCandidate;
    }
  } else if (best.fit.kind === 'ellipse') {
    const quadCandidate = accepted.find(c => isQuad(c.fit.kind));
    if (quadCandidate) {
      const sharpCorners = features.cornerAngles.filter(a => a >= 0.75).length;
      if (sharpCorners >= 3 && features.circularity < 0.65 && quadCandidate.fit.fitError < best.fit.fitError) {
        best = quadCandidate;
      }
    }
  }

  // 2. Principled ambiguity resolution when two accepted candidates have close confidence
  if (runnerUp && best !== runnerUp && (best.confidence - runnerUp.confidence) <= 0.08) {
    let resolved = false;

    // Rectangle vs Parallelogram:
    if ((best.fit.kind === 'rectangle' && runnerUp.fit.kind === 'parallelogram') ||
        (best.fit.kind === 'parallelogram' && runnerUp.fit.kind === 'rectangle')) {
      const parCandidate = best.fit.kind === 'parallelogram' ? best : runnerUp;
      const rectCandidate = best.fit.kind === 'rectangle' ? best : runnerUp;
      const skewAngle = parCandidate.fit.metrics.skewAngle ?? 0;
      if (skewAngle >= 0.13) {
        best = parCandidate;
        resolved = true;
      } else {
        best = rectCandidate;
        resolved = true;
      }
    }
    // Rectangle vs Diamond:
    else if ((best.fit.kind === 'rectangle' && runnerUp.fit.kind === 'diamond') ||
             (best.fit.kind === 'diamond' && runnerUp.fit.kind === 'rectangle')) {
      const diamond = best.fit.kind === 'diamond' ? best : runnerUp;
      const rect = best.fit.kind === 'rectangle' ? best : runnerUp;
      if (features.area <= 0.65) {
        best = diamond;
        resolved = true;
      } else {
        best = rect;
        resolved = true;
      }
    }
    // Line vs Arrow:
    else if ((best.fit.kind === 'line' && runnerUp.fit.kind === 'arrow') ||
             (best.fit.kind === 'arrow' && runnerUp.fit.kind === 'line')) {
      const arrow = best.fit.kind === 'arrow' ? best : runnerUp;
      const line = best.fit.kind === 'line' ? best : runnerUp;
      if (arrow.fit.metrics.maxLateral && arrow.fit.metrics.maxLateral >= 0.035 * (arrow.fit.metrics.shaftLength || 1)) {
        best = arrow;
        resolved = true;
      } else {
        best = line;
        resolved = true;
      }
    }
    // Trapezoid vs Rectangle / Parallelogram:
    else if (best.fit.kind === 'trapezoid' && (runnerUp.fit.kind === 'rectangle' || runnerUp.fit.kind === 'parallelogram')) {
      resolved = true;
    } else if ((best.fit.kind === 'rectangle' || best.fit.kind === 'parallelogram') && runnerUp.fit.kind === 'trapezoid') {
      resolved = true;
    }

    if (!resolved && (best.confidence - runnerUp.confidence) <= 0.02) {
      best.diagnostic.accepted = false;
      best.diagnostic.reasons.push(`ambiguous-between-${best.fit.kind}-and-${runnerUp.fit.kind}`);
      return unchanged(original, diagnostics, best.confidence);
    }
  }

  for (const candidate of scored) candidate.diagnostic.accepted = candidate === best;
  if ((best.fit.kind === 'line' || best.fit.kind === 'arrow') && best.fit.normalizedLine) {
    const points = best.fit.normalizedLine.map((point, index) => {
      const world = toWorldPoint(prepared, point);
      const source = index === 0 ? original[0] : original[original.length - 1];
      return Number.isFinite(source?.[2]) ? [world[0], world[1], source[2]] as SmartDrawingPoint : [world[0], world[1]] as SmartDrawingPoint;
    });
    return { kind: best.fit.kind, confidence: best.confidence, points, diagnostics };
  }

  if (!best.fit.normalizedBounds) return unchanged(original, diagnostics, best.confidence);
  const bounds = toWorldBounds(prepared, best.fit.normalizedBounds);
  const vertices: Point2[] | undefined = best.fit.normalizedVertices?.map(point => toWorldPoint(prepared, point));
  const rotation = best.fit.metrics.rotation;
  return { kind: best.fit.kind, confidence: best.confidence, points: original, bounds,
    ...(rotation && Math.abs(rotation) >= 1.0 ? { rotation } : {}),
    ...(vertices ? { vertices } : {}), diagnostics };
}
