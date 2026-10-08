import * as React from 'react';
import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  MousePointer2, PenLine, Eraser, StickyNote, Type, Sparkles,
  ImageIcon, Undo2, Redo2, ZoomIn, ZoomOut, Maximize2,
  Share2, Play, Timer, Video, MessageSquare, MoreHorizontal,
  Copy, Trash2, Palette, X, ChevronDown, Check, Search,
  Code, Calculator
} from 'lucide-react';
import { CanvasEngine, getConnectorRoute, isFixedShapeLabel } from './engine/CanvasEngine';
import type { ToolType, StickyShape, AnyShape } from './engine/CanvasEngine';
import { listShapePickerDefinitions, getShapeDefinition, getShapeDefinitionForLegacyType, getShapePickerLabel } from './engine/shapes/registry';
import { geometryCommandsToSvg, shapePreviewGeometry } from './engine/shapes/geometry';
import { buildConnectorPreviewGeometry } from './engine/shapes/connectors';
import { SHAPE_CATEGORIES } from './engine/shapes/types';
import type { Cardinality, EndpointMarker, ShapeCategory, ShapeDefinition, ShapeParameterMetadata, ShapeParameterValue, StrokeStyle } from './engine/shapes/types';
import { searchShapeDefinitions } from './engine/shapes/search';
import { solid3DLocalAxisSpans, solid3DLocalDimensions, solid3DScaleFromBounds, solid3DSizeSemantics, type Solid3DGeometry, type Solid3DScale } from './engine/shapes/solid3d';
import { getCanvasShortcutAction } from './engine/keyboardShortcuts';
import {
  continueWithoutLocalRecovery, getBoardRuntimeStatus, initializeBoardStore, yShapes,
} from './store/useBoardStore';
import BoardStatusBanner from './store/BoardStatusBanner';
import FormulaEditor from './formula/FormulaEditor';
import FormulaEditorBoundary from './formula/FormulaEditorBoundary';
import { DEFAULT_CODE_LANGUAGE, normalizeCodeLanguage, type CodeLanguage } from './code/languages';
import { HIGH_CONTRAST_CURSORS, visibleCursor } from './cursors';
import type { LucideIcon } from 'lucide-react';

const CodeEditor = React.lazy(() => import('./code/CodeEditor'));

// ─── Palettes ─────────────────────────────────────────────────────────────────
const PALETTE = ['#000000', '#f9a8d4', '#ef4444', '#f97316', '#22c55e', '#3b82f6', '#a855f7'];
const STICKY_COLORS = ['#fde047', '#fca5a5', '#fdba74', '#86efac', '#93c5fd', '#d8b4fe'];

type PositionedShape = Extract<AnyShape, { x: number; y: number; w: number; h: number }>;

function isPositionedShape(shape: AnyShape): shape is PositionedShape {
  return 'x' in shape && 'y' in shape && 'w' in shape && 'h' in shape;
}

function shapeRotation(shape: AnyShape): number {
  return 'rotation' in shape && typeof shape.rotation === 'number' ? shape.rotation : 0;
}

function shapeFontSize(shape: AnyShape): number {
  return 'fs' in shape && typeof shape.fs === 'number' ? shape.fs : 14;
}

function shapeTextColor(shape: AnyShape): string {
  return 'textColor' in shape && typeof shape.textColor === 'string' ? shape.textColor : '#1f2937';
}

function measureCanvasText(text: string, font: string, isCode = false, currentZoom = 1): { w: number; h: number } {
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
  try {
    let rect = mirror.getBoundingClientRect();
    let w = Math.max(20, rect.width) + 12;
    const maxWidth = (isCode ? 600 - 62 : 600 - 40) * currentZoom;
    if (w > maxWidth) {
      mirror.style.whiteSpace = 'pre-wrap';
      mirror.style.width = `${maxWidth}px`;
      rect = mirror.getBoundingClientRect();
      w = maxWidth;
    }
    return { w, h: Math.max(20, rect.height) };
  } finally {
    mirror.remove();
  }
}

const HUD_UTILITY_TOOLS: ReadonlyArray<{ label: string; Icon: LucideIcon }> = [
  { label: 'Timer', Icon: Timer },
  { label: 'Video', Icon: Video },
  { label: 'Comments', Icon: MessageSquare },
  { label: 'More', Icon: MoreHorizontal },
];

const SELECT_TOOLS: { id: ToolType; Icon: LucideIcon; label: string }[] = [
  { id: 'select', Icon: MousePointer2, label: 'Select' },
  { id: 'lasso-select', Icon: MousePointer2, label: 'Lasso Select' }, // Reuse icon for now
];

const TEXT_TOOLS: { id: ToolType; Icon: LucideIcon; label: string }[] = [
  { id: 'text', Icon: Type, label: 'Text' },
  { id: 'math', Icon: Calculator, label: 'Math LaTeX' },
  { id: 'code', Icon: Code, label: 'Code Block' },
];

const SHAPE_TOOLS = listShapePickerDefinitions().map(definition => ({
  id: definition.toolId as ToolType,
  label: definition.label,
  definition,
}));

function ConnectorPreview({ definition }: { definition: ShapeDefinition }) {
  const preview = buildConnectorPreviewGeometry(definition, 30, 24);
  const line = geometryCommandsToSvg(preview.route);
  const dash = preview.lineStyle === 'dashed' ? '3 2' : preview.lineStyle === 'dotted' ? '1 2' : undefined;
  return <svg width="26" height="22" viewBox={`0 0 ${preview.width} ${preview.height}`} fill="none" aria-hidden="true">
    <path d={line} stroke="currentColor" strokeWidth="1.8" fill="none" strokeDasharray={dash} strokeLinecap="round" strokeLinejoin="round" />
    {preview.markers.map((marker, index) => <path key={index} d={geometryCommandsToSvg(marker.commands)}
      fill={marker.fill === 'surface' ? 'var(--aw-paper, #fff)' : marker.fill} stroke="currentColor"
      strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />)}
    {definition.defaultLabel && <text x="15" y="4" textAnchor="middle" fill="currentColor" fontSize="3.2" fontWeight="700">{definition.defaultLabel}</text>}
  </svg>;
}

function ShapePreview({ definition, size = 24 }: { definition: ShapeDefinition; size?: number }) {
  if (definition.kind === 'connector') return <ConnectorPreview definition={definition} />;
  const geometry = shapePreviewGeometry(definition, 28, 22);
  const outline = geometryCommandsToSvg(geometry.outline);
  const decorations = geometry.decorations.map(geometryCommandsToSvg);
  const intrinsicFills = geometry.intrinsicFills.map(geometryCommandsToSvg);
  const hiddenEdges = geometry.hiddenEdges.map(geometryCommandsToSvg);
  const defaultDash = definition.defaultParams?.lineStyle === 'dashed' ? '2 1.6' : definition.defaultParams?.lineStyle === 'dotted' ? '1 1.7' : undefined;
  return <svg width={size} height={size} viewBox="-1 -1 30 24" fill="none" aria-hidden="true">
    {!definition.solid3d && <path d={outline} fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" strokeLinecap="round" strokeDasharray={defaultDash} />}
    {intrinsicFills.map((path, index) => <path key={`intrinsic-${index}`} d={path} fill="currentColor" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />)}
    {decorations.map((path, index) => {
      const style = geometry.decorationStyles[index];
      const dash = style === 'dashed' ? '2 1.6' : style === 'dotted' ? '1 1.7' : style === 'solid' ? undefined : defaultDash;
      return <path key={`visible-${index}`} d={path} fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" strokeLinecap="round" strokeDasharray={dash} />;
    })}
    {hiddenEdges.map((path, index) => <path key={`hidden-${index}`} d={path} fill="none" stroke="currentColor" strokeWidth="1.25" strokeDasharray="3.1 2" strokeLinecap="round" opacity=".96" />)}
    {definition.previewGlyph && <text x="14" y="12" textAnchor="middle" dominantBaseline="central" fill="currentColor" fontSize="4.2" fontWeight="750">{definition.previewGlyph}</text>}
  </svg>;
}

function ShapeParameterField({ parameter, value, onUpdate }: {
  parameter: ShapeParameterMetadata;
  value: ShapeParameterValue;
  onUpdate: (key: string, value: ShapeParameterValue, commit: boolean) => void;
}) {
  const control = parameter.control;
  if (!control) return null;
  const current = value ?? parameter.defaultValue;
  const update = (nextValue: ShapeParameterValue, commit: boolean) => onUpdate(parameter.key, nextValue, commit);
  if (control.type === 'range') {
    const numeric = typeof current === 'number' ? current : Number(current);
    const rangeValue = Number.isFinite(numeric) ? numeric : Number(parameter.defaultValue);
    const shown = control.precision === 0 ? String(Math.round(rangeValue)) : rangeValue.toFixed(control.precision ?? 2);
    return <label className="shape-property-field shape-property-range-field" title={parameter.description}>
      <span>{parameter.label} · {shown}{control.unit ?? ''}</span>
      <input type="range" min={control.min} max={control.max} step={control.step} value={rangeValue}
        aria-label={parameter.label} data-param-key={parameter.key}
        onChange={event => update(Number(event.target.value), false)}
        onPointerUp={event => update(Number(event.currentTarget.value), true)}
        onBlur={event => update(Number(event.currentTarget.value), true)} />
    </label>;
  }
  if (control.type === 'select') {
    const selected = control.options.find(option => String(option.value) === String(current))?.value ?? current;
    return <label className="shape-property-field" title={parameter.description}>
      <span>{parameter.label}</span>
      <select aria-label={parameter.label} data-param-key={parameter.key} value={String(selected)}
        onChange={event => {
          const option = control.options.find(candidate => String(candidate.value) === event.target.value);
          if (option) update(option.value, true);
        }}>
        {control.options.map(option => <option key={String(option.value)} value={String(option.value)}>{option.label}</option>)}
      </select>
    </label>;
  }
  if (control.type === 'checkbox') return <label className="shape-property-check" title={parameter.description}>
    <input type="checkbox" aria-label={parameter.label} data-param-key={parameter.key} checked={Boolean(current)}
      onChange={event => update(event.target.checked, true)} />{parameter.label}
  </label>;
  return <label className="shape-property-field" title={parameter.description}>
      <span>{parameter.label}</span>
      <input type="text" aria-label={parameter.label} data-param-key={parameter.key} value={String(current)}
        maxLength={control.maxLength} placeholder={control.placeholder}
        onChange={event => update(event.target.value, false)} onBlur={event => update(event.currentTarget.value, true)} />
  </label>;
}

function SolidDimensionFields({ shapeId, geometry, params, scale, onUpdate }: {
  shapeId: string;
  geometry: Solid3DGeometry;
  params: Readonly<Record<string, unknown>>;
  scale: Solid3DScale;
  onUpdate: (axis: keyof Solid3DScale, value: number, commit: boolean) => void;
}) {
  const [draftState, setDraftState] = useState<{ shapeId: string; values: Partial<Record<keyof Solid3DScale, string>> }>({
    shapeId, values: {},
  });
  const drafts = draftState.shapeId === shapeId ? draftState.values : {};
  const semantics = solid3DSizeSemantics(geometry);
  const spans = solid3DLocalAxisSpans(geometry, params);
  const dimensions = solid3DLocalDimensions(geometry, params, scale);
  const isotropic = semantics === 'isotropic';
  const circular = semantics === 'radial-xy';
  const regularBase = semantics === 'regular-base-xy';
  const cuboid = geometry === 'cuboid3d';
  const prism = ['triangularPrism3d', 'quadrilateralPrism3d', 'squarePrism3d',
    'pentagonalPrism3d', 'hexagonalPrism3d'].includes(geometry);
  const triangularPrism = geometry === 'triangularPrism3d';
  const factorField = isotropic && geometry !== 'cube3d' && geometry !== 'sphere3d';
  const fields: Array<{ axis: keyof Solid3DScale; label: string }> = isotropic
    ? [{ axis: 'x', label: geometry === 'cube3d' ? 'Equal edge length' : geometry === 'sphere3d' ? 'Diameter · X/Y/Z' : 'Uniform model scale' }]
    : circular
      ? [{ axis: 'x', label: 'Diameter · X/Y' }, { axis: 'z', label: 'Axial dimension · Z' }]
      : regularBase
        ? [{ axis: 'x', label: prism ? 'Base scale · X/Y' : 'Base span · X/Y' },
          { axis: 'z', label: prism ? 'Prism length · Z' : 'Height · Z' }]
        : triangularPrism
          ? [{ axis: 'x', label: 'Base width · X' }, { axis: 'y', label: 'Base height · Y' },
            { axis: 'z', label: 'Prism length · Z' }]
          : prism
            ? [{ axis: 'x', label: 'Base width · X' }, { axis: 'y', label: 'Base depth · Y' },
              { axis: 'z', label: 'Prism length · Z' }]
            : [{ axis: 'x', label: cuboid ? 'Width · X' : 'Local dimension · X' },
              { axis: 'y', label: cuboid ? 'Depth · Y' : 'Local dimension · Y' },
              { axis: 'z', label: cuboid ? 'Height · Z' : 'Local dimension · Z' }];
  const valueFor = (axis: keyof Solid3DScale) => factorField ? scale[axis] : dimensions[axis];
  const spanFor = (axis: keyof Solid3DScale) => spans[axis === 'x' ? 0 : axis === 'y' ? 1 : 2];
  const heading = cuboid ? 'Independent local dimensions' : isotropic ? 'Isotropic dimension policy'
    : circular ? 'Radial XY with axial Z' : triangularPrism ? 'Triangular prism dimensions'
      : regularBase ? prism ? 'Regular base XY + length Z' : 'Regular base XY with height Z'
        : prism ? 'Independent prism dimensions' : 'Independent local dimensions';
  const explanation = cuboid
    ? 'X is width, Y is depth, and Z is height. Each local dimension can change independently; the projected selection frame follows the 3D model.'
    : geometry === 'cube3d' ? 'Cube edits preserve one equal edge on all three local axes.'
      : geometry === 'sphere3d' ? 'Sphere edits preserve equal X/Y/Z diameters; resize never turns it into an ellipsoid.'
        : geometry === 'tetrahedron3d' || geometry === 'octahedron3d'
          ? 'One uniform scale preserves the regular solid. Its internal depth is fixed to the mathematical default.'
          : circular ? 'The revolved radius is shared by X and Y; Z changes only the axial height.'
            : triangularPrism ? 'X is triangular-base width, Y is base height, and Z is prism length; the congruent XY bases are separated along Z.'
              : regularBase ? prism ? 'The regular polygon base keeps a shared X/Y scale; Z changes prism length.'
                : 'The regular base remains coherent across X/Y; Z changes the pyramid height.'
                : prism ? 'X and Y map to the irregular base dimensions, and Z is the actual prism extrusion.'
                  : 'Dimensions follow the actual local mesh axes. Projected screen bounds are derived, not used as the size solver.';
  return <section className="shape-property-section" data-solid-dimensions data-solid-geometry={geometry}>
    <h4>{heading}</h4>
    <p>{explanation}</p>
    <div className="shape-property-grid-two">
      {fields.map(({ axis, label }) => {
        const value = valueFor(axis);
        const factor = factorField ? 1 : spanFor(axis);
        const min = factorField ? 0.01 : Math.max(0.001, factor * 0.01);
        const max = factorField ? 64 : Math.max(min, factor * 64);
        const formatted = value.toFixed(2);
        return <label className="shape-property-field" key={axis}>
          <span>{label}{factorField ? ` · ${scale[axis].toFixed(2)}×` : ` · ${formatted} units`}</span>
          <input type="number" min={min} max={max} step="0.01" value={drafts[axis] ?? formatted}
            aria-label={`${label} ${factorField ? 'scale' : 'dimension'}`} data-solid-scale-key={axis}
            data-solid-dimension-key={axis}
            onChange={event => {
              const raw = event.target.value;
              setDraftState(previous => ({ shapeId, values: { ...(previous.shapeId === shapeId ? previous.values : {}), [axis]: raw } }));
              if (raw.trim() && Number.isFinite(Number(raw))) onUpdate(axis, Number(raw), false);
            }}
            onBlur={event => {
              const raw = drafts[axis] ?? event.currentTarget.value;
              if (raw.trim() && Number.isFinite(Number(raw))) onUpdate(axis, Number(raw), true);
              setDraftState(previous => ({ shapeId, values: { ...(previous.shapeId === shapeId ? previous.values : {}), [axis]: undefined } }));
            }}
            onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
        </label>;
      })}
    </div>
  </section>;
}

type PopoverGroup = 'pen' | 'shapes' | 'text' | 'select';

// Math symbols và auto-replace đã được chuyển sang formula/parser.ts
// MATH_SYMBOLS và AUTO_REPLACE không còn cần ở đây

function PopoverItem({ active, onClick, Icon, preview, label, grid, shapeId, solid3d }: { active: boolean; onClick: (e: React.MouseEvent) => void; Icon?: LucideIcon; preview?: React.ReactNode; label: string; grid?: boolean; shapeId?: string; solid3d?: boolean }) {
  return (
    <button type="button" onClick={onClick} title={label} aria-label={label} aria-pressed={active}
      {...(shapeId ? { 'data-shape-id': shapeId } : {})}
      {...(solid3d ? { 'data-solid3d': 'true' } : {})}
      className={`popover-item${grid ? ' popover-shape-item' : ''}`}>
      <span className="popover-item-icon">{preview ?? (Icon ? <Icon size={grid ? 16 : 15} /> : null)}</span>
      <span className="popover-item-label">{label}</span>
      {active && !grid && <Check size={15} className="popover-item-check" aria-hidden="true" />}
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
  const [selectedShape, setSelectedShape] = useState<AnyShape | null>(null);
  const [shapePropertiesOpen, setShapePropertiesOpen] = useState(false);
  const shapePropertiesPanelRef = useRef<HTMLElement>(null);
  const shapePropertiesTriggerRef = useRef<HTMLButtonElement>(null);

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
  const [canvasMetrics, setCanvasMetrics] = useState({ w: 0, h: 0, left: 0, top: 0 });
  const textFocusShapeIdRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    const measureCanvas = () => {
      const wrap = wrapRef.current;
      const canvas = canvasRef.current;
      if (!wrap || !canvas) return;
      const rect = canvas.getBoundingClientRect();
      const next = { w: wrap.clientWidth, h: wrap.clientHeight, left: rect.left, top: rect.top };
      setCanvasMetrics(previous => previous.w === next.w && previous.h === next.h
        && previous.left === next.left && previous.top === next.top ? previous : next);
    };
    measureCanvas();
    const wrap = wrapRef.current;
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measureCanvas) : null;
    if (wrap) observer?.observe(wrap);
    window.addEventListener('resize', measureCanvas, { passive: true });
    window.addEventListener('scroll', measureCanvas, true);
    window.visualViewport?.addEventListener('resize', measureCanvas);
    window.visualViewport?.addEventListener('scroll', measureCanvas);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measureCanvas);
      window.removeEventListener('scroll', measureCanvas, true);
      window.visualViewport?.removeEventListener('resize', measureCanvas);
      window.visualViewport?.removeEventListener('scroll', measureCanvas);
    };
  }, []);

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
  const engineStyleRef = useRef({ penColor, penSize, fill, stroke, sw, stickyBg, fontSize });
  useLayoutEffect(() => {
    engineStyleRef.current = { penColor, penSize, fill, stroke, sw, stickyBg, fontSize };
  }, [penColor, penSize, fill, stroke, sw, stickyBg, fontSize]);

  const [openGroup, setOpenGroup] = useState<PopoverGroup | null>(null);
  const [penMode, setPenMode] = useState<'normal' | 'smart'>('normal');
  const popoverAnchorRefs = useRef<Record<PopoverGroup, HTMLDivElement | null>>({ pen: null, shapes: null, text: null, select: null });
  const popoverPanelRef = useRef<HTMLDivElement>(null);
  const [popoverPosition, setPopoverPosition] = useState<{ left: number; top: number } | null>(null);
  const [lastTextTool, setLastTextTool] = useState<ToolType>('text');
  const [lastShapeTool, setLastShapeTool] = useState<ToolType>('rect');
  const [shapeCategory, setShapeCategory] = useState<ShapeCategory>('Basic');
  const [shapeSearch, setShapeSearch] = useState('');
  const [lastSelectTool, setLastSelectTool] = useState<ToolType>('select');

  const setTool = useCallback((t: ToolType, keepOpen: boolean = false) => {
    setToolSt(t);
    // When manually selecting a tool, close any other open groups
    if (!keepOpen) setOpenGroup(null);
    engRef.current?.setTool(t);
    if (['text', 'math', 'code'].includes(t)) setLastTextTool(t);
    if (SHAPE_TOOLS.some(s => s.id === t)) setLastShapeTool(t);
    if (['select', 'lasso-select'].includes(t)) setLastSelectTool(t);
  }, []);

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

  const closeShapeProperties = useCallback((restoreFocus = false) => {
    setShapePropertiesOpen(false);
    if (restoreFocus) window.requestAnimationFrame(() => shapePropertiesTriggerRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!shapePropertiesOpen) return;
    const frame = window.requestAnimationFrame(() => shapePropertiesPanelRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [shapePropertiesOpen]);

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

  useEffect(() => {
    const rootStyle = document.documentElement.style;
    const viewport = window.visualViewport;
    const updateVisualViewport = () => {
      const left = viewport?.offsetLeft ?? 0;
      const top = viewport?.offsetTop ?? 0;
      const width = Math.max(1, viewport?.width ?? window.innerWidth);
      const height = Math.max(1, viewport?.height ?? window.innerHeight);
      const railWidth = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--aw-tool-rail-width')) || 0;
      rootStyle.setProperty('--aw-visual-viewport-left', `${left}px`);
      rootStyle.setProperty('--aw-visual-viewport-top', `${top}px`);
      rootStyle.setProperty('--aw-visual-viewport-right', `${left + width}px`);
      rootStyle.setProperty('--aw-visual-viewport-bottom', `${top + height}px`);
      rootStyle.setProperty('--aw-visual-viewport-width', `${width}px`);
      rootStyle.setProperty('--aw-visual-viewport-height', `${height}px`);
      rootStyle.setProperty('--aw-visual-viewport-content-center-x', `${left + railWidth + (width - railWidth) / 2}px`);
    };
    updateVisualViewport();
    window.addEventListener('resize', updateVisualViewport, { passive: true });
    viewport?.addEventListener('resize', updateVisualViewport, { passive: true });
    viewport?.addEventListener('scroll', updateVisualViewport, { passive: true });
    return () => {
      window.removeEventListener('resize', updateVisualViewport);
      viewport?.removeEventListener('resize', updateVisualViewport);
      viewport?.removeEventListener('scroll', updateVisualViewport);
      for (const variable of ['left', 'top', 'right', 'bottom', 'width', 'height', 'content-center-x'])
        rootStyle.removeProperty(`--aw-visual-viewport-${variable}`);
    };
  }, []);

  useLayoutEffect(() => {
    if (!openGroup) return;
    const anchor = popoverAnchorRefs.current[openGroup];
    const panel = popoverPanelRef.current;
    if (!anchor || !panel) return;

    const placePopover = () => {
      const anchorRect = anchor.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const margin = 8;
      const viewport = window.visualViewport;
      const viewportLeft = viewport?.offsetLeft ?? 0;
      const viewportTop = viewport?.offsetTop ?? 0;
      const viewportWidth = viewport?.width ?? Math.min(window.innerWidth, document.documentElement.clientWidth || window.innerWidth);
      const viewportHeight = viewport?.height ?? Math.min(window.innerHeight, document.documentElement.clientHeight || window.innerHeight);
      const minLeft = viewportLeft + margin;
      const maxLeft = Math.max(minLeft, viewportLeft + viewportWidth - panelRect.width - margin);
      let left = anchorRect.right + 8;
      if (left > maxLeft) left = anchorRect.left - panelRect.width - 8;
      left = Math.max(minLeft, Math.min(left, maxLeft));
      const minTop = viewportTop + margin;
      const maxTop = Math.max(minTop, viewportTop + viewportHeight - panelRect.height - margin);
      const top = Math.max(minTop, Math.min(anchorRect.top, maxTop));
      setPopoverPosition({ left, top });
    };

    placePopover();
    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(placePopover) : null;
    resizeObserver?.observe(panel);
    window.addEventListener('resize', placePopover);
    window.addEventListener('scroll', placePopover, true);
    window.visualViewport?.addEventListener('resize', placePopover);
    window.visualViewport?.addEventListener('scroll', placePopover);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', placePopover);
      window.removeEventListener('scroll', placePopover, true);
      window.visualViewport?.removeEventListener('resize', placePopover);
      window.visualViewport?.removeEventListener('scroll', placePopover);
    };
  }, [openGroup, shapeCategory, shapeSearch]);

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
    let active = true;
    void initializeBoardStore().then(() => {
      if (!active) return;
      setBoardRestoreError(null);
      setBoardReady(true);
    }).catch(error => {
      if (!active) return;
      const status = getBoardRuntimeStatus();
      setBoardRestoreError(status.message || (error instanceof Error ? error.message : String(error)));
    });
    return () => { active = false; };
  }, []);

  // ── init engine only after local content has been restored ─────────────
  useEffect(() => {
    const cv = canvasRef.current, wrap = wrapRef.current;
    if (!boardReady || !cv || !wrap || engRef.current) return;

    // set canvas physical pixels = container size
    cv.width = wrap.clientWidth;
    cv.height = wrap.clientHeight;

    const eng = new CanvasEngine(cv, yShapes);
    // The style-sync effect may already have run while board restoration was pending.
    // Apply the current UI values at construction so new shapes use Antiwhite defaults.
    eng.style = { ...engineStyleRef.current };
    engRef.current = eng;

    eng.onSel = ids => {
      setSelIds(ids);
      setSelectedShape(ids.length === 1 ? eng.getShape(ids[0]) : null);
      if (ids.length !== 1) setShapePropertiesOpen(false);
    };
    eng.onCursor = setCursor;
    eng.onCameraChange = (c) => { setCam(c); setZoom(c.zoom); };
    eng.onZoom = (z) => { setZoom(z); setCam(prev => ({ ...prev, zoom: z })); };
    eng.onTool = t => setToolSt(t);

    eng.onCam = cam => {
      const editingShape = editShapeRef.current;
      if (!editingShape || !isPositionedShape(editingShape)) return;
      const sp = eng.worldToClient(editingShape.x, editingShape.y);
      setEditBox(prev => ({
        ...prev, l: sp.x, t: sp.y,
        w: editingShape.w * cam.zoom, h: editingShape.h * cam.zoom,
      }));
    };

    eng.onShapeUpdate = shape => {
      if (eng.sel.has(shape.id)) setSelectedShape(shape);
      if (editShapeRef.current?.id !== shape.id) return;
      if ('text' in shape && typeof shape.text === 'string') {
        const updatedText = shape.text;
        editTextRef.current = updatedText;
        if (shape.type !== 'math') setEditText(current => current === updatedText ? current : updatedText);
      }
      if (shape.type === 'code') setEditLanguage(normalizeCodeLanguage(shape.language));
      if (isPositionedShape(shape)) {
        const sp = eng.worldToClient(shape.x, shape.y);
        setEditBox({ l: sp.x, t: sp.y, w: shape.w * eng.cam.zoom, h: shape.h * eng.cam.zoom });
      }
      internalSetEditShape(shape);
    };

    eng.onEditText = (shape: AnyShape, cx: number, cy: number) => {
      if (!isPositionedShape(shape)) return;
      eng.setEditingId(shape.id);
      const sp = eng.worldToClient(shape.x, shape.y);
      const text = 'text' in shape && typeof shape.text === 'string' ? shape.text : '';

      // Precision positioning handled by FormulaEditor's world-coordinate internal logic.
      // We pass the raw sp coordinates here as the anchor.
      setEditBox({
        l: sp.x, t: sp.y,
        w: shape.w * eng.cam.zoom,
        h: shape.h * eng.cam.zoom,
      });
      setEditClick({ x: cx, y: cy });
      internalSetEditShape(shape);
      editTextRef.current = text;
      setEditText(text);
      setEditLanguage(normalizeCodeLanguage(shape.type === 'code' ? shape.language : undefined));
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
    const onCancel = (e: PointerEvent) => eng.cancelPointer(e);
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
    eng.style = { ...engineStyleRef.current };
  }, [penColor, penSize, fill, stroke, sw, stickyBg, fontSize]);

  useEffect(() => { engRef.current?.setPenMode(penMode); }, [penMode]);

  // document title
  useEffect(() => { document.title = `${boardName} - Antiwhite`; }, [boardName]);

  // re-position edit overlay when zoom changes
  useEffect(() => {
    if (!editShape || !isPositionedShape(editShape) || !engRef.current) return;
    const eng = engRef.current;
    const sp = eng.worldToClient(editShape.x, editShape.y);
    const sw = editShape.w * eng.cam.zoom;
    const sh = editShape.h * eng.cam.zoom;
    setEditBox({ l: sp.x, t: sp.y, w: sw, h: sh });
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
    } else if (committedText.trim() === '' && !isFixedShapeLabel(editShape)) {
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

  const editShapeFontSize = editShape && 'fs' in editShape ? editShape.fs ?? 14 : 14;
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

  const shapeSearchNeedle = shapeSearch.trim();
  const visibleShapeTools = (shapeSearchNeedle
    ? searchShapeDefinitions(shapeSearchNeedle).map(definition => ({
      id: definition.toolId as ToolType, label: getShapePickerLabel(definition, definition.category), definition,
    }))
    : SHAPE_TOOLS.filter(({ definition }) => definition.category === shapeCategory || definition.pickerCategories?.includes(shapeCategory)))
    .map(item => ({ ...item, label: getShapePickerLabel(item.definition, shapeSearchNeedle ? item.definition.category : shapeCategory) }));
  const selectedDiagram = selectedShape?.type === 'diagram' ? selectedShape : null;
  const selectedConnector = selectedShape?.type === 'connector' ? selectedShape : null;
  const selectedLegacyDefinition = selectedShape && selectedShape.type !== 'diagram' && selectedShape.type !== 'connector'
    && 'x' in selectedShape && 'y' in selectedShape && 'w' in selectedShape && 'h' in selectedShape
    ? getShapeDefinitionForLegacyType(selectedShape.type) : undefined;
  const selectedPropertyShape = selectedDiagram ?? (selectedLegacyDefinition ? selectedShape : null);
  const selectedDefinition = selectedDiagram ? getShapeDefinition(selectedDiagram.shapeId) : selectedLegacyDefinition;
  const selectedSolidScale = selectedDiagram && selectedDefinition?.solid3d
    ? selectedDiagram.scale3d ?? selectedDefinition.defaultScale3d ?? solid3DScaleFromBounds(selectedDiagram.w, selectedDiagram.h, selectedDefinition.width,
      selectedDefinition.height, selectedDefinition.geometry as import('./engine/shapes/solid3d').Solid3DGeometry)
    : null;
  const selectedPropertyParams = selectedPropertyShape && 'params' in selectedPropertyShape ? selectedPropertyShape.params ?? {} : {};
  const selectedPropertyText = selectedPropertyShape && 'text' in selectedPropertyShape ? selectedPropertyShape.text ?? '' : '';
  const classifierModel = selectedDiagram?.data?.classifier as { compartments?: Array<{ id?: string; label?: string; items?: string[] }> } | undefined;
  const classifierCompartments = Array.isArray(classifierModel?.compartments) ? classifierModel.compartments : [];
  const tableModel = selectedDiagram?.data?.table as { columns?: Array<{ id?: string; name?: string; type?: string; key?: string }> } | undefined;
  const tableColumns = Array.isArray(tableModel?.columns) ? tableModel.columns : [];
  const columnModel = selectedDiagram?.data?.column as { name?: string; type?: string; key?: string } | undefined;
  const updateClassifierData = (compartments: Array<{ id?: string; label?: string; items?: string[] }>, commit = false) => {
    if (selectedDiagram && classifierModel) engRef.current?.updateDiagramData(selectedDiagram.id, { classifier: { ...classifierModel, compartments } }, commit);
  };
  const updateTableData = (columns: Array<{ id?: string; name?: string; type?: string; key?: string }>, commit = false) => {
    if (selectedDiagram) engRef.current?.updateDiagramData(selectedDiagram.id, { table: { ...(tableModel ?? {}), columns } }, commit);
  };
  const updateColumnData = (column: { name?: string; type?: string; key?: string }, commit = false) => {
    if (selectedDiagram) engRef.current?.updateDiagramData(selectedDiagram.id, { column }, commit);
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
          } else if (!(e.target instanceof HTMLInputElement && ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key))) {
            handlePopoverNavigation(e);
          }
        }} className={`tool-rail${openGroup === 'shapes' ? ' tool-rail-shapes-open' : ''}`}>
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
                  const entry = SHAPE_TOOLS.find(s => s.id === active) ?? SHAPE_TOOLS[0];
                  return <ShapePreview definition={entry.definition} size={21} />;
                })()}
              </SideBtn>
              {openGroup === 'shapes' && (
                <div ref={popoverPanelRef} className="tool-popover tool-popover-shapes" role="group" aria-label="Shape tools"
                  onKeyDown={e => {
                    if (e.target instanceof HTMLInputElement && ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
                    handlePopoverNavigation(e);
                  }}
                  style={{ left: popoverPosition?.left ?? -9999, top: popoverPosition?.top ?? -9999 }}>
                  <label className="shape-library-search">
                    <Search size={14} aria-hidden="true" />
                    <input type="search" value={shapeSearch} aria-label="Search shapes" placeholder="Search shapes"
                      onChange={e => setShapeSearch(e.target.value)} />
                  </label>
                  <nav className="shape-library-categories" aria-label="Shape categories">
                    {SHAPE_CATEGORIES.map(category => (
                      <button key={category} type="button" className={`shape-category-button${!shapeSearchNeedle && shapeCategory === category ? ' active' : ''}`}
                        aria-pressed={!shapeSearchNeedle && shapeCategory === category}
                        onClick={() => { setShapeCategory(category); setShapeSearch(''); }} title={category}>
                        {category}
                      </button>
                    ))}
                  </nav>
                  <div className="tool-popover-heading shape-library-heading" aria-live="polite">
                    {shapeSearchNeedle ? `Search results (${visibleShapeTools.length})` : `${shapeCategory} (${visibleShapeTools.length})`}
                  </div>
                  {visibleShapeTools.length ? (
                    <div className="shape-option-grid">
                      {visibleShapeTools.map(({ id, label, definition }) => (
                        <PopoverItem key={id} active={SHAPE_TOOLS.some(s => s.id === tool) ? tool === id : lastShapeTool === id}
                          preview={<ShapePreview definition={definition} size={24} />} label={label}
                          shapeId={definition.id} grid={true} solid3d={Boolean(definition.solid3d)} onClick={() => choosePopoverTool(id)} />
                      ))}
                    </div>
                  ) : <div className="shape-library-empty">No matching shapes.</div>}
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
              style={{ position: 'fixed', zIndex: 530, left: editBox.l + editBox.w / 2, top: editBox.t + editBox.h / 2,
                width: editBox.w / zoom, height: editBox.h / zoom,
                transform: `translate(-50%, -50%) rotate(${shapeRotation(editShape)}deg) scale(${zoom})`, transformOrigin: 'center center' }}
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
                      if (!element || textFocusShapeIdRef.current === editShape.id) return;
                      textFocusShapeIdRef.current = editShape.id;
                      element.focus();
                      const fs = shapeFontSize(editShape);
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
                      if (editShape.type !== 'sticky' && !isFixedShapeLabel(editShape) && engine) {
                        const fs = shapeFontSize(editShape);
                        const measured = measureCanvasText(value, `${fs}px 'Inter','Segoe UI',sans-serif`, false, 1);
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
                      fontSize: shapeFontSize(editShape), padding: 16,
                      fontFamily: "'Inter','Segoe UI',sans-serif", color: isFixedShapeLabel(editShape) ? shapeTextColor(editShape) : editShape.type === 'text' ? '#000' : 'rgba(0,0,0,0.8)',
                      caretColor: '#3b82f6', lineHeight: 1.5, boxSizing: 'border-box', resize: 'none',
                      border: 'none', borderRadius: 0, display: 'block', whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word', overflowWrap: 'break-word', overflowX: 'hidden',
                      textAlign: isFixedShapeLabel(editShape) ? 'center' : 'left',
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
                initialPreviewText={editShape.previewText ?? editText}
                fontSize={formulaFontSize}
                zoom={cam.zoom}
                worldX={editShape.x}
                worldY={editShape.y}
                cam={cam}
                view={{ w: canvasMetrics.w, h: canvasMetrics.h }}
                onTextChange={handleFormulaSourceChange}
                onCommit={commitEdit}
                onResize={resizeFormula}
                onMove={moveFormula}
                clickX={editClick.x - canvasMetrics.left}
                clickY={editClick.y - canvasMetrics.top}
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
              {(selectedPropertyShape || selectedConnector) && <button ref={shapePropertiesTriggerRef} type="button"
                aria-pressed={shapePropertiesOpen} aria-expanded={shapePropertiesOpen} aria-controls="shape-properties-panel"
                onClick={() => setShapePropertiesOpen(open => !open)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] font-medium rounded-lg hover:bg-gray-50 text-gray-700 transition-colors">
                Properties
              </button>}
              <div className="w-px h-4 bg-gray-200" />
              <button onClick={() => engRef.current?.deleteSel()}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] font-medium rounded-lg hover:bg-red-50 text-red-600 transition-colors">
                <Trash2 size={12} /> Delete
              </button>
            </div>
          )}

          {shapePropertiesOpen && (selectedPropertyShape || selectedConnector) && typeof document !== 'undefined' && createPortal(
            <aside id="shape-properties-panel" ref={shapePropertiesPanelRef} className="shape-properties-panel no-canvas panel-ui"
              role="dialog" aria-label="Shape properties" aria-labelledby="shape-properties-title" tabIndex={-1}
              onKeyDown={event => {
                if (event.key !== 'Escape') return;
                event.preventDefault();
                event.stopPropagation();
                closeShapeProperties(true);
              }}
              onPointerDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}
              style={{ position: 'fixed', zIndex: 1800 }}>
              <div className="shape-properties-header">
                <div><strong id="shape-properties-title">{selectedDefinition?.label ?? 'Connector'} properties</strong><span>{selectedDefinition?.category ?? 'Arrows & Connectors'}</span></div>
                <button type="button" onClick={() => closeShapeProperties(true)} aria-label="Close shape properties"><X size={15} /></button>
              </div>
              <div className="shape-properties-body">
                {selectedPropertyShape && selectedDefinition && <>
                  <label className="shape-property-field"><span>Name / label</span>
                    <input value={selectedPropertyText} aria-label="Shape name or label"
                      onChange={event => engRef.current?.updateTextLive(selectedPropertyShape.id, event.target.value)}
                      onBlur={event => engRef.current?.updateText(selectedPropertyShape.id, event.target.value)} />
                  </label>

                  {(selectedDefinition.parameterMetadata ?? []).some(parameter => parameter.status === 'user-editable' && parameter.control)
                    && <section className="shape-property-section shape-parameter-section" data-shape-parameter-editor>
                      <h4>{selectedDefinition.solid3d ? '3D projection & parameters' : 'Shape parameters'}</h4>
                      {selectedDefinition.solid3d && <p>Use the X/Y/Z rotation fields to rotate the actual local 3D model. Orientation, local dimensions, and planar board rotation stay independent.</p>}
                      {(selectedDefinition.parameterMetadata ?? []).filter(parameter => parameter.status === 'user-editable' && parameter.control)
                        .map(parameter => <ShapeParameterField key={parameter.key} parameter={parameter}
                          value={(selectedPropertyParams[parameter.key] ?? parameter.defaultValue) as ShapeParameterValue}
                          onUpdate={(key, value, commit) => engRef.current?.updateShapeParameters(selectedPropertyShape.id, { [key]: value }, commit)} />)}
                    </section>}

                  {selectedDiagram && selectedDefinition.solid3d && selectedSolidScale && <SolidDimensionFields shapeId={selectedDiagram.id}
                    geometry={selectedDefinition.geometry as Solid3DGeometry}
                    params={selectedDiagram.params ?? selectedDefinition.defaultParams ?? {}} scale={selectedSolidScale}
                    onUpdate={(axis, value, commit) => {
                      const geometry = selectedDefinition.geometry as Solid3DGeometry;
                      const params = selectedDiagram.params ?? selectedDefinition.defaultParams ?? {};
                      const factorField = solid3DSizeSemantics(geometry) === 'isotropic'
                        && geometry !== 'cube3d' && geometry !== 'sphere3d';
                      const spans = solid3DLocalAxisSpans(geometry, params);
                      const axisIndex = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
                      const scaleValue = factorField ? value : value / Math.max(1e-6, spans[axisIndex]);
                      engRef.current?.updateShapeScale3d(selectedDiagram.id, { [axis]: scaleValue }, commit);
                    }} />}

                  {selectedDefinition.dataCapabilities?.includes('classifier') && classifierCompartments.length > 0 && <section className="shape-property-section">
                    <h4>Classifier compartments</h4>
                    {classifierCompartments.map((compartment, index) => <label className="shape-property-field" key={compartment.id ?? index}>
                      <span>{compartment.label ?? `Compartment ${index + 1}`} · one item per line</span>
                      <textarea value={(compartment.items ?? []).join('\n')} rows={3}
                        onChange={event => updateClassifierData(classifierCompartments.map((item, itemIndex) => itemIndex === index
                          ? { ...item, items: event.target.value.split('\n').slice(0, 20) } : item), false)}
                        onBlur={() => updateClassifierData(classifierCompartments, true)} />
                    </label>)}
                  </section>}

                  {selectedDefinition.dataCapabilities?.includes('column') && columnModel && <section className="shape-property-section">
                    <h4>Database column</h4>
                    <label className="shape-property-field"><span>Column name</span>
                      <input aria-label="Database column name" value={columnModel.name ?? ''}
                        onChange={event => updateColumnData({ ...columnModel, name: event.target.value }, false)}
                        onBlur={() => updateColumnData(columnModel, true)} />
                    </label>
                    <label className="shape-property-field"><span>Data type</span>
                      <input aria-label="Database column type" value={columnModel.type ?? ''}
                        onChange={event => updateColumnData({ ...columnModel, type: event.target.value }, false)}
                        onBlur={() => updateColumnData(columnModel, true)} />
                    </label>
                    <label className="shape-property-field"><span>Key type</span><select aria-label="Database column key type"
                      value={columnModel.key ?? 'none'} onChange={event => updateColumnData({ ...columnModel, key: event.target.value }, true)}>
                      <option value="none">No key</option><option value="primary">Primary key</option><option value="foreign">Foreign key</option>
                    </select></label>
                  </section>}

                  {selectedDefinition.dataCapabilities?.includes('table') && Array.isArray(tableModel?.columns) && <section className="shape-property-section">
                    <h4>Table columns</h4>
                    {tableColumns.map((column, index) => <div className="shape-property-column" key={column.id ?? index}>
                      <div className="shape-property-column-fields">
                        <input aria-label={`Column ${index + 1} name`} value={column.name ?? ''} placeholder="column name"
                          onChange={event => updateTableData(tableColumns.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item), false)}
                          onBlur={() => updateTableData(tableColumns, true)} />
                        <input aria-label={`Column ${index + 1} type`} value={column.type ?? ''} placeholder="type"
                          onChange={event => updateTableData(tableColumns.map((item, itemIndex) => itemIndex === index ? { ...item, type: event.target.value } : item), false)}
                          onBlur={() => updateTableData(tableColumns, true)} />
                        <select aria-label={`Column ${index + 1} key type`} value={column.key ?? 'none'}
                          onChange={event => updateTableData(tableColumns.map((item, itemIndex) => itemIndex === index ? { ...item, key: event.target.value } : item), true)}>
                          <option value="none">No key</option><option value="primary">Primary key</option><option value="foreign">Foreign key</option>
                        </select>
                      </div>
                      <button type="button" onClick={() => updateTableData(tableColumns.filter((_, itemIndex) => itemIndex !== index), true)}
                        aria-label={`Remove column ${index + 1}`} title="Remove column"><X size={13} /></button>
                    </div>)}
                    <button type="button" className="shape-property-add" onClick={() => updateTableData([...tableColumns, {
                      id: `column-${Date.now()}`, name: `column_${tableColumns.length + 1}`, type: 'text', key: 'none',
                    }], true)}>Add column</button>
                  </section>}

                </>}

                {selectedConnector && <>
                  <label className="shape-property-field"><span>Connector label</span><input value={selectedConnector.label ?? ''} placeholder="Relationship or flow label"
                    onChange={event => engRef.current?.updateConnectorProperties(selectedConnector.id, { label: event.target.value }, false)}
                    onBlur={event => engRef.current?.updateConnectorProperties(selectedConnector.id, { label: event.target.value }, true)} /></label>
                  <label className="shape-property-field"><span>Line style</span><select value={selectedConnector.lineStyle}
                    onChange={event => engRef.current?.updateConnectorProperties(selectedConnector.id, { lineStyle: event.target.value as StrokeStyle })}>
                    <option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option>
                  </select></label>
                  <div className="shape-property-grid-two">
                    <label className="shape-property-field"><span>Start marker</span><select value={selectedConnector.startMarker}
                      onChange={event => engRef.current?.updateConnectorProperties(selectedConnector.id, { startMarker: event.target.value as EndpointMarker })}>
                      <option value="none">None</option><option value="arrow">Arrow</option><option value="openArrow">Open arrow</option><option value="hollowTriangle">Hollow triangle</option>
                      <option value="diamond">Hollow diamond</option><option value="filledDiamond">Filled diamond</option><option value="circle">Circle</option><option value="bar">Bar</option><option value="crowFoot">Crow's foot</option>
                    </select></label>
                    <label className="shape-property-field"><span>End marker</span><select value={selectedConnector.endMarker}
                      onChange={event => engRef.current?.updateConnectorProperties(selectedConnector.id, { endMarker: event.target.value as EndpointMarker })}>
                      <option value="none">None</option><option value="arrow">Arrow</option><option value="openArrow">Open arrow</option><option value="hollowTriangle">Hollow triangle</option>
                      <option value="diamond">Hollow diamond</option><option value="filledDiamond">Filled diamond</option><option value="circle">Circle</option><option value="bar">Bar</option><option value="crowFoot">Crow's foot</option>
                    </select></label>
                  </div>
                  <div className="shape-property-grid-two">
                    <label className="shape-property-field"><span>Source cardinality</span><select value={selectedConnector.sourceCardinality ?? ''}
                      onChange={event => engRef.current?.updateConnectorProperties(selectedConnector.id, { sourceCardinality: (event.target.value || undefined) as Cardinality | undefined })}>
                      <option value="">Not set</option><option value="one">One</option><option value="zero-or-one">Zero or one</option><option value="many">Many</option><option value="one-or-many">One or many</option><option value="zero-or-many">Zero or many</option>
                    </select></label>
                    <label className="shape-property-field"><span>Target cardinality</span><select value={selectedConnector.targetCardinality ?? ''}
                      onChange={event => engRef.current?.updateConnectorProperties(selectedConnector.id, { targetCardinality: (event.target.value || undefined) as Cardinality | undefined })}>
                      <option value="">Not set</option><option value="one">One</option><option value="zero-or-one">Zero or one</option><option value="many">Many</option><option value="one-or-many">One or many</option><option value="zero-or-many">Zero or many</option>
                    </select></label>
                  </div>
                  <section className="shape-property-section">
                    <h4>Connector route</h4>
                    <p>{selectedConnector.waypoints.length} waypoint{selectedConnector.waypoints.length === 1 ? '' : 's'} · drag route handles to edit</p>
                    <button type="button" className="shape-property-add" onClick={() => {
                      const route = getConnectorRoute(selectedConnector), midpoint = route[Math.floor(route.length / 2)] ?? [selectedConnector.x1, selectedConnector.y1];
                      engRef.current?.addConnectorWaypoint(selectedConnector.id, midpoint[0], midpoint[1]);
                    }}>Add waypoint</button>
                    {selectedConnector.waypoints.map((_, index) => <button key={index} type="button" className="shape-property-remove-waypoint"
                      onClick={() => engRef.current?.removeConnectorWaypoint(selectedConnector.id, index)}>Remove waypoint {index + 1}</button>)}
                  </section>
                </>}
              </div>
            </aside>,
            document.body
          )}

          {/* Canvas HUD: responsive groups keep controls from overlapping the board edge. */}
          <div className="canvas-hud no-canvas">
            <div className="hud-utility-cluster">
              {HUD_UTILITY_TOOLS.map(({ label, Icon }) => (
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
