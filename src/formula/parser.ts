// ─── Telex Parser ─── Incremental parsing cho Formula Editor ───
import type { FormulaNode } from './types';
import {
  createSymbol, createOperator, createNumber, createRow,
  createFraction, createSqrt, createRoot, createSup, createSub,
  createIntegral, createSum, createProduct, createLimit,
  createParens, createPlaceholder,
} from './ast';

// ─── Telex → Symbol mapping ────────────────────────────────────────────────
export const TELEX_SYMBOLS: Record<string, string> = {
  // Greek lowercase
  'alpha': 'α', 'beta': 'β', 'gamma': 'γ', 'delta': 'δ',
  'epsilon': 'ε', 'zeta': 'ζ', 'eta': 'η', 'theta': 'θ',
  'iota': 'ι', 'kappa': 'κ', 'lambda': 'λ', 'mu': 'μ',
  'nu': 'ν', 'xi': 'ξ', 'pi': 'π', 'rho': 'ρ',
  'sigma': 'σ', 'tau': 'τ', 'upsilon': 'υ', 'phi': 'φ',
  'chi': 'χ', 'psi': 'ψ', 'omega': 'ω',

  // Greek uppercase
  'Alpha': 'Α', 'Beta': 'Β', 'Gamma': 'Γ', 'Delta': 'Δ',
  'Theta': 'Θ', 'Lambda': 'Λ', 'Pi': 'Π', 'Sigma': 'Σ',
  'Phi': 'Φ', 'Psi': 'Ψ', 'Omega': 'Ω',

  // Mathematical symbols
  'inf': '∞', 'infty': '∞',
  'partial': '∂', 'nabla': '∇',
  'forall': '∀', 'exists': '∃',
  'emptyset': '∅', 'in': '∈', 'notin': '∉',
  'subset': '⊂', 'supset': '⊃',
  'cup': '∪', 'cap': '∩',
  'pm': '±', 'mp': '∓', 'times': '×', 'div': '÷', 'cdot': '·',
  'dots': '…', 'ldots': '…', 'cdots': '⋯',

  // Arrows
  'to': '→', 'rightarrow': '→', 'leftarrow': '←',
  'leftrightarrow': '↔', 'Rightarrow': '⇒',
  'Leftarrow': '⇐', 'Leftrightarrow': '⇔',
  'uparrow': '↑', 'downarrow': '↓',

  // Relations
  'neq': '≠', 'ne': '≠',
  'le': '≤', 'leq': '≤',
  'ge': '≥', 'geq': '≥',
  'approx': '≈', 'equiv': '≡',
  'sim': '∼', 'propto': '∝',
};

// Operator-like symbols that create special structures
export const TELEX_OPERATORS: Record<string, string> = {
  '<=': '≤', '>=': '≥', '!=': '≠', '->': '→', '<-': '←',
  '<=>': '⇔', '=>': '⇒', '...': '…',
};

// Structural transforms
export const TELEX_STRUCTURES: string[] = [
  'frac', 'sqrt', 'nroot', 'int', 'sum', 'prod', 'lim',
  'sup', 'sub', 'hat', 'bar', 'vec',
];

// ─── Tokenizer ──────────────────────────────────────────────────────────────
export interface Token {
  type: 'word' | 'number' | 'operator' | 'space' | 'special';
  value: string;
  start: number;
  end: number;
}

export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    // Skip spaces
    if (ch === ' ' || ch === '\t') {
      const start = i;
      while (i < input.length && (input[i] === ' ' || input[i] === '\t')) i++;
      tokens.push({ type: 'space', value: input.slice(start, i), start, end: i });
      continue;
    }

    // Numbers
    if (/[0-9.]/.test(ch)) {
      const start = i;
      while (i < input.length && /[0-9.]/.test(input[i])) i++;
      tokens.push({ type: 'number', value: input.slice(start, i), start, end: i });
      continue;
    }

    // Words (including backslash-prefixed)
    if (/[a-zA-Z\\]/.test(ch)) {
      const start = i;
      if (ch === '\\') i++; // skip backslash
      while (i < input.length && /[a-zA-Z]/.test(input[i])) i++;
      const val = input.slice(start, i);
      tokens.push({ type: 'word', value: val, start, end: i });
      continue;
    }

    // Multi-char operators (<=, >=, !=, ->, <-, =>, <=>)
    if (i + 1 < input.length) {
      const two = input.slice(i, i + 2);
      const three = i + 2 < input.length ? input.slice(i, i + 3) : '';
      if (TELEX_OPERATORS[three]) {
        tokens.push({ type: 'operator', value: three, start: i, end: i + 3 });
        i += 3;
        continue;
      }
      if (TELEX_OPERATORS[two]) {
        tokens.push({ type: 'operator', value: two, start: i, end: i + 2 });
        i += 2;
        continue;
      }
    }

    // Single-char operators
    if (/[+\-*/=^_(){}[\]|,;:!?<>]/.test(ch)) {
      tokens.push({ type: 'operator', value: ch, start: i, end: i + 1 });
      i++;
      continue;
    }

    // Special Unicode chars (already-inserted symbols)
    tokens.push({ type: 'special', value: ch, start: i, end: i + 1 });
    i++;
  }

  return tokens;
}

// ─── Parser: Tokens → AST ──────────────────────────────────────────────────
export function parseTokensToAST(tokens: Token[]): FormulaNode {
  const children: FormulaNode[] = [];

  let i = 0;
  while (i < tokens.length) {
    const tok = tokens[i];

    if (tok.type === 'space') {
      children.push(createSymbol(tok.value));
      i++;
      continue;
    }

    if (tok.type === 'number') {
      children.push(createNumber(tok.value));
      i++;
      continue;
    }

    if (tok.type === 'word') {
      const clean = tok.value.startsWith('\\') ? tok.value.slice(1) : tok.value;

      // Check if it's a structural command
      if (TELEX_STRUCTURES.includes(clean)) {
        const result = parseStructure(clean, tokens, i + 1);
        children.push(result.node);
        i = result.nextIndex;
        continue;
      }

      // Check if it's a known symbol
      if (TELEX_SYMBOLS[clean]) {
        children.push(createSymbol(TELEX_SYMBOLS[clean]));
        i++;
        continue;
      }

      // Otherwise treat each char as a symbol (variable)
      for (const ch of clean) {
        children.push(createSymbol(ch));
      }
      i++;
      continue;
    }

    if (tok.type === 'operator') {
      // Check mapped operators
      if (TELEX_OPERATORS[tok.value]) {
        children.push(createOperator(TELEX_OPERATORS[tok.value]));
      } else if (tok.value === '^') {
        const base = children.length > 0 ? children.pop()! : createPlaceholder();
        const supContent = parseNextGroup(tokens, i + 1);
        
        // 🔥 Smart Handling: Nếu base là big operator → đưa vào upper bound thay vì tạo sup slanted
        if (['integral', 'sum', 'product'].includes(base.type) && base.children) {
          const upperRow = base.children.find(c => c.role === 'upper');
          if (upperRow) {
            upperRow.children = supContent.nodes.length > 0 ? supContent.nodes : [createPlaceholder()];
            upperRow.meta = { ...upperRow.meta, isPlaceholder: false };
          }
          children.push(base);
        } else {
          children.push(createSup([base], supContent.nodes));
        }
        i = supContent.nextIndex;
        continue;
      } else if (tok.value === '_') {
        const base = children.length > 0 ? children.pop()! : createPlaceholder();
        const subContent = parseNextGroup(tokens, i + 1);

        // 🔥 Smart Handling: Nếu base là big operator/limit → đưa vào lower bound
        if (['integral', 'sum', 'product', 'limit'].includes(base.type) && base.children) {
          const lowerRow = base.children.find(c => c.role === 'lower');
          if (lowerRow) {
            lowerRow.children = subContent.nodes.length > 0 ? subContent.nodes : [createPlaceholder()];
            lowerRow.meta = { ...lowerRow.meta, isPlaceholder: false };
          }
          children.push(base);
        } else {
          children.push(createSub([base], subContent.nodes));
        }
        i = subContent.nextIndex;
        continue;
      } else if (tok.value === '(') {
        const inner = parseUntilClose(tokens, i + 1, ')');
        children.push(createParens(inner.nodes));
        i = inner.nextIndex;
        continue;
      } else {
        children.push(createOperator(tok.value));
      }
      i++;
      continue;
    }



    if (tok.type === 'special') {
      if (tok.value === '□') {
        children.push(createPlaceholder());
      } else {
        children.push(createSymbol(tok.value));
      }
      i++;
      continue;
    }

    i++;
  }

  if (children.length === 0) {
    return createRow([createPlaceholder()]);
  }

  return createRow(children);
}

/** Parse nhanh 1 chuỗi input thành AST */
export function parseTelex(input: string): FormulaNode {
  if (!input || !input.trim()) {
    return createRow([createPlaceholder()]);
  }
  const tokens = tokenize(input);
  return parseTokensToAST(tokens);
}

// ─── Internal parse helpers ─────────────────────────────────────────────────

function parseStructure(
  name: string,
  tokens: Token[],
  startIdx: number
): { node: FormulaNode; nextIndex: number } {
  switch (name) {
    case 'frac': {
      const numer = parseNextGroup(tokens, startIdx);
      const denom = parseNextGroup(tokens, numer.nextIndex);
      return {
        node: createFraction(numer.nodes, denom.nodes),
        nextIndex: denom.nextIndex,
      };
    }
    case 'sqrt': {
      const body = parseNextGroup(tokens, startIdx);
      return {
        node: createSqrt(body.nodes),
        nextIndex: body.nextIndex,
      };
    }
    case 'nroot': {
      const idx = parseNextGroup(tokens, startIdx);
      const body = parseNextGroup(tokens, idx.nextIndex);
      return {
        node: createRoot(idx.nodes, body.nodes),
        nextIndex: body.nextIndex,
      };
    }
    case 'int': {
      return {
        node: createIntegral(),
        nextIndex: startIdx,
      };
    }
    case 'sum': {
      return {
        node: createSum(),
        nextIndex: startIdx,
      };
    }
    case 'prod': {
      return {
        node: createProduct(),
        nextIndex: startIdx,
      };
    }
    case 'lim': {
      return {
        node: createLimit(),
        nextIndex: startIdx,
      };
    }
    default: {
      return {
        node: createSymbol(name),
        nextIndex: startIdx,
      };
    }
  }
}

function parseNextGroup(
  tokens: Token[],
  startIdx: number
): { nodes: FormulaNode[]; nextIndex: number } {
  // Skip spaces
  let i = startIdx;
  while (i < tokens.length && tokens[i].type === 'space') i++;

  if (i >= tokens.length) {
    return { nodes: [], nextIndex: i };
  }

  // If next token is {, parse until }
  if (tokens[i].type === 'operator' && tokens[i].value === '{') {
    const inner = parseUntilClose(tokens, i + 1, '}');
    return inner;
  }

  // If next token is (, parse until )
  if (tokens[i].type === 'operator' && tokens[i].value === '(') {
    const inner = parseUntilClose(tokens, i + 1, ')');
    return inner;
  }

  // Otherwise, just take the single next token
  const tok = tokens[i];
  if (tok.type === 'number') {
    return { nodes: [createNumber(tok.value)], nextIndex: i + 1 };
  }
  if (tok.type === 'word') {
    const clean = tok.value.startsWith('\\') ? tok.value.slice(1) : tok.value;
    if (TELEX_SYMBOLS[clean]) {
      return { nodes: [createSymbol(TELEX_SYMBOLS[clean])], nextIndex: i + 1 };
    }
    // Single variable char(s)
    const nodes: FormulaNode[] = [];
    for (const ch of clean) nodes.push(createSymbol(ch));
    return { nodes, nextIndex: i + 1 };
  }
  if (tok.type === 'special') {
    return { nodes: [createSymbol(tok.value)], nextIndex: i + 1 };
  }

  return { nodes: [createOperator(tok.value)], nextIndex: i + 1 };
}

function parseUntilClose(
  tokens: Token[],
  startIdx: number,
  closeChar: string
): { nodes: FormulaNode[]; nextIndex: number } {
  const collected: Token[] = [];
  let depth = 1;
  let i = startIdx;
  const openChar = closeChar === ')' ? '(' : closeChar === ']' ? '[' : '{';

  while (i < tokens.length) {
    const tok = tokens[i];
    if (tok.type === 'operator') {
      if (tok.value === openChar) depth++;
      if (tok.value === closeChar) {
        depth--;
        if (depth === 0) {
          i++; // skip close char
          break;
        }
      }
    }
    collected.push(tok);
    i++;
  }

  const subAST = parseTokensToAST(collected);
  return { nodes: subAST.children || [subAST], nextIndex: i };
}
