// ─── Formula DOM Renderer v2 ─── Box-model layout engine tương đương Word ───
// Sử dụng relative positioning, proper baseline, scaled operators
import type { FormulaNode } from './types';
import { MATH_SCALES as S } from './types';

// ─── Constants ──────────────────────────────────────────────────────────────
const MATH_FONT = "'Cambria Math','Times New Roman','STIX Two Math','Latin Modern Math',serif";

// Cache cho các node đã render (memoization)
const renderCache = new WeakMap<FormulaNode, string>();

// ─── Utility: check nếu row chỉ có 1 placeholder (empty slot) ─────────────
function isEmptyRow(node: FormulaNode | undefined): boolean {
  if (!node) return true;
  if (node.type === 'placeholder') return true;
  if (node.type === 'row') {
    const ch = node.children || [];
    return ch.length === 0 || (ch.length === 1 && ch[0].meta?.isPlaceholder === true);
  }
  return false;
}

interface RenderOptions {
  isStatic?: boolean;
}

/** Render FormulaNode → HTML string (cho edit preview) */
export function renderFormulaToHTML(node: FormulaNode, fontSize: number = 18): string {
  return `<div class="fm" style="font-size:${fontSize}px;font-family:${MATH_FONT};line-height:1.2;display:inline-flex;align-items:center;color:#1a1a1a">${renderNode(node, fontSize, { isStatic: false })}</div>`;
}

/** Render for canvas overlay (static display, no interactivity) */
export function renderFormulaStatic(node: FormulaNode, fontSize: number = 14): string {
  return `<div class="fm" style="font-size:${fontSize}px;font-family:${MATH_FONT};line-height:1.2;display:inline-flex;align-items:center;user-select:none;color:#1a1a1a">${renderNode(node, fontSize, { isStatic: true })}</div>`;
}

// ─── Core render function ───────────────────────────────────────────────────
function renderNode(node: FormulaNode, fs: number, opts: RenderOptions = {}): string {
  const cached = renderCache.get(node);
  if (cached) return cached;

  let html = '';

  switch (node.type) {
    // ━━━ Atomic nodes ━━━
    case 'symbol':
      if (node.value === ' ') {
        html = `<span class="fm-sym" data-id="${node.id}" style="white-space:pre-wrap">&nbsp;</span>`;
      } else {
        html = `<span class="fm-sym" data-id="${node.id}" style="font-style:italic;padding:0 0.05em">${esc(node.value || '')}</span>`;
      }
      break;

    case 'operator':
      html = `<span class="fm-op" data-id="${node.id}" style="padding:0 0.2em;font-style:normal">${esc(node.value || '')}</span>`;
      break;

    case 'number':
      html = `<span class="fm-num" data-id="${node.id}" style="font-style:normal;padding:0 0.03em">${esc(node.value || '')}</span>`;
      break;

    case 'text':
      html = `<span class="fm-txt" data-id="${node.id}" style="font-style:normal;font-family:'Inter','Segoe UI',sans-serif">${esc(node.value || '')}</span>`;
      break;

    // ━━━ Placeholder ━━━
    case 'placeholder':
      html = `<span class="fm-ph ${opts.isStatic ? 'fm-ph-ghost' : ''}" data-id="${node.id}"></span>`;
      break;

    // ━━━ Row (basic container) ━━━
    case 'row':
      html = `<span class="fm-row" data-id="${node.id}">${(node.children || []).map(c => renderNode(c, fs, opts)).join('')}</span>`;
      break;

    // ━━━ Fraction ━━━ numerator / denominator with bar
    case 'fraction': {
      const [numer, denom] = node.children || [];
      const subFs = fs * S.FRAC_NUMERATOR;
      html = `<span class="fm-frac" data-id="${node.id}"><span class="fm-frac-n">${renderNode(numer, subFs, opts)}</span><span class="fm-frac-bar"></span><span class="fm-frac-d">${renderNode(denom, subFs, opts)}</span></span>`;
      break;
    }

    // ━━━ Square root / Nth root ━━━
    case 'root': {
      const [body, degree] = node.children || [];
      const degH = degree ? `<span class="fm-root-deg">${renderNode(degree, fs * S.ROOT_DEGREE, opts)}</span>` : '';
      html = `<span class="fm-root" data-id="${node.id}">${degH}<span class="fm-root-surd">√</span><span class="fm-root-body">${renderNode(body, fs, opts)}</span></span>`;
      break;
    }

    // ━━━ Superscript ━━━
    case 'sup': {
      const [base, sup] = node.children || [];
      html = `<span class="fm-script" data-id="${node.id}"><span class="fm-base">${renderNode(base, fs, opts)}</span><span class="fm-sup">${renderNode(sup, fs * S.SUP_SUB, opts)}</span></span>`;
      break;
    }

    // ━━━ Subscript ━━━
    case 'sub': {
      const [base, sub] = node.children || [];
      html = `<span class="fm-script" data-id="${node.id}"><span class="fm-base">${renderNode(base, fs, opts)}</span><span class="fm-sub">${renderNode(sub, fs * S.SUP_SUB, opts)}</span></span>`;
      break;
    }

    // ━━━ Superscript + Subscript ━━━
    case 'supsub': {
      const [base, sup, sub] = node.children || [];
      html = `<span class="fm-script" data-id="${node.id}"><span class="fm-base">${renderNode(base, fs, opts)}</span><span class="fm-supsub-col"><span class="fm-sup">${renderNode(sup, fs * S.SUP_SUB, opts)}</span><span class="fm-sub">${renderNode(sub, fs * S.SUP_SUB, opts)}</span></span></span>`;
      break;
    }

    // ━━━ Integral ∫ ━━━
    case 'integral': {
      const [lower, upper, body] = node.children || [];
      const opFs = fs * S.INTEGRAL;
      const bndFs = fs * S.BOUNDS;
      const showUpper = !isEmptyRow(upper);
      const showLower = !isEmptyRow(lower);
      html = `<span class="fm-bigop" data-id="${node.id}"><span class="fm-bigop-core"><span class="fm-bigop-upper" style="${showUpper ? '' : 'display:none'}">${renderNode(upper, bndFs, opts)}</span><span class="fm-bigop-sym" style="font-size:${opFs}px">∫</span><span class="fm-bigop-lower" style="${showLower ? '' : 'display:none'}">${renderNode(lower, bndFs, opts)}</span></span><span class="fm-bigop-body">${renderNode(body, fs, opts)}</span></span>`;
      break;
    }

    // ━━━ Summation ∑ ━━━
    case 'sum': {
      const [lower, upper, body] = node.children || [];
      const opFs = fs * S.SUM_PRODUCT;
      const bndFs = fs * S.BOUNDS;
      const showUpper = !isEmptyRow(upper);
      const showLower = !isEmptyRow(lower);
      html = `<span class="fm-bigop" data-id="${node.id}"><span class="fm-bigop-core"><span class="fm-bigop-upper" style="${showUpper ? '' : 'display:none'}">${renderNode(upper, bndFs, opts)}</span><span class="fm-bigop-sym" style="font-size:${opFs}px">∑</span><span class="fm-bigop-lower" style="${showLower ? '' : 'display:none'}">${renderNode(lower, bndFs, opts)}</span></span><span class="fm-bigop-body">${renderNode(body, fs, opts)}</span></span>`;
      break;
    }

    // ━━━ Product ∏ ━━━
    case 'product': {
      const [lower, upper, body] = node.children || [];
      const opFs = fs * S.SUM_PRODUCT;
      const bndFs = fs * S.BOUNDS;
      const showUpper = !isEmptyRow(upper);
      const showLower = !isEmptyRow(lower);
      html = `<span class="fm-bigop" data-id="${node.id}"><span class="fm-bigop-core"><span class="fm-bigop-upper" style="${showUpper ? '' : 'display:none'}">${renderNode(upper, bndFs, opts)}</span><span class="fm-bigop-sym" style="font-size:${opFs}px">∏</span><span class="fm-bigop-lower" style="${showLower ? '' : 'display:none'}">${renderNode(lower, bndFs, opts)}</span></span><span class="fm-bigop-body">${renderNode(body, fs, opts)}</span></span>`;
      break;
    }

    // ━━━ Limit ━━━
    case 'limit': {
      const [variable, body] = node.children || [];
      const lowerFs = fs * S.LIMIT_LOWER;
      html = `<span class="fm-lim" data-id="${node.id}"><span class="fm-lim-core"><span class="fm-lim-op">lim</span><span class="fm-lim-lower">${renderNode(variable, lowerFs, opts)}</span></span><span class="fm-lim-body">${renderNode(body, fs, opts)}</span></span>`;
      break;
    }

    // ━━━ Delimiters ━━━
    case 'parens': {
      const inner = (node.children || [])[0];
      html = `<span class="fm-delim" data-id="${node.id}"><span class="fm-delim-l">(</span><span class="fm-delim-inner">${renderNode(inner, fs, opts)}</span><span class="fm-delim-r">)</span></span>`;
      break;
    }
    case 'brackets': {
      const inner = (node.children || [])[0];
      html = `<span class="fm-delim" data-id="${node.id}"><span class="fm-delim-l">[</span><span class="fm-delim-inner">${renderNode(inner, fs, opts)}</span><span class="fm-delim-r">]</span></span>`;
      break;
    }
    case 'braces': {
      const inner = (node.children || [])[0];
      html = `<span class="fm-delim" data-id="${node.id}"><span class="fm-delim-l">{</span><span class="fm-delim-inner">${renderNode(inner, fs, opts)}</span><span class="fm-delim-r">}</span></span>`;
      break;
    }

    // ━━━ Matrix ━━━
    case 'matrix': {
      const [rows, cols] = (node.value || '2x2').split('x').map(Number);
      const cells = node.children || [];
      let grid = '';
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const cell = cells[r * cols + c];
          grid += `<span class="fm-matrix-cell">${cell ? renderNode(cell, fs * 0.9, opts) : ''}</span>`;
        }
      }
      html = `<span class="fm-matrix" data-id="${node.id}"><span class="fm-delim-l" style="font-size:1.6em">(</span><span class="fm-matrix-grid" style="grid-template-columns:repeat(${cols},auto)">${grid}</span><span class="fm-delim-r" style="font-size:1.6em">)</span></span>`;
      break;
    }

    default:
      html = `<span data-id="${node.id}">${esc(node.value || '')}</span>`;
  }

  renderCache.set(node, html);
  return html;
}

/** Clear render cache */
export function clearRenderCache() {
  // WeakMap auto-cleans when nodes are GC'd
}

// HTML escaping
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
