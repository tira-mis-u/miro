// ─── Formula Module ─── Barrel export ───
// Lazy-loadable formula editor plugin for the whiteboard

// Types
export type { FormulaNode, NodeType, CursorPosition, TelexMapping, FormulaBoardNode } from './types';

// AST Operations
export {
  createNode, createSymbol, createOperator, createNumber, createText,
  createPlaceholder, createRow, createFraction, createRoot, createSqrt,
  createSup, createSub, createSupSub, createIntegral, createSum,
  createProduct, createLimit, createMatrix, createParens,
  findNode, findParent, insertAtCursor, deleteAtCursor,
  findPlaceholders, nextPlaceholder,
  serializeToLatex, serializeToJSON, cloneNode,
} from './ast';

// Parser
export { parseTelex, tokenize, TELEX_SYMBOLS, TELEX_STRUCTURES, TELEX_OPERATORS } from './parser';

// Renderer
export { renderFormulaToHTML, renderFormulaStatic } from './renderer';

// Cursor
export { FormulaCursor } from './cursor';

// API functions (top-level convenience)
import type { FormulaNode } from './types';
import { createRow as _createRow, createPlaceholder as _createPlaceholder } from './ast';

export function createFormulaNode() {
  return _createRow([_createPlaceholder()]);
}

export function updateFormulaNode(ast: FormulaNode) {
  return ast;
}
