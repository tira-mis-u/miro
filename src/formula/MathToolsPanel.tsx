// ─── Math Tools Panel ─── Floating panel với symbols và structures ───
import * as React from 'react';
import { Calculator } from 'lucide-react';
import './formula.css';

// ─── Symbol definitions ────────────────────────────────────────────────────
const SYMBOL_GROUPS = {
  'GREEK': [
    ['α', 'alpha'], ['β', 'beta'], ['γ', 'gamma'], ['δ', 'delta'], ['π', 'pi'],
    ['θ', 'theta'], ['σ', 'sigma'], ['Ω', 'Omega'], ['λ', 'lambda'], ['μ', 'mu'],
    ['φ', 'phi'], ['ψ', 'psi'], ['ω', 'omega'], ['ε', 'epsilon'], ['η', 'eta'],
  ],
  'OPERATORS': [
    ['∑', 'sum'], ['∫', 'int'], ['∂', 'partial'], ['√', 'sqrt'], ['∞', 'inf'],
    ['≠', 'neq'], ['≈', 'approx'], ['≤', 'le'], ['≥', 'ge'], ['±', 'pm'],
    ['×', 'times'], ['÷', 'div'], ['·', 'cdot'], ['∀', 'forall'], ['∃', 'exists'],
  ],
  'ARROWS': [
    ['→', 'to'], ['←', 'leftarrow'], ['↔', 'leftrightarrow'],
    ['⇒', 'Rightarrow'], ['⇐', 'Leftarrow'],
    ['↑', 'uparrow'], ['↓', 'downarrow'],
  ],
  'SETS': [
    ['∈', 'in'], ['∉', 'notin'], ['⊂', 'subset'], ['⊃', 'supset'],
    ['∪', 'cup'], ['∩', 'cap'], ['∅', 'emptyset'],
  ],
};

// ─── Structure definitions ─────────────────────────────────────────────────
const STRUCTURES = [
  { type: 'fraction', icon: '□/□', label: 'Fraction' },
  { type: 'sqrt', icon: '√□', label: 'Square Root' },
  { type: 'nroot', icon: 'ⁿ√□', label: 'Nth Root' },
  { type: 'sup', icon: 'x□', label: 'Superscript' },
  { type: 'sub', icon: 'x□', label: 'Subscript' },
  { type: 'supsub', icon: 'x□□', label: 'Sup + Sub' },
  { type: 'integral', icon: '∫□', label: 'Integral' },
  { type: 'sum', icon: '∑□', label: 'Summation' },
  { type: 'product', icon: '∏□', label: 'Product' },
  { type: 'limit', icon: 'lim', label: 'Limit' },
  { type: 'parens', icon: '(□)', label: 'Parens' },
  { type: 'matrix2x2', icon: '▦', label: 'Matrix' },
];

interface MathToolsPanelProps {
  onInsertSymbol: (symbol: string) => void;
  onInsertStructure: (type: string) => void;
  zoom?: number;
}

export default function MathToolsPanel({ onInsertSymbol, onInsertStructure, zoom = 1 }: MathToolsPanelProps) {
  // We'll keep the dragging logic but make it relative to the parent-controlled origin
  const [pos, setPos] = React.useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = React.useState(false);
  const lastMouse = React.useRef({ x: 0, y: 0 });

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault(); // Keep focus on the formula input
    e.stopPropagation();
    setIsDragging(true);
    lastMouse.current = { x: e.clientX, y: e.clientY };
  };

  React.useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      const dx = (e.clientX - lastMouse.current.x) / zoom;
      const dy = (e.clientY - lastMouse.current.y) / zoom;
      setPos(p => ({ x: p.x + dx, y: p.y + dy }));
      lastMouse.current = { x: e.clientX, y: e.clientY };
    };
    const onMouseUp = () => setIsDragging(false);

    if (isDragging) {
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [isDragging, zoom]);

  return (
    <div className="math-tools-panel" 
         tabIndex={-1}
         style={{ 
           width: 320, 
           position: 'relative', // Controlled by parent fixed container
           transform: `translate(${pos.x}px, ${pos.y}px)` 
         }}
         onPointerDown={e => e.stopPropagation()}
         onMouseDown={e => { e.stopPropagation(); e.preventDefault(); }}>
      {/* Header */}
      <div className="math-tools-header" onMouseDown={onMouseDown}>
        <Calculator size={14} className="icon" />
        <span className="title">Math Tools</span>
      </div>

      {/* Body */}
      <div className="math-tools-body">
        {/* Symbol groups */}
        {Object.entries(SYMBOL_GROUPS).map(([groupName, symbols]) => (
          <div key={groupName} className="math-tools-section">
            <div className="math-tools-section-title">{groupName}</div>
            <div className="math-tools-grid">
              {symbols.map(([char, name]) => (
                <button
                  key={name}
                  className="math-tool-btn"
                  style={{ fontSize: 20 }}
                  title={`\\${name}`}
                  onMouseDown={(e) => {
                    e.preventDefault(); // Prevent blur from input
                    e.stopPropagation();
                    onInsertSymbol(char);
                  }}
                >
                  {char}
                </button>
              ))}
            </div>
          </div>
        ))}

        {/* Structures */}
        <div className="math-tools-section">
          <div className="math-tools-section-title">STRUCTURES</div>
          <div className="math-tools-grid structures">
            {STRUCTURES.map((s) => (
              <button
                key={s.type}
                className="math-tool-btn structure"
                title={s.label}
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onInsertStructure(s.type);
                }}
              >
                <span className="struct-icon">{s.icon}</span>
                <span className="struct-label">{s.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="math-tools-footer">
        Tip: Type <code>\alpha</code> and press Space to auto-replace.
        Structures: <code>frac</code>, <code>sqrt</code>, <code>int</code>, <code>sum</code>
      </div>
    </div>
  );
}
