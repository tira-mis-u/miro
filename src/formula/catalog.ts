export type MathToolCategory = 'structures' | 'functions' | 'calculus' | 'trigonometry' | 'geometry';

export interface MathStructureDefinition {
  id: string;
  command: string;
  label: string;
  category: MathToolCategory;
  insertion: string;
  focusPlaceholder: number;
  /** Optional source used only for the static KaTeX palette preview. */
  previewSource?: string;
}

// Each entry is an editable TeX template; previews use the same KaTeX renderer as formulas.
// Commands are invoked explicitly with a backslash or through the palette; ordinary words and Space stay literal.
export const MATH_STRUCTURE_CATALOG: MathStructureDefinition[] = [
  { id: 'fraction', command: 'frac', label: 'Fraction', category: 'structures', insertion: '\\frac{□}{□}', focusPlaceholder: 0 },
  { id: 'sqrt', command: 'sqrt', label: 'Square root', category: 'structures', insertion: '\\sqrt{□}', focusPlaceholder: 0 },
  { id: 'nth-root', command: 'sqrt', label: 'Nth root', category: 'structures', insertion: '\\sqrt[□]{□}', focusPlaceholder: 0 },
  { id: 'power', command: 'sup', label: 'Power', category: 'structures', insertion: '^{□}', focusPlaceholder: 0 },
  { id: 'subscript', command: 'sub', label: 'Subscript', category: 'structures', insertion: '_{□}', focusPlaceholder: 0 },
  { id: 'sup-sub', command: 'supsub', label: 'Sup + sub', category: 'structures', insertion: '_{□}^{□}', focusPlaceholder: 0 },
  { id: 'parentheses', command: 'parens', label: 'Parentheses', category: 'structures', insertion: '(□)', focusPlaceholder: 0 },
  { id: 'brackets', command: 'brackets', label: 'Square brackets', category: 'structures', insertion: '[□]', focusPlaceholder: 0 },
  { id: 'braces', command: 'braces', label: 'Braces', category: 'structures', insertion: '{□}', focusPlaceholder: 0 },
  { id: 'absolute-value', command: 'abs', label: 'Absolute value', category: 'structures', insertion: '\\abs{□}', focusPlaceholder: 0 },
  { id: 'norm', command: 'norm', label: 'Norm', category: 'structures', insertion: '\\norm{□}', focusPlaceholder: 0 },
  { id: 'angle-brackets', command: 'anglebrackets', label: 'Angle brackets', category: 'structures', insertion: '\\left\\langle□\\right\\rangle', focusPlaceholder: 0 },

  { id: 'logarithm', command: 'log', label: 'Logarithm', category: 'functions', insertion: '\\log_{□}(□)', focusPlaceholder: 0 },
  { id: 'natural-log', command: 'ln', label: 'Natural log', category: 'functions', insertion: '\\ln(□)', focusPlaceholder: 0 },
  { id: 'minimum', command: 'min', label: 'Minimum', category: 'functions', insertion: '\\min_{□\\in□}{□}', focusPlaceholder: 0 },
  { id: 'maximum', command: 'max', label: 'Maximum', category: 'functions', insertion: '\\max_{□\\in□}{□}', focusPlaceholder: 0 },

  { id: 'sine', command: 'sin', label: 'Sine', category: 'trigonometry', insertion: '\\sin(□)', focusPlaceholder: 0 },
  { id: 'cosine', command: 'cos', label: 'Cosine', category: 'trigonometry', insertion: '\\cos(□)', focusPlaceholder: 0 },
  { id: 'tangent', command: 'tan', label: 'Tangent', category: 'trigonometry', insertion: '\\tan(□)', focusPlaceholder: 0 },
  { id: 'cotangent', command: 'cot', label: 'Cotangent', category: 'trigonometry', insertion: '\\cot(□)', focusPlaceholder: 0 },
  { id: 'secant', command: 'sec', label: 'Secant', category: 'trigonometry', insertion: '\\sec(□)', focusPlaceholder: 0 },
  { id: 'cosecant', command: 'csc', label: 'Cosecant', category: 'trigonometry', insertion: '\\csc(□)', focusPlaceholder: 0 },
  { id: 'arcsine', command: 'arcsin', label: 'Inverse sine', category: 'trigonometry', insertion: '\\arcsin(□)', focusPlaceholder: 0 },
  { id: 'arccosine', command: 'arccos', label: 'Inverse cosine', category: 'trigonometry', insertion: '\\arccos(□)', focusPlaceholder: 0 },
  { id: 'arctangent', command: 'arctan', label: 'Inverse tangent', category: 'trigonometry', insertion: '\\arctan(□)', focusPlaceholder: 0 },
  { id: 'arccotangent', command: 'arccot', label: 'Inverse cotangent', category: 'trigonometry', insertion: '\\arccot(□)', focusPlaceholder: 0 },
  { id: 'arcsecant', command: 'arcsec', label: 'Inverse secant', category: 'trigonometry', insertion: '\\arcsec(□)', focusPlaceholder: 0 },
  { id: 'arccosecant', command: 'arccsc', label: 'Inverse cosecant', category: 'trigonometry', insertion: '\\arccsc(□)', focusPlaceholder: 0 },

  { id: 'perpendicular-lines', command: 'perp', label: 'Perpendicular', category: 'geometry', insertion: '\\perp ', focusPlaceholder: 0 },
  { id: 'angle', command: 'angle', label: 'Angle', category: 'geometry', insertion: '\\angle ', focusPlaceholder: 0 },
  { id: 'triangle-notation', command: 'triangle', label: 'Triangle', category: 'geometry', insertion: '\\triangle ', focusPlaceholder: 0 },
  { id: 'degree-mark', command: 'circ', label: 'Degree', category: 'geometry', insertion: '^{\\circ}', focusPlaceholder: 0, previewSource: '\\circ' },
  { id: 'line-segment', command: 'overline', label: 'Line segment', category: 'geometry', insertion: '\\overline{□}', focusPlaceholder: 0 },
  { id: 'vector', command: 'overrightarrow', label: 'Vector', category: 'geometry', insertion: '\\overrightarrow{□}', focusPlaceholder: 0 },

  { id: 'integral', command: 'int', label: 'Integral', category: 'calculus', insertion: '\\int{□}\\diff{□}', focusPlaceholder: 0 },
  { id: 'definite-integral', command: 'int', label: 'Definite integral', category: 'calculus', insertion: '\\int_{□}^{□}{□}\\diff{□}', focusPlaceholder: 2 },
  { id: 'double-integral', command: 'iint', label: 'Double integral', category: 'calculus', insertion: '\\iint_{□}^{□}{□}\\diff{□}\\diff{□}', focusPlaceholder: 2 },
  { id: 'triple-integral', command: 'iiint', label: 'Triple integral', category: 'calculus', insertion: '\\iiint_{□}^{□}{□}\\diff{□}\\diff{□}\\diff{□}', focusPlaceholder: 2 },
  { id: 'contour-integral', command: 'oint', label: 'Contour', category: 'calculus', insertion: '\\oint_{□}{□}\\diff{□}', focusPlaceholder: 1 },
  { id: 'summation', command: 'sum', label: 'Sum', category: 'calculus', insertion: '\\sum_{□}^{□}{□}', focusPlaceholder: 2 },
  { id: 'product', command: 'prod', label: 'Product', category: 'calculus', insertion: '\\prod_{□}^{□}{□}', focusPlaceholder: 2 },
  { id: 'limit', command: 'lim', label: 'Limit', category: 'calculus', insertion: '\\lim_{□\\to□}{□}', focusPlaceholder: 0 },
  { id: 'derivative', command: 'deriv', label: 'Derivative', category: 'calculus', insertion: '\\frac{d}{d□}(□)', focusPlaceholder: 1 },
  { id: 'partial-derivative', command: 'pderiv', label: 'Partial derivative', category: 'calculus', insertion: '\\frac{\\partial}{\\partial□}(□)', focusPlaceholder: 1 },
  { id: 'differential', command: 'diff', label: 'Differential', category: 'calculus', insertion: '\\diff{□}', focusPlaceholder: 0 },
];

// Keep saved legacy commands parseable even when their dedicated palette item is unsupported or removed.
export const TELEX_STRUCTURES = [...new Set([
  ...MATH_STRUCTURE_CATALOG.map(item => item.command),
  'nroot', 'defint', 'bmatrix', 'pmatrix', 'vmatrix', 'pmatrix3x3', 'pmatrix2x3',
  'cases', 'system', 'aligned', 'leftbrace', 'vec', 'hat', 'widehat', 'overset', 'parallel',
])];

export function structureById(id: string): MathStructureDefinition | undefined {
  if (id === 'integral-definite') return MATH_STRUCTURE_CATALOG.find(item => item.id === 'definite-integral');
  return MATH_STRUCTURE_CATALOG.find(item => item.id === id || item.command === id);
}

export function structureByCommand(command: string): MathStructureDefinition | undefined {
  return MATH_STRUCTURE_CATALOG.find(item => item.command === command);
}
