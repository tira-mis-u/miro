// ─── Formula AST Operations ─── Thao tác cây AST cho Formula Editor ───
import type { FormulaNode, NodeType, NodeRole, CursorPosition, MatrixDelimiter, AccentKind } from './types';

let _counter = 0;
export function nodeId(): string {
  return 'fn_' + (++_counter).toString(36) + '_' + Math.random().toString(36).slice(2, 5);
}

// ─── Factory functions ──────────────────────────────────────────────────────
export function createNode(type: NodeType, value?: string, children?: FormulaNode[], role?: NodeRole): FormulaNode {
  return {
    id: nodeId(),
    type,
    role,
    value,
    children,
    meta: type === 'placeholder' ? { isPlaceholder: true, editable: true } : { editable: true },
  };
}

export function createSymbol(value: string): FormulaNode {
  return createNode('symbol', value);
}

export function createOperator(value: string): FormulaNode {
  return createNode('operator', value);
}

export function createNumber(value: string): FormulaNode {
  return createNode('number', value);
}

export function createText(value: string): FormulaNode {
  return createNode('text', value);
}

export function createPlaceholder(): FormulaNode {
  return createNode('placeholder', '□');
}

export function createRow(children: FormulaNode[] = []): FormulaNode {
  return createNode('row', undefined, children.length ? children : [createPlaceholder()]);
}

export function createFraction(numer?: FormulaNode[], denom?: FormulaNode[]): FormulaNode {
  const n = createRow(numer || []); n.role = 'numerator';
  const d = createRow(denom || []); d.role = 'denominator';
  return createNode('fraction', undefined, [n, d]);
}

export function createRoot(index?: FormulaNode[], body?: FormulaNode[]): FormulaNode {
  const b = createRow(body || []); b.role = 'radicand';
  if (index) {
    const deg = createRow(index); deg.role = 'degree';
    return createNode('root', undefined, [b, deg]);
  }
  return createNode('root', undefined, [b]);
}

export function createSqrt(body?: FormulaNode[]): FormulaNode {
  const b = createRow(body || []); b.role = 'radicand';
  return createNode('root', undefined, [b]);
}

export function createSup(base?: FormulaNode[], sup?: FormulaNode[]): FormulaNode {
  const b = createRow(base || []); b.role = 'base';
  const s = createRow(sup || []); s.role = 'sup';
  return createNode('sup', undefined, [b, s]);
}

export function createSub(base?: FormulaNode[], sub?: FormulaNode[]): FormulaNode {
  const b = createRow(base || []); b.role = 'base';
  const s = createRow(sub || []); s.role = 'sub';
  return createNode('sub', undefined, [b, s]);
}

export function createSupSub(base?: FormulaNode[], sup?: FormulaNode[], sub?: FormulaNode[]): FormulaNode {
  const b = createRow(base || []); b.role = 'base';
  const sp = createRow(sup || []); sp.role = 'sup';
  const sb = createRow(sub || []); sb.role = 'sub';
  return createNode('supsub', undefined, [b, sp, sb]);
}

function createFormulaSlot(nodes: FormulaNode[] | undefined, role: NodeRole, initiallyEmpty = false): FormulaNode {
  const row = createRow(nodes || []);
  row.role = role;
  if (!nodes || nodes.length === 0) row.meta = { ...row.meta, isPlaceholder: initiallyEmpty };
  else row.meta = { ...row.meta, isPlaceholder: false };
  return row;
}

export function createIntegral(
  lower?: FormulaNode[], upper?: FormulaNode[], body?: FormulaNode[], operator = 'int'
): FormulaNode {
  return createNode('integral', operator, [
    createFormulaSlot(lower, 'lower', true),
    createFormulaSlot(upper, 'upper', true),
    createFormulaSlot(body, 'body', true),
  ]);
}

export function createSum(lower?: FormulaNode[], upper?: FormulaNode[], body?: FormulaNode[]): FormulaNode {
  return createNode('sum', 'sum', [
    createFormulaSlot(lower, 'lower', true),
    createFormulaSlot(upper, 'upper', true),
    createFormulaSlot(body, 'body', true),
  ]);
}

export function createProduct(lower?: FormulaNode[], upper?: FormulaNode[], body?: FormulaNode[]): FormulaNode {
  return createNode('product', 'prod', [
    createFormulaSlot(lower, 'lower', true),
    createFormulaSlot(upper, 'upper', true),
    createFormulaSlot(body, 'body', true),
  ]);
}

export function createLimit(variable?: FormulaNode[], body?: FormulaNode[], operator: 'lim' | 'min' | 'max' = 'lim'): FormulaNode {
  return createNode('limit', operator, [
    createFormulaSlot(variable, 'lower', true),
    createFormulaSlot(body, 'body', true),
  ]);
}

export function createPiecewise(rows = 2): FormulaNode {
  const safeRows = Math.max(1, Math.min(6, Math.floor(rows) || 2));
  return createNode('piecewise', String(safeRows), Array.from({ length: safeRows * 2 }, () => createRow([])));
}

export function createSystem(rows = 2): FormulaNode {
  const safeRows = Math.max(1, Math.min(6, Math.floor(rows) || 2));
  return createNode('system', String(safeRows), Array.from({ length: safeRows }, () => createRow([])));
}

export function createAligned(rows = 2): FormulaNode {
  const safeRows = Math.max(1, Math.min(6, Math.floor(rows) || 2));
  return createNode('aligned', String(safeRows), Array.from({ length: safeRows * 2 }, () => createRow([])));
}

export function createAbsolute(inner?: FormulaNode[]): FormulaNode {
  return createNode('absolute', undefined, [createRow(inner || [])]);
}

export function createNorm(inner?: FormulaNode[]): FormulaNode {
  return createNode('norm', undefined, [createRow(inner || [])]);
}

export function createAccent(accent: AccentKind, inner?: FormulaNode[]): FormulaNode {
  return createNode('accent', accent, [createRow(inner || [])]);
}

export function createDifferential(variable?: FormulaNode[]): FormulaNode {
  return createNode('differential', undefined, [createRow(variable || [])]);
}

export function createMatrix(rows: number, cols: number, delimiter: MatrixDelimiter = 'pmatrix'): FormulaNode {
  const safeRows = Math.max(1, Math.min(8, Math.floor(rows) || 2));
  const safeCols = Math.max(1, Math.min(8, Math.floor(cols) || 2));
  const children: FormulaNode[] = [];
  for (let row = 0; row < safeRows; row++) {
    for (let col = 0; col < safeCols; col++) children.push(createRow([]));
  }
  const node = createNode('matrix', `${safeRows}x${safeCols}`, children);
  node.meta = { ...node.meta, matrixDelimiter: delimiter };
  return node;
}

export function createParens(inner?: FormulaNode[]): FormulaNode {
  const r = createRow(inner || []); r.role = 'inner';
  return createNode('parens', undefined, [r]);
}

export function createBrackets(inner?: FormulaNode[]): FormulaNode {
  const r = createRow(inner || []); r.role = 'inner';
  return createNode('brackets', undefined, [r]);
}

export function createBraces(inner?: FormulaNode[]): FormulaNode {
  const r = createRow(inner || []); r.role = 'inner';
  return createNode('braces', undefined, [r]);
}

// ─── Tree Operations ────────────────────────────────────────────────────────

/** Tìm node theo ID trong cây */
export function findNode(root: FormulaNode, id: string): FormulaNode | null {
  if (root.id === id) return root;
  if (root.children) {
    for (const child of root.children) {
      const found = findNode(child, id);
      if (found) return found;
    }
  }
  return null;
}

/** Tìm parent node */
export function findParent(root: FormulaNode, id: string): FormulaNode | null {
  if (root.children) {
    for (const child of root.children) {
      if (child.id === id) return root;
      const found = findParent(child, id);
      if (found) return found;
    }
  }
  return null;
}

/** Chèn node tại vị trí cursor */
export function insertAtCursor(
  root: FormulaNode,
  cursor: CursorPosition,
  node: FormulaNode
): { root: FormulaNode; newCursor: CursorPosition } {
  const target = findNode(root, cursor.nodeId);
  if (!target) return { root, newCursor: cursor };

  // Nếu target là placeholder, thay thế nó
  if (target.meta?.isPlaceholder) {
    const parent = findParent(root, target.id);
    if (parent && parent.children) {
      const idx = parent.children.indexOf(target);
      if (idx !== -1) {
        parent.children[idx] = node;
        return {
          root,
          newCursor: { nodeId: node.id, offset: node.value ? node.value.length : 0 },
        };
      }
    }
  }

  // Nếu target là row, chèn vào vị trí offset
  if (target.type === 'row' && target.children) {
    target.children.splice(cursor.offset, 0, node);
    // Xóa placeholder nếu có node thật
    const phIdx = target.children.findIndex(c => c.meta?.isPlaceholder);
    if (phIdx !== -1 && target.children.length > 1) {
      target.children.splice(phIdx, 1);
    }
    return {
      root,
      newCursor: {
        nodeId: target.id,
        offset: target.children.indexOf(node) + 1,
      },
    };
  }

  return { root, newCursor: cursor };
}

/** Xóa node tại vị trí cursor (Backspace) */
export function deleteAtCursor(
  root: FormulaNode,
  cursor: CursorPosition
): { root: FormulaNode; newCursor: CursorPosition } {
  const target = findNode(root, cursor.nodeId);
  if (!target || !target.children || cursor.offset <= 0) return { root, newCursor: cursor };

  if (target.type === 'row') {
    const removeIdx = cursor.offset - 1;
    if (removeIdx >= 0 && removeIdx < target.children.length) {
      target.children.splice(removeIdx, 1);
      if (target.children.length === 0) {
        target.children.push(createPlaceholder());
      }
      return {
        root,
        newCursor: { nodeId: target.id, offset: removeIdx },
      };
    }
  }

  return { root, newCursor: cursor };
}

/** Tìm tất cả placeholder */
export function findPlaceholders(root: FormulaNode): FormulaNode[] {
  const result: FormulaNode[] = [];
  if (root.meta?.isPlaceholder) result.push(root);
  if (root.children) {
    root.children.forEach(c => result.push(...findPlaceholders(c)));
  }
  return result;
}

/** Tìm placeholder tiếp theo */
export function nextPlaceholder(root: FormulaNode, currentId: string): FormulaNode | null {
  const all = findPlaceholders(root);
  const idx = all.findIndex(p => p.id === currentId);
  if (idx !== -1 && idx < all.length - 1) return all[idx + 1];
  if (all.length > 0) return all[0]; // wrap around
  return null;
}

/** Serialize the editable Telex AST to a safe TeX string for KaTeX. */
export function serializeToLatex(node: FormulaNode): string {
  const children = node.children || [];
  const content = (child?: FormulaNode): string => child ? serializeToLatex(child) : '';
  const isEmptySlot = (child?: FormulaNode): boolean => !child || child.meta?.isPlaceholder === true;
  const slot = (child?: FormulaNode): string => isEmptySlot(child) ? '' : content(child);

  switch (node.type) {
    case 'symbol': return node.value || '';
    case 'operator': return ` ${node.value || ''} `;
    case 'number': return node.value || '';
    case 'text': {
      const escaped = (node.value || '').replace(/\\/g, '\\textbackslash{}').replace(/([#$%&_{}])/g, '\\$1');
      return `\\text{${escaped}}`;
    }
    case 'placeholder': return '\\square';
    case 'row': return children.map(serializeToLatex).join('');
    case 'fraction': {
      const [numerator, denominator] = children;
      return `\\frac{${content(numerator)}}{${content(denominator)}}`;
    }
    case 'root': {
      const [body, index] = children;
      return index ? `\\sqrt[${content(index)}]{${content(body)}}` : `\\sqrt{${content(body)}}`;
    }
    case 'sup': {
      const [base, sup] = children;
      return `{${content(base)}}^{${content(sup)}}`;
    }
    case 'sub': {
      const [base, sub] = children;
      return `{${content(base)}}_{${content(sub)}}`;
    }
    case 'supsub': {
      const [base, sup, sub] = children;
      return `{${content(base)}}_{${content(sub)}}^{${content(sup)}}`;
    }
    case 'integral': {
      const [lower, upper, body] = children;
      const command = node.value === 'iint' || node.value === 'iiint' || node.value === 'oint' ? node.value : 'int';
      const lowerLimit = isEmptySlot(lower) ? '' : `\\limits_{${slot(lower)}}`;
      const upperLimit = isEmptySlot(upper) ? '' : `^{${slot(upper)}}`;
      return `\\${command}${lowerLimit}${upperLimit}${slot(body)}`;
    }
    case 'sum': {
      const [lower, upper, body] = children;
      const lowerLimit = isEmptySlot(lower) ? '' : `\\limits_{${slot(lower)}}`;
      const upperLimit = isEmptySlot(upper) ? '' : `^{${slot(upper)}}`;
      return `\\sum${lowerLimit}${upperLimit}${slot(body)}`;
    }
    case 'product': {
      const [lower, upper, body] = children;
      const lowerLimit = isEmptySlot(lower) ? '' : `\\limits_{${slot(lower)}}`;
      const upperLimit = isEmptySlot(upper) ? '' : `^{${slot(upper)}}`;
      return `\\prod${lowerLimit}${upperLimit}${slot(body)}`;
    }
    case 'limit': {
      const [variable, body] = children;
      const command = node.value === 'min' || node.value === 'max' ? node.value : 'lim';
      const lowerLimit = isEmptySlot(variable) ? '' : `\\limits_{${slot(variable)}}`;
      return `\\${command}${lowerLimit}${slot(body)}`;
    }
    case 'parens': return `\\left(${content(children[0])}\\right)`;
    case 'brackets': return `\\left[${content(children[0])}\\right]`;
    case 'braces': return node.value === 'left-open'
      ? `\\left\\{${content(children[0])}\\right.`
      : `\\left\\{${content(children[0])}\\right\\}`;
    case 'absolute': return `\\left|${content(children[0])}\\right|`;
    case 'norm': return `\\left\\|${content(children[0])}\\right\\|`;
    case 'accent': {
      const body = content(children[0]);
      if (node.value === 'arc') return `\\overset{\\frown}{${body}}`;
      const accent = node.value === 'bar' ? 'overline' : node.value === 'vec' ? 'vec' : node.value === 'overrightarrow' ? 'overrightarrow' : node.value === 'widehat' ? 'widehat' : 'hat';
      return `\\${accent}{${body}}`;
    }
    case 'differential': return `\\,\\mathrm{d}${content(children[0])}`;
    case 'multiline': {
      const rows = children.map(child => serializeToLatex(child) || '\\vphantom{0}');
      return `\\begin{gathered}${rows.join(' \\\\ ')}\\end{gathered}`;
    }
    case 'piecewise':
    case 'aligned': {
      const rows = Math.max(1, Math.min(6, Number(node.value) || Math.ceil(children.length / 2) || 1));
      const body = Array.from({ length: rows }, (_, row) => `${content(children[row * 2])} & ${content(children[row * 2 + 1])}`).join(' \\\\ ');
      const environment = node.type === 'aligned' ? 'aligned' : 'cases';
      return `\\begin{${environment}}${body}\\end{${environment}}`;
    }
    case 'system': {
      const rows = Math.max(1, Math.min(6, Number(node.value) || children.length || 1));
      const body = Array.from({ length: rows }, (_, row) => content(children[row])).join(' \\\\ ');
      return `\\begin{cases}${body}\\end{cases}`;
    }
    case 'matrix': {
      const [rawRows, rawCols] = (node.value || '2x2').split('x').map(Number);
      const rows = Number.isFinite(rawRows) ? Math.max(1, Math.min(8, rawRows)) : 2;
      const cols = Number.isFinite(rawCols) ? Math.max(1, Math.min(8, rawCols)) : 2;
      const rowsLatex = Array.from({ length: rows }, (_, row) =>
        Array.from({ length: cols }, (_, col) => content(children[row * cols + col])).join(' & ')
      ).join(' \\\\ ');
      const rawDelimiter = node.meta?.matrixDelimiter;
      const layout = node.meta?.matrixLayout;
      if (layout) {
        const columnSpec = Array.from({ length: cols }, (_, col) => layout === 'aligned' && col % 2 === 0 ? 'r' : 'l').join('');
        const array = `\\begin{array}{${columnSpec}}${rowsLatex}\\end{array}`;
        switch (rawDelimiter) {
          case 'braces': return `\\left\\{${array}\\right\\}`;
          case 'left-brace': return `\\left\\{${array}\\right.`;
          case 'left-square': return `\\left[${array}\\right.`;
          case 'square': return `\\left[${array}\\right]`;
          case 'parentheses': return `\\left(${array}\\right)`;
          case 'bars': return `\\left|${array}\\right|`;
          default: return array;
        }
      }
      const delimiter = rawDelimiter === 'bmatrix' || rawDelimiter === 'vmatrix' || rawDelimiter === 'pmatrix' ? rawDelimiter : 'pmatrix';
      return `\\begin{${delimiter}}${rowsLatex}\\end{${delimiter}}`;
    }
    default: return node.value || '';
  }
}

/** Serialize AST → JSON */
export function serializeToJSON(node: FormulaNode): string {
  return JSON.stringify(node, null, 2);
}

/** Deep clone a node */
export function cloneNode(node: FormulaNode): FormulaNode {
  return JSON.parse(JSON.stringify(node));
}
