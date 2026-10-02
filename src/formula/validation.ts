import type { FormulaNode } from './types';
import { parseTelex } from './parser';
import { isFormulaRenderable } from './renderer';

function hasBalancedTelexGroups(source: string): boolean {
  const stack: string[] = [];
  const closeFor: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (character === '\\' && ['(', ')', '[', ']', '{', '}'].includes(source[index + 1] || '')) {
      index++;
      continue;
    }
    if (character === '(' || character === '{') stack.push(character);
    else if (character === '[') {
      const leftDelimiterPrefix = source.slice(Math.max(0, index - '\\left'.length), index) === '\\left';
      const rightDot = source.indexOf('\\right.', index + 1);
      const rightSquare = source.indexOf('\\right]', index + 1);
      const isOneSidedLeftSquare = leftDelimiterPrefix && rightDot >= 0 && (rightSquare < 0 || rightDot < rightSquare);
      if (!isOneSidedLeftSquare) stack.push(character);
    } else if (character === ')' || character === ']' || character === '}') {
      if (stack.pop() !== closeFor[character]) return false;
    }
  }
  return stack.length === 0;
}

/** Accept a Telex draft only when it is balanced, parseable, and renders without fallback. */
export function parseRenderableFormula(source: string, fontSize: number): FormulaNode | null {
  if (!source.trim() || !hasBalancedTelexGroups(source)) return null;
  try {
    const candidate = parseTelex(source);
    return isFormulaRenderable(candidate, fontSize) ? candidate : null;
  } catch {
    return null;
  }
}

export interface InitialFormulaPreview {
  previewText: string;
  ast: FormulaNode | null;
  sourceError: boolean;
  refreshStoredPreview: boolean;
}

/** Prefer valid authoritative source over a stale derived preview when an editor is reopened. */
export function resolveInitialFormulaPreview(source: string, storedPreview: string | undefined, fontSize: number): InitialFormulaPreview {
  const fallbackPreview = storedPreview?.trim() ? storedPreview : source;
  const currentSourceAst = source.trim() ? parseRenderableFormula(source, fontSize) : null;
  if (currentSourceAst) {
    return {
      previewText: source,
      ast: currentSourceAst,
      sourceError: false,
      refreshStoredPreview: fallbackPreview !== source,
    };
  }
  return {
    previewText: fallbackPreview,
    ast: null,
    sourceError: source.trim() === '' ? fallbackPreview.trim() !== '' : true,
    refreshStoredPreview: false,
  };
}
