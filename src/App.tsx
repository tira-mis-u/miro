import * as React from 'react';
import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import {
  MousePointer2, PenLine, Eraser, StickyNote, Type,
  Square, Circle, Triangle, Diamond, Star, MoveRight, Sparkles,
  ImageIcon, Undo2, Redo2, ZoomIn, ZoomOut, Maximize2,
  Share2, Play, Timer, Video, MessageSquare, MoreHorizontal,
  Copy, Trash2, Palette, X, ChevronDown, Check,
  Code, Calculator, AppWindow
} from 'lucide-react';
import { CanvasEngine } from './engine/CanvasEngine';
import type { ToolType, StickyShape, AnyShape } from './engine/CanvasEngine';
import { getCanvasShortcutAction } from './engine/keyboardShortcuts';
import {
  continueWithoutLocalRecovery, getBoardRuntimeStatus, initializeBoardStore, yShapes,
} from './store/useBoardStore';
import BoardStatusBanner from './store/BoardStatusBanner';
import FormulaEditor from './formula/FormulaEditor';
import FormulaEditorBoundary from './formula/FormulaEditorBoundary';
import { DEFAULT_CODE_LANGUAGE, normalizeCodeLanguage, type CodeLanguage } from './code/languages';
import { HIGH_CONTRAST_CURSORS, visibleCursor } from './cursors';

const CodeEditor = React.lazy(() => import('./code/CodeEditor'));

// ─── Palettes ─────────────────────────────────────────────────────────────────
const PALETTE = ['#000000', '#f9a8d4', '#ef4444', '#f97316', '#22c55e', '#3b82f6', '#a855f7'];
const STICKY_COLORS = ['#fde047', '#fca5a5', '#fdba74', '#86efac', '#93c5fd', '#d8b4fe'];

const SELECT_TOOLS: { id: ToolType; Icon: React.FC<any>; label: string }[] = [
  { id: 'select', Icon: MousePointer2, label: 'Select' },
  { id: 'lasso-select', Icon: MousePointer2, label: 'Lasso Select' }, // Reuse icon for now
];

const TEXT_TOOLS: { id: ToolType; Icon: React.FC<any>; label: string }[] = [
  { id: 'text', Icon: Type, label: 'Text' },
  { id: 'math', Icon: Calculator, label: 'Math LaTeX' },
  { id: 'code', Icon: Code, label: 'Code Block' },
];

type AddedShapeTool = Extract<ToolType, 'pentagon' | 'hexagon' | 'parallelogram' | 'trapezoid' | 'right-triangle'>;

function ShapeGlyph({ kind, size = 16 }: { kind: AddedShapeTool; size?: number }) {
  const points: Record<AddedShapeTool, string> = {
    pentagon: '12,2 21.5,9 18,21 6,21 2.5,9',
    hexagon: '12,2 21,7 21,17 12,22 3,17 3,7',
    parallelogram: '7,3 22,3 17,21 2,21',
    trapezoid: '6,3 18,3 22,21 2,21',
    'right-triangle': '3,3 21,21 3,21',
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <polygon points={points[kind]} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
  </svg>;
}

const PentagonIcon: React.FC<{ size?: number }> = ({ size }) => <ShapeGlyph kind="pentagon" size={size} />;
const HexagonIcon: React.FC<{ size?: number }> = ({ size }) => <ShapeGlyph kind="hexagon" size={size} />;
const ParallelogramIcon: React.FC<{ size?: number }> = ({ size }) => <ShapeGlyph kind="parallelogram" size={size} />;
const TrapezoidIcon: React.FC<{ size?: number }> = ({ size }) => <ShapeGlyph kind="trapezoid" size={size} />;
const RightTriangleIcon: React.FC<{ size?: number }> = ({ size }) => <ShapeGlyph kind="right-triangle" size={size} />;

const BASIC_SHAPE_TOOLS: { id: ToolType; Icon: React.FC<any>; label: string }[] = [
  { id: 'rect', Icon: Square, label: 'Rectangle' },
  { id: 'rounded-rect', Icon: AppWindow, label: 'Rounded rectangle' },
  { id: 'ellipse', Icon: Circle, label: 'Ellipse' },
  { id: 'diamond', Icon: Diamond, label: 'Diamond' },
  { id: 'star', Icon: Star, label: 'Star' },
  { id: 'triangle', Icon: Triangle, label: 'Triangle' },
  { id: 'callout', Icon: MessageSquare, label: 'Callout' },
  { id: 'arrow', Icon: MoveRight, label: 'Arrow' },
];
const ADDITIONAL_SHAPE_TOOLS: { id: ToolType; Icon: React.FC<any>; label: string }[] = [
  { id: 'pentagon', Icon: PentagonIcon, label: 'Pentagon' },
  { id: 'hexagon', Icon: HexagonIcon, label: 'Hexagon' },
  { id: 'parallelogram', Icon: ParallelogramIcon, label: 'Parallelogram' },
  { id: 'trapezoid', Icon: TrapezoidIcon, label: 'Trapezoid' },
  { id: 'right-triangle', Icon: RightTriangleIcon, label: 'Right triangle' },
];
const SHAPE_TOOLS = [...BASIC_SHAPE_TOOLS, ...ADDITIONAL_SHAPE_TOOLS];

type PopoverGroup = 'pen' | 'shapes' | 'text' | 'select';

// Math symbols và auto-replace đã được chuyển sang formula/parser.ts
// MATH_SYMBOLS và AUTO_REPLACE không còn cần ở đây

function PopoverItem({ active, onClick, Icon, label, grid }: { active: boolean; onClick: (e: React.MouseEvent) => void; Icon: any; label: string; grid?: boolean }) {
  return (
    <button type="button" onClick={onClick} title={label} aria-label={label} aria-pressed={active}
      className={`popover-item${grid ? ' popover-shape-item' : ''}`}>
      <span className="popover-item-icon"><Icon size={grid ? 16 : 15} /></span>
      <span className="popover-item-label">{label}</span>
      {active && <Check size={15} className="popover-item-check" aria-hidden="true" />}
    </button>
  );
}

function SideBtn({ label, active, expanded, buttonRef, onClick, children }: { label: string; active?: boolean; expanded?: boolean; buttonRef?: React.Ref<HTMLButtonElement>; onClick: (e: React.MouseEvent) => void; children: React.ReactNode }) {
  return (
    <button ref={buttonRef} type="button" onClick={onClick} aria-label={label} title={label} aria-pressed={active} aria-expanded={expanded}
      className="side-btn">
      {children}
      <span className="side-tooltip" aria-hidden="true">{label}</span>
    </button>
  );
}

function estimateCodeCursor(source: string, clientX: number, clientY: number, box: { l: number; t: number }, zoom: number, fontSize: number): number {
  const safeZoom = Math.max(0.04, zoom);
  const lines = source.split('\n');
  const lineHeight = Math.max(12, fontSize * 1.55);
  const columnWidth = Math.max(6, fontSize * 0.6);
  const localX = (clientX - box.l) / safeZoom - 54;
  const localY = (clientY - box.t) / safeZoom - 44;
  const row = Math.max(0, Math.min(lines.length - 1, Math.floor(localY / lineHeight)));
  let offset = 0;
  for (let index = 0; index < row; index++) offset += lines[index].length + 1;
  const column = Math.max(0, Math.min(lines[row]?.length ?? 0, Math.round(localX / columnWidth)));
  return offset + column;
}

// Removed ColorSwatch as it was declared but never read.

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const engRef = useRef<CanvasEngine | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  // store last image-drop position
  const imgPosRef = useRef({ x: 0, y: 0 });

  const [tool, setToolSt] = useState<ToolType>('pen');
  const [zoom, setZoom] = useState(1);
  const [cam, setCam] = useState({ x: 0, y: 0, zoom: 1 }); // Sync camera to React for overlays
  const [cursor, setCursor] = useState('crosshair');
  const renderedCursor = visibleCursor(cursor);
  const [boardName, setBoardName] = useState('Untitled');
  const [editName, setEditName] = useState(false);
  const [selIds, setSelIds] = useState<string[]>([]);

  // text/sticky edit overlay
  const [editShape, setEditShape] = useState<AnyShape | null>(null);
  const editShapeRef = useRef<AnyShape | null>(null);
  const editTextRef = useRef('');
  const internalSetEditShape = (s: AnyShape | null) => {
    setEditShape(s);
    editShapeRef.current = s;
    if (!s) editTextRef.current = '';
  };

  const [editText, setEditText] = useState('');
  const [boardReady, setBoardReady] = useState(false);
  const [boardRestoreError, setBoardRestoreError] = useState<string | null>(null);
  const [editLanguage, setEditLanguage] = useState<CodeLanguage>(DEFAULT_CODE_LANGUAGE);
  const [editBox, setEditBox] = useState({ l: 0, t: 0, w: 0, h: 0 });
  const [editClick, setEditClick] = useState({ x: 0, y: 0 });

  // style panel
  const [panelOpen, setPanelOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelTriggerRef = useRef<HTMLButtonElement>(null);
  const [penColor, setPenColor] = useState('#ef4444');
  const [penSize, setPenSize] = useState(6);
  const [fill, setFill] = useState('transparent');
  const [stroke, setStroke] = useState('#ef4444');
  const [sw, setSw] = useState(2);
  const [stickyBg, setStickyBg] = useState('#fef08a');
  const [fontSize, setFontSize] = useState(14);

  const [openGroup, setOpenGroup] = useState<PopoverGroup | null>(null);
  const [penMode, setPenMode] = useState<'normal' | 'smart'>('normal');
  const popoverAnchorRefs = useRef<Record<PopoverGroup, HTMLDivElement | null>>({ pen: null, shapes: null, text: null, select: null });
  const popoverPanelRef = useRef<HTMLDivElement>(null);
  const [popoverPosition, setPopoverPosition] = useState<{ left: number; top: number } | null>(null);
  const [lastTextTool, setLastTextTool] = useState<ToolType>('text');
  const [lastShapeTool, setLastShapeTool] = useState<ToolType>('rect');
  const [lastSelectTool, setLastSelectTool] = useState<ToolType>('select');

  const setTool = (t: ToolType, keepOpen: boolean = false) => {
    setToolSt(t);
    // When manually selecting a tool, close any other open groups
    if (!keepOpen) setOpenGroup(null);
    engRef.current?.setTool(t);
    if (['text', 'math', 'code'].includes(t)) setLastTextTool(t);
    if (SHAPE_TOOLS.some(s => s.id === t)) setLastShapeTool(t);
    if (['select', 'lasso-select'].includes(t)) setLastSelectTool(t);
  };

  const choosePopoverTool = (t: ToolType) => {
    const group = openGroup;
    setTool(t);
    if (group) popoverAnchorRefs.current[group]?.querySelector('button')?.focus();
  };

  const choosePenMode = (mode: 'normal' | 'smart') => {
    setPenMode(mode);
    engRef.current?.setPenMode(mode);
    setTool('pen');
    popoverAnchorRefs.current.pen?.querySelector('button')?.focus();
  };

  const handlePopoverNavigation = useCallback((e: React.KeyboardEvent<HTMLElement>) => {
    const keys = ['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End'];
    if (!keys.includes(e.key)) return;
    const items = Array.from(popoverPanelRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
    if (!items.length) return;

    e.preventDefault();
    e.stopPropagation();
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    let next = current;
    if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = current < 0 ? 0 : (current + 1) % items.length;
    else next = current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length;
    items[next].focus();
  }, []);

  const closeStylePanel = useCallback((restoreFocus = false) => {
    setPanelOpen(false);
    if (restoreFocus) window.requestAnimationFrame(() => panelTriggerRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!panelOpen) return;
    const firstFocusable = panelRef.current?.querySelector<HTMLElement>(
      'button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled)'
    );
    firstFocusable?.focus();
  }, [panelOpen]);

  const handleStylePanelKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeStylePanel(true);
      return;
    }
    if (e.key !== 'Tab') return;

    const panel = panelRef.current;
    if (!panel) return;
    const focusable = Array.from(panel.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled)'
    )).filter(element => element.getClientRects().length > 0);
    if (focusable.length === 0) {
      e.preventDefault();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !panel.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !panel.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  }, [closeStylePanel]);

  useLayoutEffect(() => {
    if (!openGroup) {
      setPopoverPosition(null);
      return;
    }
    const anchor = popoverAnchorRefs.current[openGroup];
    const panel = popoverPanelRef.current;
    if (!anchor || !panel) return;

    const placePopover = () => {
      const anchorRect = anchor.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const margin = 8;
      const maxLeft = Math.max(margin, window.innerWidth - panelRect.width - margin);
      let left = anchorRect.right + 8;
      if (left > maxLeft) left = anchorRect.left - panelRect.width - 8;
      left = Math.max(margin, Math.min(left, maxLeft));
      const maxTop = Math.max(margin, window.innerHeight - panelRect.height - margin);
      const top = Math.max(margin, Math.min(anchorRect.top, maxTop));
      setPopoverPosition({ left, top });
    };

    placePopover();
    window.addEventListener('resize', placePopover);
    return () => window.removeEventListener('resize', placePopover);
  }, [openGroup]);

  const beginBoardInitialization = useCallback(() => {
    setBoardRestoreError(null);
    setBoardReady(false);
    void initializeBoardStore().then(() => {
      setBoardReady(true);
    }).catch(error => {
      const status = getBoardRuntimeStatus();
      setBoardRestoreError(status.message || (error instanceof Error ? error.message : String(error)));
    });
  }, []);

  useEffect(() => {
    beginBoardInitialization();
  }, [beginBoardInitialization]);

  // ── init engine only after local content has been restored ─────────────
  useEffect(() => {
    const cv = canvasRef.current, wrap = wrapRef.current;
    if (!boardReady || !cv || !wrap || engRef.current) return;

    // set canvas physical pixels = container size
    cv.width = wrap.clientWidth;
    cv.height = wrap.clientHeight;

    const eng = new CanvasEngine(cv, yShapes);
    engRef.current = eng;

    eng.onSel = ids => setSelIds(ids);
    eng.onCursor = setCursor;
    eng.onCameraChange = (c) => { setCam(c); setZoom(c.zoom); };
    eng.onZoom = (z) => { setZoom(z); setCam(prev => ({ ...prev, zoom: z })); };
    eng.onTool = t => setToolSt(t);

    eng.onCam = cam => {
      if (editShapeRef.current && 'x' in editShapeRef.current) {
        const s = editShapeRef.current as any;
        const sp = eng.worldToClient(s.x, s.y);
        setEditBox(prev => ({
          ...prev, l: sp.x, t: sp.y,
          w: s.w * cam.zoom, h: s.h * cam.zoom
        }));
      }
    };

    eng.onShapeUpdate = s => {
      if (editShapeRef.current?.id !== s.id) return;
      const updated = s as any;
      if (typeof updated.text === 'string') {
        editTextRef.current = updated.text;
        if (updated.type !== 'math') setEditText(current => current === updated.text ? current : updated.text);
      }
      if (updated.type === 'code') setEditLanguage(normalizeCodeLanguage(updated.language));
      if ('x' in updated && 'y' in updated) {
        const sp = eng.worldToClient(updated.x, updated.y);
        setEditBox({ l: sp.x, t: sp.y, w: updated.w * eng.cam.zoom, h: updated.h * eng.cam.zoom });
      }
      internalSetEditShape(s);
    };

    // Global measurement helper for smart resize
    const measureText = (text: string, font: string, isCode: boolean = false, currentZoom: number = 1) => {
      const mirror = document.createElement('div');
      mirror.style.position = 'absolute';
      mirror.style.visibility = 'hidden';
      mirror.style.whiteSpace = 'pre';
      mirror.style.font = font;
      mirror.style.padding = '0';
      mirror.style.lineHeight = '1.5';
      mirror.style.boxSizing = 'border-box';
      mirror.style.width = 'max-content';
      mirror.style.wordBreak = 'break-word';
      mirror.style.overflowWrap = 'break-word';
      mirror.innerText = text || ' ';
      document.body.appendChild(mirror);

      let rect = mirror.getBoundingClientRect();
      let w = Math.max(20, rect.width) + 12; // 12px extra buffer space prevents aggressive inner early text-wrapping

      const MAX_W = (isCode ? 600 - 62 : 600 - 40) * currentZoom;
      if (w > MAX_W) {
        mirror.style.whiteSpace = 'pre-wrap';
        mirror.style.width = MAX_W + 'px';
        rect = mirror.getBoundingClientRect();
        w = MAX_W;
      }

      const h = Math.max(20, rect.height);
      document.body.removeChild(mirror);
      return { w, h };
    };
    (window as any).measureTextS = measureText;

    eng.onEditText = (shape: AnyShape, cx: number, cy: number) => {
      eng.setEditingId(shape.id);
      const s = shape as any;
      const sp = eng.worldToClient(s.x, s.y);

      let l = sp.x, t = sp.y;
      // Precision positioning handled by FormulaEditor's world-coordinate internal logic.
      // We pass the raw sp coordinates here as the anchor.

      setEditBox({
        l, t,
        w: s.w * eng.cam.zoom,
        h: s.h * eng.cam.zoom,
      });
      setEditClick({ x: cx, y: cy });
      internalSetEditShape(shape);
      editTextRef.current = s.text || '';
      setEditText(s.text || '');
      setEditLanguage(normalizeCodeLanguage(s.language));
    };

    // Global click listener to close popovers when hitting board/outside
    const h = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('aside')) {
        setOpenGroup(null);
      }
    };
    window.addEventListener('mousedown', h, true);

    // Wheel zoom is camera-centered on the pointer. Editable UI and native scroll areas retain their wheel behavior.
    const onWheel = (e: WheelEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('.no-canvas, .panel-ui, .toolbar, .popover, .formula-editor-panel, .math-tools-panel, .code-editor-shell, .board-sticky-overlay, .board-code-preview, input, textarea, select, [contenteditable="true"], [role="dialog"]')) return;
      if (!e.deltaY) return;
      const unit = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : e.deltaMode === WheelEvent.DOM_DELTA_PAGE ? wrap.clientHeight : 1;
      const delta = Math.max(-160, Math.min(160, e.deltaY * unit));
      const factor = Math.max(0.8, Math.min(1.25, Math.exp(-delta * 0.00125)));
      e.preventDefault();
      eng.zoomAt(e.clientX, e.clientY, factor);
    };
    wrap.addEventListener('wheel', onWheel, { passive: false });

    // Window listeners keep drawing, erasing, and panning coherent outside the canvas bounds.
    const onMove = (e: PointerEvent) => eng.pointerMove(e);
    const onUp = (e: PointerEvent) => eng.pointerUp(e);
    const onCancel = () => eng.cancelPointer();
    const onBlur = () => eng.cancelPointer();
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('blur', onBlur);

    // resize → update canvas size
    const ro = new ResizeObserver(() => {
      cv.width = wrap.clientWidth;
      cv.height = wrap.clientHeight;
      eng.mark();
    });
    ro.observe(wrap);

    return () => {
      ro.disconnect();
      window.removeEventListener('mousedown', h, true);
      wrap.removeEventListener('wheel', onWheel);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('blur', onBlur);
      eng.cancelPointer();
      eng.destroy();
      engRef.current = null;
    };
  }, [boardReady]);

  // sync style options
  useEffect(() => {
    const eng = engRef.current; if (!eng) return;
    eng.style = { penColor, penSize, fill, stroke, sw, stickyBg, fontSize };
  }, [penColor, penSize, fill, stroke, sw, stickyBg, fontSize]);

  useEffect(() => { engRef.current?.setPenMode(penMode); }, [penMode]);

  // document title
  useEffect(() => { document.title = `${boardName} - Antiwhite`; }, [boardName]);

  // re-position edit overlay when zoom changes
  useEffect(() => {
    if (!editShape || !engRef.current) return;
    const eng = engRef.current;
    const s = editShape as any;
    const sp = eng.worldToClient(s.x, s.y);
    const sw = s.w * eng.cam.zoom;
    const sh = s.h * eng.cam.zoom;

    // For math shapes, the editor should appear EXACTLY at the shape position (where the user clicks)
    if (s.type === 'math') {
      setEditBox({
        l: sp.x,
        t: sp.y,
        w: sw, h: sh
      });
    } else {
      setEditBox({ l: sp.x, t: sp.y, w: sw, h: sh });
    }
  }, [zoom, editShape]);

  const handleFormulaSourceChange = useCallback((source: string, lastValidPreview?: string) => {
    editTextRef.current = source;
    const current = editShapeRef.current;
    if (current?.type !== 'math') return;
    const stored = yShapes.get(current.id);
    const fallbackPreview = stored?.type === 'math' ? stored.previewText : current.previewText;
    // Source remains authoritative; only a valid preview is allowed to update the board projection.
    engRef.current?.updateFormulaLive(current.id, source, lastValidPreview ?? fallbackPreview ?? '', false);
  }, []);

  const getLastValidFormulaPreview = useCallback(() => {
    const current = editShapeRef.current;
    if (current?.type !== 'math') return '';
    const stored = yShapes.get(current.id);
    return stored?.type === 'math' ? (stored.previewText ?? '') : (current.previewText ?? '');
  }, []);

  // Math Auto-Replace đã được chuyển sang FormulaEditor component.

  const commitEdit = useCallback((formulaSource?: string, lastValidPreview?: string) => {
    if (!editShape) return;
    const eng = engRef.current;
    if (!eng) return;

    const committedText = editShape.type === 'math' ? (formulaSource ?? editTextRef.current) : editText;
    eng.setEditingId(null);
    if (editShape.type === 'math') {
      const storedPreview = getLastValidFormulaPreview() ?? editShape.text ?? '';
      const previewText = lastValidPreview ?? storedPreview;
      if (!committedText.trim() && !previewText.trim()) eng.deleteShape(editShape.id);
      else eng.updateFormula(editShape.id, committedText, previewText);
    } else if (committedText.trim() === '') {
      eng.deleteShape(editShape.id);
    } else if (editShape.type === 'code') {
      eng.updateCode(editShape.id, committedText, editLanguage);
    } else {
      eng.updateText(editShape.id, committedText);
    }
    internalSetEditShape(null);
  }, [editShape, editText, editLanguage, getLastValidFormulaPreview]);

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const active = document.activeElement as HTMLElement | null;
      const tag = active?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || active?.isContentEditable) return;
      if (active?.closest('button, a, select, [role="dialog"], [role="menu"], [role="listbox"], .board-code-preview')) return;
      if (editShape) { if (e.key === 'Escape') commitEdit(); return; }
      const eng = engRef.current; if (!eng) return;

      const shortcut = getCanvasShortcutAction(e, eng.sel.size === 0);
      if (!shortcut) return;
      switch (shortcut.type) {
        case 'pan':
          e.preventDefault();
          eng.panBy(shortcut.dx, shortcut.dy);
          break;
        case 'undo': e.preventDefault(); eng.undo(); break;
        case 'redo': e.preventDefault(); eng.redo(); break;
        case 'duplicate': e.preventDefault(); eng.dupSel(); break;
        case 'delete': eng.deleteSel(); break;
        case 'tool': setTool(shortcut.tool); break;
        case 'open-image': fileRef.current?.click(); break;
        case 'clear-selection':
          eng.sel.clear(); setSelIds([]); eng.mark();
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editShape, setTool, commitEdit]);

  const resizeFormula = useCallback((width: number, height: number) => {
    const id = editShapeRef.current?.id;
    if (id) engRef.current?.updateSize(id, width, height);
  }, []);

  const moveFormula = useCallback((x: number, y: number) => {
    const id = editShapeRef.current?.id;
    if (id) engRef.current?.updatePos(id, x, y);
  }, []);

  const editShapeFontSize = editShape && 'fs' in editShape ? editShape.fs : 14;
  const formulaFontSize = editShape?.type === 'math' ? editShapeFontSize : 14;
  const codeEditorInitialCursor = editShape?.type === 'code'
    ? estimateCodeCursor(editText, editClick.x, editClick.y, editBox, zoom, editShapeFontSize)
    : undefined;

  // image: capture cursor position at click, then open file dialog
  const onImageToolClick = (e: React.MouseEvent) => {
    imgPosRef.current = { x: e.clientX, y: e.clientY };
    fileRef.current?.click();
  };

  const onImageFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    const fr = new FileReader();
    fr.onload = ev => {
      const eng = engRef.current;
      const cv = canvasRef.current;
      if (!eng || !cv) return;

      const rect = cv.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      eng.addImage(ev.target!.result as string, cx, cy);
    };
    fr.readAsDataURL(f);
    e.target.value = '';
    setTool('select');
  };

  const zoomBy = (d: number) => { const e = engRef.current; if (!e) return; e.setCamera(e.cam.x, e.cam.y, Math.max(.04, Math.min(16, e.cam.zoom + d))); };
  const resetZoom = () => engRef.current?.setCamera(0, 0, 1);

  return (
    <div className="app-shell flex flex-col overflow-hidden select-none" style={{
      '--aw-cursor-pointer': HIGH_CONTRAST_CURSORS.pointer,
      '--aw-cursor-text': HIGH_CONTRAST_CURSORS.text,
      '--aw-cursor-grab': HIGH_CONTRAST_CURSORS.grab,
      '--aw-cursor-grabbing': HIGH_CONTRAST_CURSORS.grabbing,
      '--aw-cursor-move': HIGH_CONTRAST_CURSORS.move,
    } as React.CSSProperties}>

      {/* ══ TOPBAR ══════════════════════════════════════════════════════════ */}
      <header className="app-header">
        <div className="header-brand">
          <svg className="brand-mark" width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
            <rect width="28" height="28" rx="7" fill="#F2A310" />
            <path d="M7 20l7-12 7 12h-2.5l-1.5-3h-6l-1.5 3H7zm4-5h6l-3-6-3 6z" fill="#111" />
          </svg>
          <span className="header-brand-label">antiwhite</span>
        </div>
        <span className="header-divider" aria-hidden="true" />

        <div className="header-board">
          <span className="header-breadcrumb">Boards</span>
          <span className="header-crumb-separator" aria-hidden="true">/</span>
          {editName ? (
            <input ref={nameRef} value={boardName} aria-label="Board name"
              onChange={e => setBoardName(e.target.value || 'Untitled')}
              onBlur={() => setEditName(false)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); setEditName(false); } }}
              className="header-name-input"
              autoFocus />
          ) : (
            <button onClick={() => { setEditName(true); setTimeout(() => nameRef.current?.select(), 15); }}
              className="header-board-name">
              <span className="header-board-title">{boardName}</span>
              <ChevronDown size={14} aria-hidden="true" />
            </button>
          )}
        </div>

        <div className="header-spacer" />
        <div className="header-presence" role="img" aria-label="Sample collaborator avatars; collaboration is not connected">
          <span className="presence-label">Sample</span>
          <div className="presence-avatars" aria-hidden="true">
            {['#6366f1', '#22c55e', '#f97316'].map((c, i) => (
              <div key={i} className="presence-avatar" style={{ background: c, zIndex: 3 - i }}>{String.fromCharCode(65 + i)}</div>
            ))}
          </div>
        </div>
        <span className="header-action-divider" aria-hidden="true" />
        <div className="header-actions">
          <button type="button" disabled title="Presentation is not available yet" aria-label="Present (not available yet)"
            className="header-action header-action-secondary">
            <Play size={14} strokeWidth={2.25} className="fill-current" /><span className="header-action-label">Present</span>
          </button>
          <button type="button" disabled title="Sharing is not available yet" aria-label="Share (not available yet)"
            className="header-action header-action-primary">
            <Share2 size={14} strokeWidth={2.25} /><span className="header-action-label">Share</span>
          </button>
          <div className="header-user-avatar" aria-hidden="true">U</div>
        </div>
      </header>

      {/* ══ BODY ════════════════════════════════════════════════════════════ */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* SIDEBAR */}
        <aside onKeyDown={e => {
          if (!openGroup) return;
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            const group = openGroup;
            setOpenGroup(null);
            popoverAnchorRefs.current[group]?.querySelector('button')?.focus();
          } else {
            handlePopoverNavigation(e);
          }
        }} className="tool-rail">
          <div className="tool-stack">
            {/* SELECT GROUP */}
            <div ref={el => { popoverAnchorRefs.current.select = el }} className="tool-group">
              <SideBtn label="Select Tools" active={['select', 'lasso-select'].includes(tool)} expanded={openGroup === 'select'}
                onClick={() => { const next = openGroup === 'select' ? null : 'select'; setOpenGroup(next); if (next) setTool(lastSelectTool, true); }}>
                {(() => {
                  const active = ['select', 'lasso-select'].includes(tool) ? tool : lastSelectTool;
                  const entry = SELECT_TOOLS.find(t => t.id === active);
                  return entry ? <entry.Icon size={17} /> : <MousePointer2 size={17} />;
                })()}
              </SideBtn>
              {openGroup === 'select' && (
                <div ref={popoverPanelRef} className="tool-popover tool-popover-list" role="group" aria-label="Selection tools" onKeyDown={handlePopoverNavigation}
                  style={{ left: popoverPosition?.left ?? -9999, top: popoverPosition?.top ?? -9999 }}>
                  <div className="tool-popover-heading">Selection mode</div>
                  {SELECT_TOOLS.map(t => (
                    <PopoverItem key={t.id} active={(tool === 'select' || tool === 'lasso-select') ? tool === t.id : lastSelectTool === t.id} Icon={t.Icon} label={t.label} onClick={() => { choosePopoverTool(t.id); }} />
                  ))}
                </div>
              )}
            </div>

            <div className="tool-divider" aria-hidden="true" />
            <div ref={el => { popoverAnchorRefs.current.pen = el }} className="tool-group">
              <SideBtn label="Pen modes" active={tool === 'pen'} expanded={openGroup === 'pen'}
                onClick={() => { const next = openGroup === 'pen' ? null : 'pen'; setOpenGroup(next); if (next) setTool('pen', true); }}>
                {penMode === 'smart' ? <Sparkles size={17} /> : <PenLine size={17} />}
              </SideBtn>
              {openGroup === 'pen' && (
                <div ref={popoverPanelRef} className="tool-popover tool-popover-list" role="group" aria-label="Pen drawing modes" onKeyDown={handlePopoverNavigation}
                  style={{ left: popoverPosition?.left ?? -9999, top: popoverPosition?.top ?? -9999 }}>
                  <div className="tool-popover-heading">Pen mode</div>
                  <PopoverItem active={penMode === 'normal'} Icon={PenLine} label="Normal" onClick={() => choosePenMode('normal')} />
                  <PopoverItem active={penMode === 'smart'} Icon={Sparkles} label="Smart Drawing" onClick={() => choosePenMode('smart')} />
                </div>
              )}
            </div>
            <SideBtn label="Eraser" active={tool === 'eraser'} onClick={() => setTool('eraser')}><Eraser size={17} /></SideBtn>
            <div className="tool-divider" aria-hidden="true" />
            <SideBtn label="Sticky (S)" active={tool === 'sticky'} onClick={() => setTool('sticky')}><StickyNote size={17} /></SideBtn>

            {/* TEXT GROUP */}
            <div ref={el => { popoverAnchorRefs.current.text = el }} className="tool-group">
              <SideBtn label="Text Tools" active={['text', 'math', 'code'].includes(tool)} expanded={openGroup === 'text'}
                onClick={() => { const next = openGroup === 'text' ? null : 'text'; setOpenGroup(next); if (next) setTool(lastTextTool, true); }}>
                {(() => {
                  const active = ['text', 'math', 'code'].includes(tool) ? tool : lastTextTool;
                  if (active === 'math') return <Calculator size={17} />;
                  if (active === 'code') return <Code size={17} />;
                  return <Type size={17} />;
                })()}
              </SideBtn>
              {openGroup === 'text' && (
                <div ref={popoverPanelRef} className="tool-popover tool-popover-list" role="group" aria-label="Text tools" onKeyDown={handlePopoverNavigation}
                  style={{ left: popoverPosition?.left ?? -9999, top: popoverPosition?.top ?? -9999 }}>
                  <div className="tool-popover-heading">Text &amp; math</div>
                  {TEXT_TOOLS.map(t => (
                    <PopoverItem key={t.id} active={['text', 'math', 'code'].includes(tool) ? tool === t.id : lastTextTool === t.id} Icon={t.Icon} label={t.label} onClick={() => { choosePopoverTool(t.id); }} />
                  ))}
                </div>
              )}
            </div>

            {/* SHAPES GROUP */}
            <div ref={el => { popoverAnchorRefs.current.shapes = el }} className="tool-group">
              <SideBtn label="Shapes" active={SHAPE_TOOLS.some(s => s.id === tool)} expanded={openGroup === 'shapes'}
                onClick={() => { const next = openGroup === 'shapes' ? null : 'shapes'; setOpenGroup(next); if (next) setTool(lastShapeTool, true); }}>
                {(() => {
                  const active = SHAPE_TOOLS.some(s => s.id === tool) ? tool : lastShapeTool;
                  const entry = SHAPE_TOOLS.find(s => s.id === active);
                  return entry ? React.createElement(entry.Icon, { size: 17 }) : <Square size={17} />;
                })()}
              </SideBtn>
              {openGroup === 'shapes' && (
                <div ref={popoverPanelRef} className="tool-popover tool-popover-shapes" role="group" aria-label="Shape tools" onKeyDown={handlePopoverNavigation}
                  style={{ left: popoverPosition?.left ?? -9999, top: popoverPosition?.top ?? -9999 }}>
                  <div className="tool-popover-heading">Basic shapes</div>
                  <div className="shape-option-grid">
                    {BASIC_SHAPE_TOOLS.map(t => (
                      <PopoverItem key={t.id} active={SHAPE_TOOLS.some(s => s.id === tool) ? tool === t.id : lastShapeTool === t.id} Icon={t.Icon} label={t.label} grid onClick={() => { choosePopoverTool(t.id); }} />
                    ))}
                  </div>
                  <div className="tool-popover-heading additional-shapes-heading">Polygons</div>
                  <div className="shape-option-grid">
                    {ADDITIONAL_SHAPE_TOOLS.map(t => (
                      <PopoverItem key={t.id} active={SHAPE_TOOLS.some(s => s.id === tool) ? tool === t.id : lastShapeTool === t.id} Icon={t.Icon} label={t.label} grid onClick={() => { choosePopoverTool(t.id); }} />
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="tool-divider" aria-hidden="true" />
            <SideBtn label="Image (I)" onClick={onImageToolClick}>
              <ImageIcon size={17} />
            </SideBtn>
          </div>
          <div className="tool-stack tool-stack-bottom">
            <div className="tool-divider" aria-hidden="true" />
            <SideBtn label="Colors & Styles" active={panelOpen} expanded={panelOpen} buttonRef={panelTriggerRef} onClick={() => setPanelOpen(v => !v)}>
              <div className="w-5 h-5 rounded-full border-2 border-white/30 overflow-hidden">
                <div className="w-full h-full rounded-full" style={{ background: penColor }} />
              </div>
            </SideBtn>
            <SideBtn label="Undo (Ctrl+Z)" onClick={() => engRef.current?.undo()}><Undo2 size={16} strokeWidth={1.8} /></SideBtn>
            <SideBtn label="Redo (Ctrl+Y)" onClick={() => engRef.current?.redo()}><Redo2 size={16} strokeWidth={1.8} /></SideBtn>
          </div>
        </aside>

        {/* CANVAS AREA */}
        <div ref={wrapRef} className="canvas-workspace relative flex-1 min-w-0 min-h-0 overflow-hidden" style={{ cursor: renderedCursor }}
          onPointerDown={e => {
            const eng = engRef.current; if (!eng) return;
            // Right- and middle-button gestures are camera-only, regardless of the active drawing tool.
            if (e.button === 2 || e.button === 1) {
              eng.pointerDown(e.nativeEvent);
              return;
            }
            if (e.button !== 0) return;
            if (tool === 'image') {
              imgPosRef.current = { x: e.clientX, y: e.clientY };
              fileRef.current?.click();
              return;
            }
            const target = e.target as HTMLElement;
            const sticky = target.closest('[id^="ol_"]');
            if (sticky && (sticky as HTMLElement).scrollHeight > (sticky as HTMLElement).clientHeight) {
              const rect = sticky.getBoundingClientRect();
              if (e.clientX >= rect.right - 20) return;
            }
            eng.pointerDown(e.nativeEvent);
          }}
          onDoubleClick={e => engRef.current?.doubleClick(e.nativeEvent)}
          onContextMenu={e => {
            const target = e.target as HTMLElement;
            if (!target.closest('.no-canvas, .formula-editor-panel, .math-tools-panel, .code-editor-shell, .panel-ui')) e.preventDefault();
          }}
        >
          <canvas
            ref={canvasRef}
            tabIndex={0}
            aria-label="Whiteboard canvas. Use the tool rail or keyboard shortcuts to choose tools. Right-drag to pan, scroll to zoom at the pointer, and use arrow keys to pan when no object is selected."
            style={{ cursor: renderedCursor, position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block', touchAction: 'none' }}
          />

          {(!boardReady || boardRestoreError) && (
            <div role={boardRestoreError ? 'alert' : 'status'} aria-live="polite" style={{ position: 'absolute', inset: 0, zIndex: 2000,
              display: 'grid', placeItems: 'center', padding: 20, background: 'rgba(248, 248, 245, .96)', pointerEvents: 'auto' }}>
              {boardRestoreError ? (
                <div style={{ width: 'min(520px, 100%)', padding: 22, background: '#fff', border: '1px solid #fca5a5', borderRadius: 16,
                  boxShadow: '0 18px 54px rgba(15,23,42,.18)', color: '#0f172a', font: '14px/1.5 Inter, Segoe UI, sans-serif' }}>
                  <strong style={{ fontSize: 17 }}>The saved board could not be recovered</strong>
                  <p style={{ margin: '10px 0', color: '#475569' }}>The canvas is blocked so a blank board cannot replace saved content. Check browser storage, then retry. If you continue without recovery, this tab may not survive a reload.</p>
                  <p style={{ margin: '0 0 14px', padding: 9, color: '#7f1d1d', background: '#fef2f2', borderRadius: 8, overflowWrap: 'anywhere' }}>{boardRestoreError}</p>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                    <button type="button" onClick={beginBoardInitialization} style={{ padding: '8px 12px', background: '#eff6ff', color: '#1d4ed8', borderRadius: 8, fontWeight: 700 }}>Retry recovery</button>
                    <button type="button" onClick={() => { continueWithoutLocalRecovery(); setBoardRestoreError(null); setBoardReady(true); }}
                      style={{ padding: '8px 12px', background: '#b91c1c', color: '#fff', borderRadius: 8, fontWeight: 700 }}>Continue without local recovery</button>
                  </div>
                </div>
              ) : <div style={{ padding: '10px 14px', color: '#334155', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10,
                boxShadow: '0 8px 24px rgba(15,23,42,.12)', font: '500 13px/1.4 Inter, Segoe UI, sans-serif' }}>Restoring the local board before opening the canvas…</div>}
            </div>
          )}

          {/* Text, sticky-note, and source-code editing overlays */}
          {editShape && editShape.type !== 'math' && (
            <div className={`no-canvas ${editShape.type === 'code' ? 'code-editor-overlay' : ''}`}
              style={{ position: 'fixed', zIndex: 530, left: editBox.l, top: editBox.t,
                transform: `scale(${zoom})`, transformOrigin: '0 0' }}
              onPointerDown={event => event.stopPropagation()}
              onDoubleClick={event => event.stopPropagation()}
              onWheel={event => event.stopPropagation()}
              onContextMenu={event => event.stopPropagation()}>
              <div className="relative group/editbox" style={{
                width: editBox.w / zoom,
                height: editBox.h / zoom,
                boxSizing: 'border-box',
                boxShadow: editShape.type === 'sticky' ? '0 12px 48px rgba(0,0,0,0.18)' : editShape.type === 'code' ? '0 12px 64px rgba(0,0,0,0.45)' : 'none',
                borderRadius: editShape.type === 'sticky' ? 3 : editShape.type === 'code' ? 6 : 4,
                overflow: 'visible',
                background: editShape.type === 'sticky' ? (editShape as StickyShape).bg : editShape.type === 'code' ? '#1b2430' : 'transparent',
                border: 'none',
              }}>
                <div style={{
                  position: 'absolute', inset: -4 / zoom,
                  border: `${2.5 / zoom}px solid #3b82f6`,
                  borderRadius: 3 / zoom, pointerEvents: 'none', zIndex: 10,
                }}>
                  {[-1, 0, 1].map(x => [-1, 0, 1].map(y => {
                    if (x === 0 && y === 0) return null;
                    const left = x === -1 ? `${-5 / zoom}px` : x === 0 ? `calc(50% - ${5 / zoom}px)` : `calc(100% - ${5 / zoom}px)`;
                    const top = y === -1 ? `${-5 / zoom}px` : y === 0 ? `calc(50% - ${5 / zoom}px)` : `calc(100% - ${5 / zoom}px)`;
                    return <div key={`${x}${y}`} style={{ position: 'absolute', left, top, width: 10 / zoom, height: 10 / zoom,
                      background: '#fff', border: `${1.5 / zoom}px solid #3b82f6`, borderRadius: '50%' }} />;
                  }))}
                </div>

                {editShape.type === 'code' ? (
                  <React.Suspense fallback={<div className="code-editor-loading">Loading code editor…</div>}>
                    <CodeEditor
                      key={editShape.id}
                      value={editText}
                      language={editLanguage}
                      initialCursor={codeEditorInitialCursor}
                      fontSize={editShapeFontSize}
                      autoHeight={editShape.autoHeight !== false}
                      onChange={value => {
                        setEditText(value);
                        engRef.current?.updateCodeLive(editShape.id, value, editLanguage);
                      }}
                      onLayout={height => engRef.current?.updateCodeLayoutLive(editShape.id, height)}
                      onAutoHeightChange={(enabled, height) => engRef.current?.setCodeAutoHeight(editShape.id, enabled, height)}
                      onLanguageChange={language => {
                        setEditLanguage(language);
                        engRef.current?.updateCodeLive(editShape.id, editText, language);
                      }}
                      onCommit={commitEdit}
                    />
                  </React.Suspense>
                ) : (
                  <textarea
                    className="board-text-editor"
                    aria-label={`Edit ${editShape.type} content`}
                    ref={element => {
                      if (!element || (element as any)._initFocus === editShape.id) return;
                      (element as any)._initFocus = editShape.id;
                      element.focus();
                      const fs = (editShape as any).fs || 14;
                      const charWidth = fs * 0.5;
                      const lineHeight = 1.5 * fs;
                      const dx = (editClick.x - editBox.l) / zoom - 16;
                      const dy = (editClick.y - editBox.t) / zoom - 16;
                      const row = Math.max(0, Math.floor(dy / lineHeight));
                      const column = Math.max(0, Math.round(dx / charWidth));
                      const lines = (editText || '').split('\n');
                      let offset = 0;
                      for (let index = 0; index < row && index < lines.length; index++) offset += lines[index].length + 1;
                      const position = offset + Math.min(lines[row]?.length ?? 0, column);
                      setTimeout(() => element.setSelectionRange(position, position), 0);
                    }}
                    value={editText}
                    onChange={event => {
                      const value = event.target.value;
                      setEditText(value);
                      const engine = engRef.current;
                      engine?.updateTextLive(editShape.id, value);
                      if (editShape.type !== 'sticky' && engine) {
                        const shape = editShape as any;
                        const measured = (window as any).measureTextS(value, `${shape.fs}px 'Inter','Segoe UI',sans-serif`, false, 1);
                        const width = measured.w + 40;
                        const height = measured.h + 40;
                        setEditBox(previous => ({ ...previous, w: width * zoom, h: height * zoom }));
                        engine.updateSize(editShape.id, width, height);
                      }
                    }}
                    onBlur={() => commitEdit()}
                    onKeyDown={event => {
                      if (event.key === 'Escape') { event.preventDefault(); commitEdit(); }
                    }}
                    style={{
                      width: '100%', height: '100%', background: 'transparent',
                      fontSize: (editShape as any).fs, padding: 16,
                      fontFamily: "'Inter','Segoe UI',sans-serif", color: editShape.type === 'text' ? '#000' : 'rgba(0,0,0,0.8)',
                      caretColor: '#3b82f6', lineHeight: 1.5, boxSizing: 'border-box', resize: 'none',
                      border: 'none', borderRadius: 0, display: 'block', whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word', overflowWrap: 'break-word', overflowX: 'hidden',
                      overflowY: editShape.type === 'sticky' ? 'auto' : 'hidden',
                    }}
                  />
                )}
              </div>
            </div>
          )}

          {/* ── Formula Editor (Math) ── */}
          {editShape && editShape.type === 'math' && (
            <FormulaEditorBoundary key={editShape.id} sourceRef={editTextRef} getLastValidPreview={getLastValidFormulaPreview}
              onSourceChange={handleFormulaSourceChange} onCommit={commitEdit}>
              <FormulaEditor
                key={editShape.id}
                initialText={editText}
                initialPreviewText={(editShape as any).previewText ?? editText}
                fontSize={formulaFontSize}
                zoom={cam.zoom}
                worldX={(editShape as any).x}
                worldY={(editShape as any).y}
                cam={cam}
                view={{ w: wrapRef.current?.clientWidth || 0, h: wrapRef.current?.clientHeight || 0 }}
                onTextChange={handleFormulaSourceChange}
                onCommit={commitEdit}
                onResize={resizeFormula}
                onMove={moveFormula}
                clickX={editClick.x !== undefined ? editClick.x - (canvasRef.current?.getBoundingClientRect().left || 0) : undefined}
                clickY={editClick.y !== undefined ? editClick.y - (canvasRef.current?.getBoundingClientRect().top || 0) : undefined}
              />
            </FormulaEditorBoundary>
          )}

          {/* Math Tools Panel handled inside FormulaEditor */}

          {/* Floating selection toolbar */}
          {selIds.length > 0 && !editShape && (tool === 'select' || tool === 'lasso-select') && (
            <div className="selection-toolbar toolbar no-canvas absolute top-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-1
                            bg-white rounded-xl shadow-md px-3 py-1.5 border border-gray-200">
              <span className="text-[11px] text-gray-600 font-medium pr-2 border-r border-gray-200">{selIds.length} selected</span>
              <button onClick={() => engRef.current?.dupSel()}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] font-medium rounded-lg hover:bg-gray-50 text-gray-700 transition-colors">
                <Copy size={13} /> Duplicate
              </button>
              <button onClick={() => { const ids = [...engRef.current!.sel]; engRef.current?.updateStyle(ids, { fill, stroke, sw }); }}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] font-medium rounded-lg hover:bg-gray-50 text-gray-700 transition-colors">
                <Palette size={13} /> Style
              </button>
              <div className="w-px h-4 bg-gray-200" />
              <button onClick={() => engRef.current?.deleteSel()}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] font-medium rounded-lg hover:bg-red-50 text-red-600 transition-colors">
                <Trash2 size={12} /> Delete
              </button>
            </div>
          )}

          {/* Canvas HUD: responsive groups keep controls from overlapping the board edge. */}
          <div className="canvas-hud no-canvas">
            <div className="hud-utility-cluster">
              {[["Timer", Timer], ["Video", Video], ["Comments", MessageSquare], ["More", MoreHorizontal]].map(([label, Icon]: any) => (
                <button key={label} type="button" disabled title={`${label} is not available yet`} aria-label={`${label} (not available yet)`}
                  className="hud-tool-button flex items-center justify-center rounded-md text-gray-500 disabled:cursor-not-allowed">
                  <Icon size={16} strokeWidth={2} />
                </button>
              ))}
            </div>

            <div className="canvas-hud-hint" aria-label="Canvas controls: right-drag to pan; scroll to zoom at the pointer; double-click a text-like object to edit">
              <span>Right-drag to pan</span><span className="hud-hint-divider" aria-hidden="true" />
              <span>Scroll to zoom at pointer</span><span className="hud-hint-divider" aria-hidden="true" />
              <span>Double-click text-like object to edit</span>
            </div>

            <div className="zoom-controls flex items-center bg-white rounded-lg border border-gray-200 overflow-hidden">
              <button type="button" onClick={resetZoom} title="Reset zoom to 100%" aria-label="Reset zoom to 100 percent"
                className="zoom-control-button flex items-center justify-center hover:bg-gray-50 text-gray-600 transition-colors border-r border-gray-200"><Maximize2 size={14} /></button>
              <button type="button" onClick={() => zoomBy(-0.2)} title="Zoom out" aria-label="Zoom out"
                className="zoom-control-button flex items-center justify-center hover:bg-gray-50 text-gray-700 transition-colors"><ZoomOut size={15} /></button>
              <button type="button" onClick={resetZoom} aria-label={`Zoom level ${Math.round(zoom * 100)} percent; reset zoom`}
                className="zoom-percent-button h-9 px-2 min-w-[52px] text-[12px] font-semibold text-gray-800 hover:bg-gray-50 transition-colors tabular-nums">{Math.round(zoom * 100)}%</button>
              <button type="button" onClick={() => zoomBy(0.2)} title="Zoom in" aria-label="Zoom in"
                className="zoom-control-button flex items-center justify-center hover:bg-gray-50 text-gray-700 transition-colors border-l border-gray-200"><ZoomIn size={15} /></button>
            </div>
          </div>
        </div>
      </div>

      {/* ══ COLOR PANEL ══════════════════════════════════════════════════════ */}
      {panelOpen && (
        <>
          <div className="panel-backdrop fixed inset-0 z-[998]" aria-hidden="true" onClick={() => closeStylePanel(true)} />
          <div ref={panelRef} className="panel-ui fixed z-[999] rounded-xl border overflow-hidden flex flex-col"
            role="dialog" aria-label="Colors and styles" aria-modal="true"
            onKeyDown={handleStylePanelKeyDown}
            style={{
              top: '50%', left: 'clamp(8px, calc(100vw - 296px), 68px)', transform: 'translateY(-50%)',
              width: 'min(284px, calc(100vw - 16px))', maxHeight: 'calc(100dvh - 16px)'
            }}>
            <div className="panel-heading sticky top-0 z-10 flex items-center justify-between px-4 py-3 border-b shrink-0">
              <div className="panel-title-group flex items-center gap-2"><Palette size={16} aria-hidden="true" /><span>Colors &amp; styles</span></div>
              <button type="button" onClick={() => closeStylePanel(true)} aria-label="Close Colors & Styles" className="panel-close-button"><X size={16} /></button>
            </div>
            <div className="panel-content">
              {/* Pen */}
              <section>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Pen Color</span>
                  <span className="text-[10px] font-mono text-gray-400">{penColor}</span>
                </div>
                <div className="flex gap-1 flex-wrap mb-2">
                  {PALETTE.map(c => (
                    <button key={c} type="button" onClick={() => setPenColor(c)} aria-label={`Pen color ${c}`} aria-pressed={penColor === c} className={`color-swatch w-6 h-6 rounded border flex items-center justify-center ${penColor === c ? 'border-blue-500' : 'border-transparent'}`} style={{ background: c }}>{penColor === c && <Check size={10} color={['#f9a8d4', '#f97316'].includes(c) ? '#192536' : '#fff'} />}</button>
                  ))}
                  <div className="relative">
                    <input type="color" value={penColor} onChange={e => setPenColor(e.target.value)} aria-label="Choose custom pen color" className="color-picker-input w-6 h-6 opacity-0 absolute inset-0 cursor-pointer" />
                    <button type="button" tabIndex={-1} aria-hidden="true" className="w-6 h-6 rounded border border-gray-300 flex items-center justify-center bg-transparent"><Palette size={12} color="#999" /></button>
                  </div>
                </div>
              </section>

              {/* Pen size */}
              <section>
                <div className="flex justify-between mb-2">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Pen Size</span>
                  <span className="text-[11px] text-gray-400">{penSize}px</span>
                </div>
                <input type="range" min={1} max={50} value={penSize} aria-label="Pen size" onChange={e => setPenSize(+e.target.value)} className="w-full h-1.5 accent-blue-500" />
              </section>

              {/* Font size */}
              <section>
                <div className="flex justify-between mb-2">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Font Size</span>
                  <span className="text-[11px] text-gray-400">{fontSize}px</span>
                </div>
                <input type="range" min={10} max={48} value={fontSize} aria-label="Font size" onChange={e => setFontSize(+e.target.value)} className="w-full accent-blue-500 h-1.5" />
              </section>

              <hr className="border-gray-100" />

              {/* Fill */}
              <section>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Shape Fill</span>
                  <span className="text-[10px] font-mono text-gray-400">{fill}</span>
                </div>
                <div className="flex gap-1 flex-wrap mb-2">
                  {PALETTE.map((c, i) => (
                    <button key={i} type="button" onClick={() => setFill(c)} aria-label={`Shape fill ${c}`} aria-pressed={fill === c} className={`color-swatch w-6 h-6 rounded border flex items-center justify-center ${fill === c ? 'border-blue-500' : 'border-transparent'}`} style={{ background: c }}>{fill === c && <Check size={10} color={['#ffffff', '#f9a8d4', '#f97316'].includes(c) ? '#192536' : '#fff'} />}</button>
                  ))}
                  <button type="button" onClick={() => setFill('transparent')} aria-label="Transparent shape fill" aria-pressed={fill === 'transparent'} className={`color-swatch w-6 h-6 rounded border border-dashed border-gray-300 flex items-center justify-center ${fill === 'transparent' ? 'border-blue-500 bg-gray-100' : 'bg-transparent'}`} title="Transparent"><X size={12} color="#999" /></button>
                  <div className="relative">
                    <input type="color" value={fill === 'transparent' ? '#ffffff' : fill} onChange={e => setFill(e.target.value)} aria-label="Choose custom shape fill" className="color-picker-input w-6 h-6 opacity-0 absolute inset-0 cursor-pointer" />
                    <button type="button" tabIndex={-1} aria-hidden="true" className="w-6 h-6 rounded border border-gray-300 flex items-center justify-center bg-transparent"><Palette size={12} color="#999" /></button>
                  </div>
                </div>
              </section>

              {/* Stroke */}
              <section>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Stroke</span>
                  <span className="text-[10px] font-mono text-gray-400">{stroke}</span>
                </div>
                <div className="flex gap-1 flex-wrap mb-2">
                  {PALETTE.map((c, i) => (
                    <button key={i} type="button" onClick={() => setStroke(c)} aria-label={`Stroke color ${c}`} aria-pressed={stroke === c} className={`color-swatch w-6 h-6 rounded border flex items-center justify-center ${stroke === c ? 'border-blue-500' : 'border-transparent'}`} style={{ background: c }}>{stroke === c && <Check size={10} color={['#ffffff', '#f9a8d4', '#f97316'].includes(c) ? '#192536' : '#fff'} />}</button>
                  ))}
                  <button type="button" onClick={() => setStroke('transparent')} aria-label="Transparent stroke" aria-pressed={stroke === 'transparent'} className={`color-swatch w-6 h-6 rounded border border-dashed border-gray-300 flex items-center justify-center ${stroke === 'transparent' ? 'border-blue-500 bg-gray-100' : 'bg-transparent'}`} title="Transparent"><X size={12} color="#999" /></button>
                  <div className="relative">
                    <input type="color" value={stroke === 'transparent' ? '#ffffff' : stroke} onChange={e => setStroke(e.target.value)} aria-label="Choose custom stroke color" className="color-picker-input w-6 h-6 opacity-0 absolute inset-0 cursor-pointer" />
                    <button type="button" tabIndex={-1} aria-hidden="true" className="w-6 h-6 rounded border border-gray-300 flex items-center justify-center bg-transparent"><Palette size={12} color="#999" /></button>
                  </div>
                </div>
                <div className="flex justify-between mb-2 mt-4">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Stroke Width</span>
                  <span className="text-[11px] text-gray-400">{sw}px</span>
                </div>
                <input type="range" min={0} max={50} value={sw} aria-label="Stroke width" onChange={e => setSw(+e.target.value)} className="w-full h-1.5 accent-blue-500" />
              </section>

              <hr className="border-gray-100" />

              {/* Sticky */}
              <section>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Sticky Color</span>
                  <span className="text-[10px] font-mono text-gray-400">{stickyBg}</span>
                </div>
                <div className="flex gap-1 flex-wrap mb-2">
                  {STICKY_COLORS.map(c => (
                    <button key={c} type="button" onClick={() => setStickyBg(c)} aria-label={`Sticky color ${c}`} aria-pressed={stickyBg === c}
                      className={['sticky-swatch w-6 h-6 rounded border flex items-center justify-center transition-all', stickyBg === c ? 'border-blue-500 scale-110' : 'border-transparent'].join(' ')}
                      style={{ background: c }}>
                      {stickyBg === c && <Check size={10} color="#000" />}
                    </button>
                  ))}
                </div>
              </section>
            </div>
          </div>
        </>
      )}

      <BoardStatusBanner />
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onImageFile} />
    </div>
  );
}
