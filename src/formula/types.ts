// ─── Formula AST Types ─── Thiết kế gần với cách hoạt động của Microsoft Word ───

export type NodeType =
  // Basic
  | 'symbol'
  | 'operator'
  | 'text'
  | 'number'
  // Layout
  | 'row'
  | 'fraction'
  | 'root'
  | 'sup'
  | 'sub'
  | 'supsub'
  // Advanced
  | 'integral'
  | 'sum'
  | 'product'
  | 'limit'
  | 'matrix'
  | 'piecewise'
  // Special
  | 'placeholder'
  | 'differential' // d(x)
  | 'parens'       // ()
  | 'brackets'     // []
  | 'braces';      // {}

// 🔥 NodeRole - semantic role of each child for correct layout positioning
export type NodeRole =
  | 'base'
  | 'sup'
  | 'sub'
  | 'numerator'
  | 'denominator'
  | 'radicand'
  | 'degree'
  | 'upper'
  | 'lower'
  | 'body'
  | 'operator'
  | 'inner';

export interface FormulaNode {
  id: string;
  type: NodeType;
  role?: NodeRole;       // 🔥 semantic role dentro parent

  children?: FormulaNode[];
  value?: string;

  layout?: {
    width: number;
    height: number;
    baseline: number;
    ascent: number;       // distance from baseline to top
    descent: number;      // distance from baseline to bottom
  };

  style?: {
    fontSize: number;
    scale: number;
  };

  meta?: {
    isPlaceholder?: boolean;
    isGhost?: boolean;      // ghost placeholder (no visual in overlay)
    editable?: boolean;
    locked?: boolean;
    stretch?: boolean;      // for delimiters that stretch
  };
}

// ─── Scale constants (chuẩn Microsoft Word) ──────────────────────────────────
export const MATH_SCALES = {
  // Big operators
  INTEGRAL: 4.5,
  SUM_PRODUCT: 2.8,
  LIMIT_OP: 1.0,

  // Script sizes
  SUP_SUB: 0.7,
  SUP_SUB_SHIFT_UP: -0.4,   // em units, negative = up
  SUP_SUB_SHIFT_DOWN: 0.3,  // em units, positive = down

  // Fraction
  FRAC_NUMERATOR: 0.9,
  FRAC_DENOMINATOR: 0.9,
  FRAC_BAR_THICKNESS: 1.2,  // px

  // Root
  ROOT_DEGREE: 0.6,

  // Bounds on big operators
  BOUNDS: 0.7,

  // Limit underscript
  LIMIT_LOWER: 0.75,
};

// ─── Cursor ─────────────────────────────────────────────────────────────────
export interface CursorPosition {
  nodeId: string;
  offset: number; // within node's children or value
}

// ─── Telex Mapping ──────────────────────────────────────────────────────────
export interface TelexMapping {
  input: string;
  output: string | null; // null = structural transform
  nodeType?: NodeType;
  symbol?: string;
}

// ─── Canvas integration (BoardNode) ─────────────────────────────────────────
export interface FormulaBoardNode {
  id: string;
  type: 'formula';
  position: { x: number; y: number };
  scale: number;
  data: FormulaNode;
}
