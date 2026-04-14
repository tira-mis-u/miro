// ─── Formula AST Operations ─── Thao tác cây AST cho Formula Editor ───
import type { FormulaNode, NodeType, NodeRole, CursorPosition } from './types';

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

export function createIntegral(lower?: FormulaNode[], upper?: FormulaNode[], body?: FormulaNode[]): FormulaNode {
  const lo = createRow(lower || []); lo.role = 'lower';
  const up = createRow(upper || []); up.role = 'upper';
  const bd = createRow(body || []); bd.role = 'body';
  return createNode('integral', '∫', [lo, up, bd]);
}

export function createSum(lower?: FormulaNode[], upper?: FormulaNode[], body?: FormulaNode[]): FormulaNode {
  const lo = createRow(lower || []); lo.role = 'lower';
  const up = createRow(upper || []); up.role = 'upper';
  const bd = createRow(body || []); bd.role = 'body';
  return createNode('sum', '∑', [lo, up, bd]);
}

export function createProduct(lower?: FormulaNode[], upper?: FormulaNode[], body?: FormulaNode[]): FormulaNode {
  const lo = createRow(lower || []); lo.role = 'lower';
  const up = createRow(upper || []); up.role = 'upper';
  const bd = createRow(body || []); bd.role = 'body';
  return createNode('product', '∏', [lo, up, bd]);
}

export function createLimit(variable?: FormulaNode[], body?: FormulaNode[]): FormulaNode {
  const lo = createRow(variable || []); lo.role = 'lower';
  const bd = createRow(body || []); bd.role = 'body';
  return createNode('limit', 'lim', [lo, bd]);
}

export function createMatrix(rows: number, cols: number): FormulaNode {
  const children: FormulaNode[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      children.push(createRow([]));
    }
  }
  const node = createNode('matrix', `${rows}x${cols}`, children);
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

/** Serialize AST → chuỗi LaTeX (optional export) */
export function serializeToLatex(node: FormulaNode): string {
  switch (node.type) {
    case 'symbol': return node.value || '';
    case 'operator': return ` ${node.value || ''} `;
    case 'number': return node.value || '';
    case 'text': return `\\text{${node.value || ''}}`;
    case 'placeholder': return '{\\square}';

    case 'row':
      return (node.children || []).map(serializeToLatex).join('');

    case 'fraction': {
      const [n, d] = node.children || [];
      return `\\frac{${serializeToLatex(n)}}{${serializeToLatex(d)}}`;
    }
    case 'root': {
      const [body, index] = node.children || [];
      if (index) return `\\sqrt[${serializeToLatex(index)}]{${serializeToLatex(body)}}`;
      return `\\sqrt{${serializeToLatex(body)}}`;
    }
    case 'sup': {
      const [base, sup] = node.children || [];
      return `{${serializeToLatex(base)}}^{${serializeToLatex(sup)}}`;
    }
    case 'sub': {
      const [base, sub] = node.children || [];
      return `{${serializeToLatex(base)}}_{${serializeToLatex(sub)}}`;
    }
    case 'supsub': {
      const [base, sup, sub] = node.children || [];
      return `{${serializeToLatex(base)}}_{${serializeToLatex(sub)}}^{${serializeToLatex(sup)}}`;
    }
    case 'integral': {
      const [lower, upper, body] = node.children || [];
      return `\\int_{${serializeToLatex(lower)}}^{${serializeToLatex(upper)}} ${serializeToLatex(body)}`;
    }
    case 'sum': {
      const [lower, upper, body] = node.children || [];
      return `\\sum_{${serializeToLatex(lower)}}^{${serializeToLatex(upper)}} ${serializeToLatex(body)}`;
    }
    case 'product': {
      const [lower, upper, body] = node.children || [];
      return `\\prod_{${serializeToLatex(lower)}}^{${serializeToLatex(upper)}} ${serializeToLatex(body)}`;
    }
    case 'limit': {
      const [variable, body] = node.children || [];
      return `\\lim_{${serializeToLatex(variable)}} ${serializeToLatex(body)}`;
    }
    case 'parens':
      return `\\left(${serializeToLatex((node.children || [])[0])}\\right)`;
    case 'brackets':
      return `\\left[${serializeToLatex((node.children || [])[0])}\\right]`;
    case 'braces':
      return `\\left\\{${serializeToLatex((node.children || [])[0])}\\right\\}`;

    case 'matrix': {
      const [rows, cols] = (node.value || '2x2').split('x').map(Number);
      const cells = node.children || [];
      let result = '\\begin{pmatrix}';
      for (let r = 0; r < rows; r++) {
        if (r > 0) result += ' \\\\ ';
        for (let c = 0; c < cols; c++) {
          if (c > 0) result += ' & ';
          result += serializeToLatex(cells[r * cols + c]);
        }
      }
      result += '\\end{pmatrix}';
      return result;
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
