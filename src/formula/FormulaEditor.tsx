// ─── Formula Editor Component ─── React component cho editing formula ───
import * as React from 'react';
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import type { FormulaNode } from './types';
import { parseTelex, TELEX_SYMBOLS, TELEX_STRUCTURES } from './parser';
import { renderFormulaToHTML } from './renderer';
import { createRow, createPlaceholder } from './ast';
import MathToolsPanel from './MathToolsPanel';
import './formula.css';

interface FormulaEditorProps {
  initialText: string;
  fontSize: number;
  zoom: number;
  worldX: number;
  worldY: number;
  cam: { x: number; y: number };
  view: { w: number; h: number };
  onTextChange: (text: string) => void;
  onCommit: () => void;
  onASTChange?: (ast: FormulaNode) => void;
  onResize?: (w: number, h: number) => void;
  onMove?: (x: number, y: number) => void;
  clickX?: number; // Screen X of the click
  clickY?: number; // Screen Y of the click
}

export default function FormulaEditor({
  initialText,
  fontSize,
  zoom,
  worldX,
  worldY,
  cam,
  view,
  clickX,
  clickY,
  onTextChange,
  onCommit,
  onASTChange,
  onResize,
  onMove
}: FormulaEditorProps) {
  const [inputText, setInputText] = useState(initialText);
  const [ast, setAst] = useState<FormulaNode>(() => 
    initialText ? parseTelex(initialText) : createRow([createPlaceholder()])
  );
  
  // Draggability - now working in WORLD coordinates
  const [isDragging, setIsDragging] = useState(false);
  const [isMeasured, setIsMeasured] = useState(false); // Used to hide the "pop" during initial resize
  const dragStart = useRef({ wx: worldX, wy: worldY, mx: 0, my: 0 });
  const [previewHeight, setPreviewHeight] = useState(0);

  // 🛠 ALIGNMENT CONSTANTS (Matching formula.css)
  const GUTTER_W = 40; // line numbers gutter
  const INPUT_PAD_L = 12; // textarea padding-left
  const PANEL_BORDER = 2; // border-width
  const OBJECT_PAD = 16; // internal padding of the board object

  // Calculate screen position for the editor (World -> Client)
  const screenX = (worldX - cam.x) * zoom + view.w / 2;
  const screenY = (worldY - cam.y) * zoom + view.h / 2;

  // The "Gutter offset compensation": ensures text inside starts AT screenX + 16px
  const leftOffset = (GUTTER_W + INPUT_PAD_L + PANEL_BORDER - OBJECT_PAD) * zoom;
  const finalX = screenX - leftOffset;
  const finalY = screenY - (previewHeight + PANEL_BORDER) * zoom; // Vertically align textarea top with object top

  const onDragDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    // Drag start in local world units
    dragStart.current = { wx: worldX, wy: worldY, mx: e.clientX, my: e.clientY };
    e.stopPropagation();
  };

  useEffect(() => {
    if (!isDragging) return;
    const onMoveLocal = (e: MouseEvent) => {
      // Delta in screen pixels
      const dx = e.clientX - dragStart.current.mx;
      const dy = e.clientY - dragStart.current.my;
      // Convert screen delta to world delta
      const nwx = dragStart.current.wx + dx / zoom;
      const nwy = dragStart.current.wy + dy / zoom;
      onMove?.(nwx, nwy);
    };
    const onUp = () => setIsDragging(false);
    window.addEventListener('mousemove', onMoveLocal);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMoveLocal);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isDragging, onMove, zoom]);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const mathMeasureRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Focus input on mount & place cursor based on click position
  useEffect(() => {
    const fs = Math.max(14 * zoom, fontSize * zoom);
    // Use proportional width approximation (0.5) to match the Cambria Math rendering on the board!
    const CHAR_W = fs * 0.5; 
    const lineH = 1.6 * fs;

    let targetSelection = inputText.length;
    
    // If we have click coordinates, calculate nearest char
    if (clickX !== undefined && clickY !== undefined) {
      // Offset from the start of the TEXT itself (not the panel)
      const dx = clickX - (screenX + OBJECT_PAD * zoom);
      const dy = clickY - (screenY + OBJECT_PAD * zoom);

      const row = Math.max(0, Math.floor(dy / lineH));
      const col = Math.round(Math.max(0, dx / CHAR_W));

      const linesArr = inputText.split('\n');
      let offset = 0;
      for (let i = 0; i < row && i < linesArr.length; i++) {
        offset += linesArr[i].length + 1; // +1 for \n
      }
      
      const targetLine = linesArr[row] || '';
      targetSelection = offset + Math.min(targetLine.length, col);
    }
    
    // Auto-focus after a short delay
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        inputRef.current.selectionStart = targetSelection;
        inputRef.current.selectionEnd = targetSelection;
      }
    }, 60);
  }, []); // Run once on mount



  // Render preview HTML (memoized)
  const previewHTML = useMemo(() => {
    // 💡 Render at BASE world font size. 
    // The .formula-editor-panel's CSS 'transform: scale(zoom)' handles visual scaling.
    return renderFormulaToHTML(ast, fontSize);
  }, [ast, fontSize]);

  // Cập nhật previewHeight khi nội dung thay đổi
  useEffect(() => {
    if (previewRef.current) {
      setPreviewHeight(previewRef.current.offsetHeight);
    }
  }, [previewHTML]);

  // Parse input → AST (debounced cho performance)
  const updateAST = useCallback((text: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const newAst = parseTelex(text);
      setAst(newAst);
      onASTChange?.(newAst);
    }, 30);
  }, [onASTChange]);
  // Precision measurement of formula content (world units)
  useEffect(() => {
    const mathEl = mathMeasureRef.current;
    if (!mathEl) return; 

    // Measures the absolute fit-content size in the hidden layer
    const rect = mathEl.getBoundingClientRect();
    
    // Convert to world units (rect is in screen pixels since it's outside the zoom-container)
    const contentW = rect.width + 32; 
    const contentH = rect.height + 32; 

    // Synchronize whiteboard shape
    onResize?.(contentW, contentH);
    setIsMeasured(true); // Now we can show the editor without the "pop"

    // Synchronize textarea height
    const textarea = inputRef.current;
    if (textarea) {
      textarea.style.height = 'auto'; // Reset
      textarea.style.height = `${textarea.scrollHeight}px`;
    }
  }, [inputText, onResize, fontSize]); // fontSize is critical for measurement accuracy

  // Line numbering logic
  const lines = inputText.split('\n');

  // Handle input change
  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInputText(val);
    onTextChange(val);
    updateAST(val);
  }, [onTextChange, updateAST]);

  // Handle keydown - auto-replace + shortcuts
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onCommit();
      return;
    }

    // Space: trigger telex auto-replace
    if (e.key === ' ' && !e.shiftKey) {
      const textarea = e.target as HTMLTextAreaElement;
      const text = textarea.value;
      const cursorPos = textarea.selectionStart;
      const beforeCursor = text.slice(0, cursorPos);
      const match = beforeCursor.match(/(?:\\)?([a-zA-Z]+)$/);
      
      if (match) {
        const word = match[1];
        const fullMatch = match[0];
        const startPos = cursorPos - fullMatch.length;
        
        if (TELEX_SYMBOLS[word]) {
          e.preventDefault();
          const newText = text.slice(0, startPos) + TELEX_SYMBOLS[word] + ' ' + text.slice(cursorPos);
          setInputText(newText);
          onTextChange(newText);
          updateAST(newText);
          setTimeout(() => {
            if (inputRef.current) {
              const newPos = startPos + TELEX_SYMBOLS[word].length + 1;
              inputRef.current.selectionStart = newPos;
              inputRef.current.selectionEnd = newPos;
            }
          }, 0);
          return;
        }

        if (TELEX_STRUCTURES.includes(word)) {
          e.preventDefault();
          let replacement = '';
          switch (word) {
            case 'frac': replacement = 'frac{□}{□}'; break;
            case 'sqrt': replacement = 'sqrt(□)'; break;
            case 'nroot': replacement = 'nroot{□}{□}'; break;
            case 'int': replacement = '∫_{□}^{□} □'; break;
            case 'sum': replacement = '∑_{□}^{□} □'; break;
            case 'prod': replacement = '∏_{□}^{□} □'; break;
            case 'lim': replacement = 'lim_{□} □'; break;
            default: replacement = word;
          }
          const newText = text.slice(0, startPos) + replacement + text.slice(cursorPos);
          setInputText(newText);
          onTextChange(newText);
          updateAST(newText);
          setTimeout(() => {
            if (inputRef.current) {
              const placeholderPos = newText.indexOf('□', startPos);
              if (placeholderPos !== -1) {
                inputRef.current.selectionStart = placeholderPos;
                inputRef.current.selectionEnd = placeholderPos + 1;
              }
            }
          }, 0);
          return;
        }
      }
    }
  }, [onCommit, onTextChange, updateAST]);

  // Insert symbol from panel
  const insertSymbol = useCallback((symbol: string) => {
    const textarea = inputRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const newText = inputText.slice(0, start) + symbol + inputText.slice(end);
    setInputText(newText);
    onTextChange(newText);
    updateAST(newText);
    setTimeout(() => {
      textarea.focus();
      const newPos = start + symbol.length;
      textarea.selectionStart = newPos; textarea.selectionEnd = newPos;
    }, 0);
  }, [inputText, onTextChange, updateAST]);

  const insertStructure = useCallback((type: string) => {
    let insertion = '';
    switch (type) {
      case 'fraction': insertion = 'frac{□}{□}'; break;
      case 'sqrt': insertion = 'sqrt(□)'; break;
      case 'nroot': insertion = 'nroot{□}{□}'; break;
      case 'sup': insertion = '^{□}'; break;
      case 'sub': insertion = '_{□}'; break;
      case 'supsub': insertion = '_{□}^{□}'; break;
      case 'integral': insertion = '∫_{□}^{□} □'; break;
      case 'sum': insertion = '∑_{□}^{□} □'; break;
      case 'product': insertion = '∏_{□}^{□} □'; break;
      case 'limit': insertion = 'lim_{□} □'; break;
      case 'parens': insertion = '(□)'; break;
      case 'brackets': insertion = '[□]'; break;
      case 'braces': insertion = '{□}'; break;
      default: return;
    }
    const textarea = inputRef.current; if (!textarea) return;
    const start = textarea.selectionStart;
    const newText = inputText.slice(0, start) + insertion + inputText.slice(textarea.selectionEnd);
    setInputText(newText);
    onTextChange(newText);
    updateAST(newText);
    setTimeout(() => {
      textarea.focus();
      const placeholderPos = newText.indexOf('□', start);
      if (placeholderPos !== -1) {
        textarea.selectionStart = placeholderPos; textarea.selectionEnd = placeholderPos + 1;
      }
    }, 0);
  }, [inputText, onTextChange, updateAST]);

  // Export context for parent
  useEffect(() => {
    (window as any).__formulaEditor = { insertSymbol, insertStructure }; // lint error ID: 123
    return () => { delete (window as any).__formulaEditor; };
  }, [insertSymbol, insertStructure]);

  return (
    <>
      {/* Main Editor Panel */}
      <div className="formula-editor-panel" 
           tabIndex={-1}
           style={{ 
             left: finalX, 
             top: finalY,
             transform: `scale(${zoom})`,
             transformOrigin: 'top left',
             opacity: isMeasured ? 1 : 0, // 🟢 HIDDEN UNTIL SIZED CORRECTLY 🟢
             transition: isMeasured ? 'opacity 0.2s ease-out' : 'none',
             zIndex: 1001
           }}
           onPointerDown={e => e.stopPropagation()}
           onMouseDown={e => e.stopPropagation()}>
        {/* Live Preview / Drag Handle */}
        <div
          ref={previewRef}
          className="formula-preview"
          style={{ minWidth: 450, cursor: 'move' }}
          onMouseDown={(e) => { e.preventDefault(); onDragDown(e); }}
          dangerouslySetInnerHTML={{ __html: previewHTML }}
        />

        {/* Telex Input with Gutter */}
        <div className="formula-input-wrapper" style={{ flex: 1, position: 'relative', display: 'flex' }}>
          <div className="formula-input-gutter">
            {lines.map((_, i) => (
              <div key={i} className="gutter-line">{i + 1}</div>
            ))}
          </div>
          <textarea
            ref={inputRef}
            className="formula-input"
            value={inputText}
            onChange={handleChange}
            onKeyDown={handleKeyDown} 
            onBlur={(e) => {
              // Chỉ commit khi click ra ngoài hẳn các panel liên quan
              const target = e.relatedTarget as HTMLElement;
              if (target && (target.closest('.formula-editor-panel') || target.closest('.math-tools-panel'))) {
                return;
              }
              onCommit();
            }}
            placeholder="Type formula... e.g. sqrt x + alpha"
            style={{
              width: '100%',
              minHeight: 60,
              fontSize: Math.max(14, 16 * zoom),
            }}
            rows={1}
          />
        </div>
      </div>

      {/* Synchronized Math Tools Panel (Pinned to the right) */}
      <div className="math-tools-pinned-container" 
           style={{ 
             position: 'absolute',
             left: finalX + (450 + 24 + (GUTTER_W + INPUT_PAD_L + PANEL_BORDER - OBJECT_PAD)) * zoom, 
             top: finalY,
             transform: `scale(${zoom})`,
             transformOrigin: 'top left',
             zIndex: 1000,
             pointerEvents: 'none',
             opacity: isMeasured ? 1 : 0, // Sync with editor reveal
             transition: isMeasured ? 'opacity 0.2s ease-out' : 'none'
           }}>
        <div style={{ pointerEvents: 'auto' }}>
          <MathToolsPanel
            onInsertSymbol={insertSymbol}
            onInsertStructure={insertStructure}
            zoom={zoom}
          />
        </div>
      </div>

      {/* Invisible Measurement Layer: Used to get the TRUE unconstrained fit-content size */}
      <div 
        ref={mathMeasureRef} 
        style={{
          position: 'absolute',
          visibility: 'hidden',
          top: -10000,
          left: -10000,
          pointerEvents: 'none',
          width: 'fit-content',
          maxWidth: 'none',
          fontSize: fontSize,
          fontFamily: "'Cambria Math', 'Times New Roman', serif",
          lineHeight: '1.2', 
          boxSizing: 'content-box',
          padding: 0
        }}
        dangerouslySetInnerHTML={{ __html: previewHTML }}
      />
    </>
  );
}

