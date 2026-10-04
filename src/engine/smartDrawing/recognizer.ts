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
  if (fit.kind === 'rectangle') {
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
  if (fit.geometryScore < 0.48) reasons.push('geometry-score-below-floor');
  if (templateScore < 0.54) reasons.push('template-similarity-below-floor');
  if (confidence < threshold) reasons.push('shape-threshold-not-met');
  return { kind: fit.kind, geometryScore: fit.geometryScore, templateScore, confidence, threshold,
    accepted: confidence >= threshold && fit.geometryScore >= 0.48 && templateScore >= 0.54,
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
  const best = scored[0];
  if (!best || !best.diagnostic.accepted) return unchanged(original, diagnostics, best?.confidence ?? 0);

  const runnerUp = scored.find(candidate => candidate.fit.kind !== best.fit.kind);
  if (runnerUp && runnerUp.confidence >= best.confidence - 0.035) {
    best.diagnostic.accepted = false;
    best.diagnostic.reasons.push(`ambiguous-with-${runnerUp.fit.kind}`);
    return unchanged(original, diagnostics, best.confidence);
  }

  for (const candidate of scored) candidate.diagnostic.accepted = candidate === best;
  if (best.fit.kind === 'line' && best.fit.normalizedLine) {
    const points = best.fit.normalizedLine.map((point, index) => {
      const world = toWorldPoint(prepared, point);
      const source = index === 0 ? original[0] : original[original.length - 1];
      return Number.isFinite(source?.[2]) ? [world[0], world[1], source[2]] as SmartDrawingPoint : [world[0], world[1]] as SmartDrawingPoint;
    });
    return { kind: 'line', confidence: best.confidence, points, diagnostics };
  }

  if (!best.fit.normalizedBounds) return unchanged(original, diagnostics, best.confidence);
  const bounds = toWorldBounds(prepared, best.fit.normalizedBounds);
  const vertices: Point2[] | undefined = best.fit.normalizedVertices?.map(point => toWorldPoint(prepared, point));
  return { kind: best.fit.kind, confidence: best.confidence, points: original, bounds,
    ...(vertices ? { vertices } : {}), diagnostics };
}
