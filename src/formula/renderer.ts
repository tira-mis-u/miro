// KaTeX-backed renderer shared by palette previews, the formula editor, and static canvas objects.
import katex from 'katex';
import 'katex/dist/katex.min.css';
import type { FormulaNode } from './types';
import { serializeToLatex } from './ast';

const MAX_FONT_SIZE = 180;

export interface FormulaRenderOptions {
  /** Apply real TeX display style without changing the expression or its math layout. */
  mathStyle?: 'text' | 'display';
}

function presentEditableSlots(node: FormulaNode): FormulaNode {
  if (node.type === 'placeholder') {
    // Keep the source placeholder editable, but display it as KaTeX's real outlined square glyph.
    return { ...node, type: 'symbol', value: '\\square', children: undefined, meta: { ...node.meta, isPlaceholder: false } };
  }
  return { ...node, children: node.children?.map(presentEditableSlots) };
}

function renderLatex(latexSource: string, fontSize: number, staticDisplay: boolean, options: FormulaRenderOptions = {}): string {
  const safeSize = Math.max(8, Math.min(MAX_FONT_SIZE, Number.isFinite(fontSize) ? fontSize : 18));
  const rawLatex = latexSource || '\\,';
  const latex = options.mathStyle === 'display' ? `\\displaystyle ${rawLatex}` : rawLatex;
  const fallback = () => {
    const escaped = rawLatex.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<span class="fm-render-error" role="status" aria-label="Formula could not be rendered; showing safe source fallback" style="display:inline-block;font-family:ui-monospace,monospace;font-size:${safeSize}px;line-height:1.35;color:#b42318;background:#fff4f2;border:1px solid #f1b4ac;border-radius:4px;padding:4px 7px;white-space:pre-wrap">Formula could not be rendered: ${escaped}</span>`;
  };

  try {
    const rendered = katex.renderToString(latex, {
      displayMode: false,
      throwOnError: true,
      strict: 'ignore',
      output: 'htmlAndMathml',
      maxExpand: 1000,
      maxSize: 300,
      errorColor: '#c2413b',
    });
    if (rendered.includes('katex-error')) return fallback();
    const staticClass = staticDisplay ? ' math-render-static' : ' math-render-edit-preview';
    return `<span class="math-render-root${staticClass}" style="display:inline-block;font-size:${safeSize}px;line-height:1.25;color:inherit;${staticDisplay ? 'user-select:none;' : ''}">${rendered}</span>`;
  } catch {
    // Preview failure is local; the original editor source remains authoritative and unchanged.
    return fallback();
  }
}

/** Render an AST for viewing. Editable template slots use KaTeX's supported square symbol without mutating source. */
export function renderFormulaToHTML(node: FormulaNode, fontSize = 18, options: FormulaRenderOptions = {}): string {
  const previewNode = presentEditableSlots(node);
  return renderLatex(serializeToLatex(previewNode), fontSize, false, options);
}

/** Render a trusted, source-level TeX preview through the same bundled KaTeX configuration. */
export function renderLatexToHTML(latex: string, fontSize = 18, options: FormulaRenderOptions = {}): string {
  return renderLatex(latex, fontSize, false, options);
}

export function renderFormulaStatic(node: FormulaNode, fontSize = 14): string {
  const previewNode = presentEditableSlots(node);
  return renderLatex(serializeToLatex(previewNode), fontSize, true);
}

export function isFormulaRenderable(node: FormulaNode, fontSize = 18): boolean {
  return !renderFormulaToHTML(node, fontSize).includes('fm-render-error');
}

export function clearRenderCache(): void {
  // KaTeX rendering is deterministic; palette markup itself is cached by MathToolsPanel.
}
