import * as React from 'react';
import { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import {
  MousePointer2, PenLine, Eraser, StickyNote, Type, Sparkles,
  ImageIcon, Undo2, Redo2, ZoomIn, ZoomOut, Maximize2,
  Share2, Play, Timer, Video, MessageSquare, MoreHorizontal,
  Copy, Trash2, Palette, X, ChevronDown, Check, Search,
  Code, Calculator, LassoSelect, Star, Clock, Database, Plus, ArrowUp, ArrowDown, Smile, Lock
} from 'lucide-react';
import { CanvasEngine, getConnectorRoute, isFixedShapeLabel } from './engine/CanvasEngine';
import type { ToolType, StickyShape, AnyShape } from './engine/CanvasEngine';
import { listShapePickerDefinitions, getShapeDefinition, getShapeDefinitionForLegacyType, getShapePickerLabel } from './engine/shapes/registry';
import { geometryCommandsToSvg, shapePreviewGeometry, UML_BOUNDARY_TITLE_HEIGHT } from './engine/shapes/geometry';
import { buildConnectorPreviewGeometry, connectorDisplayLabel } from './engine/shapes/connectors';
import { SHAPE_CATEGORIES } from './engine/shapes/types';
import type { Cardinality, DiagramShape, EndpointMarker, SequenceFragmentData, SequenceFragmentOperator, ShapeCategory, ShapeDefinition, ShapeParameterMetadata, ShapeParameterValue, StrokeStyle, TableColumnModel, UMLClassifierData, UMLClassifierMember, UMLDiagramFamily, UMLExtensionPoint, UMLInstanceData, UMLInstanceValue, UMLSubjectBoundaryData, UMLUseCaseData, UMLVisibility } from './engine/shapes/types';
import { generateTableDdl, type DdlDialect } from './engine/shapes/erdDdl';
import { diagramCapabilitiesFor, familyForDefinition, UML_FAMILY_LABELS, umlFamilyForCategory } from './engine/shapes/diagramContext';
import type { DiagramGraphDiagnostic } from './engine/shapes/diagramContext';
import { createClassifierMember, formatOperationParameters, parseOperationParameters } from './engine/shapes/classifier';
import { searchShapeDefinitions } from './engine/shapes/search';
import { solid3DLocalAxisSpans, solid3DLocalDimensions, solid3DScaleFromBounds, solid3DSizeSemantics, type Solid3DGeometry, type Solid3DScale } from './engine/shapes/solid3d';
import { getCanvasShortcutAction } from './engine/keyboardShortcuts';
import {
  BOARD_ID,
  continueWithoutLocalRecovery, getBoardRuntimeStatus, initializeBoardStore, subscribeBoardRuntimeStatus, yShapes,
} from './store/useBoardStore';
import { RemoteCursorsOverlay } from './components/collab/RemoteCursorsOverlay';
import { ShareModal } from './components/collab/ShareModal';
import { resolveBoardRoleFromUrl, type BoardUserRole } from './store/boardSecurity';
import {
  broadcastCollabCursor,
  broadcastCollabPresenter,
  broadcastCollabReaction,
  broadcastCollabRoleOverride,
  getEffectivePeerRole,
  updateLocalCollabRole,
  getCollabPeers,
  getLocalCollabUser,
  subscribeCollabPresence,
  type CollabPeer,
  type CollabUser,
} from './store/collabPresence';
import BoardStatusBanner from './store/BoardStatusBanner';
import FormulaEditor from './formula/FormulaEditor';
import FormulaEditorBoundary from './formula/FormulaEditorBoundary';
import { DEFAULT_CODE_LANGUAGE, normalizeCodeLanguage, type CodeLanguage } from './code/languages';
import { getCustomCursors, visibleCursor } from './cursors';
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
  if (shape.type === 'diagram') {
    const definition = getShapeDefinition(shape.shapeId);
    const defW = definition?.width ?? 160;
    const defH = definition?.height ?? 85;
    const dimensionRatio = Math.sqrt((shape.w / defW) * (shape.h / defH));
    const fontScale = Number.isFinite(shape.embeddedTextScale) && (shape.embeddedTextScale ?? 0) > 0
      ? Math.max(0.25, Math.min(16, shape.embeddedTextScale!))
      : Math.max(0.3, Math.min(16, dimensionRatio));
    const baseFs = 'fs' in shape && typeof shape.fs === 'number' ? shape.fs : 14;
    return Math.max(11, Math.round(baseFs * fontScale));
  }
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
  { id: 'lasso-select', Icon: LassoSelect, label: 'Lasso Select' },
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
    {intrinsicFills.map((path, index) => {
      const surface = geometry.intrinsicFillColors[index] === 'surface';
      return <path key={`intrinsic-${index}`} d={path} fill={surface ? 'var(--aw-paper, #fff)' : 'currentColor'}
        stroke={surface ? 'none' : 'currentColor'} strokeWidth="1.1" strokeLinejoin="round" />;
    })}
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

function SideBtn({
  label,
  shortcut,
  active,
  expanded,
  hasSubmenu,
  buttonRef,
  onClick,
  children
}: {
  label: string;
  shortcut?: string;
  active?: boolean;
  expanded?: boolean;
  hasSubmenu?: boolean;
  buttonRef?: React.Ref<HTMLButtonElement>;
  onClick: (e: React.MouseEvent) => void;
  children: React.ReactNode;
}) {
  return (
    <button ref={buttonRef} type="button" onClick={onClick} aria-label={label} title={label} aria-pressed={active} aria-expanded={expanded}
      className={`side-btn${active ? ' active' : ''}`}>
      {active && <span className="side-active-bar" aria-hidden="true" />}
      <span className="side-btn-content">{children}</span>
      {hasSubmenu && (
        <span className="side-submenu-indicator" aria-hidden="true">
          <svg width="5" height="5" viewBox="0 0 5 5" fill="none">
            <path d="M0.8 4.2L4.2 4.2L4.2 0.8" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      )}
      <span className="side-tooltip" aria-hidden="true">
        <span className="side-tooltip-text">{label}</span>
        {shortcut && <kbd className="side-tooltip-kbd">{shortcut}</kbd>}
      </span>
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
  const mouseClientRef = useRef<{ x: number; y: number } | null>(null);

  const [tool, setToolSt] = useState<ToolType>('pen');
  const [zoom, setZoom] = useState(1);
  const [cam, setCam] = useState({ x: 0, y: 0, zoom: 1 }); // Sync camera to React for overlays
  // Real-time Anonymous User & Presence
  const [collabUser, setCollabUser] = useState<CollabUser | null>(() => getLocalCollabUser());
  const collabUserRef = useRef(collabUser);
  collabUserRef.current = collabUser;

  const [cursor, setCursor] = useState('default');
  const userColor = collabUser?.color || '#2563eb';
  const renderedCursor = visibleCursor(cursor, userColor);
  const customCursors = useMemo(() => getCustomCursors(userColor), [userColor]);
  const [showMorePeers, setShowMorePeers] = useState(false);
  const morePeersRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showMorePeers) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (morePeersRef.current && !morePeersRef.current.contains(e.target as Node)) {
        setShowMorePeers(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowMorePeers(false);
    };
    window.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [showMorePeers]);
  const [boardName, setBoardName] = useState('Untitled');
  const [editName, setEditName] = useState(false);
  const [selIds, setSelIds] = useState<string[]>([]);
  const [selectedShape, setSelectedShape] = useState<AnyShape | null>(null);
  const [graphDiagnostics, setGraphDiagnostics] = useState<DiagramGraphDiagnostic[]>([]);
  const [semanticEditNotice, setSemanticEditNotice] = useState<string | null>(null);
  const [shapePropertiesOpen, setShapePropertiesOpen] = useState(false);
  const shapePropertiesPanelRef = useRef<HTMLElement>(null);
  const shapePropertiesTriggerRef = useRef<HTMLButtonElement>(null);
  const [ddlModalData, setDdlModalData] = useState<{ tableName: string; columns: TableColumnModel[] } | null>(null);
  const [ddlDialect, setDdlDialect] = useState<DdlDialect>('postgresql');
  const [ddlCopied, setDdlCopied] = useState(false);

  const [collabPeers, setCollabPeers] = useState<CollabPeer[]>(() => getCollabPeers());

  // Miro-standard Follow Collaborator Mode ("Screen Following")
  const [followingPeerId, setFollowingPeerId] = useState<number | null>(null);
  const followingPeerIdRef = useRef(followingPeerId);
  followingPeerIdRef.current = followingPeerId;

  // Miro-standard Presenter Mode ("Bring Everyone to Me")
  const [isPresenting, setIsPresenting] = useState(false);
  const isPresentingRef = useRef(isPresenting);
  isPresentingRef.current = isPresenting;
  const myPresentationStartedAtRef = useRef<number>(0);
  const [followingPresenter, setFollowingPresenter] = useState(true);
  const [takeoverNotice, setTakeoverNotice] = useState<string | null>(null);
  const takeoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Live Floating Emoji Reactions
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const lastMouseWorldPosRef = useRef<{ x: number; y: number } | null>(null);

  // Share Board Modal
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);

  // Strict Permission & Access Control (Owner / Editor / Commenter / Viewer)
  const [userRole, setUserRole] = useState<BoardUserRole>(() => resolveBoardRoleFromUrl());
  const isReadOnly = userRole === 'viewer' || userRole === 'commenter';
  const isReadOnlyRef = useRef(isReadOnly);
  isReadOnlyRef.current = isReadOnly;

  useEffect(() => {
    if (engRef.current) {
      engRef.current.isReadOnly = isReadOnly;
    }
    if (isReadOnly && tool !== 'select') {
      setTool('select');
    }
  }, [isReadOnly, tool]);

  useEffect(() => {
    return subscribeCollabPresence(() => {
      const u = getLocalCollabUser();
      setCollabUser(u);
      setCollabPeers(getCollabPeers());
      if (u) {
        const effective = getEffectivePeerRole(u.anonymousNumber, u.role ?? resolveBoardRoleFromUrl());
        if (effective !== userRole) {
          setUserRole(effective);
          updateLocalCollabRole(effective);
          setTakeoverNotice(
            effective === 'viewer'
              ? '📢 Quyền truy cập: Chỉ xem (View only)'
              : effective === 'commenter'
              ? '📢 Quyền truy cập: Người bình luận (Commenter)'
              : '📢 Bạn đã được cấp quyền Chỉnh sửa (Editor)'
          );
          setTimeout(() => setTakeoverNotice(null), 3500);
        }
      }
    });
  }, [userRole]);

  const followingPeer = collabPeers.find(p => p.clientId === followingPeerId);

  // Identify active remote presenter by newest startedAt
  const activeRemotePresenter = useMemo(() => {
    const presenters = collabPeers.filter(p => p.presenter && p.presenter.active);
    if (presenters.length === 0) return null;
    presenters.sort((a, b) => (b.presenter?.startedAt ?? 0) - (a.presenter?.startedAt ?? 0));
    return presenters[0];
  }, [collabPeers]);

  // Single Presenter Lock / Graceful Takeover
  useEffect(() => {
    if (!activeRemotePresenter?.presenter) return;
    const remote = activeRemotePresenter.presenter;
    const remoteStartedAt = remote.startedAt ?? 0;

    // If local user is currently presenting, but another user took over with a newer startedAt:
    if (isPresentingRef.current && remoteStartedAt > myPresentationStartedAtRef.current) {
      isPresentingRef.current = false;
      setIsPresenting(false);
      myPresentationStartedAtRef.current = 0;
      setFollowingPresenter(true);
      setTakeoverNotice(`${activeRemotePresenter.user.name} đã tiếp quản buổi thuyết trình`);
      if (takeoverTimeoutRef.current) clearTimeout(takeoverTimeoutRef.current);
      takeoverTimeoutRef.current = setTimeout(() => setTakeoverNotice(null), 4000);
    }
  }, [activeRemotePresenter]);

  // Auto track followed collaborator's cursor/position
  useEffect(() => {
    if (!followingPeerId || !engRef.current) return;
    const target = collabPeers.find(p => p.clientId === followingPeerId);
    if (!target) {
      setFollowingPeerId(null);
      return;
    }
    if (target.cursor) {
      engRef.current.panTo(target.cursor.x, target.cursor.y);
    }
  }, [followingPeerId, collabPeers]);

  // Auto track remote presenter's camera - NEVER track while local user is presenting!
  useEffect(() => {
    if (!engRef.current) return;
    const p = activeRemotePresenter?.presenter;
    if (isPresenting || !p || !p.active || !followingPresenter) return;
    engRef.current.setCamera(p.x, p.y, p.zoom);
  }, [
    isPresenting,
    activeRemotePresenter?.presenter?.x,
    activeRemotePresenter?.presenter?.y,
    activeRemotePresenter?.presenter?.zoom,
    activeRemotePresenter?.presenter?.active,
    activeRemotePresenter?.presenter?.startedAt,
    followingPresenter,
  ]);

  const togglePresenting = useCallback(() => {
    const next = !isPresentingRef.current;
    isPresentingRef.current = next;
    setIsPresenting(next);
    if (next) {
      const now = Date.now();
      myPresentationStartedAtRef.current = now;
      setFollowingPresenter(false);
      setFollowingPeerId(null);
      if (engRef.current && collabUserRef.current) {
        broadcastCollabPresenter({
          active: true,
          startedAt: now,
          clientId: collabUserRef.current.anonymousNumber,
          x: Math.round(engRef.current.cam.x * 10) / 10,
          y: Math.round(engRef.current.cam.y * 10) / 10,
          zoom: Math.round(engRef.current.cam.zoom * 100) / 100,
          presenterName: collabUserRef.current.name,
        });
      }
    } else {
      myPresentationStartedAtRef.current = 0;
      broadcastCollabPresenter(null);
    }
  }, []);

  const handleSendReaction = useCallback((emoji: string) => {
    const eng = engRef.current;
    let worldPos = lastMouseWorldPosRef.current;
    if (!worldPos && eng) {
      worldPos = eng.clientToWorld(window.innerWidth / 2, window.innerHeight / 2);
    }
    if (worldPos) {
      broadcastCollabReaction(emoji, worldPos);
    }
    setShowReactionPicker(false);
  }, []);

  // text/sticky edit overlay
  const [editShape, setEditShape] = useState<AnyShape | null>(null);
  const editShapeRef = useRef<AnyShape | null>(null);
  const editTextRef = useRef('');
  const editLanguageRef = useRef<CodeLanguage>(DEFAULT_CODE_LANGUAGE);
  const editSessionCounterRef = useRef(0);
  const activeEditSessionRef = useRef(0);
  const committedEditSessionRef = useRef<number | null>(null);
  const internalSetEditShape = (s: AnyShape | null) => {
    setEditShape(s);
    editShapeRef.current = s;
    if (!s) editTextRef.current = '';
  };

  const [editText, setEditText] = useState('');
  const boardRuntimeStatus = useSyncExternalStore(subscribeBoardRuntimeStatus, getBoardRuntimeStatus, getBoardRuntimeStatus);
  const justCommittedShapeRef = useRef<{ id: string; time: number } | null>(null);
  const [boardReady, setBoardReady] = useState(false);
  const [boardRestoreError, setBoardRestoreError] = useState<string | null>(null);
  const [editLanguage, setEditLanguage] = useState<CodeLanguage>(DEFAULT_CODE_LANGUAGE);
  const [editBox, setEditBox] = useState({ l: 0, t: 0, w: 0, h: 0 });
  const [editClick, setEditClick] = useState({ x: 0, y: 0 });
  const [canvasMetrics, setCanvasMetrics] = useState({ w: 0, h: 0, left: 0, top: 0 });
  const textFocusShapeIdRef = useRef<string | null>(null);
  const editingLocalBoundsRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const editingClassifierContextRef = useRef<{
    shapeId: string;
    target: 'header' | 'member' | 'empty-compartment';
    compartmentId?: string;
    compartmentKind?: 'attributes' | 'operations' | 'literals' | 'values';
    memberId?: string;
    memberIndex?: number;
    fontSize: number;
    textAlign: 'left' | 'center';
  } | null>(null);
  const editingErContextRef = useRef<{
    shapeId: string;
    target: 'header' | 'column';
    columnIndex?: number;
    fontSize?: number;
  } | null>(null);
  const editingUsecaseExtContextRef = useRef<{
    shapeId: string;
    target: 'header' | 'extension-points';
  } | null>(null);

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
  const openGroupRef = useRef(openGroup);
  openGroupRef.current = openGroup;
  const [penMode, setPenMode] = useState<'normal' | 'smart'>('normal');
  const popoverAnchorRefs = useRef<Record<PopoverGroup, HTMLDivElement | null>>({ pen: null, shapes: null, text: null, select: null });
  const popoverPanelRef = useRef<HTMLDivElement>(null);
  const [popoverPosition, setPopoverPosition] = useState<{ left: number; top: number } | null>(null);
  const [lastTextTool, setLastTextTool] = useState<ToolType>('text');
  const [lastShapeTool, setLastShapeTool] = useState<ToolType>('rect');
  const [shapeCategory, setShapeCategory] = useState<ShapeCategory>('Basic');
  const [shapeSearch, setShapeSearch] = useState('');
  const [lastSelectTool, setLastSelectTool] = useState<ToolType>('select');
  const [isFavorite, setIsFavorite] = useState(false);
  const previousCreationToolRef = useRef<ToolType | null>(null);
  const isSwitchingToolRef = useRef(false);

  const setTool = useCallback((t: ToolType, keepOpen: boolean = false, contextCategory?: ShapeCategory, preserveSelection: boolean = false, isAutoSwitch: boolean = false) => {
    if (isReadOnlyRef.current && t !== 'select') {
      setTakeoverNotice('🔒 Chế độ chỉ xem: Bạn không có quyền chỉnh sửa board này.');
      setTimeout(() => setTakeoverNotice(null), 3000);
      return;
    }
    isSwitchingToolRef.current = true;
    try {
      setToolSt(t);
      // When manually selecting a tool, close any other open groups
      if (!keepOpen) setOpenGroup(null);
      const shapeTool = SHAPE_TOOLS.find(item => item.id === t);
      if (shapeTool) engRef.current?.setDiagramContext(umlFamilyForCategory(contextCategory ?? shapeTool.definition.category ?? shapeCategory));
      engRef.current?.setTool(t, preserveSelection);
      if (['text', 'math', 'code'].includes(t)) setLastTextTool(t);
      if (shapeTool) setLastShapeTool(t);
      if (['select', 'lasso-select'].includes(t)) setLastSelectTool(t);

      if (!isAutoSwitch) {
        if (['select', 'lasso-select', 'eraser', 'hand'].includes(t)) {
          previousCreationToolRef.current = null;
        } else {
          previousCreationToolRef.current = t;
        }
      }
    } finally {
      isSwitchingToolRef.current = false;
    }
  }, [shapeCategory]);

  const choosePopoverTool = (t: ToolType, contextCategory?: ShapeCategory) => {
    const group = openGroup;
    setTool(t, false, contextCategory);
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
    eng.setDiagramContext(umlFamilyForCategory(shapeCategory));
    // The style-sync effect may already have run while board restoration was pending.
    // Apply the current UI values at construction so new shapes use Antiwhite defaults.
    eng.style = { ...engineStyleRef.current };
    eng.isReadOnly = isReadOnlyRef.current;
    engRef.current = eng;
    if (import.meta.env.DEV || (typeof window !== 'undefined' && Boolean((window as unknown as { __ENABLE_TEST_ENGINE__?: boolean }).__ENABLE_TEST_ENGINE__))) {
      (window as unknown as { eng?: CanvasEngine }).eng = eng;
    }

    eng.onSel = ids => {
      setSelIds(ids);
      setSelectedShape(ids.length === 1 ? eng.getShape(ids[0]) : null);
      setSemanticEditNotice(null);
      if (ids.length !== 1) setShapePropertiesOpen(false);

      if (!isSwitchingToolRef.current && ids.length === 0 && previousCreationToolRef.current) {
        const restore = previousCreationToolRef.current;
        previousCreationToolRef.current = null;
        setTool(restore, false, undefined, false, false);
      }
    };
    eng.onGraphUpdate = diagnostics => setGraphDiagnostics(diagnostics);
    setGraphDiagnostics(eng.getDiagramGraphDiagnostics());
    eng.onCursor = setCursor;
    eng.onCameraChange = (c) => {
      setCam(c);
      setZoom(c.zoom);
      if (isPresentingRef.current && collabUserRef.current) {
        broadcastCollabPresenter({
          active: true,
          startedAt: myPresentationStartedAtRef.current,
          clientId: collabUserRef.current.anonymousNumber,
          x: Math.round(c.x * 10) / 10,
          y: Math.round(c.y * 10) / 10,
          zoom: Math.round(c.zoom * 100) / 100,
          presenterName: collabUserRef.current.name,
        });
      }
    };
    eng.onZoom = (z) => {
      setZoom(z);
    };
    eng.onTool = t => {
      setToolSt(t);
      if (t === 'select' || t === 'lasso-select') setLastSelectTool(t);
    };

    eng.onCam = cam => {
      const editingShape = editShapeRef.current;
      if (!editingShape || !isPositionedShape(editingShape)) return;
      const sp = eng.worldToClient(editingShape.x, editingShape.y);
      const local = editingLocalBoundsRef.current;
      if (local) {
        setEditBox(prev => ({
          ...prev,
          l: sp.x + local.x * cam.zoom,
          t: sp.y + local.y * cam.zoom,
          w: local.w * cam.zoom,
          h: local.h * cam.zoom,
        }));
      } else {
        setEditBox(prev => ({
          ...prev, l: sp.x, t: sp.y,
          w: editingShape.w * cam.zoom, h: editingShape.h * cam.zoom,
        }));
      }
    };

    eng.onShapeUpdate = shape => {
      if (eng.sel.has(shape.id)) setSelectedShape(shape);
      if (editShapeRef.current?.id !== shape.id) return;
      if ('text' in shape && typeof shape.text === 'string') {
        const updatedText = shape.text;
        editTextRef.current = updatedText;
        if (shape.type !== 'math') setEditText(current => current === updatedText ? current : updatedText);
      }
      if (shape.type === 'code') {
        const language = normalizeCodeLanguage(shape.language);
        editLanguageRef.current = language;
        setEditLanguage(language);
      }
      if (isPositionedShape(shape)) {
        const sp = eng.worldToClient(shape.x, shape.y);
        const local = editingLocalBoundsRef.current;
        if (local) {
          setEditBox(prev => ({
            ...prev,
            l: sp.x + local.x * eng.cam.zoom,
            t: sp.y + local.y * eng.cam.zoom,
            w: local.w * eng.cam.zoom,
            h: local.h * eng.cam.zoom,
          }));
        } else {
          setEditBox({ l: sp.x, t: sp.y, w: shape.w * eng.cam.zoom, h: shape.h * eng.cam.zoom });
        }
      }
      internalSetEditShape(shape);
    };

    eng.onEditText = (shape: AnyShape, cx: number, cy: number) => {
      if (!isPositionedShape(shape)) return;
      activeEditSessionRef.current = ++editSessionCounterRef.current;
      committedEditSessionRef.current = null;
      textFocusShapeIdRef.current = null;
      editingClassifierContextRef.current = null;
      editingErContextRef.current = null;
      editingUsecaseExtContextRef.current = null;
      eng.setEditingId(shape.id);
      const sp = eng.worldToClient(shape.x, shape.y);
      let text = 'text' in shape && typeof shape.text === 'string' ? shape.text : '';

      let localBounds = { x: 0, y: 0, w: shape.w, h: shape.h };
      let boxL = sp.x;
      let boxT = sp.y;
      let boxW = shape.w * eng.cam.zoom;
      let boxH = shape.h * eng.cam.zoom;

      if (shape.type === 'diagram') {
        const diagram = shape as DiagramShape;
        const def = getShapeDefinition(diagram.shapeId);
        if (def?.id === 'uml.actor') {
          const glyphH = shape.h * 0.68;
          localBounds = { x: 4, y: glyphH + 4, w: shape.w - 8, h: shape.h - glyphH - 6 };
          boxL = sp.x + localBounds.x * eng.cam.zoom;
          boxT = sp.y + localBounds.y * eng.cam.zoom;
          boxW = localBounds.w * eng.cam.zoom;
          boxH = localBounds.h * eng.cam.zoom;
          text = shape.text || 'Actor';
        } else if (def?.id === 'uml.use-case-ext') {
          const wPt = eng.clientToWorld(cx, cy);
          const localY = wPt.y - shape.y;
          const usecase = diagram.data?.usecase as { extensionPoints?: Array<{ name: string }> } | undefined;
          const eps = usecase?.extensionPoints ?? [];
          const dividerY = Math.max(shape.h * 0.35, shape.h * 0.50);
          if (localY >= dividerY && eps.length > 0) {
            localBounds = { x: 16, y: dividerY + 4, w: shape.w - 32, h: shape.h - dividerY - 8 };
            boxL = sp.x + localBounds.x * eng.cam.zoom;
            boxT = sp.y + localBounds.y * eng.cam.zoom;
            boxW = localBounds.w * eng.cam.zoom;
            boxH = localBounds.h * eng.cam.zoom;
            text = eps.map(e => e.name).join('\n');
            editingUsecaseExtContextRef.current = { shapeId: shape.id, target: 'extension-points' };
            eng.setEditingClassifierContext({ shapeId: shape.id, target: 'usecase-ext' });
          } else {
            localBounds = { x: 16, y: 8, w: shape.w - 32, h: dividerY - 12 };
            boxL = sp.x + localBounds.x * eng.cam.zoom;
            boxT = sp.y + localBounds.y * eng.cam.zoom;
            boxW = localBounds.w * eng.cam.zoom;
            boxH = localBounds.h * eng.cam.zoom;
            text = shape.text || 'Use Case';
            editingUsecaseExtContextRef.current = { shapeId: shape.id, target: 'header' };
            eng.setEditingClassifierContext({ shapeId: shape.id, target: 'header' });
          }
        } else if (def?.id === 'uml.system-boundary') {
          const headerH = Math.min(shape.h, UML_BOUNDARY_TITLE_HEIGHT);
          localBounds = { x: 10, y: 0, w: Math.max(20, shape.w - 20), h: headerH };
          boxL = sp.x + localBounds.x * eng.cam.zoom;
          boxT = sp.y + localBounds.y * eng.cam.zoom;
          boxW = localBounds.w * eng.cam.zoom;
          boxH = localBounds.h * eng.cam.zoom;
          text = shape.text || 'System';
        } else if (def?.id === 'uml.use-case' || def?.geometry === 'useCase') {
          localBounds = { x: Math.max(4, shape.w * 0.12), y: Math.max(4, shape.h * 0.20), w: Math.max(20, shape.w * 0.76), h: Math.max(16, shape.h * 0.60) };
          boxL = sp.x + localBounds.x * eng.cam.zoom;
          boxT = sp.y + localBounds.y * eng.cam.zoom;
          boxW = localBounds.w * eng.cam.zoom;
          boxH = localBounds.h * eng.cam.zoom;
          text = shape.text || def.defaultText || 'Use Case';
        } else if (def?.id === 'erd.er-table' || def?.id === 'erd.table' || def?.id === 'erd.view') {
          const hit = eng.getErTableHit(shape.id, cx, cy);
          if (hit) {
            boxL = hit.clientBounds.l;
            boxT = hit.clientBounds.t;
            boxW = hit.clientBounds.w;
            boxH = hit.clientBounds.h;
            localBounds = hit.localBounds;
            editingErContextRef.current = {
              shapeId: shape.id,
              target: hit.target,
              columnIndex: hit.columnIndex,
              fontSize: hit.fontSize,
            };
            eng.setEditingClassifierContext({
              shapeId: shape.id,
              target: hit.target === 'header' ? 'header' : 'member',
              columnIndex: hit.columnIndex,
            });
            text = hit.initialText;
          }
        } else if (def?.id === 'uml.class' || def?.id === 'uml.abstract-class' || def?.id === 'uml.interface'
          || def?.id === 'uml.enumeration' || def?.id === 'uml.object') {
          const hit = eng.getClassifierHit(shape.id, cx, cy);
          if (hit) {
            boxL = hit.clientBounds.l;
            boxT = hit.clientBounds.t;
            boxW = hit.clientBounds.w;
            boxH = hit.clientBounds.h;
            localBounds = hit.localBounds;
            editingClassifierContextRef.current = {
              shapeId: shape.id,
              target: hit.target,
              compartmentId: hit.compartmentId,
              compartmentKind: hit.compartmentKind,
              memberId: hit.memberId,
              memberIndex: hit.memberIndex,
              fontSize: hit.fontSize,
              textAlign: hit.textAlign,
            };
            eng.setEditingClassifierContext({
              shapeId: shape.id,
              target: hit.target,
              memberId: hit.memberId,
            });
            text = hit.initialText;
          } else {
            const scale = Number.isFinite(diagram.embeddedTextScale) && (diagram.embeddedTextScale ?? 0) > 0
              ? Math.max(0.25, Math.min(16, diagram.embeddedTextScale!))
              : Math.sqrt((shape.w / Math.max(1, def.width)) * (shape.h / Math.max(1, def.height)));
            const stereotype = typeof shape.params?.stereotype === 'string' ? shape.params.stereotype : '';
            const titleLine = Math.max(18, 14 * scale * 1.35);
            const stereotypeLine = stereotype ? Math.max(16, 12 * scale * 1.2) : 0;
            const headerH = Math.min(shape.h * 0.48, Math.max(38, 16 * scale + titleLine + stereotypeLine));
            localBounds = { x: 8, y: 0, w: shape.w - 16, h: headerH };
            boxT = sp.y;
            boxH = headerH * eng.cam.zoom;
            boxL = sp.x + 8 * eng.cam.zoom;
            boxW = (shape.w - 16) * eng.cam.zoom;
            editingClassifierContextRef.current = {
              shapeId: shape.id,
              target: 'header',
              fontSize: 14 * scale,
              textAlign: 'center',
            };
            eng.setEditingClassifierContext({
              shapeId: shape.id,
              target: 'header',
            });
          }
        } else if (def?.id === 'uml.package' || def?.id === 'uml.module') {
          const tabH = Math.min(shape.h * 0.35, 28);
          localBounds = { x: 8, y: 4, w: Math.min(shape.w * 0.6, 90), h: tabH };
          boxT = sp.y + localBounds.y * eng.cam.zoom;
          boxH = tabH * eng.cam.zoom;
          boxL = sp.x + localBounds.x * eng.cam.zoom;
          boxW = localBounds.w * eng.cam.zoom;
          text = shape.text || 'Package';
        } else if (def?.id === 'uml.lifeline') {
          const headerH = Math.min(shape.h, 48);
          localBounds = { x: 4, y: 4, w: Math.max(20, shape.w - 8), h: Math.max(16, headerH - 8) };
          boxT = sp.y + localBounds.y * eng.cam.zoom;
          boxH = localBounds.h * eng.cam.zoom;
          boxL = sp.x + localBounds.x * eng.cam.zoom;
          boxW = localBounds.w * eng.cam.zoom;
          text = shape.text || def.defaultText || 'Lifeline';
        } else if (def?.id === 'uml.boundary' || def?.id === 'uml.control' || def?.id === 'uml.entity') {
          localBounds = { x: 4, y: 52, w: Math.max(20, shape.w - 8), h: 28 };
          boxT = sp.y + localBounds.y * eng.cam.zoom;
          boxH = localBounds.h * eng.cam.zoom;
          boxL = sp.x + localBounds.x * eng.cam.zoom;
          boxW = localBounds.w * eng.cam.zoom;
          text = shape.text || def.defaultText || '';
        } else if (def?.id === 'uml.sequence-actor') {
          localBounds = { x: 4, y: 58, w: Math.max(20, shape.w - 8), h: 28 };
          boxT = sp.y + localBounds.y * eng.cam.zoom;
          boxH = localBounds.h * eng.cam.zoom;
          boxL = sp.x + localBounds.x * eng.cam.zoom;
          boxW = localBounds.w * eng.cam.zoom;
          text = shape.text || 'Actor';
        } else if (def?.id === 'uml.frame') {
          const tabH = Math.min(shape.h * 0.25, 26);
          localBounds = { x: 6, y: 4, w: Math.min(shape.w * 0.5, 90), h: tabH };
          boxT = sp.y + localBounds.y * eng.cam.zoom;
          boxH = tabH * eng.cam.zoom;
          boxL = sp.x + localBounds.x * eng.cam.zoom;
          boxW = localBounds.w * eng.cam.zoom;
          text = shape.text || (shape.params?.title as string) || 'sd';
        } else if (def?.id === 'uml.note') {
          localBounds = { x: 8, y: 8, w: shape.w - 20, h: shape.h - 16 };
          boxT = sp.y + 8 * eng.cam.zoom;
          boxH = localBounds.h * eng.cam.zoom;
          boxL = sp.x + 8 * eng.cam.zoom;
          boxW = localBounds.w * eng.cam.zoom;
        } else if (def?.geometry === 'diamond' || def?.geometry === 'associativeEntity') {
          const isIdentifying = shape.params?.doubleBorder === true;
          const safeW = shape.w * (isIdentifying ? 0.72 : 0.78);
          const safeH = shape.h * (isIdentifying ? 0.58 : 0.64);
          localBounds = { x: (shape.w - safeW) / 2, y: (shape.h - safeH) / 2, w: safeW, h: safeH };
          boxL = sp.x + localBounds.x * eng.cam.zoom;
          boxT = sp.y + localBounds.y * eng.cam.zoom;
          boxW = localBounds.w * eng.cam.zoom;
          boxH = localBounds.h * eng.cam.zoom;
        } else if (def?.geometry === 'ellipse') {
          const isDouble = shape.params?.doubleBorder === true;
          const safeW = shape.w * (isDouble ? 0.72 : 0.80);
          const safeH = shape.h * (isDouble ? 0.64 : 0.72);
          localBounds = { x: (shape.w - safeW) / 2, y: (shape.h - safeH) / 2, w: safeW, h: safeH };
          boxL = sp.x + localBounds.x * eng.cam.zoom;
          boxT = sp.y + localBounds.y * eng.cam.zoom;
          boxW = localBounds.w * eng.cam.zoom;
          boxH = localBounds.h * eng.cam.zoom;
        }
      }

      editingLocalBoundsRef.current = localBounds;
      setEditBox({
        l: boxL, t: boxT,
        w: boxW,
        h: boxH,
      });
      setEditClick({ x: cx, y: cy });
      internalSetEditShape(shape);
      editTextRef.current = text;
      setEditText(text);
      const language = normalizeCodeLanguage(shape.type === 'code' ? shape.language : undefined);
      editLanguageRef.current = language;
      setEditLanguage(language);
    };

    eng.onEditSemantic = shape => {
      setSelectedShape(shape);
      setShapePropertiesOpen(true);
      // The panel is portaled and mounts after state commit. Focus an editor owned by the
      // selected semantic object, never the generic whole-object text editor.
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
        document.querySelector<HTMLElement>('#shape-properties-panel [data-semantic-edit-target]')?.focus();
      }));
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
      if (followingPeerIdRef.current) setFollowingPeerId(null);
      const unit = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : e.deltaMode === WheelEvent.DOM_DELTA_PAGE ? wrap.clientHeight : 1;
      const delta = Math.max(-160, Math.min(160, e.deltaY * unit));
      const factor = Math.max(0.8, Math.min(1.25, Math.exp(-delta * 0.00125)));
      e.preventDefault();
      eng.zoomAt(e.clientX, e.clientY, factor);
    };
    wrap.addEventListener('wheel', onWheel, { passive: false });

    // Window listeners keep drawing, erasing, and panning coherent outside the canvas bounds.
    const onMove = (e: PointerEvent) => {
      eng.pointerMove(e);
      if (wrap) {
        const rect = wrap.getBoundingClientRect();
        const inside = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
        const drawing = eng.isDrawingActive();
        if (inside || drawing) {
          const world = eng.clientToWorld(e.clientX, e.clientY);
          lastMouseWorldPosRef.current = world;
          broadcastCollabCursor(world, drawing);
        } else {
          broadcastCollabCursor(null, false);
        }
      }
    };
    const onUp = (e: PointerEvent) => {
      eng.pointerUp(e);
      if (wrap) {
        const rect = wrap.getBoundingClientRect();
        if (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom) {
          const world = eng.clientToWorld(e.clientX, e.clientY);
          lastMouseWorldPosRef.current = world;
          broadcastCollabCursor(world, false);
        } else {
          broadcastCollabCursor(null, false);
        }
      }
    };
    const onCancel = (e: PointerEvent) => {
      eng.cancelPointer(e);
      broadcastCollabCursor(null, false);
    };
    const onBlur = () => {
      eng.cancelPointer();
      broadcastCollabCursor(null, false);
    };
    const onLeave = () => {
      if (!eng.isDrawingActive()) {
        broadcastCollabCursor(null, false);
      }
    };
    wrap.addEventListener('pointerleave', onLeave);
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
      wrap.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('blur', onBlur);
      eng.cancelPointer();
      eng.destroy();
      engRef.current = null;
      if (import.meta.env.DEV || (typeof window !== 'undefined' && Boolean((window as unknown as { __ENABLE_TEST_ENGINE__?: boolean }).__ENABLE_TEST_ENGINE__))) {
        (window as unknown as { eng?: CanvasEngine | null }).eng = null;
      }
    };
  }, [boardReady]);

  // sync diagram family context when shape category changes without destroying engine
  useEffect(() => {
    engRef.current?.setDiagramContext(umlFamilyForCategory(shapeCategory));
  }, [shapeCategory]);

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
    const local = editingLocalBoundsRef.current;
    if (local) {
      setEditBox({
        l: sp.x + local.x * eng.cam.zoom,
        t: sp.y + local.y * eng.cam.zoom,
        w: local.w * eng.cam.zoom,
        h: local.h * eng.cam.zoom,
      });
    } else {
      const sw = editShape.w * eng.cam.zoom;
      const sh = editShape.h * eng.cam.zoom;
      setEditBox({ l: sp.x, t: sp.y, w: sw, h: sh });
    }
  }, [zoom]);

  const handleFormulaSourceChange = useCallback((source: string, lastValidPreview?: string, measuredSize?: { width: number; height: number }) => {
    editTextRef.current = source;
    const current = editShapeRef.current;
    if (current?.type !== 'math') return;
    const stored = yShapes.get(current.id);
    const fallbackPreview = stored?.type === 'math' ? stored.previewText : current.previewText;
    // Source remains authoritative; only a valid preview is allowed to update the board projection.
    engRef.current?.updateFormulaLive(current.id, source, lastValidPreview ?? fallbackPreview ?? '', measuredSize, true);
  }, []);

  const getLastValidFormulaPreview = useCallback(() => {
    const current = editShapeRef.current;
    if (current?.type !== 'math') return '';
    const stored = yShapes.get(current.id);
    return stored?.type === 'math' ? (stored.previewText ?? '') : (current.previewText ?? '');
  }, []);

  // Math Auto-Replace đã được chuyển sang FormulaEditor component.

  const commitEdit = useCallback((formulaSource?: string, lastValidPreview?: string, measuredSize?: { width: number; height: number }) => {
    const shape = editShapeRef.current;
    const eng = engRef.current;
    const session = activeEditSessionRef.current;
    if (!shape || !eng || !session || committedEditSessionRef.current === session) return;
    // Blur, Escape, Done, and editor teardown can race. One editor session owns one logical commit.
    committedEditSessionRef.current = session;
    const committedText = shape.type === 'math' ? (formulaSource ?? editTextRef.current) : editTextRef.current;
    const classifierContext = editingClassifierContextRef.current;
    const erContext = editingErContextRef.current;
    const usecaseExtContext = editingUsecaseExtContextRef.current;

    if (classifierContext && shape.id === classifierContext.shapeId) {
      if (classifierContext.target === 'header') {
        eng.updateText(shape.id, committedText);
      } else if (classifierContext.target === 'member' && classifierContext.memberId) {
        if (!committedText.trim()) {
          eng.removeClassifierMember(shape.id, classifierContext.memberId);
        } else {
          eng.updateClassifierMember(shape.id, classifierContext.memberId, committedText);
        }
      } else if (classifierContext.target === 'empty-compartment' && classifierContext.compartmentKind) {
        if (committedText.trim()) {
          eng.addClassifierMember(shape.id, classifierContext.compartmentKind, committedText);
        }
      }
      editingClassifierContextRef.current = null;
    } else if (erContext && shape.id === erContext.shapeId) {
      if (erContext.target === 'header') {
        eng.updateText(shape.id, committedText);
      } else if (erContext.target === 'column' && erContext.columnIndex !== undefined) {
        eng.updateErTableColumn(shape.id, erContext.columnIndex, committedText);
      }
      editingErContextRef.current = null;
    } else if (usecaseExtContext && shape.id === usecaseExtContext.shapeId) {
      if (usecaseExtContext.target === 'header') {
        eng.updateText(shape.id, committedText);
      } else if (usecaseExtContext.target === 'extension-points') {
        eng.updateUseCaseExtensionPoints(shape.id, committedText);
      }
      editingUsecaseExtContextRef.current = null;
    } else if (shape.type === 'math') {
      const storedPreview = getLastValidFormulaPreview() || shape.previewText || '';
      const previewText = lastValidPreview ?? storedPreview;
      const finalSource = committedText.trim() ? committedText : '\\square';
      const finalPreview = previewText.trim() ? previewText : '\\square';
      eng.updateFormula(shape.id, finalSource, finalPreview, measuredSize);
    } else if (committedText.trim() === '' && !isFixedShapeLabel(shape) && shape.type !== 'sticky') {
      eng.deleteShape(shape.id);
    } else if (shape.type === 'code') {
      const current = eng.getShape(shape.id);
      const language = current?.type === 'code' ? normalizeCodeLanguage(current.language) : editLanguageRef.current;
      eng.updateCode(shape.id, committedText, language);
    } else {
      eng.updateText(shape.id, committedText);
    }
    const committedId = shape.id;
    justCommittedShapeRef.current = { id: committedId, time: performance.now() };

    // Commit the model while the engine still suppresses its DOM preview, then release that
    // ownership in the same turn that tears down the React editor. Only the committed preview
    // remains as the final board representation.
    editingLocalBoundsRef.current = null;
    editingClassifierContextRef.current = null;
    editingErContextRef.current = null;
    editingUsecaseExtContextRef.current = null;
    eng.setEditingClassifierContext(null);
    internalSetEditShape(null);
    textFocusShapeIdRef.current = null;
    eng.setEditingId(null);

    // Keep the finished shape in selected preview state, and switch tool to select
    const finalShape = eng.getShape(committedId);
    if (finalShape) {
      if (eng.tool !== 'select') {
        eng.setTool('select', true);
        setTool('select', false, undefined, true, true);
      }
      eng.sel.clear();
      eng.sel.add(committedId);
      eng.onSel?.([committedId]);
      setSelectedShape(finalShape);
    }
  }, [getLastValidFormulaPreview]);

  const commitAndAdvanceClassifierMember = useCallback(() => {
    const shape = editShapeRef.current;
    const eng = engRef.current;
    const classifierContext = editingClassifierContextRef.current;
    if (!shape || !eng || !classifierContext || classifierContext.target === 'header') {
      commitEdit();
      return;
    }

    const currentText = editTextRef.current;
    const kind = classifierContext.compartmentKind ?? 'attributes';
    let anchorMemberId = classifierContext.memberId;

    if (classifierContext.target === 'member' && classifierContext.memberId) {
      if (!currentText.trim()) {
        eng.removeClassifierMember(shape.id, classifierContext.memberId);
        anchorMemberId = undefined;
      } else {
        eng.updateClassifierMember(shape.id, classifierContext.memberId, currentText);
      }
    } else if (classifierContext.target === 'empty-compartment') {
      if (currentText.trim()) {
        anchorMemberId = eng.addClassifierMember(shape.id, kind, currentText) ?? undefined;
      }
    }

    const placeholder = kind === 'operations' ? '+ method()' : kind === 'literals' ? 'LITERAL' : '+ attribute : String';
    const newMemberId = eng.addClassifierMember(shape.id, kind, placeholder, anchorMemberId);
    if (!newMemberId) {
      commitEdit();
      return;
    }

    const nextBounds = eng.getClassifierMemberBounds(shape.id, newMemberId);
    if (!nextBounds) {
      commitEdit();
      return;
    }

    const updatedShape = eng.getShape(shape.id);
    if (updatedShape) internalSetEditShape(updatedShape);

    editingClassifierContextRef.current = {
      shapeId: shape.id,
      target: 'member',
      compartmentId: classifierContext.compartmentId,
      compartmentKind: kind,
      memberId: newMemberId,
      fontSize: nextBounds.fontSize,
      textAlign: nextBounds.textAlign,
    };
    editingLocalBoundsRef.current = nextBounds.localBounds;

    editTextRef.current = placeholder;
    setEditText(placeholder);
    setEditBox(nextBounds.clientBounds);

    window.requestAnimationFrame(() => {
      const textarea = document.querySelector<HTMLTextAreaElement>('.board-text-editor');
      if (textarea) {
        textarea.focus();
        textarea.select();
      }
    });
  }, [commitEdit]);

  const commitAndAdvanceErTableColumn = useCallback(() => {
    const shape = editShapeRef.current;
    const eng = engRef.current;
    const erContext = editingErContextRef.current;
    if (!shape || !eng || !erContext || erContext.target === 'header' || erContext.columnIndex === undefined) {
      commitEdit();
      return;
    }

    const currentText = editTextRef.current;
    let nextIdx = erContext.columnIndex + 1;

    if (!currentText.trim()) {
      eng.removeErTableColumn(shape.id, erContext.columnIndex);
      nextIdx = erContext.columnIndex;
    } else {
      eng.updateErTableColumn(shape.id, erContext.columnIndex, currentText);
    }

    const insertedIdx = eng.addErTableColumn(shape.id, nextIdx, 'column_name : varchar(255)');
    if (insertedIdx === null) {
      commitEdit();
      return;
    }

    const nextBounds = eng.getErTableColumnBounds(shape.id, insertedIdx);
    if (!nextBounds) {
      commitEdit();
      return;
    }

    const updatedShape = eng.getShape(shape.id);
    if (updatedShape) internalSetEditShape(updatedShape);

    editingErContextRef.current = {
      shapeId: shape.id,
      target: 'column',
      columnIndex: insertedIdx,
      fontSize: nextBounds.fontSize,
    };
    editingLocalBoundsRef.current = nextBounds.localBounds;

    editTextRef.current = nextBounds.initialText;
    setEditText(nextBounds.initialText);
    setEditBox(nextBounds.clientBounds);

    window.requestAnimationFrame(() => {
      const textarea = document.querySelector<HTMLTextAreaElement>('.board-text-editor');
      if (textarea) {
        textarea.focus();
        textarea.select();
      }
    });
  }, [commitEdit]);

  const navigateErTableColumn = useCallback((direction: 'up' | 'down') => {
    const shape = editShapeRef.current;
    const eng = engRef.current;
    const erContext = editingErContextRef.current;
    if (!shape || !eng || !erContext || erContext.target === 'header' || erContext.columnIndex === undefined) {
      return false;
    }

    const currentText = editTextRef.current;
    if (currentText.trim()) {
      eng.updateErTableColumn(shape.id, erContext.columnIndex, currentText);
    }

    const targetIdx = direction === 'up' ? erContext.columnIndex - 1 : erContext.columnIndex + 1;
    const nextBounds = eng.getErTableColumnBounds(shape.id, targetIdx);
    if (!nextBounds) {
      return false;
    }

    const updatedShape = eng.getShape(shape.id);
    if (updatedShape) internalSetEditShape(updatedShape);

    editingErContextRef.current = {
      shapeId: shape.id,
      target: 'column',
      columnIndex: targetIdx,
      fontSize: nextBounds.fontSize,
    };
    editingLocalBoundsRef.current = nextBounds.localBounds;

    editTextRef.current = nextBounds.initialText;
    setEditText(nextBounds.initialText);
    setEditBox(nextBounds.clientBounds);

    window.requestAnimationFrame(() => {
      const textarea = document.querySelector<HTMLTextAreaElement>('.board-text-editor');
      if (textarea) {
        textarea.focus();
        textarea.select();
      }
    });
    return true;
  }, []);

  // Keyboard context priority: native editor/form controls first, then application dialogs and
  // toolbars, then the focused board. A text editor's native history/select-all must never reach
  // the board's Yjs history manager.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const active = document.activeElement as HTMLElement | null;
      const tag = active?.tagName;
      const nativeEditor = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
        || Boolean(active?.isContentEditable);
      if (nativeEditor) return;

      const editorOrControl = active?.closest('.formula-editor-panel, .math-tools-panel, .code-editor-shell, .code-editor-overlay, [role="dialog"], [role="menu"], [role="listbox"], .panel-ui, .popover, aside, header, button, a, select');
      if (editorOrControl) return;
      // A canvas click focuses the real canvas even when the pointer landed on a DOM-rendered
      // object. Body focus is the application's idle board context; other parts of the app are not.
      const boardHasFocus = !active || active === document.body || active === document.documentElement
        || active === canvasRef.current || Boolean(wrapRef.current?.contains(active));
      if (!boardHasFocus) return;
      if (editShapeRef.current) { if (e.key === 'Escape') { e.preventDefault(); commitEdit(); } return; }
      const eng = engRef.current; if (!eng) return;

      const shortcut = getCanvasShortcutAction(e, eng.sel.size === 0);
      if (!shortcut) return;
      if (isReadOnlyRef.current && ['undo', 'redo', 'duplicate', 'delete', 'tool', 'open-image'].includes(shortcut.type)) {
        if (shortcut.type === 'tool' && shortcut.tool === 'select') {
          // allow switching to select
        } else {
          e.preventDefault();
          setTakeoverNotice('📢 Chế độ chỉ xem: Không thể chỉnh sửa hoặc đổi công cụ vẽ.');
          setTimeout(() => setTakeoverNotice(null), 2500);
          return;
        }
      }

      switch (shortcut.type) {
        case 'pan':
          e.preventDefault();
          eng.panBy(shortcut.dx, shortcut.dy);
          break;
        case 'undo': e.preventDefault(); eng.undo(); break;
        case 'redo': e.preventDefault(); eng.redo(); break;
        case 'select-all': e.preventDefault(); eng.selectAll(); break;
        case 'duplicate': e.preventDefault(); eng.dupSel(); break;
        case 'copy': e.preventDefault(); eng.copySel(); break;
        case 'delete': e.preventDefault(); eng.deleteSel(); break;
        case 'tool': setTool(shortcut.tool); break;
        case 'open-image': fileRef.current?.click(); break;
        case 'clear-selection':
          eng.clearSelection();
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setTool, commitEdit]);

  // Track mouse coordinates for pasting precisely at the cursor location
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      mouseClientRef.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener('mousemove', onMouseMove, { passive: true });
    return () => window.removeEventListener('mousemove', onMouseMove);
  }, []);

  // Smart Clipboard Paste Handler: recognizes image files, video files, URLs, and shapes
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (isReadOnlyRef.current) return;
      const active = document.activeElement as HTMLElement | null;
      const tag = active?.tagName;
      const isTypingInNativeInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
        || Boolean(active?.isContentEditable);
      if (isTypingInNativeInput) return;

      const isInsideSpecialEditor = Boolean(
        active?.closest('.formula-editor-panel, .math-tools-panel, .code-editor-shell, .code-editor-overlay, .board-text-editor')
      );
      if (isInsideSpecialEditor) return;

      const eng = engRef.current;
      if (!eng) return;

      const cv = canvasRef.current;
      const rect = cv?.getBoundingClientRect();
      let cx = window.innerWidth / 2;
      let cy = window.innerHeight / 2;

      if (rect) {
        cx = rect.left + rect.width / 2;
        cy = rect.top + rect.height / 2;
      }
      if (mouseClientRef.current) {
        const mx = mouseClientRef.current.x;
        const my = mouseClientRef.current.y;
        if (!rect || (mx >= rect.left && mx <= rect.right && my >= rect.top && my <= rect.bottom)) {
          cx = mx;
          cy = my;
        }
      }

      // 1. Check Files / Items in Clipboard
      const files = Array.from(e.clipboardData?.files || []);
      const items = Array.from(e.clipboardData?.items || []);
      let videoFile = files.find(f => f.type.startsWith('video/'));
      let imageFile = files.find(f => f.type.startsWith('image/'));

      if (!videoFile || !imageFile) {
        for (const item of items) {
          if (item.kind === 'file') {
            const f = item.getAsFile();
            if (f) {
              if (!videoFile && f.type.startsWith('video/')) videoFile = f;
              if (!imageFile && f.type.startsWith('image/')) imageFile = f;
            }
          }
        }
      }

      if (videoFile) {
        e.preventDefault();
        const fr = new FileReader();
        fr.onload = async (ev) => {
          try {
            const res = await fetch('/api/media/upload', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ filename: videoFile.name, dataUrl: ev.target?.result }),
            });
            if (res.ok) {
              const data = await res.json() as { url: string };
              eng.addVideo(data.url, cx, cy, videoFile.name);
            } else {
              const objUrl = URL.createObjectURL(videoFile);
              eng.addVideo(objUrl, cx, cy, videoFile.name);
            }
          } catch {
            const objUrl = URL.createObjectURL(videoFile);
            eng.addVideo(objUrl, cx, cy, videoFile.name);
          }
        };
        fr.readAsDataURL(videoFile);
        return;
      }

      if (imageFile) {
        e.preventDefault();
        const fr = new FileReader();
        fr.onload = async (ev) => {
          try {
            const res = await fetch('/api/media/upload', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ filename: imageFile.name, dataUrl: ev.target?.result }),
            });
            if (res.ok) {
              const data = await res.json() as { url: string };
              eng.addImage(data.url, cx, cy);
            } else {
              eng.addImage(ev.target?.result as string, cx, cy);
            }
          } catch {
            eng.addImage(ev.target?.result as string, cx, cy);
          }
        };
        fr.readAsDataURL(imageFile);
        return;
      }

      // 2. Check Text / URL in Clipboard
      const text = (e.clipboardData?.getData('text/plain') || '').trim();
      if (text) {
        const isUrl = /^https?:\/\/[^\s]+$/i.test(text);
        if (isUrl) {
          e.preventDefault();
          // Direct Image URL
          if (/\.(png|jpe?g|webp|gif|svg)(\?.*)?$/i.test(text)) {
            eng.addImage(text, cx, cy);
            return;
          }
          // Direct Video URL
          if (/\.(mp4|webm|ogg|mov)(\?.*)?$/i.test(text)) {
            eng.addVideo(text, cx, cy);
            return;
          }

          // Web / Social URL (YouTube, Facebook, Twitter, GitHub, etc.)
          let initialDomain = '';
          try { initialDomain = new URL(text).hostname.replace(/^www\./i, ''); } catch { /* ignore */ }
          const isYt = text.includes('youtube.com') || text.includes('youtu.be');
          let ytThumb = '';
          if (isYt) {
            const m = text.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/|youtube\.com\/shorts\/)([^"&?\/\s]{11})/i);
            if (m?.[1]) {
              ytThumb = `https://img.youtube.com/vi/${m[1]}/hqdefault.jpg`;
            }
          }

          const cardId = eng.addLinkCard(text, cx, cy, {
            status: 'loading',
            siteName: isYt ? 'YouTube' : initialDomain,
            image: ytThumb,
            mediaType: isYt ? 'video' : 'website',
          });

          void (async () => {
            try {
              const res = await fetch(`/api/link-preview?url=${encodeURIComponent(text)}`);
              if (res.ok) {
                const meta = await res.json() as {
                  title?: string;
                  description?: string;
                  image?: string;
                  favicon?: string;
                  siteName?: string;
                  mediaType?: 'website' | 'video' | 'article' | 'image';
                  embedUrl?: string;
                };
                eng.updateLinkCardMeta(cardId, {
                  status: 'ready',
                  title: meta.title,
                  description: meta.description,
                  image: meta.image || ytThumb,
                  favicon: meta.favicon,
                  siteName: meta.siteName || initialDomain,
                  mediaType: meta.mediaType,
                  embedUrl: meta.embedUrl,
                });
              } else {
                eng.updateLinkCardMeta(cardId, {
                  status: 'ready',
                  title: initialDomain || text,
                  description: text,
                  image: ytThumb,
                  siteName: initialDomain,
                  favicon: `https://www.google.com/s2/favicons?domain=${initialDomain}&sz=64`,
                });
              }
            } catch {
              eng.updateLinkCardMeta(cardId, {
                status: 'ready',
                title: initialDomain || text,
                description: text,
                image: ytThumb,
                siteName: initialDomain,
              });
            }
          })();
          return;
        }

        // Internal clipboard has copied shapes
        if (eng.hasInternalClipboard()) {
          e.preventDefault();
          eng.pasteInternal(cx, cy);
          return;
        }

        // Plain text pasted onto canvas -> create Sticky Note
        e.preventDefault();
        eng.addSticky(text, cx, cy);
        return;
      }

      // 3. Fallback: Check internal canvas clipboard
      if (eng.hasInternalClipboard()) {
        e.preventDefault();
        eng.pasteInternal(cx, cy);
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, []);

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
  const selectedConnectorDefinition = selectedConnector ? getShapeDefinition(selectedConnector.shapeId) : undefined;
  const selectedContextDefinition = selectedDefinition ?? selectedConnectorDefinition;
  const selectedContextFamilies = familyForDefinition(selectedContextDefinition);
  const selectedContextValue = selectedDiagram?.diagramContext ?? selectedConnector?.diagramContext
    ?? (selectedConnector ? engRef.current?.getSemanticContextForShape(selectedConnector.id) : undefined)
    ?? (selectedContextFamilies.length === 1 ? selectedContextFamilies[0] : '');
  const selectedCapabilities = diagramCapabilitiesFor(selectedContextDefinition, selectedContextValue || null);
  const selectedConnectorCapabilities = selectedConnector ? selectedCapabilities.connector : undefined;
  const selectedGraphIssues = selectedShape ? graphDiagnostics.filter(issue => issue.relatedIds.includes(selectedShape.id)) : [];
  const selectedStyleIsApplicable = selIds.some(id => {
    const candidate = engRef.current?.getShape(id);
    if (!candidate) return false;
    if (candidate.type === 'connector') {
      const caps = diagramCapabilitiesFor(getShapeDefinition(candidate.shapeId)).style;
      return Boolean(caps.stroke || caps.strokeWidth);
    }
    if (candidate.type === 'diagram') {
      const caps = diagramCapabilitiesFor(getShapeDefinition(candidate.shapeId)).style;
      return Boolean(caps.fill || caps.stroke || caps.strokeWidth || caps.textColor || caps.fontSize);
    }
    return true;
  });
  const selectedSolidScale = selectedDiagram && selectedDefinition?.solid3d
    ? selectedDiagram.scale3d ?? selectedDefinition.defaultScale3d ?? solid3DScaleFromBounds(selectedDiagram.w, selectedDiagram.h, selectedDefinition.width,
      selectedDefinition.height, selectedDefinition.geometry as import('./engine/shapes/solid3d').Solid3DGeometry)
    : null;
  const selectedPropertyParams = selectedPropertyShape && 'params' in selectedPropertyShape ? selectedPropertyShape.params ?? {} : {};
  const selectedPropertyText = selectedPropertyShape && 'text' in selectedPropertyShape ? selectedPropertyShape.text ?? '' : '';
  const classifierModel = selectedDiagram?.data?.classifier as UMLClassifierData | undefined;
  const classifierCompartments = Array.isArray(classifierModel?.compartments) ? classifierModel.compartments : [];
  const instanceModel = selectedDiagram?.data?.instance as UMLInstanceData | undefined;
  const instanceValues = Array.isArray(instanceModel?.values) ? instanceModel.values : [];
  const tableModel = selectedDiagram?.data?.table as { columns?: Array<TableColumnModel> } | undefined;
  const tableColumns = Array.isArray(tableModel?.columns) ? tableModel.columns : [];
  const columnModel = selectedDiagram?.data?.column as { name?: string; type?: string; key?: string } | undefined;
  const sequenceFragment = selectedDiagram?.shapeId === 'uml.frame'
    ? selectedDiagram.data?.sequenceFragment as SequenceFragmentData | undefined : undefined;
  const updateSequenceFragment = (fragment: SequenceFragmentData, commit = false) => {
    if (selectedDiagram?.shapeId === 'uml.frame')
      engRef.current?.updateDiagramData(selectedDiagram.id, { sequenceFragment: fragment as unknown as Record<string, unknown> }, commit);
  };
  const updateClassifierData = (model: UMLClassifierData, commit = false) => {
    if (selectedDiagram) engRef.current?.updateDiagramData(selectedDiagram.id, { classifier: model as unknown as Record<string, unknown> }, commit);
  };
  const patchClassifierMember = (compartmentId: string, memberId: string, patch: Record<string, unknown>, commit = false) => {
    if (!classifierModel) return;
    const compartments = classifierModel.compartments.map(compartment => compartment.id !== compartmentId ? compartment : {
      ...compartment, items: compartment.items.map(member => {
        if (member.id !== memberId) return member;
        const updated = { ...member, ...patch } as UMLClassifierMember;
        delete updated.sourceText;
        return updated;
      }),
    });
    updateClassifierData({ ...classifierModel, compartments }, commit);
  };
  const moveClassifierMember = (compartmentId: string, memberIndex: number, delta: -1 | 1) => {
    if (!classifierModel) return;
    const compartments = classifierModel.compartments.map(compartment => {
      if (compartment.id !== compartmentId) return compartment;
      const targetIndex = memberIndex + delta;
      if (targetIndex < 0 || targetIndex >= compartment.items.length) return compartment;
      const items = compartment.items.slice();
      const [member] = items.splice(memberIndex, 1);
      items.splice(targetIndex, 0, member);
      return { ...compartment, items };
    });
    updateClassifierData({ ...classifierModel, compartments }, true);
  };
  const addClassifierMember = (compartmentId: string) => {
    if (!classifierModel) return;
    const compartments = classifierModel.compartments.map(compartment => compartment.id !== compartmentId ? compartment : {
      ...compartment, items: [...compartment.items, createClassifierMember(compartment.kind, compartment.items.length) as UMLClassifierMember],
    });
    updateClassifierData({ ...classifierModel, compartments }, true);
  };
  const updateInstanceData = (model: UMLInstanceData, commit = false) => {
    if (selectedDiagram) engRef.current?.updateDiagramData(selectedDiagram.id, { instance: model as unknown as Record<string, unknown> }, commit);
  };
  const patchInstanceValue = (valueId: string, patch: Record<string, unknown>, commit = false) => {
    if (!instanceModel) return;
    const values = instanceModel.values.map(value => {
      if (value.id !== valueId) return value;
      const updated = { ...value, ...patch } as UMLInstanceValue;
      delete updated.sourceText;
      return updated;
    });
    updateInstanceData({ ...instanceModel, values }, commit);
  };
  const moveInstanceValue = (valueIndex: number, delta: -1 | 1) => {
    if (!instanceModel) return;
    const targetIndex = valueIndex + delta;
    if (targetIndex < 0 || targetIndex >= instanceModel.values.length) return;
    const values = instanceModel.values.slice();
    const [value] = values.splice(valueIndex, 1);
    values.splice(targetIndex, 0, value);
    updateInstanceData({ ...instanceModel, values }, true);
  };
  const addInstanceValue = () => {
    if (!instanceModel) return;
    updateInstanceData({ ...instanceModel, values: [...instanceModel.values,
      createClassifierMember('values', instanceModel.values.length) as UMLInstanceValue] }, true);
  };
  const updateTableData = (columns: Array<{ id?: string; name?: string; type?: string; key?: string; nullable?: boolean; default?: string }>, commit = false) => {
    if (selectedDiagram) {
      engRef.current?.updateDiagramData(selectedDiagram.id, { table: { ...(tableModel ?? {}), columns } }, commit);
      if (commit) {
        const neededHeight = Math.max(selectedDiagram.h, (columns.length + 1) * 32);
        if (neededHeight > selectedDiagram.h) {
          engRef.current?.updateSize(selectedDiagram.id, selectedDiagram.w, neededHeight);
        }
      }
    }
  };

  const addTableColumn = () => {
    const newCol: TableColumnModel = {
      id: `column-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: `column_${tableColumns.length + 1}`,
      type: 'varchar(255)',
      key: 'none',
      nullable: true,
    };
    updateTableData([...tableColumns, newCol], true);
  };

  const addSurrogateIdKey = () => {
    const hasPk = tableColumns.some(col => col.key === 'primary' || col.key === 'primary_foreign');
    if (hasPk) return;
    const idCol: TableColumnModel = {
      id: `col-id-${Date.now()}`,
      name: 'id',
      type: 'bigint',
      key: 'primary',
      nullable: false,
    };
    updateTableData([idCol, ...tableColumns], true);
  };

  const addTimestampsPreset = () => {
    const existingNames = new Set(tableColumns.map(col => col.name?.toLowerCase()));
    const toAdd: TableColumnModel[] = [];
    if (!existingNames.has('created_at')) {
      toAdd.push({
        id: `col-created-at-${Date.now()}`,
        name: 'created_at',
        type: 'timestamp',
        key: 'none',
        nullable: false,
        default: 'CURRENT_TIMESTAMP',
      });
    }
    if (!existingNames.has('updated_at')) {
      toAdd.push({
        id: `col-updated-at-${Date.now()}`,
        name: 'updated_at',
        type: 'timestamp',
        key: 'none',
        nullable: false,
        default: 'CURRENT_TIMESTAMP',
      });
    }
    if (toAdd.length > 0) {
      updateTableData([...tableColumns, ...toAdd], true);
    }
  };

  const addSoftDeletePreset = () => {
    const existingNames = new Set(tableColumns.map(col => col.name?.toLowerCase()));
    if (!existingNames.has('deleted_at')) {
      const col: TableColumnModel = {
        id: `col-deleted-at-${Date.now()}`,
        name: 'deleted_at',
        type: 'timestamp',
        key: 'none',
        nullable: true,
      };
      updateTableData([...tableColumns, col], true);
    }
  };

  const moveTableColumn = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= tableColumns.length) return;
    const updated = [...tableColumns];
    const [moved] = updated.splice(index, 1);
    updated.splice(target, 0, moved);
    updateTableData(updated, true);
  };
  const updateColumnData = (column: { name?: string; type?: string; key?: string }, commit = false) => {
    if (selectedDiagram) engRef.current?.updateDiagramData(selectedDiagram.id, { column }, commit);
  };
  const usecaseModel = selectedDiagram?.data?.usecase as UMLUseCaseData | undefined;
  const usecaseExtensionPoints = Array.isArray(usecaseModel?.extensionPoints) ? usecaseModel.extensionPoints : [];
  const updateUseCaseData = (model: UMLUseCaseData, commit = false) => {
    if (selectedDiagram) engRef.current?.updateDiagramData(selectedDiagram.id, { usecase: model as unknown as Record<string, unknown> }, commit);
  };
  const patchExtensionPoint = (pointId: string, patch: Partial<UMLExtensionPoint>, commit = false) => {
    if (!usecaseModel) return;
    const extensionPoints = (usecaseModel.extensionPoints ?? []).map(point =>
      point.id === pointId ? { ...point, ...patch } : point
    );
    updateUseCaseData({ ...usecaseModel, extensionPoints }, commit);
  };
  const moveExtensionPoint = (pointIndex: number, delta: -1 | 1) => {
    if (!usecaseModel) return;
    const targetIndex = pointIndex + delta;
    const currentPoints = usecaseModel.extensionPoints ?? [];
    if (targetIndex < 0 || targetIndex >= currentPoints.length) return;
    const items = currentPoints.slice();
    const [point] = items.splice(pointIndex, 1);
    items.splice(targetIndex, 0, point);
    updateUseCaseData({ ...usecaseModel, extensionPoints: items }, true);
  };
  const addExtensionPoint = () => {
    const current = usecaseModel ?? { version: 1, extensionPoints: [] };
    const currentPoints = current.extensionPoints ?? [];
    const newPoint: UMLExtensionPoint = {
      id: `ep:${Date.now()}:${currentPoints.length + 1}`,
      name: `point_${currentPoints.length + 1}`,
      explanation: '',
    };
    updateUseCaseData({ ...current, extensionPoints: [...currentPoints, newPoint] }, true);
  };
  const deleteExtensionPoint = (pointId: string) => {
    if (!usecaseModel) return;
    const extensionPoints = (usecaseModel.extensionPoints ?? []).filter(p => p.id !== pointId);
    updateUseCaseData({ ...usecaseModel, extensionPoints }, true);
  };

  const subjectBoundaryModel = selectedDiagram?.data?.subjectBoundary as UMLSubjectBoundaryData | undefined;
  const updateSubjectBoundaryData = (model: UMLSubjectBoundaryData, commit = false) => {
    if (selectedDiagram) engRef.current?.updateDiagramData(selectedDiagram.id, { subjectBoundary: model as unknown as Record<string, unknown> }, commit);
  };

  const zoomBy = (d: number) => { const e = engRef.current; if (!e) return; e.setCamera(e.cam.x, e.cam.y, Math.max(.04, Math.min(16, e.cam.zoom + d))); };
  const resetZoom = () => engRef.current?.setCamera(0, 0, 1);

  return (
    <div className="app-shell flex flex-col overflow-hidden select-none" style={{
      '--aw-cursor-pointer': customCursors.pointer,
      '--aw-cursor-text': customCursors.text,
      '--aw-cursor-grab': customCursors.grab,
      '--aw-cursor-grabbing': customCursors.grabbing,
      '--aw-cursor-move': customCursors.move,
    } as React.CSSProperties}>

      {/* ══ TOPBAR (MIRO INSPIRED) ══════════════════════════════════════════ */}
      <header className="app-header">
        <div className="header-brand">
          <div className="brand-logo-container">
            <svg className="brand-mark" width="30" height="30" viewBox="0 0 64 64" fill="none" aria-label="Antiwhite logo">
              <defs>
                <linearGradient id="hdrAwBg" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor="#E0F7FA"/>
                  <stop offset="100%" stopColor="#BAE6FD"/>
                </linearGradient>
                <filter id="hdrAwWShadow" x="-20%" y="-20%" width="140%" height="140%">
                  <feDropShadow dx="0" dy="1.5" stdDeviation="1.5" floodColor="#0f172a" floodOpacity="0.38"/>
                </filter>
                <filter id="hdrAwAShadow" x="-20%" y="-20%" width="140%" height="140%">
                  <feDropShadow dx="0" dy="1" stdDeviation="1" floodColor="#991b1b" floodOpacity="0.25"/>
                </filter>
              </defs>
              <circle cx="32" cy="32" r="29.5" fill="url(#hdrAwBg)" stroke="#38BDF8" strokeWidth="2.5"/>
              <circle cx="32" cy="32" r="27" fill="none" stroke="#0EA5E9" strokeWidth="0.75" strokeOpacity="0.35"/>
              <path d="M32 10.5L48.5 51.5H39.8L35.7 40H28.3L24.2 51.5H15.5L32 10.5ZM32 23.5L29.6 33.2H34.4L32 23.5Z" 
                    fill="#DC2626" fillRule="evenodd" filter="url(#hdrAwAShadow)"/>
              <path d="M19.5 31.5L25.8 49L32 35.5L38.2 49L44.5 31.5" 
                    stroke="#FFFFFF" strokeWidth="4.8" strokeLinecap="round" strokeLinejoin="round" filter="url(#hdrAwWShadow)"/>
            </svg>
          </div>
          <div className="header-brand-info">
            <span className="header-brand-label">Antiwhite</span>
          </div>
        </div>

        <span className="header-divider" aria-hidden="true" />

        <div className="header-board">
          <span className="header-breadcrumb">Boards</span>
          <span className="header-crumb-separator" aria-hidden="true">/</span>
          {editName && !isReadOnly ? (
            <input ref={nameRef} value={boardName} aria-label="Board name"
              onChange={e => setBoardName(e.target.value || 'Untitled')}
              onBlur={() => setEditName(false)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); setEditName(false); } }}
              className="header-name-input"
              autoFocus />
          ) : (
            <button onClick={() => { if (!isReadOnly) { setEditName(true); setTimeout(() => nameRef.current?.select(), 15); } }}
              className={`header-board-name group ${isReadOnly ? 'cursor-default' : ''}`} title={isReadOnly ? 'Board name (Read only)' : 'Click to rename board'}>
              <span className="header-board-title">{boardName}</span>
              {!isReadOnly && <ChevronDown size={13} className="header-board-chevron" aria-hidden="true" />}
            </button>
          )}

          <button type="button" onClick={() => setIsFavorite(v => !v)}
            className={`header-star-btn${isFavorite ? ' active' : ''}`}
            title={isFavorite ? 'Remove from favorites' : 'Mark as favorite'}
            aria-label="Star board">
            <Star size={14} className={isFavorite ? 'fill-amber-400 text-amber-500' : 'text-gray-400'} />
          </button>

          <div className="header-sync-status" title="All changes saved locally &amp; synced">
            <span className="header-sync-dot" />
            <span className="header-sync-text">Saved</span>
          </div>

          {isReadOnly && (
            <div className="header-role-badge" title={userRole === 'viewer' ? 'View only: You cannot modify this board' : 'Comment only: You can view and leave reactions'}>
              <Lock size={12} className="text-amber-600 flex-shrink-0" />
              <span>{userRole === 'viewer' ? 'View only' : 'Comment only'}</span>
            </div>
          )}
        </div>

        <div className="header-spacer" />

        <div className="header-presence" role="region" aria-label="Online collaborators">
          <div className="presence-avatars">
            {/* The Local User (You) - Always visible in the presence stack (Slot 1 of max 3) */}
            <div
              className="presence-avatar is-self"
              style={{
                background: collabUser ? collabUser.gradient : 'linear-gradient(135deg, #2563eb, #1d4ed8)',
                zIndex: 20,
              }}
              title={`You (${collabUser ? collabUser.name : 'Active'})`}
              aria-label={`You (${collabUser ? collabUser.name : 'Active'})`}
            >
              <span>{collabUser ? collabUser.avatarLabel : 'U'}</span>
              <span className="presence-self-dot" />
              <div className="presence-avatar-tooltip">
                You ({collabUser ? collabUser.name : 'Active'})
              </div>
            </div>

            {/* Remote Peers in Overlapping Stack (Up to 2 peers, keeping max 3 avatar slots) */}
            {collabPeers.slice(0, 2).map((peer, idx) => {
              const isFollowed = followingPeerId === peer.clientId;
              return (
                <button
                  key={peer.clientId}
                  type="button"
                  className={`presence-avatar ${isFollowed ? 'is-following' : ''}`}
                  style={{
                    background: peer.user.gradient,
                    zIndex: 19 - idx,
                    cursor: 'pointer',
                  }}
                  title={`${peer.user.name} (Active) — ${isFollowed ? 'Click to stop following' : 'Click to follow screen'}`}
                  aria-label={`${peer.user.name} — ${isFollowed ? 'Stop following' : 'Follow screen'}`}
                  aria-pressed={isFollowed}
                  onClick={() => {
                    if (isFollowed) {
                      setFollowingPeerId(null);
                    } else {
                      setFollowingPeerId(peer.clientId);
                      if (peer.cursor && engRef.current) {
                        engRef.current.panTo(peer.cursor.x, peer.cursor.y);
                      }
                    }
                  }}
                >
                  <span>{peer.user.avatarLabel}</span>
                  <div className="presence-avatar-tooltip">
                    {peer.user.name}{peer.presenter?.active ? ' (Presenting)' : ''}{isFollowed ? ' (Following)' : ''}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Miro-style Overflow Collaborators Dropdown (When > 2 remote peers, max 3 slots exceeded) */}
          {collabPeers.length > 2 && (
            <div className="relative inline-flex items-center" ref={morePeersRef}>
              <button
                type="button"
                className={`presence-more-btn ${showMorePeers ? 'is-open' : ''}`}
                title={`${collabPeers.length - 2} more collaborators online`}
                aria-label={`View ${collabPeers.length - 2} more collaborators`}
                aria-expanded={showMorePeers}
                onClick={() => setShowMorePeers(prev => !prev)}
              >
                <span>+{collabPeers.length - 2}</span>
                <ChevronDown size={12} className={`presence-more-chevron ${showMorePeers ? 'rotate-180' : ''}`} />
              </button>

              {showMorePeers && (
                <div className="presence-dropdown-menu" role="menu">
                  <div className="presence-dropdown-header">
                    Collaborators ({collabPeers.length + 1})
                  </div>
                  <div className="presence-dropdown-list">
                    {/* Local User */}
                    <div className="presence-dropdown-item is-self">
                      <div
                        className="presence-dropdown-avatar"
                        style={{ background: collabUser ? collabUser.gradient : 'linear-gradient(135deg, #2563eb, #1d4ed8)' }}
                      >
                        {collabUser ? collabUser.avatarLabel : 'U'}
                        <span className="presence-self-dot" />
                      </div>
                      <div className="presence-dropdown-info">
                        <span className="presence-dropdown-name">{collabUser ? collabUser.name : 'You'} (You)</span>
                        <span className="presence-dropdown-status">Active now</span>
                      </div>
                    </div>

                    {/* All Remote Collaborators */}
                    {collabPeers.map(peer => {
                      const isFollowed = followingPeerId === peer.clientId;
                      const isPresenting = peer.presenter?.active;
                      return (
                        <button
                          key={peer.clientId}
                          type="button"
                          className={`presence-dropdown-item ${isFollowed ? 'is-following' : ''}`}
                          onClick={() => {
                            if (isFollowed) {
                              setFollowingPeerId(null);
                            } else {
                              setFollowingPeerId(peer.clientId);
                              if (peer.cursor && engRef.current) {
                                engRef.current.panTo(peer.cursor.x, peer.cursor.y);
                              }
                            }
                            setShowMorePeers(false);
                          }}
                        >
                          <div
                            className="presence-dropdown-avatar"
                            style={{ background: peer.user.gradient }}
                          >
                            {peer.user.avatarLabel}
                          </div>
                          <div className="presence-dropdown-info">
                            <span className="presence-dropdown-name">{peer.user.name}</span>
                            <span className="presence-dropdown-status">
                              {isPresenting ? '📢 Presenting' : isFollowed ? '👀 Following' : 'Click to follow'}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <span className="header-action-divider" aria-hidden="true" />

        <div className="header-actions">
          <button
            type="button"
            onClick={togglePresenting}
            title={isPresenting ? 'Stop presenting board to collaborators' : 'Present board to everyone (Bring everyone to me)'}
            aria-label={isPresenting ? 'Stop presenting' : 'Start presenting'}
            aria-pressed={isPresenting}
            className={`header-action header-action-secondary ${isPresenting ? 'is-presenting' : ''}`}
          >
            <Play size={13} strokeWidth={2.4} className="fill-current" />
            <span className="header-action-label">{isPresenting ? 'Stop' : 'Present'}</span>
          </button>
          <button
            type="button"
            onClick={() => setIsShareModalOpen(true)}
            title="Share board with collaborators"
            aria-label="Share board"
            className="header-action header-action-share"
          >
            <Share2 size={13} strokeWidth={2.4} />
            <span className="header-action-label">Share</span>
          </button>
        </div>
      </header>

      {/* Share Board Dialog */}
      <ShareModal
        isOpen={isShareModalOpen}
        onClose={() => setIsShareModalOpen(false)}
        boardId={BOARD_ID}
        collabPeers={collabPeers}
        collabUser={collabUser}
        onRoleChange={(targetClientId, role) => {
          broadcastCollabRoleOverride(targetClientId, role);
        }}
      />

      {/* Miro-style Collaborative Follow & Presenter Floating Overlays */}
      {takeoverNotice && (
        <div className="presentation-takeover-toast" role="status" aria-live="polite">
          <span className="takeover-icon">📢</span>
          <span>{takeoverNotice}</span>
        </div>
      )}

      {followingPeer && (
        <div className="following-collab-pill" role="status" aria-live="polite">
          <span className="following-pulse-dot" style={{ backgroundColor: followingPeer.user.color }} />
          <span>Following <strong>{followingPeer.user.name}</strong></span>
          <button
            type="button"
            className="following-stop-btn"
            onClick={() => setFollowingPeerId(null)}
            aria-label="Stop following collaborator"
          >
            Stop
          </button>
        </div>
      )}

      {isPresenting && (
        <div className="presenting-indicator-pill" role="status" aria-live="polite">
          <span className="presenting-pulse-dot" />
          <span>You are presenting to everyone</span>
          <button
            type="button"
            className="presenting-stop-btn"
            onClick={togglePresenting}
            aria-label="Stop presenting"
          >
            Stop
          </button>
        </div>
      )}

      {!isPresenting && activeRemotePresenter?.presenter && followingPresenter && (
        <div className="presenting-indicator-pill" role="status" aria-live="polite">
          <span className="presenting-pulse-dot" />
          <span><strong>{activeRemotePresenter.user.name}</strong> is presenting</span>
          <button
            type="button"
            className="presenting-stop-btn"
            onClick={() => setFollowingPresenter(false)}
            aria-label="Leave presentation"
          >
            Leave
          </button>
        </div>
      )}

      {/* ══ BODY ════════════════════════════════════════════════════════════ */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* SIDEBAR (MIRO FLOATING/DOCKED TOOL RAIL WITH LARGER ICONS) */}
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
              <SideBtn label="Select Tools" shortcut="V" active={['select', 'lasso-select'].includes(tool)} expanded={openGroup === 'select'} hasSubmenu
                onClick={() => { const next = openGroup === 'select' ? null : 'select'; setOpenGroup(next); if (next) setTool(lastSelectTool, true); }}>
                {(() => {
                  const active = ['select', 'lasso-select'].includes(tool) ? tool : lastSelectTool;
                  const entry = SELECT_TOOLS.find(t => t.id === active);
                  return entry ? <entry.Icon size={23} strokeWidth={2} /> : <MousePointer2 size={23} strokeWidth={2} />;
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

            {!isReadOnly && (
              <>
                <div className="tool-divider" aria-hidden="true" />

                {/* PEN GROUP */}
                <div ref={el => { popoverAnchorRefs.current.pen = el }} className="tool-group">
                  <SideBtn label="Pen &amp; Smart Drawing" shortcut="P" active={tool === 'pen'} expanded={openGroup === 'pen'} hasSubmenu
                    onClick={() => { const next = openGroup === 'pen' ? null : 'pen'; setOpenGroup(next); if (next) setTool('pen', true); }}>
                    {penMode === 'smart' ? <Sparkles size={23} strokeWidth={2} /> : <PenLine size={23} strokeWidth={2} />}
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

                {/* ERASER */}
                <SideBtn label="Eraser" shortcut="E" active={tool === 'eraser'} onClick={() => setTool('eraser')}>
                  <Eraser size={23} strokeWidth={2} />
                </SideBtn>

                <div className="tool-divider" aria-hidden="true" />

                {/* STICKY */}
                <SideBtn label="Sticky Note" shortcut="S" active={tool === 'sticky'} onClick={() => setTool('sticky')}>
                  <StickyNote size={23} strokeWidth={2} />
                </SideBtn>

                {/* TEXT GROUP */}
                <div ref={el => { popoverAnchorRefs.current.text = el }} className="tool-group">
                  <SideBtn label="Text, Math &amp; Code" shortcut="T" active={['text', 'math', 'code'].includes(tool)} expanded={openGroup === 'text'} hasSubmenu
                    onClick={() => { const next = openGroup === 'text' ? null : 'text'; setOpenGroup(next); if (next) setTool(lastTextTool, true); }}>
                    {(() => {
                      const active = ['text', 'math', 'code'].includes(tool) ? tool : lastTextTool;
                      if (active === 'math') return <Calculator size={23} strokeWidth={2} />;
                      if (active === 'code') return <Code size={23} strokeWidth={2} />;
                      return <Type size={23} strokeWidth={2.2} />;
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
                  <SideBtn label="Shapes &amp; UML" shortcut="O" active={SHAPE_TOOLS.some(s => s.id === tool)} expanded={openGroup === 'shapes'} hasSubmenu
                    onClick={() => { const next = openGroup === 'shapes' ? null : 'shapes'; setOpenGroup(next); if (next) setTool(lastShapeTool, true); }}>
                    {(() => {
                      const active = SHAPE_TOOLS.some(s => s.id === tool) ? tool : lastShapeTool;
                      const entry = SHAPE_TOOLS.find(s => s.id === active) ?? SHAPE_TOOLS[0];
                      return <ShapePreview definition={entry.definition} size={25} />;
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
                            onClick={() => { setShapeCategory(category); setShapeSearch(''); engRef.current?.setDiagramContext(umlFamilyForCategory(category)); }} title={category}>
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
                              shapeId={definition.id} grid={true} solid3d={Boolean(definition.solid3d)}
                              onClick={() => choosePopoverTool(id, shapeSearchNeedle ? definition.category : shapeCategory)} />
                          ))}
                        </div>
                      ) : <div className="shape-library-empty">No matching shapes.</div>}
                    </div>
                  )}
                </div>

                <div className="tool-divider" aria-hidden="true" />
                <SideBtn label="Upload Image" shortcut="I" onClick={onImageToolClick}>
                  <ImageIcon size={23} strokeWidth={2} />
                </SideBtn>
              </>
            )}
          </div>
          {!isReadOnly && (
            <div className="tool-stack tool-stack-bottom">
              <div className="tool-divider" aria-hidden="true" />
              <SideBtn label="Colors &amp; Styles" active={panelOpen} expanded={panelOpen} buttonRef={panelTriggerRef} onClick={() => setPanelOpen(v => !v)}>
                <div className="sidebar-palette-swatch" style={{ borderColor: panelOpen ? '#4262FF' : 'rgba(0, 0, 0, 0.14)' }}>
                  <div className="sidebar-palette-fill" style={{ background: penColor }} />
                </div>
              </SideBtn>
              <SideBtn label="Undo" shortcut="Ctrl+Z" onClick={() => engRef.current?.undo()}>
                <Undo2 size={21} strokeWidth={2} />
              </SideBtn>
              <SideBtn label="Redo" shortcut="Ctrl+Y" onClick={() => engRef.current?.redo()}>
                <Redo2 size={21} strokeWidth={2} />
              </SideBtn>
            </div>
          )}
        </aside>

        {/* CANVAS AREA */}
        <div ref={wrapRef} className="canvas-workspace relative flex-1 min-w-0 min-h-0 overflow-hidden" style={{ cursor: renderedCursor }}
          onPointerDown={e => {
            const eng = engRef.current; if (!eng) return;
            // If any sidebar popover or flyout panel is open, clicking canvas dismisses it first,
            // without immediately drawing or creating an object on the board!
            if (openGroupRef.current !== null || document.querySelector('.tool-popover')) {
              setOpenGroup(null);
              return;
            }
            // Right- and middle-button gestures are camera-only, regardless of the active drawing tool.
            if (e.button === 2 || e.button === 1) {
              canvasRef.current?.focus({ preventScroll: true });
              eng.pointerDown(e.nativeEvent);
              return;
            }
            if (e.button !== 0) return;
            if (tool === 'image') {
              imgPosRef.current = { x: e.clientX, y: e.clientY };
              fileRef.current?.click();
              return;
            }

            // Check if this pointerdown just triggered a commit from blur / window capture on an active editor
            const justCommitted = justCommittedShapeRef.current;
            if (justCommitted && performance.now() - justCommitted.time < 220) {
              const w = eng.clientToWorld(e.clientX, e.clientY);
              const hit = eng.hitShape(w.x, w.y);
              justCommittedShapeRef.current = null;
              if (!hit || hit.id === justCommitted.id) {
                // Click on empty board: swallow to preserve the finished shape's selected state!
                e.stopPropagation();
                e.preventDefault();
                return;
              }
            }

            // If an object is actively being edited and user clicks on canvas:
            if (editShapeRef.current) {
              const editingId = editShapeRef.current.id;
              const w = eng.clientToWorld(e.clientX, e.clientY);
              const hit = eng.hitShape(w.x, w.y);
              if (!hit || hit.id === editingId) {
                commitEdit();
                if (eng.tool !== 'select') {
                  eng.setTool('select', true);
                  setTool('select', false, undefined, true, true);
                }
                eng.sel.clear();
                eng.sel.add(editingId);
                eng.onSel?.([editingId]);
                setSelectedShape(eng.getShape(editingId) ?? null);
                e.stopPropagation();
                e.preventDefault();
                return;
              } else {
                commitEdit();
                if (eng.tool !== 'select') {
                  eng.setTool('select', true);
                  setTool('select', false, undefined, true, true);
                }
              }
            }

            // The engine's DOM content overlays are siblings of the canvas and do not focus it
            // automatically. Explicitly make board shortcuts available after any board interaction.
            canvasRef.current?.focus({ preventScroll: true });
            const target = e.target as HTMLElement;
            const sticky = target.closest('[id^="ol_"]');
            if (sticky && (sticky as HTMLElement).scrollHeight > (sticky as HTMLElement).clientHeight) {
              const rect = sticky.getBoundingClientRect();
              if (e.clientX >= rect.right - 20) return;
            }
            if (followingPeerIdRef.current) setFollowingPeerId(null);
            eng.pointerDown(e.nativeEvent);
            if (eng.isDrawingActive()) {
              const world = eng.clientToWorld(e.clientX, e.clientY);
              lastMouseWorldPosRef.current = world;
              broadcastCollabCursor(world, true);
            }
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

          <RemoteCursorsOverlay engine={engRef.current} camera={cam} />

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
              <div className={`relative group/editbox ${editShape.type === 'sticky' ? 'is-sticky-box' : ''}`} style={{
                width: editBox.w / zoom,
                height: editBox.h / zoom,
                boxSizing: 'border-box',
                boxShadow: editShape.type === 'sticky' ? '0 0 0 1px #2563eb, 0 12px 48px rgba(0,0,0,0.18)' : editShape.type === 'code' ? '0 12px 64px rgba(0,0,0,0.45)' : 'none',
                borderRadius: editShape.type === 'sticky' ? 4 : editShape.type === 'code' ? 6 : 4,
                overflow: 'hidden',
                display: editShape.type === 'sticky' ? 'flex' : 'block',
                flexDirection: editShape.type === 'sticky' ? 'column' : undefined,
                background: editShape.type === 'sticky' ? (editShape as StickyShape).bg : editShape.type === 'code' ? '#1b2430' : 'transparent',
                border: editShape.type === 'sticky' ? '2px solid #2563eb' : 'none',
              }}>
                {editShape.type === 'sticky' && (
                  <div className="sticky-dog-ear" style={{
                    position: 'absolute', top: 0, right: 0, width: 16, height: 16,
                    background: 'rgba(0,0,0,0.10)', clipPath: 'polygon(100% 0, 0 0, 100% 100%)',
                    zIndex: 5, pointerEvents: 'none',
                  }} />
                )}

                {editShape.type === 'text' && (
                  <div style={{
                    position: 'absolute', inset: -3 / zoom,
                    border: `${1.5 / zoom}px solid #3b82f6`,
                    borderRadius: 3 / zoom, pointerEvents: 'none', zIndex: 10,
                  }} />
                )}

                {editShape.type === 'code' ? (
                  <React.Suspense fallback={<div className="code-editor-loading">Loading code editor…</div>}>
                    <CodeEditor
                      key={editShape.id}
                      value={editText}
                      language={editLanguage}
                      initialCursor={codeEditorInitialCursor}
                      fontSize={editShapeFontSize}
                      onChange={value => {
                        editTextRef.current = value;
                        setEditText(value);
                        engRef.current?.updateCodeLive(editShape.id, value, editLanguageRef.current);
                      }}
                      onLayout={height => engRef.current?.updateCodeLayoutLive(editShape.id, height)}
                      onLanguageChange={language => {
                        editLanguageRef.current = language;
                        setEditLanguage(language);
                        engRef.current?.updateCodeLive(editShape.id, editTextRef.current, language);
                      }}
                      onCommit={commitEdit}
                    />
                  </React.Suspense>
                ) : (
                  <>
                    {editShape.type === 'sticky' && (editShape as StickyShape).createdAt && (
                      <div className="sticky-editor-timestamp" style={{
                        padding: '12px 16px 4px',
                        fontSize: '10.5px',
                        opacity: 0.65,
                        fontWeight: 550,
                        color: 'rgba(15,23,42,0.85)',
                        fontFamily: "'Inter',system-ui,sans-serif",
                        fontVariantNumeric: 'tabular-nums',
                        userSelect: 'none',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        lineHeight: 1.2,
                        flexShrink: 0,
                      }}>
                        <Clock size={11} strokeWidth={2.2} style={{ opacity: 0.75, flexShrink: 0 }} />
                        <span>{(editShape as StickyShape).createdAt}</span>
                      </div>
                    )}
                    <textarea
                    className={`board-text-editor ${editShape.type === 'sticky' ? 'is-sticky-editor' : ''}`}
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
                      editTextRef.current = value;
                      setEditText(value);
                      const engine = engRef.current;
                      if (!editingClassifierContextRef.current && !editingErContextRef.current && !editingUsecaseExtContextRef.current) {
                        engine?.updateTextLive(editShape.id, value);
                        if (editShape.type !== 'sticky' && !isFixedShapeLabel(editShape) && engine) {
                          const fs = shapeFontSize(editShape);
                          const measured = measureCanvasText(value, `${fs}px 'Inter',system-ui,sans-serif`, false, 1.35);
                          const width = Math.max(60, measured.w + 24);
                          const height = Math.max(28, measured.h + 16);
                          setEditBox(previous => ({ ...previous, w: width * zoom, h: height * zoom }));
                          engine.updateSize(editShape.id, width, height);
                        }
                      } else if (editingClassifierContextRef.current?.target === 'header'
                        || editingErContextRef.current?.target === 'header'
                        || editingUsecaseExtContextRef.current?.target === 'header') {
                        engine?.updateTextLive(editShape.id, value);
                      }
                    }}
                    onBlur={() => commitEdit()}
                    onKeyDown={event => {
                      if (event.key === 'Escape') { event.preventDefault(); commitEdit(); return; }
                      if (editingErContextRef.current && editingErContextRef.current.target === 'column') {
                        if (event.key === 'Enter' && !event.shiftKey) {
                          event.preventDefault();
                          commitAndAdvanceErTableColumn();
                          return;
                        }
                        if (event.key === 'Tab') {
                          event.preventDefault();
                          if (event.shiftKey) {
                            navigateErTableColumn('up');
                          } else {
                            const advanced = navigateErTableColumn('down');
                            if (!advanced) {
                              commitAndAdvanceErTableColumn();
                            }
                          }
                          return;
                        }
                        if (event.key === 'ArrowUp') {
                          if (navigateErTableColumn('up')) {
                            event.preventDefault();
                            return;
                          }
                        }
                        if (event.key === 'ArrowDown') {
                          if (navigateErTableColumn('down')) {
                            event.preventDefault();
                            return;
                          }
                        }
                      }
                      if (event.key === 'Enter' && !event.shiftKey && editShape.type === 'diagram'
                        && !['uml.note', 'uml.use-case-ext'].includes((editShape as DiagramShape).shapeId)) {
                        event.preventDefault();
                        if (editingClassifierContextRef.current && editingClassifierContextRef.current.target !== 'header') {
                          commitAndAdvanceClassifierMember();
                        } else {
                          commitEdit();
                        }
                      }
                    }}
                    style={{
                      width: '100%',
                      height: '100%',
                      flex: editShape.type === 'sticky' ? '1 1 0%' : undefined,
                      minHeight: editShape.type === 'sticky' ? 0 : undefined,
                      background: (editingClassifierContextRef.current && editingClassifierContextRef.current.target !== 'header')
                        || (editingErContextRef.current && editingErContextRef.current.target === 'column')
                        || (editingUsecaseExtContextRef.current && editingUsecaseExtContextRef.current.target === 'extension-points')
                        ? '#ffffff'
                        : 'transparent',
                      fontSize: editingClassifierContextRef.current
                        ? editingClassifierContextRef.current.fontSize
                        : editingErContextRef.current?.fontSize
                        ? editingErContextRef.current.fontSize
                        : shapeFontSize(editShape),
                      padding: (editingClassifierContextRef.current && editingClassifierContextRef.current.target !== 'header')
                        || (editingErContextRef.current && editingErContextRef.current.target === 'column')
                        || (editingUsecaseExtContextRef.current && editingUsecaseExtContextRef.current.target === 'extension-points')
                        ? '1px 6px'
                        : editShape.type === 'diagram' && ['uml.use-case', 'uml.use-case-ext'].includes((editShape as DiagramShape).shapeId)
                        ? `${Math.max(4, (editBox.h / zoom - shapeFontSize(editShape) * 1.35) / 2)}px 12px 4px`
                        : editShape.type === 'diagram' && ['uml.system-boundary'].includes((editShape as DiagramShape).shapeId)
                        ? `${Math.max(2, (editBox.h / zoom - shapeFontSize(editShape) * 1.35) / 2)}px 8px`
                        : editShape.type === 'diagram' && ['uml.lifeline'].includes((editShape as DiagramShape).shapeId)
                        ? `${Math.max(2, (editBox.h / zoom - shapeFontSize(editShape) * 1.35) / 2)}px 4px`
                        : editShape.type === 'diagram' && ['uml.sequence-actor', 'uml.boundary', 'uml.control', 'uml.entity'].includes((editShape as DiagramShape).shapeId)
                        ? '4px 4px'
                        : editShape.type === 'diagram' && ['uml.class', 'uml.abstract-class', 'uml.interface', 'uml.enumeration', 'uml.object'].includes((editShape as DiagramShape).shapeId)
                        ? `${Math.max(4, (editBox.h / zoom - shapeFontSize(editShape) * 1.35) / 2)}px 8px 4px`
                        : editShape.type === 'diagram' && (editShape as DiagramShape).shapeId === 'uml.actor'
                        ? '4px 6px'
                        : editShape.type === 'diagram' && ['uml.package', 'uml.module', 'uml.frame'].includes((editShape as DiagramShape).shapeId)
                        ? '2px 6px'
                        : editShape.type === 'diagram' && (
                            ['erd.identifying-relationship', 'erd.relationship', 'erd.entity', 'erd.weak-entity', 'erd.associative-entity'].includes((editShape as DiagramShape).shapeId)
                            || getShapeDefinition((editShape as DiagramShape).shapeId)?.geometry === 'diamond'
                            || getShapeDefinition((editShape as DiagramShape).shapeId)?.geometry === 'ellipse'
                          )
                        ? `${Math.max(2, (editBox.h / zoom - shapeFontSize(editShape) * 1.35) / 2)}px 6px`
                        : editShape.type === 'diagram' && (editShape as DiagramShape).shapeId === 'uml.note'
                        ? '8px 8px'
                        : editShape.type === 'sticky'
                        ? ((editShape as StickyShape).createdAt ? '0px 16px 14px 16px' : '14px 16px 14px 16px')
                        : editShape.type === 'text'
                        ? '8px 12px'
                        : 8,
                      fontFamily: "'Inter',system-ui,sans-serif",
                      fontWeight: (editingClassifierContextRef.current && editingClassifierContextRef.current.target !== 'header')
                        || (editingErContextRef.current && editingErContextRef.current.target === 'column')
                        ? 400
                        : editShape.type === 'diagram' ? 600 : 'normal',
                      fontStyle: editShape.type === 'diagram' && (editShape as DiagramShape).shapeId === 'uml.abstract-class' && (!editingClassifierContextRef.current || editingClassifierContextRef.current.target === 'header') ? 'italic' : 'normal',
                      color: isFixedShapeLabel(editShape) ? shapeTextColor(editShape) : editShape.type === 'text' ? (shapeTextColor(editShape) || ('color' in editShape && typeof editShape.color === 'string' ? editShape.color : '#1e293b')) : 'rgba(0,0,0,0.88)',
                      caretColor: '#2563eb', lineHeight: 1.35, boxSizing: 'border-box', resize: 'none',
                      outline: 'none',
                      border: (editingClassifierContextRef.current && editingClassifierContextRef.current.target !== 'header')
                        || (editingErContextRef.current && editingErContextRef.current.target === 'column')
                        || (editingUsecaseExtContextRef.current && editingUsecaseExtContextRef.current.target === 'extension-points')
                        ? '1.5px solid #2563eb'
                        : 'none',
                      borderRadius: 3,
                      boxShadow: (editingClassifierContextRef.current && editingClassifierContextRef.current.target !== 'header')
                        || (editingErContextRef.current && editingErContextRef.current.target === 'column')
                        || (editingUsecaseExtContextRef.current && editingUsecaseExtContextRef.current.target === 'extension-points')
                        ? '0 1px 4px rgba(37,99,235,0.25)' : 'none',
                      display: 'block', whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word', overflowWrap: 'break-word', overflowX: 'hidden',
                      textAlign: editingClassifierContextRef.current ? editingClassifierContextRef.current.textAlign
                        : editingErContextRef.current && editingErContextRef.current.target === 'column' ? 'left'
                        : editShape.type === 'diagram' && ['uml.note', 'uml.package', 'uml.module', 'uml.frame'].includes((editShape as DiagramShape).shapeId)
                        ? 'left'
                        : isFixedShapeLabel(editShape) || (editShape.type === 'diagram' && (
                            [
                              'uml.system-boundary', 'uml.actor', 'uml.use-case',
                              'uml.lifeline', 'uml.sequence-actor', 'uml.boundary', 'uml.control', 'uml.entity',
                              'uml.class', 'uml.abstract-class', 'uml.interface', 'uml.enumeration', 'uml.object',
                              'erd.identifying-relationship', 'erd.relationship', 'erd.entity', 'erd.weak-entity', 'erd.associative-entity'
                            ].includes((editShape as DiagramShape).shapeId)
                            || getShapeDefinition((editShape as DiagramShape).shapeId)?.geometry === 'diamond'
                            || getShapeDefinition((editShape as DiagramShape).shapeId)?.geometry === 'ellipse'
                          )) ? 'center' : 'left',
                      overflowY: editShape.type === 'sticky' ? 'auto' : 'hidden',
                    }}
                  />
                </>
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
                initialWidth={editShape.w}
                initialHeight={editShape.h}
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
          {selIds.length > 0 && !editShape && !isReadOnly && (tool === 'select' || tool === 'lasso-select') && (
            <div className="selection-toolbar toolbar no-canvas absolute top-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-1
                            bg-white rounded-xl shadow-md px-3 py-1.5 border border-gray-200">
              <span className="text-[11px] text-gray-600 font-medium pr-2 border-r border-gray-200">{selIds.length} selected</span>
              <button onClick={() => engRef.current?.dupSel()}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] font-medium rounded-lg hover:bg-gray-50 text-gray-700 transition-colors">
                <Copy size={13} /> Duplicate
              </button>
              {selectedStyleIsApplicable && <button onClick={() => { const ids = [...engRef.current!.sel]; engRef.current?.updateStyle(ids, { fill, stroke, sw }); }}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] font-medium rounded-lg hover:bg-gray-50 text-gray-700 transition-colors">
                <Palette size={13} /> Style
              </button>}
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
                <div><strong id="shape-properties-title">{selectedDefinition?.label ?? selectedConnectorDefinition?.label ?? 'Object'} properties</strong><span>{selectedDefinition?.category ?? selectedConnectorDefinition?.category ?? 'Canvas object'}</span></div>
                <button type="button" onClick={() => closeShapeProperties(true)} aria-label="Close shape properties"><X size={15} /></button>
              </div>
              <div className="shape-properties-body">
                {(selectedDiagram || selectedConnector) && selectedContextDefinition?.semantic?.notation === 'uml' && <>
                  <section className="shape-property-section">
                    <h4>Diagram context</h4>
                    <label className="shape-property-field"><span>Interpret this object in</span>
                      <select aria-label="Diagram context" value={selectedContextValue}
                        onChange={event => {
                          const ok = engRef.current?.updateDiagramContext(selectedShape!.id, (event.target.value || null) as UMLDiagramFamily | null);
                          setSemanticEditNotice(ok ? null : 'Context change was rejected because it conflicts with the object role or current graph.');
                        }}>
                        <option value="">Automatic</option>
                        {selectedContextFamilies.map(family => <option key={family} value={family}>{UML_FAMILY_LABELS[family]}</option>)}
                      </select>
                    </label>
                  </section>
                  {semanticEditNotice && <p role="status" className="shape-property-diagnostic invalid">{semanticEditNotice}</p>}
                  {selectedGraphIssues.length > 0 && <section className="shape-property-section" aria-label="Graph diagnostics">
                    <h4>Graph diagnostics</h4>
                    {selectedGraphIssues.map(issue => <p key={`${issue.id}:${issue.code}`} className={`shape-property-diagnostic ${issue.severity}`}>
                      <strong>{issue.severity === 'invalid' ? 'Invalid' : 'Incomplete'}{issue.family ? ` · ${UML_FAMILY_LABELS[issue.family]}` : ''}</strong>
                      <span>{issue.message}</span>
                    </p>)}
                  </section>}
                </>}
                {selectedPropertyShape && selectedDefinition && <>
                  {selectedCapabilities.text.editable === true && <label className="shape-property-field"><span>Name / label</span>
                    <input value={selectedPropertyText} aria-label="Shape name or label" data-semantic-edit-target
                      onChange={event => engRef.current?.updateTextLive(selectedPropertyShape.id, event.target.value)}
                      onBlur={event => engRef.current?.updateText(selectedPropertyShape.id, event.target.value)} />
                  </label>}

                  {selectedDiagram && (selectedDefinition.semantic?.behavioralNodeRoles?.length ?? 0) > 1 && <section className="shape-property-section">
                    <h4>Behavioral role</h4>
                    <label className="shape-property-field"><span>Interpret this shared UML glyph as</span>
                      <select aria-label="Behavioral role" value={selectedDiagram.behavioralRole ?? selectedDefinition.semantic?.defaultBehavioralNodeRole ?? ''}
                        onChange={event => {
                          const accepted = engRef.current?.updateDiagramBehavioralRole(selectedDiagram.id, event.target.value as import('./engine/shapes/types').BehavioralNodeRole);
                          setSemanticEditNotice(accepted ? null : 'Role change was rejected because it would violate the current graph topology.');
                        }}>
                        {selectedDefinition.semantic!.behavioralNodeRoles!.map(role => <option key={role} value={role}>
                          {role === 'decision' ? 'Decision' : role === 'merge' ? 'Merge' : role === 'fork' ? 'Fork' : role === 'join' ? 'Join' : role === 'choice' ? 'Choice' : 'Junction'}
                        </option>)}
                      </select>
                    </label>
                  </section>}

                  {selectedDiagram?.shapeId === 'uml.frame' && sequenceFragment && <section className="shape-property-section" data-sequence-fragment-editor>
                    <h4>Interaction fragment</h4>
                    <label className="shape-property-field"><span>Operator</span>
                      <select aria-label="Sequence fragment operator" value={sequenceFragment.operator}
                        onChange={event => {
                          const operator = event.target.value as SequenceFragmentOperator;
                          const multiOperand = ['alt', 'par', 'seq', 'strict'].includes(operator);
                          const operands = sequenceFragment.operands.slice(0, multiOperand ? 16 : 1);
                          while (operands.length < (multiOperand ? 2 : 1)) {
                            operands.push({ id: `operand:${selectedDiagram.id}:${Date.now()}:${operands.length + 1}`,
                              order: operands.length, guard: '' });
                          }
                          updateSequenceFragment({ ...sequenceFragment, operator, operands }, true);
                        }}>
                        <option value="alt">alt — alternatives</option>
                        <option value="opt">opt — optional</option>
                        <option value="loop">loop — repetition</option>
                        <option value="par">par — parallel</option>
                        <option value="critical">critical — critical region</option>
                        <option value="break">break — break</option>
                        <option value="seq">seq — weak sequencing</option>
                        <option value="strict">strict — strict sequencing</option>
                        <option value="neg">neg — negative trace</option>
                        <option value="assert">assert — assertion</option>
                        <option value="ignore">ignore — ignore messages</option>
                        <option value="consider">consider — consider messages</option>
                      </select>
                    </label>
                    <p>Operands own the guards and message occurrences in each region. Resizing the frame does not scale its contents.</p>
                    {sequenceFragment.operands.map((operand, index) => <label className="shape-property-field" key={operand.id}>
                      <span>{sequenceFragment.operator === 'loop' ? 'Loop condition' : sequenceFragment.operator === 'opt' ? 'Optional condition' : `Operand ${index + 1} guard`}</span>
                      <div className="sequence-operand-field">
                        <input aria-label={`Fragment operand ${index + 1} guard`} data-semantic-edit-target value={operand.guard}
                          placeholder="condition (optional)"
                          onChange={event => updateSequenceFragment({ ...sequenceFragment, operands: sequenceFragment.operands.map(item =>
                            item.id === operand.id ? { ...item, guard: event.target.value } : item) }, false)}
                          onBlur={event => updateSequenceFragment({ ...sequenceFragment, operands: sequenceFragment.operands.map(item =>
                            item.id === operand.id ? { ...item, guard: event.currentTarget.value } : item) }, true)} />
                        {['alt', 'par', 'seq', 'strict'].includes(sequenceFragment.operator) && sequenceFragment.operands.length > 2
                          && <button type="button" aria-label={`Remove fragment operand ${index + 1}`} title="Remove operand"
                            onClick={() => updateSequenceFragment({ ...sequenceFragment,
                              operands: sequenceFragment.operands.filter(item => item.id !== operand.id) }, true)}><X size={13} /></button>}
                      </div>
                    </label>)}
                    {['alt', 'par', 'seq', 'strict'].includes(sequenceFragment.operator)
                      && <button type="button" className="shape-property-add" disabled={sequenceFragment.operands.length >= 16}
                        onClick={() => updateSequenceFragment({ ...sequenceFragment, operands: [...sequenceFragment.operands,
                          { id: `operand:${selectedDiagram.id}:${Date.now()}`, order: sequenceFragment.operands.length, guard: '' }] }, true)}>
                        Add operand
                      </button>}
                  </section>}

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

                  {selectedDefinition.dataCapabilities?.includes('classifier') && classifierModel && <section className="shape-property-section uml-classifier-editor" data-uml-classifier-editor>
                    <h4>Structured classifier members</h4>
                    <p>Each row has a stable identity. Edit, reorder, add, or remove members without replacing the other rows.</p>
                    {classifierCompartments.map(compartment => <div className="uml-classifier-compartment" key={compartment.id}>
                      <div className="uml-classifier-compartment-heading">
                        <strong>{compartment.label}</strong>
                        <button type="button" className="shape-property-add" onClick={() => addClassifierMember(compartment.id)}>
                          Add {compartment.kind === 'operations' ? 'operation' : compartment.kind === 'literals' ? 'literal' : 'attribute'}
                        </button>
                      </div>
                      {!compartment.items.length && <p className="uml-classifier-empty">No {compartment.label.toLowerCase()} yet.</p>}
                      {compartment.items.map((member, memberIndex) => {
                        const rowLabel = member.kind === 'operation' ? 'operation' : member.kind === 'literal' ? 'literal' : 'attribute';
                        const patch = (values: Record<string, unknown>, commit = false) =>
                          patchClassifierMember(compartment.id, member.id, values, commit);
                        return <article className="uml-classifier-member" key={member.id} data-classifier-member-id={member.id}>
                          <div className="uml-classifier-member-heading">
                            <span>{rowLabel} {memberIndex + 1}</span>
                            <div className="uml-classifier-member-actions">
                              <button type="button" disabled={memberIndex === 0} aria-label={`Move ${rowLabel} ${memberIndex + 1} up`}
                                title="Move up" onClick={() => moveClassifierMember(compartment.id, memberIndex, -1)}>↑</button>
                              <button type="button" disabled={memberIndex === compartment.items.length - 1} aria-label={`Move ${rowLabel} ${memberIndex + 1} down`}
                                title="Move down" onClick={() => moveClassifierMember(compartment.id, memberIndex, 1)}>↓</button>
                              <button type="button" aria-label={`Delete ${rowLabel} ${memberIndex + 1}`} title="Delete row"
                                onClick={() => updateClassifierData({ ...classifierModel, compartments: classifierModel.compartments.map(item => item.id === compartment.id
                                  ? { ...item, items: item.items.filter(candidate => candidate.id !== member.id) } : item) }, true)}><X size={13} /></button>
                            </div>
                          </div>
                          <label className="shape-property-field"><span>{member.kind === 'literal' ? 'Literal name' : member.kind === 'operation' ? 'Operation name' : 'Attribute name'}</span>
                            <input aria-label={`${rowLabel} ${memberIndex + 1} name`} value={member.name}
                              onChange={event => patch({ name: event.target.value })} onBlur={event => patch({ name: event.currentTarget.value }, true)} />
                          </label>
                          {(member.kind === 'attribute' || member.kind === 'operation') && <>
                            <label className="shape-property-field"><span>Visibility</span>
                              <select aria-label={`${rowLabel} ${memberIndex + 1} visibility`} value={member.visibility ?? ''}
                                onChange={event => patch({ visibility: (event.target.value || undefined) as UMLVisibility | undefined }, true)}>
                                <option value="">Unspecified</option><option value="public">Public (+)</option><option value="protected">Protected (#)</option>
                                <option value="package">Package (~)</option><option value="private">Private (-)</option>
                              </select>
                            </label>
                          </>}
                          {member.kind === 'attribute' && <>
                            <div className="shape-property-grid-two">
                              <label className="shape-property-field"><span>Type</span>
                                <input aria-label={`Attribute ${memberIndex + 1} type`} value={member.type ?? ''}
                                  onChange={event => patch({ type: event.target.value })} onBlur={event => patch({ type: event.currentTarget.value }, true)} />
                              </label>
                              <label className="shape-property-field"><span>Default value</span>
                                <input aria-label={`Attribute ${memberIndex + 1} default value`} value={member.defaultValue ?? ''}
                                  onChange={event => patch({ defaultValue: event.target.value })} onBlur={event => patch({ defaultValue: event.currentTarget.value }, true)} />
                              </label>
                            </div>
                            <div className="uml-classifier-flags">
                              <label><input type="checkbox" aria-label={`Attribute ${memberIndex + 1} is derived`} checked={member.derived === true}
                                onChange={event => patch({ derived: event.target.checked }, true)} /><span>Derived</span></label>
                              <label><input type="checkbox" aria-label={`Attribute ${memberIndex + 1} is static`} checked={member.static === true}
                                onChange={event => patch({ static: event.target.checked }, true)} /><span>Static</span></label>
                            </div>
                          </>}
                          {member.kind === 'operation' && <>
                            <label className="shape-property-field"><span>Parameters · name : Type = default</span>
                              <input aria-label={`Operation ${memberIndex + 1} parameters`} value={formatOperationParameters(member.parameters)}
                                onChange={event => patch({ parameters: parseOperationParameters(event.target.value, member.parameters) })}
                                onBlur={event => patch({ parameters: parseOperationParameters(event.currentTarget.value, member.parameters) }, true)} />
                            </label>
                            <label className="shape-property-field"><span>Return type</span>
                              <input aria-label={`Operation ${memberIndex + 1} return type`} value={member.returnType ?? ''}
                                onChange={event => patch({ returnType: event.target.value })} onBlur={event => patch({ returnType: event.currentTarget.value }, true)} />
                            </label>
                            <div className="uml-classifier-flags">
                              <label><input type="checkbox" aria-label={`Operation ${memberIndex + 1} is abstract`} checked={member.abstract === true}
                                onChange={event => patch({ abstract: event.target.checked }, true)} /><span>Abstract</span></label>
                              <label><input type="checkbox" aria-label={`Operation ${memberIndex + 1} is static`} checked={member.static === true}
                                onChange={event => patch({ static: event.target.checked }, true)} /><span>Static</span></label>
                            </div>
                          </>}
                        </article>;
                      })}
                    </div>)}
                  </section>}

                  {selectedDefinition.dataCapabilities?.includes('instance') && instanceModel && <section className="shape-property-section uml-instance-editor" data-uml-instance-editor>
                    <h4>Object slots</h4>
                    <p>Object values are instance slots, not Class attributes.</p>
                    {!instanceValues.length && <p className="uml-classifier-empty">No slot values yet.</p>}
                    {instanceValues.map((value, valueIndex) => <article className="uml-classifier-member" key={value.id} data-instance-value-id={value.id}>
                      <div className="uml-classifier-member-heading">
                        <span>Slot {valueIndex + 1}</span>
                        <div className="uml-classifier-member-actions">
                          <button type="button" disabled={valueIndex === 0} aria-label={`Move slot ${valueIndex + 1} up`}
                            title="Move up" onClick={() => moveInstanceValue(valueIndex, -1)}>↑</button>
                          <button type="button" disabled={valueIndex === instanceValues.length - 1} aria-label={`Move slot ${valueIndex + 1} down`}
                            title="Move down" onClick={() => moveInstanceValue(valueIndex, 1)}>↓</button>
                          <button type="button" aria-label={`Delete slot ${valueIndex + 1}`} title="Delete row"
                            onClick={() => updateInstanceData({ ...instanceModel, values: instanceValues.filter(item => item.id !== value.id) }, true)}><X size={13} /></button>
                        </div>
                      </div>
                      <label className="shape-property-field"><span>Slot name</span>
                        <input aria-label={`Slot ${valueIndex + 1} name`} value={value.name}
                          onChange={event => patchInstanceValue(value.id, { name: event.target.value })}
                          onBlur={event => patchInstanceValue(value.id, { name: event.currentTarget.value }, true)} />
                      </label>
                      <div className="shape-property-grid-two">
                        <label className="shape-property-field"><span>Type</span>
                          <input aria-label={`Slot ${valueIndex + 1} type`} value={value.type ?? ''}
                            onChange={event => patchInstanceValue(value.id, { type: event.target.value })}
                            onBlur={event => patchInstanceValue(value.id, { type: event.currentTarget.value }, true)} />
                        </label>
                        <label className="shape-property-field"><span>Value</span>
                          <input aria-label={`Slot ${valueIndex + 1} value`} value={value.value ?? ''}
                            onChange={event => patchInstanceValue(value.id, { value: event.target.value })}
                            onBlur={event => patchInstanceValue(value.id, { value: event.currentTarget.value }, true)} />
                        </label>
                      </div>
                    </article>)}
                    <button type="button" className="shape-property-add" onClick={addInstanceValue}>Add slot</button>
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
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <h4>Table columns ({tableColumns.length})</h4>
                      <button
                        type="button"
                        className="shape-preset-btn is-action"
                        onClick={() => {
                          const tableName = selectedDiagram?.text || selectedDefinition?.label || 'my_table';
                          setDdlModalData({ tableName, columns: tableColumns as TableColumnModel[] });
                        }}
                        title="Generate SQL DDL (PostgreSQL, MySQL, SQLite)"
                      >
                        <Database size={11} />
                        SQL DDL
                      </button>
                    </div>

                    <div className="shape-property-presets">
                      <button type="button" className="shape-preset-btn" onClick={addTableColumn}>
                        <Plus size={11} /> Column
                      </button>
                      <button
                        type="button"
                        className="shape-preset-btn"
                        onClick={addSurrogateIdKey}
                        disabled={tableColumns.some(col => col.key === 'primary' || col.key === 'primary_foreign')}
                        title={tableColumns.some(col => col.key === 'primary' || col.key === 'primary_foreign') ? 'Table already has a primary key' : 'Add surrogate id (bigint PK)'}
                      >
                        + ID (PK)
                      </button>
                      <button type="button" className="shape-preset-btn" onClick={addTimestampsPreset} title="Add created_at and updated_at timestamps">
                        + Timestamps
                      </button>
                      <button type="button" className="shape-preset-btn" onClick={addSoftDeletePreset} title="Add deleted_at nullable timestamp">
                        + Soft Delete
                      </button>
                    </div>

                    <datalist id="sql-column-types-datalist">
                      <option value="bigint" />
                      <option value="integer" />
                      <option value="smallint" />
                      <option value="serial" />
                      <option value="varchar(255)" />
                      <option value="varchar(100)" />
                      <option value="text" />
                      <option value="boolean" />
                      <option value="timestamp" />
                      <option value="timestamptz" />
                      <option value="date" />
                      <option value="time" />
                      <option value="numeric(12,2)" />
                      <option value="decimal(10,2)" />
                      <option value="uuid" />
                      <option value="jsonb" />
                      <option value="json" />
                    </datalist>

                    {tableColumns.map((column, index) => <div className="shape-property-column" key={column.id ?? index} style={{ marginBottom: 6 }}>
                      <div className="shape-property-column-fields-v2">
                        <input aria-label={`Column ${index + 1} name`} value={column.name ?? ''} placeholder="column_name"
                          onChange={event => updateTableData(tableColumns.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item), false)}
                          onBlur={() => updateTableData(tableColumns, true)} />
                        <input aria-label={`Column ${index + 1} type`} value={column.type ?? ''} placeholder="varchar(255)"
                          list="sql-column-types-datalist"
                          onChange={event => updateTableData(tableColumns.map((item, itemIndex) => itemIndex === index ? { ...item, type: event.target.value } : item), false)}
                          onBlur={() => updateTableData(tableColumns, true)} />
                        <select aria-label={`Column ${index + 1} key type`} value={column.key ?? 'none'}
                          onChange={event => {
                            const newKey = event.target.value;
                            const autoNotNull = newKey === 'primary' || newKey === 'primary_foreign';
                            updateTableData(tableColumns.map((item, itemIndex) => itemIndex === index ? {
                              ...item,
                              key: newKey,
                              nullable: autoNotNull ? false : item.nullable,
                            } : item), true);
                          }}>
                          <option value="none">Regular</option>
                          <option value="primary">PK</option>
                          <option value="foreign">FK</option>
                          <option value="primary_foreign">PK, FK</option>
                          <option value="unique">UK</option>
                        </select>
                        <div className="shape-property-column-subfields">
                          <label title="Not Null constraint">
                            <input
                              type="checkbox"
                              checked={column.nullable === false || column.key === 'primary' || column.key === 'primary_foreign'}
                              disabled={column.key === 'primary' || column.key === 'primary_foreign'}
                              onChange={event => updateTableData(tableColumns.map((item, itemIndex) => itemIndex === index ? { ...item, nullable: !event.target.checked } : item), true)}
                            />
                            <span>NN</span>
                          </label>
                          <input
                            type="text"
                            placeholder="DEFAULT expr"
                            value={column.default ?? ''}
                            title="Default expression (e.g. CURRENT_TIMESTAMP, 0, 'active')"
                            onChange={event => updateTableData(tableColumns.map((item, itemIndex) => itemIndex === index ? { ...item, default: event.target.value } : item), false)}
                            onBlur={() => updateTableData(tableColumns, true)}
                          />
                        </div>
                      </div>
                      <div className="shape-property-column-actions">
                        <button
                          type="button"
                          disabled={index === 0}
                          onClick={() => moveTableColumn(index, -1)}
                          title="Move column up"
                          aria-label={`Move column ${index + 1} up`}
                        >
                          <ArrowUp size={11} />
                        </button>
                        <button
                          type="button"
                          disabled={index === tableColumns.length - 1}
                          onClick={() => moveTableColumn(index, 1)}
                          title="Move column down"
                          aria-label={`Move column ${index + 1} down`}
                        >
                          <ArrowDown size={11} />
                        </button>
                        <button
                          type="button"
                          onClick={() => updateTableData(tableColumns.filter((_, itemIndex) => itemIndex !== index), true)}
                          aria-label={`Remove column ${index + 1}`}
                          title="Remove column"
                          style={{ color: '#ef4444' }}
                        >
                          <X size={11} />
                        </button>
                      </div>
                    </div>)}
                  </section>}

                  {(selectedDiagram?.shapeId === 'uml.use-case' || selectedDiagram?.shapeId === 'uml.use-case-ext') && <section className="shape-property-section uml-usecase-editor" data-uml-usecase-editor>
                    <h4>Extension Points</h4>
                    <p>Extension points define locations where the behavior of this use case can be extended (UML 2.5).</p>
                    {!usecaseExtensionPoints.length && <p className="uml-classifier-empty">No extension points defined.</p>}
                    {usecaseExtensionPoints.map((point, index) => (
                      <article className="uml-classifier-member" key={point.id} data-extension-point-id={point.id}>
                        <div className="uml-classifier-member-heading">
                          <span>Point {index + 1}</span>
                          <div className="uml-classifier-member-actions">
                            <button type="button" disabled={index === 0} aria-label={`Move extension point ${index + 1} up`}
                              title="Move up" onClick={() => moveExtensionPoint(index, -1)}>↑</button>
                            <button type="button" disabled={index === usecaseExtensionPoints.length - 1} aria-label={`Move extension point ${index + 1} down`}
                              title="Move down" onClick={() => moveExtensionPoint(index, 1)}>↓</button>
                            <button type="button" aria-label={`Delete extension point ${index + 1}`} title="Delete point"
                              onClick={() => deleteExtensionPoint(point.id)}><X size={13} /></button>
                          </div>
                        </div>
                        <label className="shape-property-field">
                          <span>Point name</span>
                          <input aria-label={`Extension point ${index + 1} name`} value={point.name}
                            placeholder="e.g. VIP Checkout"
                            onChange={event => patchExtensionPoint(point.id, { name: event.target.value })}
                            onBlur={event => patchExtensionPoint(point.id, { name: event.currentTarget.value }, true)} />
                        </label>
                        <label className="shape-property-field">
                          <span>Explanation / condition (optional)</span>
                          <input aria-label={`Extension point ${index + 1} explanation`} value={point.explanation ?? ''}
                            placeholder="e.g. triggered on priority customer"
                            onChange={event => patchExtensionPoint(point.id, { explanation: event.target.value })}
                            onBlur={event => patchExtensionPoint(point.id, { explanation: event.currentTarget.value }, true)} />
                        </label>
                      </article>
                    ))}
                    <button type="button" className="shape-property-add" onClick={addExtensionPoint}>Add extension point</button>
                  </section>}

                  {selectedDiagram?.shapeId === 'uml.system-boundary' && <section className="shape-property-section" data-uml-boundary-editor>
                    <h4>Subject Boundary</h4>
                    <p>UML 2.5 subject boundary stereotype («system», «subsystem», «service», etc.).</p>
                    <label className="shape-property-field">
                      <span>Stereotype</span>
                      <input aria-label="Subject stereotype"
                        value={subjectBoundaryModel?.stereotype ?? (selectedDiagram.params?.stereotype as string) ?? ''}
                        placeholder="«system», «subsystem», «component»"
                        onChange={event => {
                          const val = event.target.value;
                          updateSubjectBoundaryData({ version: 1, stereotype: val }, false);
                          engRef.current?.updateShapeParameters(selectedDiagram.id, { stereotype: val }, false);
                        }}
                        onBlur={event => {
                          const val = event.currentTarget.value;
                          updateSubjectBoundaryData({ version: 1, stereotype: val }, true);
                          engRef.current?.updateShapeParameters(selectedDiagram.id, { stereotype: val }, true);
                        }}
                      />
                    </label>
                  </section>}

                </>}

                {selectedConnector && <>
                  {selectedConnector.shapeId === 'uml.extend' && <section className="shape-property-section" data-usecase-extend-editor>
                    <h4>«extend» relationship details</h4>
                    <p>Extension condition and target extension point per UML 2.5.</p>
                    <label className="shape-property-field">
                      <span>Extension condition (optional)</span>
                      <input
                        aria-label="Extend condition"
                        value={selectedConnector.usecaseExtend?.condition ?? ''}
                        placeholder="e.g. cart total > $100"
                        onChange={event => engRef.current?.updateConnectorProperties(selectedConnector.id, {
                          usecaseExtend: {
                            version: 1,
                            condition: event.target.value,
                            extensionPoint: selectedConnector.usecaseExtend?.extensionPoint ?? '',
                          }
                        }, false)}
                        onBlur={event => engRef.current?.updateConnectorProperties(selectedConnector.id, {
                          usecaseExtend: {
                            version: 1,
                            condition: event.currentTarget.value,
                            extensionPoint: selectedConnector.usecaseExtend?.extensionPoint ?? '',
                          }
                        }, true)}
                      />
                    </label>
                    <label className="shape-property-field">
                      <span>Target extension point name</span>
                      <input
                        aria-label="Target extension point"
                        value={selectedConnector.usecaseExtend?.extensionPoint ?? ''}
                        placeholder="e.g. VIP checkout"
                        onChange={event => engRef.current?.updateConnectorProperties(selectedConnector.id, {
                          usecaseExtend: {
                            version: 1,
                            condition: selectedConnector.usecaseExtend?.condition ?? '',
                            extensionPoint: event.target.value,
                          }
                        }, false)}
                        onBlur={event => engRef.current?.updateConnectorProperties(selectedConnector.id, {
                          usecaseExtend: {
                            version: 1,
                            condition: selectedConnector.usecaseExtend?.condition ?? '',
                            extensionPoint: event.currentTarget.value,
                          }
                        }, true)}
                      />
                    </label>
                  </section>}
                  {selectedConnectorCapabilities?.labelMode === 'structured' && selectedConnector.stateTransition && <section className="shape-property-section">
                    <h4>Structured connector label</h4>
                    <p>The rendered label is derived from these canonical parts.</p>
                    {(['trigger', 'guard', 'effect'] as const).map(part => <label className="shape-property-field" key={part}>
                      <span>{part === 'trigger' ? 'Trigger' : part === 'guard' ? 'Guard' : 'Effect'}</span>
                      <input aria-label={`Transition ${part}`} data-semantic-edit-target value={selectedConnector.stateTransition?.[part] ?? ''}
                        placeholder={part === 'guard' ? 'condition' : part === 'effect' ? 'action' : 'event'}
                        onChange={event => engRef.current?.updateConnectorProperties(selectedConnector.id, {
                          stateTransition: { ...selectedConnector.stateTransition, [part]: event.target.value },
                        }, false)}
                        onBlur={event => engRef.current?.updateConnectorProperties(selectedConnector.id, {
                          stateTransition: { ...selectedConnector.stateTransition, [part]: event.target.value },
                        }, true)} />
                    </label>)}
                  </section>}
                  {selectedConnectorCapabilities?.labelMode === 'plain' && <label className="shape-property-field"><span>Connector label</span><input aria-label="Connector label" data-semantic-edit-target value={selectedConnector.label ?? ''} placeholder="Relationship or flow label"
                    onChange={event => engRef.current?.updateConnectorProperties(selectedConnector.id, { label: event.target.value }, false)}
                    onBlur={event => engRef.current?.updateConnectorProperties(selectedConnector.id, { label: event.target.value }, true)} /></label>}
                  {selectedConnectorCapabilities?.labelMode === 'fixed' && <div className="shape-property-section">
                    <h4>Canonical label</h4><p>{connectorDisplayLabel(selectedConnector)}</p>
                  </div>}
                  {selectedConnectorCapabilities?.directionText && <p className="shape-property-direction" data-connector-direction>
                    {selectedConnectorCapabilities.directionText}
                  </p>}
                  {(selectedConnectorCapabilities?.sourceLabelEditable || selectedConnectorCapabilities?.targetLabelEditable
                    || selectedConnectorCapabilities?.multiplicityEditable) && <section className="shape-property-section" data-uml-relationship-labels>
                    <h4>Relationship end labels</h4>
                    {selectedConnectorCapabilities.sourceLabelEditable && <label className="shape-property-field">
                      <span>{selectedConnectorCapabilities.sourceRoleLabel ?? 'Source-end label'}</span>
                      <input aria-label="Source-end role label" data-semantic-edit-target value={selectedConnector.sourceLabel ?? ''}
                        onChange={event => engRef.current?.updateConnectorProperties(selectedConnector.id, { sourceLabel: event.target.value }, false)}
                        onBlur={event => engRef.current?.updateConnectorProperties(selectedConnector.id, { sourceLabel: event.currentTarget.value }, true)} />
                    </label>}
                    {selectedConnectorCapabilities.targetLabelEditable && <label className="shape-property-field">
                      <span>{selectedConnectorCapabilities.targetRoleLabel ?? 'Target-end label'}</span>
                      <input aria-label="Target-end role label" data-semantic-edit-target value={selectedConnector.targetLabel ?? ''}
                        onChange={event => engRef.current?.updateConnectorProperties(selectedConnector.id, { targetLabel: event.target.value }, false)}
                        onBlur={event => engRef.current?.updateConnectorProperties(selectedConnector.id, { targetLabel: event.currentTarget.value }, true)} />
                    </label>}
                    {selectedConnectorCapabilities.multiplicityEditable && <div className="shape-property-grid-two">
                      <label className="shape-property-field"><span>Source multiplicity · exact text</span>
                        <input aria-label="Source multiplicity" value={selectedConnector.sourceMultiplicity ?? ''} placeholder="e.g. 0..1, 1..*, n"
                          onChange={event => engRef.current?.updateConnectorProperties(selectedConnector.id, { sourceMultiplicity: event.target.value }, false)}
                          onBlur={event => engRef.current?.updateConnectorProperties(selectedConnector.id, { sourceMultiplicity: event.currentTarget.value }, true)} />
                      </label>
                      <label className="shape-property-field"><span>Target multiplicity · exact text</span>
                        <input aria-label="Target multiplicity" value={selectedConnector.targetMultiplicity ?? ''} placeholder="e.g. 0..1, 1..*, n"
                          onChange={event => engRef.current?.updateConnectorProperties(selectedConnector.id, { targetMultiplicity: event.target.value }, false)}
                          onBlur={event => engRef.current?.updateConnectorProperties(selectedConnector.id, { targetMultiplicity: event.currentTarget.value }, true)} />
                      </label>
                    </div>}
                  </section>}
                  {selectedConnectorCapabilities?.lineStyleEditable && <label className="shape-property-field"><span>Line style</span><select value={selectedConnector.lineStyle}
                    onChange={event => engRef.current?.updateConnectorProperties(selectedConnector.id, { lineStyle: event.target.value as StrokeStyle })}>
                    <option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option>
                  </select></label>}
                  {selectedConnectorCapabilities?.markersEditable && <div className="shape-property-grid-two">
                    <label className="shape-property-field"><span>Start marker</span><select value={selectedConnector.startMarker}
                      onChange={event => engRef.current?.updateConnectorProperties(selectedConnector.id, { startMarker: event.target.value as EndpointMarker })}>
                      <option value="none">None</option><option value="arrow">Arrow</option><option value="openArrow">Open arrow</option><option value="hollowTriangle">Hollow triangle</option>
                      <option value="diamond">Hollow diamond</option><option value="filledDiamond">Filled diamond</option><option value="circle">Circle</option><option value="filledCircle">Filled circle</option><option value="bar">Bar</option><option value="crowFoot">Crow's foot</option>
                    </select></label>
                    <label className="shape-property-field"><span>End marker</span><select value={selectedConnector.endMarker}
                      onChange={event => engRef.current?.updateConnectorProperties(selectedConnector.id, { endMarker: event.target.value as EndpointMarker })}>
                      <option value="none">None</option><option value="arrow">Arrow</option><option value="openArrow">Open arrow</option><option value="hollowTriangle">Hollow triangle</option>
                      <option value="diamond">Hollow diamond</option><option value="filledDiamond">Filled diamond</option><option value="circle">Circle</option><option value="filledCircle">Filled circle</option><option value="bar">Bar</option><option value="crowFoot">Crow's foot</option>
                    </select></label>
                  </div>}
                  {selectedConnectorCapabilities?.cardinalityEditable && <div className="shape-property-grid-two">
                    <label className="shape-property-field"><span>Source cardinality</span><select value={selectedConnector.sourceCardinality ?? ''}
                      onChange={event => engRef.current?.updateConnectorProperties(selectedConnector.id, { sourceCardinality: (event.target.value || undefined) as Cardinality | undefined })}>
                      <option value="">Not set</option><option value="one">One</option><option value="zero-or-one">Zero or one</option><option value="many">Many</option><option value="one-or-many">One or many</option><option value="zero-or-many">Zero or many</option>
                    </select></label>
                    <label className="shape-property-field"><span>Target cardinality</span><select value={selectedConnector.targetCardinality ?? ''}
                      onChange={event => engRef.current?.updateConnectorProperties(selectedConnector.id, { targetCardinality: (event.target.value || undefined) as Cardinality | undefined })}>
                      <option value="">Not set</option><option value="one">One</option><option value="zero-or-one">Zero or one</option><option value="many">Many</option><option value="one-or-many">One or many</option><option value="zero-or-many">Zero or many</option>
                    </select></label>
                  </div>}
                  {selectedConnectorCapabilities?.labelPositionEditable && <section className="shape-property-section" data-route-label-positions>
                    <h4>Route-relative label placement</h4>
                    {selectedConnectorCapabilities.labelMode !== 'none' && <>
                      <label className="shape-property-field"><span>Center label · {selectedConnector.labelPosition ?? 500}‰</span>
                        <input type="range" min={0} max={1000} value={selectedConnector.labelPosition ?? 500} aria-label="Center label position along route"
                          onChange={event => engRef.current?.updateConnectorProperties(selectedConnector.id, { labelPosition: +event.target.value }, false)}
                          onPointerUp={event => engRef.current?.updateConnectorProperties(selectedConnector.id, { labelPosition: +event.currentTarget.value }, true)}
                          onBlur={event => engRef.current?.updateConnectorProperties(selectedConnector.id, { labelPosition: +event.currentTarget.value }, true)} />
                      </label>
                      <label className="shape-property-field"><span>Center label offset · {selectedConnector.labelOffset ?? 0} px</span>
                        <input type="range" min={-80} max={80} value={selectedConnector.labelOffset ?? 0} aria-label="Center label offset from route"
                          onChange={event => engRef.current?.updateConnectorProperties(selectedConnector.id, { labelOffset: +event.target.value }, false)}
                          onPointerUp={event => engRef.current?.updateConnectorProperties(selectedConnector.id, { labelOffset: +event.currentTarget.value }, true)}
                          onBlur={event => engRef.current?.updateConnectorProperties(selectedConnector.id, { labelOffset: +event.currentTarget.value }, true)} />
                      </label>
                    </>}
                    {selectedConnectorCapabilities.sourceLabelEditable && <>
                      <label className="shape-property-field"><span>Source-end label position · {selectedConnector.sourceLabelPosition ?? 180}‰</span>
                        <input type="range" min={0} max={1000} value={selectedConnector.sourceLabelPosition ?? 180} aria-label="Source-end label position along route"
                          onChange={event => engRef.current?.updateConnectorProperties(selectedConnector.id, { sourceLabelPosition: +event.target.value }, false)}
                          onPointerUp={event => engRef.current?.updateConnectorProperties(selectedConnector.id, { sourceLabelPosition: +event.currentTarget.value }, true)}
                          onBlur={event => engRef.current?.updateConnectorProperties(selectedConnector.id, { sourceLabelPosition: +event.currentTarget.value }, true)} />
                      </label>
                      <label className="shape-property-field"><span>Source-end label offset · {selectedConnector.sourceLabelOffset ?? 12} px</span>
                        <input type="range" min={-80} max={80} value={selectedConnector.sourceLabelOffset ?? 12} aria-label="Source-end label offset from route"
                          onChange={event => engRef.current?.updateConnectorProperties(selectedConnector.id, { sourceLabelOffset: +event.target.value }, false)}
                          onPointerUp={event => engRef.current?.updateConnectorProperties(selectedConnector.id, { sourceLabelOffset: +event.currentTarget.value }, true)}
                          onBlur={event => engRef.current?.updateConnectorProperties(selectedConnector.id, { sourceLabelOffset: +event.currentTarget.value }, true)} />
                      </label>
                    </>}
                    {selectedConnectorCapabilities.targetLabelEditable && <>
                      <label className="shape-property-field"><span>Target-end label position · {selectedConnector.targetLabelPosition ?? 820}‰</span>
                        <input type="range" min={0} max={1000} value={selectedConnector.targetLabelPosition ?? 820} aria-label="Target-end label position along route"
                          onChange={event => engRef.current?.updateConnectorProperties(selectedConnector.id, { targetLabelPosition: +event.target.value }, false)}
                          onPointerUp={event => engRef.current?.updateConnectorProperties(selectedConnector.id, { targetLabelPosition: +event.currentTarget.value }, true)}
                          onBlur={event => engRef.current?.updateConnectorProperties(selectedConnector.id, { targetLabelPosition: +event.currentTarget.value }, true)} />
                      </label>
                      <label className="shape-property-field"><span>Target-end label offset · {selectedConnector.targetLabelOffset ?? 12} px</span>
                        <input type="range" min={-80} max={80} value={selectedConnector.targetLabelOffset ?? 12} aria-label="Target-end label offset from route"
                          onChange={event => engRef.current?.updateConnectorProperties(selectedConnector.id, { targetLabelOffset: +event.target.value }, false)}
                          onPointerUp={event => engRef.current?.updateConnectorProperties(selectedConnector.id, { targetLabelOffset: +event.currentTarget.value }, true)}
                          onBlur={event => engRef.current?.updateConnectorProperties(selectedConnector.id, { targetLabelOffset: +event.currentTarget.value }, true)} />
                      </label>
                    </>}
                    <p>Each editable label also has an independent canvas handle.</p>
                  </section>}
                  {selectedConnectorCapabilities?.routeEditable && <section className="shape-property-section">
                    <h4>Connector route</h4>
                    <p>{selectedConnector.waypoints.length} waypoint{selectedConnector.waypoints.length === 1 ? '' : 's'} · drag route handles to edit</p>
                    <button type="button" className="shape-property-add" onClick={() => {
                      const route = getConnectorRoute(selectedConnector);
                      const segment = route.slice(1).map((end, index) => {
                        const start = route[index];
                        return { start, end, length: Math.hypot(end[0] - start[0], end[1] - start[1]) };
                      }).sort((left, right) => right.length - left.length)[0];
                      if (!segment || segment.length < 1) return;
                      engRef.current?.addConnectorWaypoint(selectedConnector.id,
                        (segment.start[0] + segment.end[0]) / 2, (segment.start[1] + segment.end[1]) / 2);
                    }}>Add waypoint</button>
                    {selectedConnector.waypoints.map((_, index) => <button key={index} type="button" className="shape-property-remove-waypoint"
                      onClick={() => engRef.current?.removeConnectorWaypoint(selectedConnector.id, index)}>Remove waypoint {index + 1}</button>)}
                  </section>}
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

            {boardRuntimeStatus.unsyncedRemoteChanges && (
              <div
                className="hud-syncing-pill"
                style={{
                  gridArea: 'hint',
                  justifySelf: 'center',
                  background: 'rgba(255, 255, 255, 0.95)',
                  padding: '6px 12px',
                  borderRadius: '9999px',
                  border: '1px solid rgba(203, 213, 225, 0.78)',
                  boxShadow: '0 2px 8px rgba(15, 23, 42, 0.05)',
                  fontSize: '11px',
                  pointerEvents: 'auto',
                }}
              >
                <span className="hud-syncing-dot" aria-hidden="true" />
                Syncing changes…
              </div>
            )}

            <div className="hud-zoom-group">
              {/* Live Floating Reaction Picker */}
              <div className="reaction-trigger-container relative">
                <button
                  type="button"
                  onClick={() => setShowReactionPicker(prev => !prev)}
                  title="Send emoji reaction"
                  aria-label="Send emoji reaction"
                  aria-expanded={showReactionPicker}
                  className="reaction-trigger-btn"
                >
                  <Smile size={16} strokeWidth={2} />
                </button>
                {showReactionPicker && (
                  <div className="reaction-picker-bar absolute bottom-11 right-0 z-50">
                    {['❤️', '👍', '🔥', '🎉', '🚀', '👏', '😂', '💡', '✨'].map(emoji => (
                      <button
                        key={emoji}
                        type="button"
                        className="reaction-emoji-btn"
                        onClick={() => handleSendReaction(emoji)}
                        aria-label={`Send ${emoji} reaction`}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                )}
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

      {ddlModalData && createPortal(
        <div className="ddl-modal-backdrop" onClick={() => setDdlModalData(null)}>
          <div className="ddl-modal-card" onClick={e => e.stopPropagation()}>
            <div className="ddl-modal-header">
              <h3>
                <Database size={16} color="#2563eb" />
                SQL DDL Generator — {ddlModalData.tableName}
              </h3>
              <button
                type="button"
                onClick={() => setDdlModalData(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}
                aria-label="Close DDL modal"
              >
                <X size={18} />
              </button>
            </div>
            <div className="ddl-modal-tabs">
              {(['postgresql', 'mysql', 'sqlite'] as const).map(d => (
                <button
                  key={d}
                  type="button"
                  className={`ddl-modal-tab ${ddlDialect === d ? 'active' : ''}`}
                  onClick={() => setDdlDialect(d)}
                >
                  {d === 'postgresql' ? 'PostgreSQL' : d === 'mysql' ? 'MySQL' : 'SQLite'}
                </button>
              ))}
            </div>
            <pre className="ddl-modal-code">
              {generateTableDdl(ddlModalData.tableName, ddlModalData.columns, ddlDialect)}
            </pre>
            <div className="ddl-modal-footer">
              <button
                type="button"
                className="shape-preset-btn"
                onClick={() => setDdlModalData(null)}
              >
                Close
              </button>
              <button
                type="button"
                className="shape-preset-btn is-action"
                onClick={() => {
                  const sql = generateTableDdl(ddlModalData.tableName, ddlModalData.columns, ddlDialect);
                  navigator.clipboard.writeText(sql);
                  setDdlCopied(true);
                  setTimeout(() => setDdlCopied(false), 2000);
                }}
              >
                {ddlCopied ? <Check size={12} /> : <Copy size={12} />}
                {ddlCopied ? 'Copied!' : 'Copy SQL'}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      <BoardStatusBanner />
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onImageFile} />
    </div>
  );
}
