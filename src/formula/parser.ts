// Telex source parser for the editable formula tree.
import type { FormulaNode, MatrixDelimiter } from './types';
import {
  createAccent,
  createNode,
  createAbsolute,
  createAligned,
  createBraces,
  createBrackets,
  createDifferential,
  createFraction,
  createIntegral,
  createLimit,
  createMatrix,
  createNorm,
  createNumber,
  createOperator,
  createParens,
  createPiecewise,
  createPlaceholder,
  createProduct,
  createRoot,
  createRow,
  createSub,
  createSum,
  createSup,
  createSupSub,
  createSqrt,
  createSymbol,
  createSystem,
  createText,
  serializeToLatex,
} from './ast';
import { TELEX_STRUCTURES } from './catalog';
import { findStructuredGridAt, type StructuredGridDelimiter, type StructuredGridLayout } from './structuredGrid';
export { TELEX_STRUCTURES } from './catalog';

// Telex command → KaTeX command. Source remains plain, editable Telex text.
export const TELEX_SYMBOLS: Record<string, string> = {
  // Conventional lowercase Greek symbols and supported variants.
  alpha: '\\alpha', beta: '\\beta', gamma: '\\gamma', delta: '\\delta',
  epsilon: '\\epsilon', varepsilon: '\\varepsilon', zeta: '\\zeta', eta: '\\eta', theta: '\\theta', vartheta: '\\vartheta',
  iota: '\\iota', kappa: '\\kappa', varkappa: '\\varkappa', lambda: '\\lambda', mu: '\\mu',
  nu: '\\nu', xi: '\\xi', pi: '\\pi', varpi: '\\varpi', rho: '\\rho', varrho: '\\varrho',
  sigma: '\\sigma', varsigma: '\\varsigma', tau: '\\tau', upsilon: '\\upsilon', phi: '\\phi', varphi: '\\varphi',
  chi: '\\chi', psi: '\\psi', omega: '\\omega', digamma: '\\digamma',
  // TeX defines named commands for the distinct uppercase Greek glyphs only.
  Gamma: '\\Gamma', Delta: '\\Delta', Theta: '\\Theta', Lambda: '\\Lambda', Xi: '\\Xi',
  Pi: '\\Pi', Sigma: '\\Sigma', Upsilon: '\\Upsilon', Phi: '\\Phi', Psi: '\\Psi', Omega: '\\Omega',
  // Relations, logic, sets, and common symbols
  inf: '\\infty', infty: '\\infty', partial: '\\partial', nabla: '\\nabla',
  forall: '\\forall', exists: '\\exists', emptyset: '\\emptyset',
  in: '\\in', notin: '\\notin', subset: '\\subset', subseteq: '\\subseteq',
  supset: '\\supset', supseteq: '\\supseteq', cup: '\\cup', cap: '\\cap',
  pm: '\\pm', mp: '\\mp', times: '\\times', div: '\\div', cdot: '\\cdot',
  dots: '\\ldots', ldots: '\\ldots', cdots: '\\cdots', vdots: '\\vdots', ddots: '\\ddots',
  to: '\\to', rightarrow: '\\rightarrow', leftarrow: '\\leftarrow',
  leftrightarrow: '\\leftrightarrow', Rightarrow: '\\Rightarrow',
  Leftarrow: '\\Leftarrow', Leftrightarrow: '\\Leftrightarrow',
  uparrow: '\\uparrow', downarrow: '\\downarrow', mapsto: '\\mapsto',
  neq: '\\neq', ne: '\\neq', le: '\\le', leq: '\\leq',
  ge: '\\ge', geq: '\\geq', approx: '\\approx', equiv: '\\equiv',
  sim: '\\sim', simeq: '\\simeq', propto: '\\propto', notapprox: '\\not\\approx',
  parallel: '\\mathbin{//}', perp: '\\perp', angle: '\\angle', triangle: '\\triangle', circ: '\\circ',
  langle: '\\langle', rangle: '\\rangle', square: '\\square',
  degree: '^\\circ', therefore: '\\therefore', because: '\\because',
  // Named operators
  sin: '\\sin', cos: '\\cos', tan: '\\tan', cot: '\\cot',
  sec: '\\sec', csc: '\\csc', arcsin: '\\arcsin', arccos: '\\arccos', arctan: '\\arctan',
  arccot: '\\operatorname{arccot}', arcsec: '\\operatorname{arcsec}', arccsc: '\\operatorname{arccsc}',
  log: '\\log', ln: '\\ln', exp: '\\exp', max: '\\max', min: '\\min',
  supremum: '\\sup', infimum: '\\inf', det: '\\det', dim: '\\dim',
  arg: '\\arg', ker: '\\ker', gcd: '\\gcd',
};

export const TELEX_OPERATORS: Record<string, string> = {
  '<=': '\\le', '>=': '\\ge', '!=': '\\neq', '->': '\\to', '<-': '\\leftarrow',
  '<=>': '\\Leftrightarrow', '=>': '\\Rightarrow', '...': '\\ldots', '//': '\\mathbin{//}',
};

export interface Token {
  type: 'word' | 'number' | 'operator' | 'space' | 'special';
  value: string;
  start: number;
  end: number;
  /** True only for a backslash command; bare words never imply a TeX command. */
  explicit?: boolean;
}

const SINGLE_OPERATORS = new Set(['+', '-', '*', '/', '=', '^', '_', '(', ')', '[', ']', '{', '}', '|', ',', ';', ':', '!', '?', '<', '>', '&']);
const MULTI_OPERATORS = ['<=>', '<=', '>=', '!=', '->', '<-', '=>', '...', '//'];

export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < input.length) {
    const ch = input[index];
    if (/\s/.test(ch)) {
      const start = index++;
      while (index < input.length && /\s/.test(input[index])) index++;
      tokens.push({ type: 'space', value: input.slice(start, index), start, end: index });
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(input[index + 1] || ''))) {
      const start = index++;
      while (index < input.length && /[0-9]/.test(input[index])) index++;
      if (input[index] === '.' && /[0-9]/.test(input[index + 1] || '')) {
        index++;
        while (index < input.length && /[0-9]/.test(input[index])) index++;
      }
      tokens.push({ type: 'number', value: input.slice(start, index), start, end: index });
      continue;
    }
    if (ch === '\\') {
      const start = index++;
      if (/[a-zA-Z]/.test(input[index] || '')) {
        while (index < input.length && /[a-zA-Z0-9]/.test(input[index])) index++;
        tokens.push({ type: 'word', value: input.slice(start + 1, index), start, end: index, explicit: true });
      } else if (index < input.length) {
        tokens.push({ type: 'operator', value: input[index], start, end: index + 1 });
        index++;
      } else {
        tokens.push({ type: 'special', value: '\\', start, end: index });
      }
      continue;
    }
    if (/[a-zA-Z]/.test(ch)) {
      const start = index++;
      while (index < input.length && /[a-zA-Z0-9]/.test(input[index])) index++;
      tokens.push({ type: 'word', value: input.slice(start, index), start, end: index });
      continue;
    }
    const operator = MULTI_OPERATORS.find(candidate => input.startsWith(candidate, index));
    if (operator) {
      tokens.push({ type: 'operator', value: operator, start: index, end: index + operator.length });
      index += operator.length;
      continue;
    }
    if (SINGLE_OPERATORS.has(ch)) {
      tokens.push({ type: 'operator', value: ch, start: index, end: index + 1 });
      index++;
      continue;
    }
    tokens.push({ type: 'special', value: ch, start: index, end: index + 1 });
    index++;
  }
  return tokens;
}

function fillSlot(node: FormulaNode | undefined, nodes: FormulaNode[]): void {
  if (!node) return;
  node.children = nodes.length ? nodes : [createPlaceholder()];
  node.meta = { ...node.meta, isPlaceholder: false };
}

function setBigOperatorBody(node: FormulaNode, nodes: FormulaNode[]): void {
  const body = node.children?.find(child => child.role === 'body');
  fillSlot(body, nodes);
}

function isBigOperator(node?: FormulaNode): boolean {
  return !!node && ['integral', 'sum', 'product', 'limit'].includes(node.type);
}

function wordNodes(word: string): FormulaNode[] {
  const segments = word.match(/[A-Za-z]+|[0-9]+/g) || [];
  return segments.flatMap(segment => /^[0-9]+$/.test(segment)
    ? [createNumber(segment)]
    : [...segment].map(character => createSymbol(character)));
}

const LEGACY_STRUCTURE_COMMANDS = new Set(['pmatrix3x3', 'pmatrix2x3']);

function parseWord(clean: string, tokens: Token[], start: number, explicit: boolean): { node: FormulaNode; nextIndex: number } {
  if (explicit && (TELEX_STRUCTURES.includes(clean) || LEGACY_STRUCTURE_COMMANDS.has(clean))) return parseStructure(clean, tokens, start);
  if (explicit && Object.prototype.hasOwnProperty.call(TELEX_SYMBOLS, clean)) {
    return { node: createSymbol(TELEX_SYMBOLS[clean]), nextIndex: start };
  }
  if (explicit) return { node: createSymbol(`\\${clean}`), nextIndex: start };
  const chars = wordNodes(clean);
  return { node: createRow(chars.length ? chars : [createSymbol(clean)]), nextIndex: start };
}

export function parseTokensToAST(tokens: Token[]): FormulaNode {
  const children: FormulaNode[] = [];
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index];
    if (token.type === 'space') { children.push(createText(token.value)); index++; continue; }
    if (token.type === 'number') { children.push(createNumber(token.value)); index++; continue; }
    if (token.type === 'word') {
      const parsed = parseWord(token.value, tokens, index + 1, token.explicit === true);
      children.push(parsed.node);
      index = Math.max(index + 1, parsed.nextIndex);
      continue;
    }
    if (token.type === 'special') {
      if (token.value === '□') children.push(createPlaceholder());
      else if (token.value === '∫' || token.value === '∬' || token.value === '∭' || token.value === '∮') {
        const command = token.value === '∬' ? 'iint' : token.value === '∭' ? 'iiint' : token.value === '∮' ? 'oint' : 'int';
        children.push(createIntegral(undefined, undefined, undefined, command));
      } else if (token.value === '∑') children.push(createSum());
      else if (token.value === '∏') children.push(createProduct());
      else if (token.value === '√') children.push(createSqrt());
      else children.push(createSymbol(token.value));
      index++;
      continue;
    }

    const value = token.value;
    if (TELEX_OPERATORS[value]) { children.push(createOperator(TELEX_OPERATORS[value])); index++; continue; }
    if (value === '^') {
      const base = children.pop() || createPlaceholder();
      const group = parseNextGroup(tokens, index + 1);
      if (isBigOperator(base)) {
        fillSlot(base.children?.find(child => child.role === 'upper'), group.nodes);
        children.push(base);
      } else if (base.type === 'sub') {
        const [baseRow, subRow] = base.children || [];
        children.push(createSupSub(baseRow?.children, group.nodes, subRow?.children));
      } else if (base.type === 'sup') {
        const [baseRow, oldSup] = base.children || [];
        children.push(createSupSub(baseRow?.children, group.nodes, oldSup?.children));
      } else {
        children.push(createSup([base], group.nodes));
      }
      index = Math.max(index + 1, group.nextIndex);
      continue;
    }
    if (value === '_') {
      const base = children.pop() || createPlaceholder();
      const group = parseNextGroup(tokens, index + 1);
      if (isBigOperator(base) || base.type === 'limit') {
        fillSlot(base.children?.find(child => child.role === 'lower'), group.nodes);
        children.push(base);
      } else if (base.type === 'sup') {
        const [baseRow, supRow] = base.children || [];
        children.push(createSupSub(baseRow?.children, supRow?.children, group.nodes));
      } else {
        children.push(createSub([base], group.nodes));
      }
      index = Math.max(index + 1, group.nextIndex);
      continue;
    }
    if (value === '(' || value === '[' || value === '{') {
      const close = value === '(' ? ')' : value === '[' ? ']' : '}';
      const group = parseUntilClose(tokens, index + 1, close);
      const last = children[children.length - 1];
      if (value === '{' && isBigOperator(last)) {
        setBigOperatorBody(last, group.nodes);
      } else if (value === '(') children.push(createParens(group.nodes));
      else if (value === '[') children.push(createBrackets(group.nodes));
      else children.push(createBraces(group.nodes));
      index = Math.max(index + 1, group.nextIndex);
      continue;
    }
    children.push(createOperator(value));
    index++;
  }
  return createRow(children.length ? children : [createPlaceholder()]);
}

function buildStructuredGrid(layout: StructuredGridLayout, delimiter: StructuredGridDelimiter, cells: string[][]): FormulaNode {
  const rows = Math.max(1, cells.length);
  const columns = Math.max(1, ...cells.map(row => row.length));
  const node = createMatrix(rows, columns, delimiter);
  node.meta = { ...node.meta, matrixLayout: layout, matrixDelimiter: delimiter };
  node.children = Array.from({ length: rows }, (_, row) =>
    Array.from({ length: columns }, (_, column) => parseTelex(cells[row]?.[column] ?? '□')),
  ).flat();
  return node;
}

/** Split only top-level physical newlines or explicit row breaks; grouped/environment content is left intact. */
function splitTopLevelMathRows(source: string): string[] | null {
  const rows: string[] = [];
  const environments: string[] = [];
  let rowStart = 0;
  let braces = 0;
  let brackets = 0;
  let parentheses = 0;
  const topLevel = () => environments.length === 0 && braces === 0 && brackets === 0 && parentheses === 0;

  for (let index = 0; index < source.length;) {
    if (source[index] === '\\') {
      if (source[index + 1] === '\\' && topLevel()) {
        rows.push(source.slice(rowStart, index));
        index += 2;
        if (source[index] === '*') index++;
        if (source[index] === '\r') { index++; if (source[index] === '\n') index++; }
        else if (source[index] === '\n') index++;
        rowStart = index;
        continue;
      }
      const environment = /^\\(begin|end)\s*\{([A-Za-z*]+)\}/.exec(source.slice(index));
      if (environment) {
        if (environment[1] === 'begin') environments.push(environment[2]);
        else {
          const matchIndex = environments.lastIndexOf(environment[2]);
          if (matchIndex >= 0) environments.splice(matchIndex, 1);
        }
        index += environment[0].length;
        continue;
      }
      if (/[A-Za-z]/.test(source[index + 1] || '')) {
        index += 2;
        while (/[A-Za-z]/.test(source[index] || '')) index++;
      } else {
        index = Math.min(source.length, index + 2);
      }
      continue;
    }

    const character = source[index];
    if ((character === '\n' || character === '\r') && topLevel()) {
      rows.push(source.slice(rowStart, index));
      if (character === '\r' && source[index + 1] === '\n') index++;
      rowStart = index + 1;
      index++;
      continue;
    }
    if (character === '{') braces++;
    else if (character === '}') braces = Math.max(0, braces - 1);
    else if (character === '[') brackets++;
    else if (character === ']') brackets = Math.max(0, brackets - 1);
    else if (character === '(') parentheses++;
    else if (character === ')') parentheses = Math.max(0, parentheses - 1);
    index++;
  }

  if (rows.length === 0) return null;
  rows.push(source.slice(rowStart));
  return rows;
}

export function parseTelex(input: string): FormulaNode {
  const source = input || '';
  const multilineRows = splitTopLevelMathRows(source);
  if (multilineRows) {
    return createNode('multiline', undefined, multilineRows.map(row => {
      const trimmed = row.trim();
      return trimmed ? parseTelex(trimmed) : createNode('row', undefined, []);
    }));
  }
  const gridPattern = /\\grid\s*\[|\\begin\{(?:array|matrix|aligned|cases)\}/g;
  const nodes: FormulaNode[] = [];
  let cursor = 0;
  let foundGrid = false;
  let match: RegExpExecArray | null;

  const appendText = (segment: string) => {
    if (!segment.trim()) return;
    const parsed = parseTokensToAST(tokenize(segment));
    nodes.push(...(parsed.children ?? [parsed]));
  };

  while ((match = gridPattern.exec(source))) {
    const grid = findStructuredGridAt(source, match.index, match.index);
    if (!grid || grid.start < cursor) continue;
    appendText(source.slice(cursor, grid.start));
    nodes.push(buildStructuredGrid(grid.layout, grid.draft.delimiter, grid.draft.cells));
    cursor = grid.end;
    foundGrid = true;
  }

  if (!foundGrid) return parseTokensToAST(tokenize(source));
  appendText(source.slice(cursor));
  return createRow(nodes.length ? nodes : [createPlaceholder()]);
}

function parseStructure(name: string, tokens: Token[], startIndex: number): { node: FormulaNode; nextIndex: number } {
  const empty = (node: FormulaNode) => ({ node, nextIndex: startIndex });
  switch (name) {
    case 'frac': {
      const numerator = parseNextGroup(tokens, startIndex);
      const denominator = parseNextGroup(tokens, numerator.nextIndex);
      return { node: createFraction(numerator.nodes, denominator.nodes), nextIndex: denominator.nextIndex };
    }
    case 'sqrt': {
      const cursor = skipSpaces(tokens, startIndex);
      if (tokens[cursor]?.type === 'operator' && tokens[cursor].value === '[') {
        const index = parseUntilClose(tokens, cursor + 1, ']');
        const body = parseNextGroup(tokens, index.nextIndex);
        return { node: createRoot(index.nodes, body.nodes), nextIndex: body.nextIndex };
      }
      const body = parseNextGroup(tokens, startIndex);
      return { node: createSqrt(body.nodes), nextIndex: body.nextIndex };
    }
    case 'nroot': {
      const degree = parseNextGroup(tokens, startIndex);
      const body = parseNextGroup(tokens, degree.nextIndex);
      return { node: createRoot(degree.nodes, body.nodes), nextIndex: body.nextIndex };
    }
    case 'int': case 'defint': return empty(createIntegral());
    case 'iint': case 'iiint': case 'oint': return empty(createIntegral(undefined, undefined, undefined, name));
    case 'sum': return empty(createSum());
    case 'prod': return empty(createProduct());
    case 'lim': return empty(createLimit(undefined, undefined, 'lim'));
    case 'min': return empty(createLimit(undefined, undefined, 'min'));
    case 'max': return empty(createLimit(undefined, undefined, 'max'));
    case 'anglebrackets': {
      const group = parseNextGroup(tokens, startIndex);
      return {
        node: createRow([createSymbol('\\left\\langle'), createRow(group.nodes), createSymbol('\\right\\rangle')]),
        nextIndex: group.nextIndex,
      };
    }
    case 'overset': {
      const mark = parseNextGroup(tokens, startIndex);
      const body = parseNextGroup(tokens, mark.nextIndex);
      const markSource = serializeToLatex(createRow(mark.nodes)).trim();
      if (markSource === '\\frown') {
        return { node: createAccent('arc', body.nodes), nextIndex: body.nextIndex };
      }
      const bodySource = serializeToLatex(createRow(body.nodes));
      return { node: createSymbol(`\\overset{${markSource}}{${bodySource}}`), nextIndex: body.nextIndex };
    }
    case 'bmatrix': return parseGridMatrix(tokens, startIndex, 'bmatrix');
    case 'vmatrix': return parseGridMatrix(tokens, startIndex, 'vmatrix');
    case 'pmatrix': return hasLegacyMatrixCells(tokens, startIndex)
      ? parseMatrix(tokens, startIndex, 2, 2, 'pmatrix')
      : parseGridMatrix(tokens, startIndex, 'pmatrix');
    case 'pmatrix3x3': return parseMatrix(tokens, startIndex, 3, 3, 'pmatrix');
    case 'pmatrix2x3': return parseMatrix(tokens, startIndex, 2, 3, 'pmatrix');
    case 'cases': return parsePairedRows(tokens, startIndex, false);
    case 'system': return parseSystemRows(tokens, startIndex);
    case 'aligned': return parsePairedRows(tokens, startIndex, true);
    case 'abs': case 'norm': case 'parens': case 'brackets': case 'braces': case 'leftbrace': {
      const group = parseNextGroup(tokens, startIndex);
      const node = name === 'abs' ? createAbsolute(group.nodes)
        : name === 'norm' ? createNorm(group.nodes)
          : name === 'parens' ? createParens(group.nodes)
            : name === 'brackets' ? createBrackets(group.nodes) : createBraces(group.nodes);
      if (name === 'leftbrace') node.value = 'left-open';
      return { node, nextIndex: group.nextIndex };
    }
    case 'hat': case 'widehat': case 'bar': case 'overline': case 'vec': case 'overrightarrow': {
      const group = parseNextGroup(tokens, startIndex);
      const accent: 'hat' | 'widehat' | 'bar' | 'vec' | 'overrightarrow' = name === 'overline' ? 'bar' : name as 'hat' | 'widehat' | 'bar' | 'vec' | 'overrightarrow';
      return { node: createAccent(accent, group.nodes), nextIndex: group.nextIndex };
    }
    case 'diff': {
      const group = parseNextGroup(tokens, startIndex);
      return { node: createDifferential(group.nodes), nextIndex: group.nextIndex };
    }
    case 'sup': case 'sub': {
      const group = parseNextGroup(tokens, startIndex);
      const placeholder = createPlaceholder();
      return { node: name === 'sup' ? createSup([placeholder], group.nodes) : createSub([placeholder], group.nodes), nextIndex: group.nextIndex };
    }
    case 'supsub': {
      const base = parseNextGroup(tokens, startIndex);
      const lower = parseNextGroup(tokens, base.nextIndex);
      const upper = parseNextGroup(tokens, lower.nextIndex);
      return { node: createSupSub(base.nodes, upper.nodes, lower.nodes), nextIndex: upper.nextIndex };
    }
    case 'deriv': case 'pderiv': {
      const partial = name === 'pderiv';
      const differential = partial ? '\\partial' : 'd';
      const denominator = [createSymbol(differential), createPlaceholder()];
      const expression = parseNextGroup(tokens, startIndex);
      const fraction = createFraction([createSymbol(differential)], denominator);
      return { node: createRow([fraction, createParens(expression.nodes)]), nextIndex: expression.nextIndex };
    }
    case 'log': case 'ln': case 'exp': {
      return { node: createSymbol(TELEX_SYMBOLS[name]), nextIndex: startIndex };
    }
    default: {
      if (Object.prototype.hasOwnProperty.call(TELEX_SYMBOLS, name)) return { node: createSymbol(TELEX_SYMBOLS[name]), nextIndex: startIndex };
      return { node: createRow(wordNodes(name)), nextIndex: startIndex };
    }
  }
}

function skipSpaces(tokens: Token[], index: number): number {
  while (index < tokens.length && tokens[index].type === 'space') index++;
  return index;
}

const OPEN_TO_CLOSE: Record<string, string> = { '(': ')', '[': ']', '{': '}' };

function collectGroupTokens(tokens: Token[], startIndex: number): { tokens: Token[]; nextIndex: number } | null {
  const start = skipSpaces(tokens, startIndex);
  const opening = tokens[start];
  if (opening?.type !== 'operator' || !OPEN_TO_CLOSE[opening.value]) return null;

  const stack = [OPEN_TO_CLOSE[opening.value]];
  const collected: Token[] = [];
  for (let index = start + 1; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.type === 'operator') {
      if (OPEN_TO_CLOSE[token.value]) stack.push(OPEN_TO_CLOSE[token.value]);
      else if (Object.values(OPEN_TO_CLOSE).includes(token.value) && stack.at(-1) === token.value) {
        stack.pop();
        if (stack.length === 0) return { tokens: collected, nextIndex: index + 1 };
      }
    }
    collected.push(token);
  }
  return { tokens: collected, nextIndex: tokens.length };
}

function splitTopLevel(tokens: Token[], separator: string): Token[][] {
  const parts: Token[][] = [];
  const stack: string[] = [];
  let current: Token[] = [];
  for (const token of tokens) {
    if (token.type === 'operator') {
      if (OPEN_TO_CLOSE[token.value]) stack.push(OPEN_TO_CLOSE[token.value]);
      else if (Object.values(OPEN_TO_CLOSE).includes(token.value) && stack.at(-1) === token.value) stack.pop();
      if (token.value === separator && stack.length === 0) {
        parts.push(current);
        current = [];
        continue;
      }
    }
    current.push(token);
  }
  parts.push(current);
  return parts;
}

function hasLegacyMatrixCells(tokens: Token[], startIndex: number): boolean {
  let cursor = skipSpaces(tokens, startIndex);
  for (let cell = 0; cell < 4; cell++) {
    const group = collectGroupTokens(tokens, cursor);
    if (!group || splitTopLevel(group.tokens, ',').length > 1 || splitTopLevel(group.tokens, ';').length > 1) return false;
    cursor = group.nextIndex;
  }
  return true;
}

function parseGridMatrix(tokens: Token[], startIndex: number, delimiter: MatrixDelimiter): { node: FormulaNode; nextIndex: number } {
  const group = collectGroupTokens(tokens, startIndex);
  if (!group) return { node: createMatrix(2, 2, delimiter), nextIndex: startIndex };

  const rows = splitTopLevel(group.tokens, ';').slice(0, 8);
  const grid = rows.map(row => splitTopLevel(row, ',').slice(0, 8));
  const rowCount = Math.max(1, grid.length);
  const columnCount = Math.max(1, ...grid.map(row => row.length));
  const matrix = createMatrix(rowCount, columnCount, delimiter);
  matrix.children = Array.from({ length: rowCount * columnCount }, (_, index) => {
    const row = Math.floor(index / columnCount);
    const column = index % columnCount;
    const parsed = parseTokensToAST(grid[row]?.[column] ?? []);
    return createRow(parsed.children || []);
  });
  return { node: matrix, nextIndex: group.nextIndex };
}

function parseMatrix(tokens: Token[], startIndex: number, rows: number, cols: number, delimiter: MatrixDelimiter = 'pmatrix'): { node: FormulaNode; nextIndex: number } {
  const matrix = createMatrix(rows, cols, delimiter);
  const cells: FormulaNode[] = [];
  let cursor = startIndex;
  for (let index = 0; index < rows * cols; index++) {
    const group = parseNextGroup(tokens, cursor);
    cells.push(createRow(group.nodes.length ? group.nodes : [createPlaceholder()]));
    if (group.nextIndex > cursor) cursor = group.nextIndex;
  }
  matrix.children = cells;
  return { node: matrix, nextIndex: cursor };
}

function parseSystemRows(tokens: Token[], startIndex: number): { node: FormulaNode; nextIndex: number } {
  const rows: FormulaNode[] = [];
  let cursor = skipSpaces(tokens, startIndex);
  while (rows.length < 6 && tokens[cursor]?.type === 'operator' && tokens[cursor].value === '{') {
    const group = collectGroupTokens(tokens, cursor);
    if (!group) break;
    const parsed = parseTokensToAST(group.tokens);
    rows.push(createRow(parsed.children || []));
    cursor = group.nextIndex;
    cursor = skipSpaces(tokens, cursor);
  }
  if (rows.length === 0) rows.push(createRow([]));
  const system = createSystem(rows.length);
  system.children = rows;
  return { node: system, nextIndex: cursor };
}

function parsePairedRows(tokens: Token[], startIndex: number, aligned: boolean): { node: FormulaNode; nextIndex: number } {
  const groups: FormulaNode[][] = [];
  let cursor = startIndex;
  for (let index = 0; index < 4; index++) {
    const group = parseNextGroup(tokens, cursor);
    groups.push(group.nodes.length ? group.nodes : [createPlaceholder()]);
    if (group.nextIndex > cursor) cursor = group.nextIndex;
  }
  const node = aligned ? createAligned(2) : createPiecewise(2);
  node.children = groups.map(group => createRow(group));
  return { node, nextIndex: cursor };
}

function parseNextGroup(tokens: Token[], startIndex: number): { nodes: FormulaNode[]; nextIndex: number } {
  const index = skipSpaces(tokens, startIndex);
  if (index >= tokens.length) return { nodes: [], nextIndex: index };
  const token = tokens[index];
  if (token.type === 'operator' && (token.value === '{' || token.value === '(' || token.value === '[')) {
    const close = token.value === '{' ? '}' : token.value === '(' ? ')' : ']';
    return parseUntilClose(tokens, index + 1, close);
  }
  if (token.type === 'word') {
    const parsed = parseWord(token.value, tokens, index + 1, token.explicit === true);
    return { nodes: [parsed.node], nextIndex: Math.max(index + 1, parsed.nextIndex) };
  }
  if (token.type === 'number') return { nodes: [createNumber(token.value)], nextIndex: index + 1 };
  if (token.type === 'special') {
    if (token.value === '□') return { nodes: [createPlaceholder()], nextIndex: index + 1 };
    if (token.value === '∫' || token.value === '∬' || token.value === '∭' || token.value === '∮') {
      const command = token.value === '∬' ? 'iint' : token.value === '∭' ? 'iiint' : token.value === '∮' ? 'oint' : 'int';
      return { nodes: [createIntegral(undefined, undefined, undefined, command)], nextIndex: index + 1 };
    }
    return { nodes: [createSymbol(token.value)], nextIndex: index + 1 };
  }
  return { nodes: [createOperator(token.value)], nextIndex: index + 1 };
}

function parseUntilClose(tokens: Token[], startIndex: number, closeCharacter: string): { nodes: FormulaNode[]; nextIndex: number } {
  const openCharacter = closeCharacter === ')' ? '(' : closeCharacter === ']' ? '[' : '{';
  const collected: Token[] = [];
  let depth = 1;
  let index = startIndex;
  while (index < tokens.length) {
    const token = tokens[index];
    if (token.type === 'operator') {
      if (token.value === openCharacter) depth++;
      if (token.value === closeCharacter) {
        depth--;
        if (depth === 0) {
          index++;
          break;
        }
      }
    }
    collected.push(token);
    index++;
  }
  const parsed = parseTokensToAST(collected);
  return { nodes: parsed.children || [parsed], nextIndex: index };
}
