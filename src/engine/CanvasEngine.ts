import { getStroke } from 'perfect-freehand';
import * as Y from 'yjs';
import RBush from 'rbush';
import { parseTelex } from '../formula/parser';
import { renderFormulaStatic } from '../formula/renderer';
import { CODE_LANGUAGES, DEFAULT_CODE_LANGUAGE, normalizeCodeLanguage, type CodeLanguage } from '../code/languages';
import { CanvasCodePreviewCache } from '../code/canvasHighlight';
import { initialCodeBlockHeight } from '../code/layout';
import { recognizeSmartDrawing } from './smartDrawing';
import { getShapeDefinition, getShapeDefinitionByToolId, getShapeDefinitionForLegacyType, getShapeResizePolicy } from './shapes/registry';
import type { RegisteredBoxShapeToolId, RegisteredConnectorToolId, RegisteredShapeToolId } from './shapes/registry';
import { buildGeometryCommands, buildShapeGeometry, drawPathCommands, geometryUsesFill, structuredTableLayout } from './shapes/geometry';
import { buildConnectorRoute, CONNECTOR_LABEL_HEIGHT, connectorLabelLayout, fitConnectorLabel } from './shapes/connectors';
import { containerAcceptsSemanticChild, connectorEndpointPairAllowed, connectorEndpointSideAllowed } from './shapes/semantics';
import { normalizeShapeParameterPatch } from './shapes/parameters';
import { solid3DScaleFromBounds, type Solid3DScale } from './shapes/solid3d';
import { connectionPointsForBox, connectorBounds, deserializeBoardShape, deriveStructuredShapeParameters, objectPointToWorld, resizeBoxFromHandle, rotatedBoxBounds, rotatedBoxCorners, rotatePoint, unrotatePoint, worldPointToObject } from './shapes/model';
import type { ConnectorShapeObject, DiagramShapeObject, EndpointMarker, PathCommand, ShapeDefinition, ShapeResizePolicy } from './shapes/types';

export type ToolType =
  | 'select' | 'lasso-select' | 'pen' | 'eraser'
  | 'sticky' | 'text' | 'math' | 'code' | 'image'
  | RegisteredShapeToolId;

export type BoxShapeTool = RegisteredBoxShapeToolId;
export type ConnectorTool = RegisteredConnectorToolId;

export interface Camera { x: number; y: number; zoom: number; }

interface BaseShape { id:string; type:string; minX:number; minY:number; maxX:number; maxY:number; }
interface BoxShape extends BaseShape {
  x:number; y:number; w:number; h:number;
  rotation?: number;
  shapeId?: string;
  params?: Record<string, unknown>;
  text?: string; fs?: number; textColor?: string;
  vertices?: [number, number][];
}

export interface PenShape     extends BaseShape { type:'pen';      pts:number[][]; color:string; size:number; /** New ink defines pressure simulation explicitly; absent on legacy saved strokes. */ simulatePressure?: boolean; }
export interface LineShape    extends BaseShape { type:'line'; x1:number; y1:number; x2:number; y2:number; color:string; sw:number; }
export interface CurveShape   extends BaseShape { type:'curve'; pts:number[][]; color:string; sw:number; }
export interface RectShape    extends BoxShape  { type:'rect'|'rounded-rect'; fill:string; stroke:string; sw:number; }
export interface EllipseShape extends BoxShape  { type:'ellipse';  fill:string; stroke:string; sw:number; }
export interface TriShape     extends BoxShape  { type:'triangle'; fill:string; stroke:string; sw:number; vertices?: [number, number][]; }
export interface DiamShape    extends BoxShape  { type:'diamond';  fill:string; stroke:string; sw:number; }
export interface StarShape    extends BoxShape  { type:'star';     fill:string; stroke:string; sw:number; }
export interface CalloutShape extends BoxShape  { type:'callout'; fill:string; stroke:string; sw:number; }
export interface PolygonShape extends BoxShape { type:'pentagon'|'hexagon'|'parallelogram'|'trapezoid'|'right-triangle'; fill:string; stroke:string; sw:number; }
export interface ArrowShape   extends BaseShape { type:'arrow';    x1:number;y1:number;x2:number;y2:number; color:string; sw:number; }
export interface StickyShape  extends BoxShape  { type:'sticky';   text:string; bg:string; fs:number; }
export interface TextShape    extends BoxShape  { type:'text'|'math'|'code'; text:string; color:string; fs:number; language?: CodeLanguage; previewText?: string; autoHeight?: boolean; }
export interface ImageShape   extends BoxShape  { type:'image';    src:string; naturalW:number; naturalH:number; }
export type DiagramShape = DiagramShapeObject;
export type ConnectorShape = ConnectorShapeObject;
export type AnyShape = PenShape|LineShape|CurveShape|RectShape|EllipseShape|TriShape|DiamShape|StarShape|CalloutShape|PolygonShape|ArrowShape|StickyShape|TextShape|ImageShape|DiagramShape|ConnectorShape;
type RotatableShape = Exclude<AnyShape, PenShape | LineShape | CurveShape | ArrowShape | ConnectorShape>;

export interface StyleOptions {
  penColor:string; penSize:number;
  fill:string; stroke:string; sw:number;
  stickyBg:string; fontSize:number;
}

// ── cursor types for each resize handle ──────────────────────────────────────
const HANDLE_CURSORS: Record<string,string> = {
  nw:'nw-resize', ne:'ne-resize', sw:'sw-resize', se:'se-resize',
  n:'n-resize',   s:'s-resize',   e:'e-resize',   w:'w-resize',
  'line-start':'crosshair', 'line-end':'crosshair', rotate:'grab', waypoint:'move',
};
const ERASER_RADIUS_PX = 11;
const MAX_PEN_STROKE_WIDTH = 50;
interface CachedDiagramGeometry {
  key: string; path?: Path2D; outline: PathCommand[]; decorations: PathCommand[][]; decorationStyles: Array<'solid' | 'dashed' | 'dotted' | undefined>;
  intrinsicFills: PathCommand[][]; hiddenEdges: PathCommand[][]; visibleFaces: import('./shapes/solid3d').Solid3DProjection['visibleFaces']; projection?: import('./shapes/solid3d').Solid3DProjection['metadata'];
  decorationPaths?: Array<Path2D | undefined>; intrinsicFillPaths?: Array<Path2D | undefined>; hiddenEdgePaths?: Array<Path2D | undefined>; visibleFacePaths?: Array<Path2D | undefined>;
}
interface ConnectorLabelVisual {
  text: string; x: number; y: number; width: number; height: number; textWidth: number;
}
export class CanvasEngine {
  private cv: HTMLCanvasElement;
  private cx: CanvasRenderingContext2D;
  private yMap: Y.Map<any>;
  private shapes: Map<string,AnyShape> = new Map();
  private opaqueShapes = new Map<string, unknown>();
  private geometryCache = new WeakMap<object, CachedDiagramGeometry>();
  private rtree = new RBush<any>();

  public  cam: Camera = { x:0, y:0, zoom:1 };
  public  tool: ToolType = 'pen';
  public  penMode: 'normal' | 'smart' = 'normal';
  public  style: StyleOptions = {
    penColor:'#1e293b', penSize:6,
    fill:'transparent', stroke:'#1e40af', sw:2,
    stickyBg:'#fef08a', fontSize:14,
  };

  public onShapeUpdate: ((s: AnyShape) => void) | null = null;

  private editingId: string | null = null;
  public setEditingId(id: string | null) { this.editingId = id; this.dirty = true; }

  private raf = 0;
  private dirty = true;
  private imgCache = new Map<string,HTMLImageElement>();

  // overlay for dom elements
  private overlayDiv: HTMLDivElement;
  private wrapperDiv: HTMLDivElement;
  private overlayAttachTimer: ReturnType<typeof setTimeout> | null = null;
  private lastOverlayState = '';
  private codePreviewCache = new CanvasCodePreviewCache();
  private destroyed = false;

  // interaction state
  private isDown    = false;
  private isPanning = false;
  private panButton: number | null = null;
  private isErasing = false;
  private eraseChanged = false;
  private eraserLastPoint: { x: number; y: number } | null = null;
  private eraserCursorPoint: { x: number; y: number } | null = null;
  private activeSmartDrawing = false;
  private activePointerId: number | null = null;
  private pendingPenPublishRaf: number | null = null;
  private currId: string|null = null;
  private panRef    = {sx:0,sy:0,cx:0,cy:0};
  private shapeOrigin = {x:0,y:0};

  // select / drag / resize / box
  public  sel           = new Set<string>();
  private isDragging    = false;
  private dragRef       = {wx:0,wy:0};
  private dragOrigins   = new Map<string,{x:number,y:number}>();
  private isResizing    = false;
  private resizeH       = '';
  private resizeRef: any = null;
  private isBoxing      = false;
  private boxA          = {x:0,y:0};
  private boxB          = {x:0,y:0};
  private isLassoing    = false;
  private lassoPts: {x:number,y:number}[] = [];

  // callbacks
  public onSel?:      (ids:string[]) => void;
  public onZoom?:     (z:number) => void;
  public onCam?:      (cam:Camera) => void;
  public onCameraChange: ((cam: Camera) => void) | null = null;
  public onContextMenu?: (x:number, y:number) => void;
  public onTextEdit?: (s:AnyShape) => void;
  public onEditText?: (s: AnyShape, cx: number, cy: number) => void;
  public onCursor?:   (cursor:string) => void;
  public onTool?:     (tool:ToolType) => void;

  private undoManager!: Y.UndoManager;
  private readonly remoteRepairOrigin = { source: 'canvas-engine-remote-repair' };
  private readonly remoteDeletedKeys = new Set<string>();
  private pendingFormulaCaptureId: string | null = null;

  private readonly onYMapChange = (event: Y.YMapEvent<AnyShape>) => {
    const origin = event.transaction.origin;
    if (origin === this) {
      // A subsequent local add/update supersedes any older observed remote tombstone.
      event.changes.keys.forEach((change, key) => {
        if (change.action !== 'delete') this.remoteDeletedKeys.delete(key);
      });
      return;
    }
    const externalChange = origin !== this.remoteRepairOrigin && origin !== this.undoManager
      && !this.undoManager.undoing && !this.undoManager.redoing;
    let redraw = false;
    let selectionChanged = false;
    event.changes.keys.forEach((change, key) => {
      if (externalChange) {
        if (change.action === 'delete') this.remoteDeletedKeys.add(key);
        else this.remoteDeletedKeys.delete(key);
      }
      const old = this.shapes.get(key);
      if (old) this.rtree.remove(old);
      if (change.action === 'delete') {
        // A remote deletion needs a deterministic detached edge, but that repair is not a local user edit.
        // Undo/redo already contains the connector-reference change in the same local history item.
        if (old && isConnectableShape(old) && !this.undoManager.undoing && !this.undoManager.redoing) {
          this.detachConnectorsFrom(key, this.remoteRepairOrigin);
        }
        if (old?.type === 'diagram' && externalChange) this.detachContainedChildrenFrom(key, this.remoteRepairOrigin);
        if (old?.type === 'code') this.codePreviewCache.forget(key);
        this.shapes.delete(key);
        this.opaqueShapes.delete(key);
        selectionChanged = this.sel.delete(key) || selectionChanged;
      } else {
        const raw = this.yMap.get(key);
        const shape = deserializeBoardShape(key, raw);
        if (!shape) {
          this.shapes.delete(key);
          this.opaqueShapes.set(key, raw);
          if (old?.type === 'code') this.codePreviewCache.forget(key);
          selectionChanged = this.sel.delete(key) || selectionChanged;
        } else {
          this.opaqueShapes.delete(key);
          if (old?.type === 'code' && shape.type !== 'code') this.codePreviewCache.forget(key);
          this.shapes.set(key, shape as unknown as AnyShape);
          this.rtree.insert(shape);
          // Undo/redo and remote Yjs writes bypass put(); keep the selected properties panel
          // synchronized with the map value just as local engine writes do.
          if (this.sel.has(key)) this.onShapeUpdate?.(shape as unknown as AnyShape);
        }
      }
      if (key !== this.editingId) redraw = true;
    });
    if (externalChange) this.reconcileContainerMembership(this.remoteRepairOrigin, false);
    if (selectionChanged) this.onSel?.([...this.sel]);
    if (redraw) this.dirty = true;
  };

  constructor(cv: HTMLCanvasElement, yMap: Y.Map<any>) {
    this.cv   = cv;
    this.cx   = cv.getContext('2d', {alpha:false})!;
    this.yMap = yMap;
    this.undoManager = new Y.UndoManager(this.yMap, {
      trackedOrigins: new Set([this]),
      // Engine operations are grouped explicitly at saveH() boundaries, not by wall-clock timing.
      captureTimeout: Number.POSITIVE_INFINITY,
      // Preserve map-key concurrency: remote writes must not be selectively erased by local undo.
      ignoreRemoteMapChanges: false,
    });

    this.yMap.forEach((raw:unknown, key:string) => {
      const shape = deserializeBoardShape(key, raw);
      if (!shape) { this.opaqueShapes.set(key, raw); return; }
      this.shapes.set(key, shape as unknown as AnyShape);
      this.rtree.insert(shape);
    });
    
    // Setup overlay DOM for Math/Code
    this.overlayDiv = document.createElement('div');
    this.overlayDiv.style.position = 'absolute';
    this.overlayDiv.style.inset = '0';
    this.overlayDiv.style.pointerEvents = 'none';
    this.overlayDiv.style.overflow = 'hidden';
    this.overlayDiv.style.zIndex = '10';
    
    this.wrapperDiv = document.createElement('div');
    this.wrapperDiv.style.transformOrigin = '0 0';
    this.overlayDiv.appendChild(this.wrapperDiv);
    
    // Wait for the canvas to be attached; cleanup cancels this on React/StrictMode remounts.
    this.overlayAttachTimer = setTimeout(() => {
      this.overlayAttachTimer = null;
      if (!this.destroyed && this.cv.parentElement) this.cv.parentElement.appendChild(this.overlayDiv);
    }, 100);

    this.yMap.observe(this.onYMapChange);

    this.saveH();
    this.loop();
  }

  // ─── coordinate conversion ──────────────────────────────────────────────
  // Keep pointer, zoom and DOM-overlay conversions in canvas backing-pixel space.
  // The canvas currently uses CSS-pixel backing dimensions (no DPR multiplier), but
  // the measured ratios also cover fractional CSS sizes and any future DPR backing.
  private clientToCanvas(clientX: number, clientY: number) {
    const rect = this.cv.getBoundingClientRect();
    const scaleX = rect.width > 0 ? this.cv.width / rect.width : 1;
    const scaleY = rect.height > 0 ? this.cv.height / rect.height : 1;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  }

  private canvasToClient(x: number, y: number) {
    const rect = this.cv.getBoundingClientRect();
    const scaleX = this.cv.width > 0 ? rect.width / this.cv.width : 1;
    const scaleY = this.cv.height > 0 ? rect.height / this.cv.height : 1;
    return {
      x: rect.left + x * scaleX,
      y: rect.top + y * scaleY,
    };
  }

  /** Canvas backing-pixel coordinates to board world coordinates through the camera only. */
  canvasToWorld(canvasX: number, canvasY: number) {
    return {
      x: (canvasX - this.cv.width / 2) / this.cam.zoom + this.cam.x,
      y: (canvasY - this.cv.height / 2) / this.cam.zoom + this.cam.y,
    };
  }

  /** Board world coordinates to canvas backing pixels through the camera only. */
  worldToCanvas(worldX: number, worldY: number) {
    return {
      x: (worldX - this.cam.x) * this.cam.zoom + this.cv.width / 2,
      y: (worldY - this.cam.y) * this.cam.zoom + this.cv.height / 2,
    };
  }

  // clientX/Y → world coords through CSS/client scaling followed by the camera transform.
  clientToWorld(clientX: number, clientY: number) {
    const pixel = this.clientToCanvas(clientX, clientY);
    return this.canvasToWorld(pixel.x, pixel.y);
  }

  // world → CSS/client screen coordinates (used by DOM overlays and pointer test tooling).
  worldToClient(worldX: number, worldY: number) {
    const pixel = this.worldToCanvas(worldX, worldY);
    return this.canvasToClient(pixel.x, pixel.y);
  }

  // ─── pointer events (called with raw DOM events from window listener) ───
  pointerDown(e: PointerEvent) {
    if (e.target && (e.target as HTMLElement).closest('.formula-editor-panel, .popover, .math-tools-panel, .no-canvas, .zoom-controls, .panel-ui, .toolbar, .code-editor-shell')) return;
    // A second pointer must not replace the in-flight gesture or its pointer identity.
    if (this.isDown || this.isPanning || this.isErasing || this.isDragging || this.isResizing || this.isBoxing || this.isLassoing) return;
    if (e.isPrimary === false) return;
    if (e.button === 2 || e.button === 1) {
      e.preventDefault();
      this.activePointerId = Number.isFinite(e.pointerId) ? e.pointerId : null;
      this.isPanning = true;
      this.panButton = e.button;
      const pointer = this.clientToCanvas(e.clientX, e.clientY);
      this.panRef = { sx: pointer.x, sy: pointer.y, cx: this.cam.x, cy: this.cam.y };
      this.onCursor?.('grabbing');
      return;
    }
    if (e.button !== 0) return;

    const w = this.clientToWorld(e.clientX, e.clientY);

    if (this.tool === 'eraser') {
      this.isDown = true;
      this.activePointerId = Number.isFinite(e.pointerId) ? e.pointerId : null;
      this.isErasing = true;
      this.eraseChanged = false;
      this.eraserCursorPoint = w;
      this.eraserLastPoint = w;
      this.eraseAlongSegment(w, w);
      this.dirty = true;
      return;
    }

    // --- 0. RESIZE HANDLE check (highest priority) ---
    const rh = this.hitResizeHandle(e.clientX, e.clientY);
    if (rh) {
      this.isResizing = true;
      this.activePointerId = Number.isFinite(e.pointerId) ? e.pointerId : null;
      this.resizeH    = rh.h;
      const s = this.shapes.get(rh.id)!;
      this.resizeRef  = { wx:w.x, wy:w.y, s:JSON.parse(JSON.stringify(s)) };
      this.onCursor?.(HANDLE_CURSORS[rh.h] ?? 'nwse-resize');
      return;
    }

    // Lasso remains a deliberate gesture; resize handles have already claimed their exact hit
    // regions above, so dragging elsewhere still starts a lasso.
    if (this.tool === 'lasso-select') {
      this.activePointerId = Number.isFinite(e.pointerId) ? e.pointerId : null;
      this.isLassoing = true;
      this.lassoPts = [w];
      if (!e.shiftKey) { this.sel.clear(); this.onSel?.([]); }
      this.onCursor?.('crosshair');
      this.dirty = true;
      return;
    }

    // --- 1. HIT TEST for existing objects ---
    let hit: AnyShape | null = null;

    const rawHit = this.hitShape(w.x, w.y);
    if (rawHit) {
      if (this.tool === 'select') {
        hit = rawHit;
      } else if (['text', 'math', 'code'].includes(this.tool)) {
        if (['text', 'math', 'code'].includes(rawHit.type)) hit = rawHit;
      } else if (this.tool === 'sticky') {
        if (rawHit.type === 'sticky') hit = rawHit;
      } else if (isConnectorTool(this.tool)) {
        if (rawHit.type === 'connector' || rawHit.type === 'arrow' || rawHit.type === 'line') hit = rawHit;
      } else if (isBoxShapeTool(this.tool)) {
        if (isBoxShapeTool(rawHit.type) || rawHit.type === 'diagram' || isConnectorShape(rawHit)) hit = rawHit;
      } else if (this.tool === 'image') {
        if (rawHit.type === 'image') hit = rawHit;
      }
    }

    if (hit) {
      if (!e.shiftKey && !this.sel.has(hit.id)) { this.sel.clear(); }
      this.sel.add(hit.id);
      this.onSel?.([...this.sel]);
      this.isDragging = true;
      this.activePointerId = Number.isFinite(e.pointerId) ? e.pointerId : null;
      this.dragRef = {wx:w.x, wy:w.y};
      this.dragOrigins.clear();
      this.sel.forEach(id => {
        const shape = this.shapes.get(id);
        if (!shape) return;
        this.dragOrigins.set(id, getXY(shape));
        if (shape.type === 'diagram') {
          for (const child of this.containedDescendants(id)) this.dragOrigins.set(child.id, getXY(child));
        }
      });
      this.onCursor?.('move');
      this.dirty = true;
      return;
    }

    // --- 2. DESELECT IF CLICKING BOARD ---
    if (this.sel.size > 0 && !e.shiftKey) {
      this.sel.clear();
      this.onSel?.([]);
      this.dirty = true;
      // If something was selected, clicking anywhere on the board should ONLY drop selection.
      // E.g., drops the blue border without simultaneously acting as a new click drawing.
      return; 
    }

    // --- 3. TOOL SPECIFIC LOGIC ---

    // ── SELECT tool ──
    if (this.tool === 'select') {
      this.activePointerId = Number.isFinite(e.pointerId) ? e.pointerId : null;
      this.isBoxing = true;
      this.boxA = w; this.boxB = w;
      this.onCursor?.('default');
      this.dirty = true;
      return;
    }

    // ── PEN ──
    if (this.tool === 'pen') {
      this.isDown  = true;
      this.activePointerId = Number.isFinite(e.pointerId) ? e.pointerId : null;
      this.currId  = uid();
      this.activeSmartDrawing = this.penMode === 'smart';
      const s: PenShape = {
        id:this.currId, type:'pen',
        pts:[[w.x, w.y, this.pressureOf(e, 0.5)]],
        color:this.style.penColor, size:this.style.penSize,
        simulatePressure:false,
        minX:w.x, minY:w.y, maxX:w.x, maxY:w.y,
      };
      this.put(s, {persist: !this.activeSmartDrawing});
      return;
    }

    // ── STICKY / TEXT / MATH / CODE ──
    if (['sticky', 'text', 'math', 'code'].includes(this.tool)) {
      if (this.tool === 'sticky') {
        const id = uid();
        const x = w.x - 16 / this.cam.zoom;
        const y = w.y - 16 / this.cam.zoom;
        const s: StickyShape = {
          id, type: 'sticky',
          x, y, w: 240, h: 240, fs: 14,
          bg: this.style.stickyBg, text: '',
          minX:x, minY:y, maxX:x+240, maxY:y+240
        };
        this.put(s);
        this.sel.add(id); this.onSel?.([id]);
        this.saveH();
        setTimeout(() => this.onEditText?.(s, e.clientX, e.clientY), 30);
      } else {
        const id = uid();
        const offsetX = (this.tool === 'code' ? 46 : 16) / this.cam.zoom;
        const offsetY = (this.tool === 'code' ? 12 : 16) / this.cam.zoom;
        const nx = w.x - offsetX;
        const ny = w.y - offsetY;
        const codeBlock = this.tool === 'code';
        const width = codeBlock ? 360 : 200;
        const height = codeBlock ? initialCodeBlockHeight(this.style.fontSize) : 40;
        const s: TextShape = {
          id, type:this.tool as any, x:nx, y:ny, w:width, h:height,
          text: '',
          color: codeBlock ? '#d4d4d4' : '#000000', fs:this.style.fontSize,
          minX:nx, minY:ny, maxX:nx+width, maxY:ny+height,
          ...(codeBlock ? { language: DEFAULT_CODE_LANGUAGE, autoHeight: true } : {}),
          ...(this.tool === 'math' ? { previewText: '' } : {}),
        };
        this.put(s);
        this.sel.add(id); this.onSel?.([id]);
        this.saveH();
        setTimeout(() => this.onEditText?.(s, e.clientX, e.clientY), 30);
      }
      return;
    }

    // ── Registered diagram shapes and connectors ──
    if (isBoxShapeTool(this.tool) || isConnectorTool(this.tool)) {
      this.isDown = true;
      this.activePointerId = Number.isFinite(e.pointerId) ? e.pointerId : null;
      this.currId = uid();
      this.shapeOrigin = { x: w.x, y: w.y };
      const definition = getShapeDefinitionByToolId(this.tool);
      if (!definition) { this.isDown = false; this.currId = null; return; }
      if (definition.kind === 'connector') {
        const connector: ConnectorShape = {
          id: this.currId, type: 'connector', shapeId: definition.id,
          x1: w.x, y1: w.y, x2: w.x, y2: w.y, waypoints: [],
          color: this.style.stroke, sw: this.style.sw,
          lineStyle: definition.connector?.lineStyle ?? 'solid',
          startMarker: definition.connector?.startMarker ?? 'none', endMarker: definition.connector?.endMarker ?? 'none',
          ...(definition.connector?.sourceCardinality ? { sourceCardinality: definition.connector.sourceCardinality } : {}),
          ...(definition.connector?.targetCardinality ? { targetCardinality: definition.connector.targetCardinality } : {}),
          ...(definition.defaultLabel !== undefined ? { label: definition.defaultLabel } : {}),
          ...connectorBounds({ shapeId: definition.id, x1: w.x, y1: w.y, x2: w.x, y2: w.y, waypoints: [],
            startMarker: definition.connector?.startMarker ?? 'none', endMarker: definition.connector?.endMarker ?? 'none',
            sourceCardinality: definition.connector?.sourceCardinality, targetCardinality: definition.connector?.targetCardinality,
            label: definition.defaultLabel, sw: this.style.sw }),
        };
        this.put(connector);
      } else if (definition.legacyType) {
        this.put({ id: this.currId, type: definition.legacyType,
          x: w.x, y: w.y, w: 0, h: 0,
          shapeId: definition.id, params: { ...(definition.defaultParams ?? {}) }, rotation: 0,
          fill: definition.solid3d ? 'transparent' : this.style.fill, stroke: definition.defaultStroke ?? this.style.stroke,
          sw: definition.defaultStrokeWidth ?? this.style.sw,
          minX: w.x, minY: w.y, maxX: w.x, maxY: w.y } as any);
      } else {
        const diagram: DiagramShape = {
          id: this.currId, type: 'diagram', shapeId: definition.id,
          x: w.x, y: w.y, w: 0, h: 0, rotation: 0,
          fill: definition.solid3d ? 'transparent' : this.style.fill, stroke: definition.defaultStroke ?? this.style.stroke,
          sw: definition.defaultStrokeWidth ?? this.style.sw,
          ...(definition.defaultText !== undefined ? { text: definition.defaultText } : {}),
          fs: this.style.fontSize, textColor: '#1f2937', params: { ...(definition.defaultParams ?? {}) },
          ...(definition.solid3d ? { scale3d: { x: 1, y: 1, z: 1 } } : {}),
          ...(definition.defaultData ? { data: JSON.parse(JSON.stringify(definition.defaultData)) as Record<string, unknown> } : {}),
          minX: w.x, minY: w.y, maxX: w.x, maxY: w.y,
        };
        this.put(diagram);
      }
    }
  }

  private pressureOf(event: PointerEvent, fallback: number): number {
    const pressure = event.pressure;
    return Number.isFinite(pressure) && pressure > 0 ? Math.max(0, Math.min(1, pressure)) : fallback;
  }

  private appendPenSamples(event: PointerEvent) {
    const shape = this.currId ? this.shapes.get(this.currId) : undefined;
    if (!shape || shape.type !== 'pen') return;
    const stroke = shape as PenShape;
    let samples: PointerEvent[] = [];
    if (typeof event.getCoalescedEvents === 'function') {
      try { samples = event.getCoalescedEvents(); } catch { samples = []; }
    }
    if (!samples.length) samples = [event];
    const lastCoalesced = samples[samples.length - 1];
    if (!lastCoalesced || lastCoalesced.clientX !== event.clientX || lastCoalesced.clientY !== event.clientY ||
        Math.abs((lastCoalesced.pressure || 0.5) - (event.pressure || 0.5)) > 0.015) samples.push(event);

    const points = stroke.pts.slice();
    let minX = stroke.minX, minY = stroke.minY, maxX = stroke.maxX, maxY = stroke.maxY;
    let last = points[points.length - 1];
    let changed = false;
    for (const sample of samples) {
      if (this.activePointerId !== null && Number.isFinite(sample.pointerId) && sample.pointerId !== this.activePointerId) continue;
      const world = this.clientToWorld(sample.clientX, sample.clientY);
      const pressure = this.pressureOf(sample, last?.[2] ?? 0.5);
      if (last && (world.x - last[0]) ** 2 + (world.y - last[1]) ** 2 < 1e-8 && Math.abs(pressure - (last[2] ?? 0.5)) < 0.015) continue;
      last = [world.x, world.y, pressure];
      points.push(last);
      minX = Math.min(minX, world.x); maxX = Math.max(maxX, world.x);
      minY = Math.min(minY, world.y); maxY = Math.max(maxY, world.y);
      changed = true;
    }
    if (!changed) return;
    this.put({ ...stroke, pts: points, minX, minY, maxX, maxY }, {persist:false});
    if (!this.activeSmartDrawing) this.schedulePenPublish(stroke.id);
  }

  private schedulePenPublish(id: string) {
    if (this.pendingPenPublishRaf !== null) return;
    this.pendingPenPublishRaf = requestAnimationFrame(() => {
      this.pendingPenPublishRaf = null;
      if (this.destroyed || this.currId !== id || this.activeSmartDrawing) return;
      const stroke = this.shapes.get(id);
      if (!stroke || stroke.type !== 'pen') return;
      const persisted = this.yMap.get(id) as PenShape | undefined;
      if (persisted && persisted.pts.length === stroke.pts.length) return;
      this.put(stroke, {redraw:false});
    });
  }

  private flushPenPublish() {
    if (this.pendingPenPublishRaf !== null) {
      cancelAnimationFrame(this.pendingPenPublishRaf);
      this.pendingPenPublishRaf = null;
    }
    if (!this.currId || this.activeSmartDrawing) return;
    const stroke = this.shapes.get(this.currId);
    if (!stroke || stroke.type !== 'pen') return;
    const persisted = this.yMap.get(stroke.id) as PenShape | undefined;
    if (!persisted || persisted.pts.length !== stroke.pts.length) this.put(stroke, {redraw:false});
  }

  pointerMove(e: PointerEvent) {
    if (this.activePointerId !== null && e.pointerId !== this.activePointerId) return;
    const w = this.clientToWorld(e.clientX, e.clientY);

    // ── panning ──
    if (this.isPanning) {
      const pointer = this.clientToCanvas(e.clientX, e.clientY);
      const dsx = pointer.x - this.panRef.sx;
      const dsy = pointer.y - this.panRef.sy;
      this.cam.x = this.panRef.cx - dsx / this.cam.zoom;
      this.cam.y = this.panRef.cy - dsy / this.cam.zoom;
      this.dirty = true;
      return;
    }

    if (this.tool === 'eraser') {
      const target = e.target as HTMLElement | null;
      const blocked = target?.closest?.('.no-canvas, .panel-ui, .toolbar, .popover, .formula-editor-panel, .math-tools-panel, .code-editor-shell');
      if (this.isErasing) {
        if (blocked) {
          this.eraserCursorPoint = null;
          this.eraserLastPoint = null;
          this.dirty = true;
          return;
        }
        this.eraserCursorPoint = w;
        const from = this.eraserLastPoint ?? w;
        this.eraseAlongSegment(from, w);
        this.eraserLastPoint = w;
        this.dirty = true;
        return;
      }
      this.updateEraserHover(e);
    }

    // ── dragging selected shapes ──
    if (this.isDragging) {
      const dx = w.x - this.dragRef.wx;
      const dy = w.y - this.dragRef.wy;
      this.dragOrigins.forEach((orig, id) => {
        const shape = this.shapes.get(id);
        if (!shape) return;
        this.put(moveShape(shape, orig.x + dx, orig.y + dy));
      });
      return;
    }

    // ── resizing ──
    if (this.isResizing && this.resizeRef) {
      this.doResize(w.x, w.y);
      return;
    }

    // ── selection box ──
    if (this.isBoxing) {
      this.boxB = w;
      this.dirty = true;
      return;
    }

    // ── lasso selection ──
    if (this.isLassoing) {
      this.lassoPts.push(w);
      this.dirty = true;
      return;
    }

    // Hover ordinary selection/resize affordances; local 3D rotation remains available in properties.
    if (!this.isDown && !this.isDragging && !this.isResizing && !this.isPanning) {
      if (this.tool === 'select' || this.tool === 'lasso-select') {
        const handle = this.tool === 'select' ? this.hitResizeHandle(e.clientX, e.clientY) : null;
        if (handle) this.onCursor?.(HANDLE_CURSORS[handle.h] ?? 'nwse-resize');
        else if (this.tool === 'lasso-select') this.onCursor?.('crosshair');
        else this.onCursor?.(this.hitShape(w.x, w.y) ? 'move' : 'default');
      }
    }

    // ── drawing / eraser tracking ──
    if (!this.isDown) return;
    const s = this.currId ? this.shapes.get(this.currId) : undefined;
    if (!s) return;

    // ── pen stroke ──
    if (s.type === 'pen') {
      this.appendPenSamples(e);
      return;
    }

    // ── legacy and registered connectors ──
    if (s.type === 'arrow') {
      const a = s as ArrowShape;
      this.put({ ...a, x2: w.x, y2: w.y,
        minX: Math.min(a.x1, w.x), minY: Math.min(a.y1, w.y),
        maxX: Math.max(a.x1, w.x), maxY: Math.max(a.y1, w.y) });
      return;
    }
    if (s.type === 'connector') {
      const connector = s as ConnectorShape;
      this.put({ ...connector, x2: w.x, y2: w.y,
        ...connectorBounds({ ...connector, x2: w.x, y2: w.y }) });
      return;
    }

    // ── registered/legacy box shapes ──
    if ('w' in s) {
      const definition = s.type === 'diagram' ? getShapeDefinition((s as DiagramShape).shapeId) : getShapeDefinitionForLegacyType(s.type);
      const box = normalizeDragBox(this.shapeOrigin, w, getShapeCreationResizePolicy(definition));
      const next = { ...(s as any), ...box };
      if (s.type === 'diagram' && definition?.solid3d) {
        next.scale3d = fitSolidScaleToProjectedBounds({ ...next } as DiagramShape, definition, { x: 1, y: 1, z: 1 }, box.w, box.h, 'create');
      }
      Object.assign(next, rotatedBoxBounds(next));
      this.put(next as AnyShape);
    }
  }

  pointerUp(eventOrButton?: number | PointerEvent) {
    const event = typeof eventOrButton === 'number' ? undefined : eventOrButton;
    const button = typeof eventOrButton === 'number' ? eventOrButton : eventOrButton?.button;
    if (event && this.activePointerId !== null && Number.isFinite(event.pointerId) && event.pointerId !== this.activePointerId) return;
    if (this.isDown && event && event.button !== undefined && event.button !== 0) return;
    if (this.isPanning) {
      if (button !== undefined && this.panButton !== null && button !== this.panButton) return;
      this.isPanning = false;
      this.panButton = null;
      this.activePointerId = null;
      this.onCursor?.(this.cursorForTool());
      return;
    }
    if (this.isErasing) {
      this.finishErasing(true);
      if (event && this.tool === 'eraser') this.updateEraserHover(event);
      this.onCursor?.(this.cursorForTool());
      return;
    }
    if (this.isDragging) {
      this.isDragging = false;
      this.activePointerId = null;
      this.onCursor?.('move');
      this.reconcileContainerMembership(this, true);
      this.saveH();
      return;
    }
    if (this.isResizing) {
      const resizeId = this.resizeRef?.s?.id;
      const resized = resizeId ? this.shapes.get(resizeId) : undefined;
      if (resized?.type === 'connector') this.snapConnectorShape(resized as ConnectorShape);
      this.reconcileContainerMembership(this, true);
      this.isResizing = false;
      this.activePointerId = null;
      this.resizeH = '';
      this.resizeRef = null;
      this.onCursor?.('default');
      this.saveH();
      return;
    }
    if (this.isBoxing) {
      this.isBoxing = false;
      this.activePointerId = null;
      const x0=Math.min(this.boxA.x,this.boxB.x), y0=Math.min(this.boxA.y,this.boxB.y);
      const x1=Math.max(this.boxA.x,this.boxB.x), y1=Math.max(this.boxA.y,this.boxB.y);
      if (x1-x0>4 || y1-y0>4) {
        this.shapes.forEach(s => {
          if (s.minX<x1 && s.maxX>x0 && s.minY<y1 && s.maxY>y0) this.sel.add(s.id);
        });
        this.onSel?.([...this.sel]);
      }
      this.dirty = true;
      return;
    }
    
    if (this.isLassoing) {
      this.isLassoing = false;
      this.activePointerId = null;
      if (this.lassoPts.length > 2) {
        const polygon = this.lassoPts.map(point => [point.x, point.y] as [number, number]);
        const tolerance = 3 / Math.max(0.04, this.cam.zoom);
        const minX = Math.min(...polygon.map(point => point[0])) - tolerance;
        const maxX = Math.max(...polygon.map(point => point[0])) + tolerance;
        const minY = Math.min(...polygon.map(point => point[1])) - tolerance;
        const maxY = Math.max(...polygon.map(point => point[1])) + tolerance;
        const candidates = this.rtree.search({ minX, minY, maxX, maxY }) as AnyShape[];
        candidates.forEach(shape => {
          if (this.shapeTouchesLasso(shape, polygon, tolerance)) this.sel.add(shape.id);
        });
        this.onSel?.([...this.sel]);
      }
      this.lassoPts = [];
      this.dirty = true;
      return;
    }

    if (this.isDown && event && this.currId) {
      const shape = this.shapes.get(this.currId);
      const world = this.clientToWorld(event.clientX, event.clientY);
      if (shape?.type === 'pen' && event.button === 0) {
        this.appendPenSamples(event);
      } else if (shape?.type === 'arrow') {
        const arrow = shape as ArrowShape;
        this.put({ ...arrow, x2: world.x, y2: world.y,
          minX: Math.min(arrow.x1, world.x), minY: Math.min(arrow.y1, world.y),
          maxX: Math.max(arrow.x1, world.x), maxY: Math.max(arrow.y1, world.y) });
      } else if (shape?.type === 'connector') {
        const connector = shape as ConnectorShape;
        this.put({ ...connector, x2: world.x, y2: world.y, ...connectorBounds({ ...connector, x2: world.x, y2: world.y }) });
      } else if (shape && 'w' in shape) {
        const definition = shape.type === 'diagram' ? getShapeDefinition((shape as DiagramShape).shapeId) : getShapeDefinitionForLegacyType(shape.type);
        const box = normalizeDragBox(this.shapeOrigin, world, getShapeCreationResizePolicy(definition));
        const next = { ...(shape as any), ...box };
        if (shape.type === 'diagram' && definition?.solid3d) {
          next.scale3d = fitSolidScaleToProjectedBounds(next as DiagramShape, definition, { x: 1, y: 1, z: 1 }, box.w, box.h, 'create');
        }
        Object.assign(next, rotatedBoxBounds(next));
        this.put(next as AnyShape);
      }
    }
    if (this.isDown && this.currId && !this.activeSmartDrawing) this.flushPenPublish();

    if (this.isDown) {
      this.isDown = false;
      if (this.currId) {
        let shape = this.shapes.get(this.currId);
        if (shape?.type === 'pen' && this.activeSmartDrawing) {
          const converted = this.finalizeSmartStroke(shape as PenShape);
          if (!converted) this.put(shape, {persist:true});
          shape = this.shapes.get(this.currId);
        }
        // Click-to-create uses each registered definition's dimensions; legacy box tools keep 120×80.
        if (this.tool !== 'pen' && shape && 'w' in shape && (shape as any).w < 5 && (shape as any).h < 5) {
          const box = shape as any;
          const definition = shape.type === 'diagram' ? getShapeDefinition(shape.shapeId) : getShapeDefinitionForLegacyType(shape.type);
          const width = definition?.width ?? 120;
          const height = definition?.height ?? 80;
          const resized = { ...box, w: width, h: height };
          if (shape.type === 'diagram' && definition?.solid3d) {
            resized.scale3d = fitSolidScaleToProjectedBounds(resized as DiagramShape, definition, { x: 1, y: 1, z: 1 }, width, height, 'uniform');
          }
          Object.assign(resized, rotatedBoxBounds(resized));
          this.put(resized as AnyShape);
          shape = this.shapes.get(this.currId);
        } else if (shape?.type === 'arrow') {
          const arrow = shape as ArrowShape;
          if (Math.abs(arrow.x2 - arrow.x1) < 5 && Math.abs(arrow.y2 - arrow.y1) < 5)
            this.put({ ...arrow, x2: arrow.x1 + 120, maxX: arrow.x1 + 120 });
          shape = this.shapes.get(this.currId);
        } else if (shape?.type === 'connector') {
          const connector = shape as ConnectorShape;
          if (Math.hypot(connector.x2 - connector.x1, connector.y2 - connector.y1) < 5) {
            const definition = getShapeDefinition(connector.shapeId);
            const moved = { ...connector, x2: connector.x1 + Math.max(60, definition?.width ?? 120), y2: connector.y1 + Math.max(0, definition?.height ?? 0) };
            this.put({ ...moved, ...connectorBounds(moved) });
          }
          shape = this.shapes.get(this.currId);
        }
        if (shape?.type === 'connector') this.snapConnectorShape(shape as ConnectorShape);
        this.reconcileContainerMembership(this, true);

        if (this.tool !== 'pen') {
          this.sel.clear();
          this.sel.add(this.currId);
          this.onSel?.([...this.sel]);
          this.dirty = true;
        } else {
          this.sel.clear(); this.onSel?.([]);
          this.dirty = true;
        }

        this.currId = null;
        this.activeSmartDrawing = false;
        this.saveH();
        this.mark();
      }
      this.activePointerId = null;
    }
  }

  doubleClick(e: MouseEvent) {
    const w = this.clientToWorld(e.clientX, e.clientY);
    const hit = this.hitShape(w.x, w.y);
    if (hit && isLabelEditableShape(hit)) this.onEditText?.(hit, e.clientX, e.clientY);
  }

  public updateSize(id: string, w: number, h: number) {
    const shape = this.shapes.get(id);
    if (!shape || !('w' in shape) || (shape.w === w && shape.h === h)) return;
    let resizedShape: AnyShape = { ...shape, w, h } as AnyShape;
    if (shape.type === 'diagram') {
      const diagram = shape as DiagramShape, definition = getShapeDefinition(diagram.shapeId);
      if (definition?.solid3d) {
        const bounds = localSolidProjectedBounds(diagram), baseScale = diagram.scale3d
          ?? solid3DScaleFromBounds(diagram.w, diagram.h, definition.width, definition.height, definition.geometry as import('./shapes/solid3d').Solid3DGeometry);
        const scale3d = fitSolidScaleToProjectedBounds(diagram, definition, baseScale,
          (bounds.maxX - bounds.minX) * w / Math.max(1, diagram.w), (bounds.maxY - bounds.minY) * h / Math.max(1, diagram.h));
        resizedShape = { ...diagram, w, h, scale3d };
      }
    }
    const resized = withComputedShapeBounds(resizedShape);
    // Formula overlays can report a final measured layout just after committing source.
    // Keep that same-object measurement in the edit's existing undo item.
    this.put(resized, { redraw: id !== this.editingId,
      ...(this.pendingFormulaCaptureId === id ? { historyContinuationId: id } : {}) });
  }

  public updatePos(id: string, x: number, y: number) {
    const s = this.shapes.get(id);
    if (s && 'x' in s) {
      // For box shapes (sticky, text, math, code, rect, etc.)
      const b = s as any;
      const news = withComputedShapeBounds({ ...b, x, y } as AnyShape);
      this.put(news);
    } else if (s && s.type === 'pen') {
      const pen = s as PenShape;
      const dx = x - pen.minX;
      const dy = y - pen.minY;
      const news: PenShape = {
        ...pen,
        pts: pen.pts.map(p => [p[0] + dx, p[1] + dy, p[2]]),
        minX: x, minY: y, maxX: pen.maxX + dx, maxY: pen.maxY + dy
      };
      this.put(news);
    } else if (s && s.type === 'line') {
      const line = s as LineShape;
      const dx = x - line.x1, dy = y - line.y1;
      this.put({ ...line, x1: x, y1: y, x2: line.x2 + dx, y2: line.y2 + dy,
        minX: Math.min(x, line.x2 + dx), minY: Math.min(y, line.y2 + dy),
        maxX: Math.max(x, line.x2 + dx), maxY: Math.max(y, line.y2 + dy) });
    } else if (s && s.type === 'curve') {
      const curve = s as CurveShape;
      const dx = x - curve.minX, dy = y - curve.minY;
      this.put({ ...curve, pts: curve.pts.map(point => [point[0] + dx, point[1] + dy, point[2]]),
        minX: x, minY: y, maxX: curve.maxX + dx, maxY: curve.maxY + dy });
    } else if (s && s.type === 'arrow') {
      const a = s as ArrowShape;
      const dx = x - a.x1;
      const dy = y - a.y1;
      const news: ArrowShape = {
        ...a,
        x1: x, y1: y, x2: a.x2 + dx, y2: a.y2 + dy,
        minX: Math.min(x, a.x2 + dx), minY: Math.min(y, a.y2 + dy),
        maxX: Math.max(x, a.x2 + dx), maxY: Math.max(y, a.y2 + dy)
      };
      this.put(news);
    }
  }

  // ─── helpers ────────────────────────────────────────────────────────────
  private transactMap(work: () => void, origin: object = this) {
    const document = this.yMap.doc;
    if (document) document.transact(work, origin);
    else work();
  }

  private closePendingFormulaCapture(continuationShapeId?: string) {
    if (!this.pendingFormulaCaptureId || this.pendingFormulaCaptureId === continuationShapeId) return;
    this.pendingFormulaCaptureId = null;
    this.undoManager.stopCapturing();
  }

  private put(shape: AnyShape, options: { redraw?: boolean; notify?: boolean; persist?: boolean; syncAttachments?: boolean; origin?: object; historyContinuationId?: string } = {}) {
    const isTrackedLocalWrite = options.persist !== false && (options.origin ?? this) === this;
    if (isTrackedLocalWrite) this.closePendingFormulaCapture(options.historyContinuationId);
    const s = withComputedShapeBounds(shape);
    const old = this.shapes.get(s.id);
    if (old) this.rtree.remove(old);
    this.shapes.set(s.id, s);
    this.rtree.insert(s);
    if (options.persist !== false) this.transactMap(() => this.yMap.set(s.id, s), options.origin ?? this);
    if (options.redraw !== false) this.dirty = true;
    if (options.notify !== false) this.onShapeUpdate?.(s);
    if (options.syncAttachments !== false && isConnectableShape(s)) this.updateAttachedConnectors(s.id);
  }

  private deleteShapes(ids: string[]): string[] {
    const removed = ids.flatMap(id => {
      const shape = this.shapes.get(id);
      return shape ? [{ id, shape }] : [];
    });
    if (!removed.length) return [];
    this.closePendingFormulaCapture();
    removed.forEach(({ id, shape }) => {
      if (isConnectableShape(shape)) this.detachConnectorsFrom(id);
      if (shape.type === 'diagram') this.detachContainedChildrenFrom(id, this);
    });
    this.transactMap(() => removed.forEach(({ id }) => this.yMap.delete(id)));
    removed.forEach(({ id, shape }) => {
      this.rtree.remove(shape);
      if (shape.type === 'code') this.codePreviewCache.forget(id);
      this.shapes.delete(id);
    });
    this.reconcileContainerMembership(this, true);
    this.dirty = true;
    return removed.map(({ id }) => id);
  }

  private del(id: string): boolean {
    return this.deleteShapes([id]).length > 0;
  }

  private eraseAlongSegment(from: { x: number; y: number }, to: { x: number; y: number }) {
    const radius = ERASER_RADIUS_PX / Math.max(0.04, this.cam.zoom);
    const broadPhase = radius + MAX_PEN_STROKE_WIDTH / 2 + 22;
    const candidates = this.rtree.search({
      minX: Math.min(from.x, to.x) - broadPhase,
      minY: Math.min(from.y, to.y) - broadPhase,
      maxX: Math.max(from.x, to.x) + broadPhase,
      maxY: Math.max(from.y, to.y) + broadPhase,
    }) as AnyShape[];
    const removedIds = this.deleteShapes(candidates.filter(shape => eraserSegmentTouchesShape(shape, from, to, radius)).map(shape => shape.id));
    if (removedIds.length) {
      this.eraseChanged = true;
      let selectionChanged = false;
      removedIds.forEach(id => { selectionChanged = this.sel.delete(id) || selectionChanged; });
      if (selectionChanged) this.onSel?.([...this.sel]);
    }
  }

  private updateEraserHover(event: PointerEvent) {
    const rect = this.cv.getBoundingClientRect();
    const target = event.target as HTMLElement | null;
    const blocked = target?.closest?.('.no-canvas, .panel-ui, .toolbar, .popover, .formula-editor-panel, .math-tools-panel, .code-editor-shell');
    const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
    this.eraserCursorPoint = inside && !blocked ? this.clientToWorld(event.clientX, event.clientY) : null;
    this.dirty = true;
  }

  private finishErasing(preserveCursor = false) {
    this.isErasing = false;
    this.isDown = false;
    this.activePointerId = null;
    this.eraserLastPoint = null;
    if (!preserveCursor) this.eraserCursorPoint = null;
    if (this.eraseChanged) this.saveH();
    this.eraseChanged = false;
    this.dirty = true;
  }

  private finalizeSmartStroke(stroke: PenShape): boolean {
    const result = recognizeSmartDrawing(stroke.pts, stroke.size);
    if (result.kind === 'unchanged') return false;
    if (result.kind === 'line') {
      if (result.points.length < 2) return false;
      const [first, last] = result.points;
      if (!Number.isFinite(first[0]) || !Number.isFinite(first[1]) || !Number.isFinite(last[0]) || !Number.isFinite(last[1])) return false;
      this.put({
        id: stroke.id, type: 'line',
        x1: first[0], y1: first[1], x2: last[0], y2: last[1],
        color: stroke.color, sw: stroke.size,
        minX: Math.min(first[0], last[0]), minY: Math.min(first[1], last[1]),
        maxX: Math.max(first[0], last[0]), maxY: Math.max(first[1], last[1]),
      } as LineShape);
      return true;
    }
    if (result.kind !== 'rectangle' && result.kind !== 'ellipse' && result.kind !== 'triangle') return false;
    const bounds = result.bounds;
    if (!bounds || !Number.isFinite(bounds.x + bounds.y + bounds.w + bounds.h) || bounds.w <= 0 || bounds.h <= 0) return false;
    const vertices = (result.kind === 'triangle' || result.kind === 'rectangle') && result.vertices
      ? result.vertices.map(([x, y]) => [(x - bounds.x) / bounds.w, (y - bounds.y) / bounds.h] as [number, number])
      : undefined;
    const type = result.kind === 'rectangle' ? 'rect' : result.kind;
    this.put({
      id: stroke.id,
      type,
      x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h,
      fill: 'transparent', stroke: stroke.color, sw: stroke.size,
      minX: bounds.x, minY: bounds.y, maxX: bounds.x + bounds.w, maxY: bounds.y + bounds.h,
      ...(vertices ? { vertices } : {}),
    } as AnyShape);
    return true;
  }

  private hitShape(wx: number, wy: number): AnyShape|null {
    const P = 8/this.cam.zoom;
    const hits = this.rtree.search({minX:wx-P, minY:wy-P, maxX:wx+P, maxY:wy+P}) as AnyShape[];
    const point = { x: wx, y: wy };
    const preciseHits = hits.filter(shape => {
      if (shape.type === 'line' || shape.type === 'arrow') {
        const line = shape as LineShape | ArrowShape;
        return pointToSegmentDistance(point, { x: line.x1, y: line.y1 }, { x: line.x2, y: line.y2 }) <= P + line.sw / 2;
      }
      if (shape.type === 'connector') {
        const connector = shape as ConnectorShape, route = getConnectorRoute(connector);
        if (route.slice(1).some((sample, index) => pointToSegmentDistance(point,
          { x: route[index][0], y: route[index][1] }, { x: sample[0], y: sample[1] }) <= P + connector.sw / 2)) return true;
        const label = this.connectorLabelVisual(connector, route);
        if (label && Math.abs(point.x - label.x) <= label.width / 2 + P
          && Math.abs(point.y - label.y) <= label.height / 2 + P) return true;
        return false;
      }
      if (shape.type === 'curve') {
        const curve = shape as CurveShape;
        return curve.pts.length === 1
          ? Math.hypot(wx - curve.pts[0][0], wy - curve.pts[0][1]) <= P + curve.sw / 2
          : curve.pts.slice(1).some((sample, index) => pointToSegmentDistance(point,
            { x: curve.pts[index][0], y: curve.pts[index][1] }, { x: sample[0], y: sample[1] }) <= P + curve.sw / 2);
      }
      if (shape.type === 'diagram') return pointTouchesDiagram(shape as DiagramShape, point, P);
      if (isBoxShapeTool(shape.type)) {
        const vertices = getShapeVertices(shape);
        if (vertices.length >= 3) {
          const inside = pointInsidePolygon(point, vertices);
          if (inside) return true;
          return vertices.some((vertex, index) => pointToSegmentDistance(point,
            { x: vertex[0], y: vertex[1] }, { x: vertices[(index + 1) % vertices.length][0], y: vertices[(index + 1) % vertices.length][1] }) <= P + shapeStrokeWidth(shape) / 2);
        }
      }
      return true;
    });
    return preciseHits[preciseHits.length-1] ?? null;
  }

  private diagramTouchesLasso(shape: DiagramShape, polygon: [number, number][], tolerance: number): boolean {
    const definition = getShapeDefinition(shape.shapeId);
    if (!definition) return false;
    const { outlines, decorations, intrinsicFills } = getDiagramPathGroups(shape);
    const strokeRadius = tolerance + Math.max(0, shape.sw) / 2;
    // Closed canonical silhouettes are treated as bounded shape regions even when their paint
    // fill is transparent. Open semantic marks (Actor limbs, lifelines, notation rules) remain
    // stroke geometry. Table/classifier text belongs to the parent semantic object, never cells.
    for (const path of outlines) {
      if (path.length >= 3 && isClosedPath(path)) {
        if (lassoTouchesArea(polygon, path, strokeRadius)) return true;
      } else if (lassoTouchesPolyline(polygon, path, strokeRadius)) return true;
    }
    for (const path of intrinsicFills) if (lassoTouchesArea(polygon, path, strokeRadius)) return true;
    for (const path of decorations) {
      if (path.length >= 3 && isClosedPath(path) && lassoTouchesArea(polygon, path, strokeRadius)) return true;
      if (lassoTouchesPolyline(polygon, path, strokeRadius)) return true;
    }
    return false;
  }

  private shapeTouchesLasso(shape: AnyShape, polygon: [number, number][], tolerance: number): boolean {
    if (shape.type === 'pen') {
      const pen = shape as PenShape;
      return lassoTouchesPolyline(polygon, pen.pts.map(point => [point[0], point[1]]), tolerance + Math.max(0, pen.size) / 2);
    }
    if (shape.type === 'curve') {
      const curve = shape as CurveShape;
      return lassoTouchesPolyline(polygon, curve.pts.map(point => [point[0], point[1]]), tolerance + Math.max(0, curve.sw) / 2);
    }
    if (shape.type === 'line' || shape.type === 'arrow') {
      const line = shape as LineShape | ArrowShape;
      const radius = tolerance + Math.max(0, line.sw) / 2;
      if (lassoTouchesPolyline(polygon, [[line.x1, line.y1], [line.x2, line.y2]], radius)) return true;
      if (shape.type === 'arrow') {
        const marker = legacyArrowHeadPolygon(shape as ArrowShape);
        if (marker.length && lassoTouchesArea(polygon, marker, radius)) return true;
      }
      return false;
    }
    if (shape.type === 'connector') {
      const connector = shape as ConnectorShape, route = getConnectorRoute(connector);
      const radius = tolerance + Math.max(0, connector.sw) / 2;
      if (lassoTouchesPolyline(polygon, route, radius)) return true;
      const markerSize = Math.max(8, connector.sw * 3.1);
      const endpointMarkers = [
        { marker: connector.startMarker, point: route[0], neighbor: route[1] ?? route[0] },
        { marker: connector.endMarker, point: route.at(-1) ?? route[0], neighbor: route.at(-2) ?? route[0] },
      ];
      for (const endpoint of endpointMarkers) {
        for (const markerPath of connectorMarkerPaths(endpoint.marker, endpoint.point, endpoint.neighbor, markerSize)) {
          if (isClosedPath(markerPath) ? lassoTouchesArea(polygon, markerPath, radius)
            : lassoTouchesPolyline(polygon, markerPath, radius)) return true;
        }
      }
      const cardinalityRadius = Math.max(9, connector.sw * 3) * 1.55 + radius;
      if (connector.sourceCardinality && lassoTouchesArea(polygon, circlePolygon(route[0], cardinalityRadius), 0)) return true;
      const end = route.at(-1) ?? route[0];
      if (connector.targetCardinality && lassoTouchesArea(polygon, circlePolygon(end, cardinalityRadius), 0)) return true;
      const label = this.connectorLabelVisual(connector, route);
      if (label && lassoTouchesArea(polygon, [[label.x - label.width / 2, label.y - label.height / 2],
        [label.x + label.width / 2, label.y - label.height / 2], [label.x + label.width / 2, label.y + label.height / 2],
        [label.x - label.width / 2, label.y + label.height / 2]], tolerance)) return true;
      return false;
    }
    if (shape.type === 'diagram') return this.diagramTouchesLasso(shape as DiagramShape, polygon, tolerance);
    if ('x' in shape && 'w' in shape && 'h' in shape) {
      const box = shape as BoxShape;
      if (isBoxShapeTool(shape.type)) {
        const definition = getShapeDefinitionForLegacyType(shape.type) ?? getShapeDefinitionByToolId(shape.type);
        if (definition) {
          const vertices = getShapeVertices(shape);
          if (vertices.length >= 3) return lassoTouchesArea(polygon, vertices, tolerance + shapeStrokeWidth(shape) / 2);
          const legacyDiagram = { ...shape, type: 'diagram', shapeId: definition.id,
            params: { ...(definition.defaultParams ?? {}), ...(box.params ?? {}) } } as unknown as DiagramShape;
          return this.diagramTouchesLasso(legacyDiagram, polygon, tolerance);
        }
      }
      // Text, sticky notes, images and other DOM-backed boxes are selected by their rotated frame.
      return lassoTouchesArea(polygon, rotatedBoxCorners(box), tolerance);
    }
    return false;
  }

  private solidSelectionCorners(shape: DiagramShape): [number, number][] {
    return projectedSolidWorldCorners(shape);
  }

  private solidResizeHandlePoints(shape: DiagramShape): [string, number, number][] {
    const corners = this.solidSelectionCorners(shape);
    const midpoint = (a: [number, number], b: [number, number]): [number, number] => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    return [['nw', ...corners[0]], ['n', ...midpoint(corners[0], corners[1])], ['ne', ...corners[1]],
      ['e', ...midpoint(corners[1], corners[2])], ['se', ...corners[2]], ['s', ...midpoint(corners[2], corners[3])],
      ['sw', ...corners[3]], ['w', ...midpoint(corners[3], corners[0])]];
  }

  // Registered box objects expose transformed resize/rotation handles; connectors expose endpoints and waypoints.
  private hitResizeHandle(cx: number, cy: number): { id: string; h: string } | null {
    const radius = 9;
    const hit = (wx: number, wy: number) => {
      const screen = this.worldToClient(wx, wy);
      return Math.hypot(cx - screen.x, cy - screen.y) <= radius;
    };
    for (const shape of this.shapes.values()) {
      if (!this.sel.has(shape.id)) continue;
      if (shape.type === 'connector') {
        const connector = shape as ConnectorShape;
        if (hit(connector.x1, connector.y1)) return { id: shape.id, h: 'line-start' };
        if (hit(connector.x2, connector.y2)) return { id: shape.id, h: 'line-end' };
        for (let index = 0; index < connector.waypoints.length; index++) {
          const [x, y] = connector.waypoints[index];
          if (hit(x, y)) return { id: shape.id, h: `waypoint-${index}` };
        }
        if (hasConnectorRotationHandle(connector)) {
          const rotationHandle = { x: (shape.minX + shape.maxX) / 2, y: shape.minY - 24 / this.cam.zoom };
          if (hit(rotationHandle.x, rotationHandle.y)) return { id: shape.id, h: 'rotate' };
        }
        continue;
      }
      if (shape.type === 'line' || shape.type === 'arrow') {
        const line = shape as LineShape | ArrowShape;
        if (hit(line.x1, line.y1)) return { id: shape.id, h: 'line-start' };
        if (hit(line.x2, line.y2)) return { id: shape.id, h: 'line-end' };
        continue;
      }
      if (!('x' in shape && 'w' in shape)) continue;
      const box = shape as BoxShape;
      const diagramDefinition = box.type === 'diagram' ? getShapeDefinition((box as DiagramShape).shapeId) : undefined;
      const solidShape = box.type === 'diagram' && diagramDefinition?.solid3d ? box as DiagramShape : null;
      const handles = solidShape ? this.solidResizeHandlePoints(solidShape) : getBoxHandlePoints(box);
      for (const [handle, x, y] of handles) if (hit(x, y)) return { id: shape.id, h: handle };
      // A solid's on-object XYZ triad is its sole rotation control; suppress the old 2D
      // selection-box rotate tab so pointer ownership and the UI cannot disagree.
      if (solidShape) continue;
      const [rotateX, rotateY] = getRotationHandlePoint(box, this.cam.zoom);
      if (hit(rotateX, rotateY)) return { id: shape.id, h: 'rotate' };
    }
    return null;
  }

  private doResize(wx: number, wy: number) {
    if (!this.resizeRef) return;
    const original = this.resizeRef.s as AnyShape & Record<string, any>;
    const dx = wx - this.resizeRef.wx, dy = wy - this.resizeRef.wy;
    if (original.type === 'connector') {
      const connector = original as ConnectorShape;
      const current = this.shapes.get(connector.id) as ConnectorShape;
      if (this.resizeH === 'rotate') {
        const cx = (connector.minX + connector.maxX) / 2, cy = (connector.minY + connector.maxY) / 2;
        const a0 = Math.atan2(this.resizeRef.wy - cy, this.resizeRef.wx - cx);
        const a1 = Math.atan2(wy - cy, wx - cx), angle = (a1 - a0) * 180 / Math.PI;
        const centerX = (connector.x1 + connector.x2) / 2, centerY = (connector.y1 + connector.y2) / 2;
        const [x1, y1] = rotatePoint(connector.x1, connector.y1, centerX, centerY, angle);
        const [x2, y2] = rotatePoint(connector.x2, connector.y2, centerX, centerY, angle);
        const waypoints = connector.waypoints.map(([x, y]) => rotatePoint(x, y, centerX, centerY, angle));
        const next = { ...connector, x1, y1, x2, y2, waypoints, sourceRef: undefined, targetRef: undefined };
        this.put({ ...next, ...connectorBounds(next) });
      } else if (this.resizeH === 'line-start' || this.resizeH === 'line-end') {
        const start = this.resizeH === 'line-start';
        const next = { ...current,
          x1: connector.x1 + (start ? dx : 0), y1: connector.y1 + (start ? dy : 0),
          x2: connector.x2 + (start ? 0 : dx), y2: connector.y2 + (start ? 0 : dy),
          ...(start ? { sourceRef: undefined } : { targetRef: undefined }),
        };
        this.put({ ...next, ...connectorBounds(next) });
      } else if (this.resizeH.startsWith('waypoint-')) {
        const index = Number(this.resizeH.slice('waypoint-'.length));
        if (!Number.isInteger(index) || index < 0 || index >= connector.waypoints.length) return;
        const waypoints = current.waypoints.map(point => [point[0], point[1]] as [number, number]);
        waypoints[index] = [connector.waypoints[index][0] + dx, connector.waypoints[index][1] + dy];
        const next = { ...current, waypoints };
        this.put({ ...next, ...connectorBounds(next) });
      }
      return;
    }
    if (original.type === 'line' || original.type === 'arrow') {
      const line = original as LineShape | ArrowShape;
      if (this.resizeH !== 'line-start' && this.resizeH !== 'line-end') return;
      const start = this.resizeH === 'line-start';
      const x1 = line.x1 + (start ? dx : 0), y1 = line.y1 + (start ? dy : 0);
      const x2 = line.x2 + (start ? 0 : dx), y2 = line.y2 + (start ? 0 : dy);
      this.put({ ...line, x1, y1, x2, y2, minX: Math.min(x1, x2), minY: Math.min(y1, y2), maxX: Math.max(x1, x2), maxY: Math.max(y1, y2) } as AnyShape);
      return;
    }
    if (!('x' in original && 'w' in original)) return;
    const box = original as BoxShape;
    if (this.resizeH === 'rotate') {
      const centerX = box.x + box.w / 2, centerY = box.y + box.h / 2;
      const initial = Math.atan2(this.resizeRef.wy - centerY, this.resizeRef.wx - centerX);
      const nextAngle = Math.atan2(wy - centerY, wx - centerX);
      const rotation = (box.rotation ?? 0) + (nextAngle - initial) * 180 / Math.PI;
      this.put(withComputedShapeBounds({ ...box, rotation } as AnyShape));
      return;
    }
    const minWidth = box.type === 'sticky' ? 120 : 20;
    const minHeight = box.type === 'sticky' ? 120 : box.type === 'code' ? initialCodeBlockHeight(box.fs) : 20;
    const definition = box.type === 'diagram' ? getShapeDefinition((box as DiagramShape).shapeId) : getShapeDefinitionForLegacyType(box.type);
    if (box.type === 'diagram' && definition?.solid3d) {
      const diagram = box as DiagramShape, projected = localSolidProjectedBounds(diagram);
      const frame = { x: diagram.x + projected.minX, y: diagram.y + projected.minY,
        w: Math.max(1, projected.maxX - projected.minX), h: Math.max(1, projected.maxY - projected.minY) };
      const [localX, localY] = unrotatePoint(wx, wy, diagram.x + diagram.w / 2, diagram.y + diagram.h / 2, diagram.rotation ?? 0);
      // Each projected resize axis maps back to independent local X/Y dimensions. Preserve local Z
      // depth; projection may change naturally after the actual pre-rotation model is resized.
      const resizedFrame = resizeBoxFromHandle(frame, this.resizeH, { x: localX, y: localY },
        { mode: 'free' }, 20, 20);
      if (!resizedFrame) return;
      const baseScale = diagram.scale3d ?? solid3DScaleFromBounds(diagram.w, diagram.h, definition.width, definition.height, definition.geometry as import('./shapes/solid3d').Solid3DGeometry);
      const scale3d = fitSolidScaleToProjectedBounds(diagram, definition, baseScale, resizedFrame.w, resizedFrame.h);
      const translationX = resizedFrame.x + resizedFrame.w / 2 - frame.x - frame.w / 2;
      const translationY = resizedFrame.y + resizedFrame.h / 2 - frame.y - frame.h / 2;
      this.put({ ...diagram, x: diagram.x + translationX, y: diagram.y + translationY, scale3d });
      return;
    }
    const resizedGeometry = resizeBoxFromHandle(box, this.resizeH, { x: wx, y: wy },
      getShapeResizePolicy(definition), minWidth, minHeight);
    if (!resizedGeometry) return;
    const resized: any = { ...box, ...resizedGeometry };
    if (box.type === 'code' && ['nw', 'ne', 'sw', 'se', 'n', 's'].includes(this.resizeH)) resized.autoHeight = false;
    this.put(withComputedShapeBounds(resized as AnyShape));
  }

  // ─── zoom ────────────────────────────────────────────────────────────────
  zoomAt(clientX: number, clientY: number, factor: number) {
    const anchor = this.clientToWorld(clientX, clientY);
    const nextZoom = Math.max(0.04, Math.min(16, this.cam.zoom * factor));
    const zoomRatio = this.cam.zoom / nextZoom;
    const nextX = anchor.x - (anchor.x - this.cam.x) * zoomRatio;
    const nextY = anchor.y - (anchor.y - this.cam.y) * zoomRatio;
    this.setCamera(nextX, nextY, nextZoom);
  }

  setCamera(x:number, y:number, zoom:number) {
    this.cam = {x,y,zoom};
    this.onZoom?.(zoom);
    this.onCam?.(this.cam);
    this.onCameraChange?.(this.cam);
    this.dirty = true;
  }

  panBy(dx: number, dy: number) {
    this.setCamera(this.cam.x+dx/this.cam.zoom, this.cam.y+dy/this.cam.zoom, this.cam.zoom);
  }

  // ─── public API ──────────────────────────────────────────────────────────
  private cursorForTool(): string {
    if (this.tool === 'select') return 'default';
    if (this.tool === 'lasso-select' || this.tool === 'pen' || this.tool === 'eraser' ||
        isBoxShapeTool(this.tool) || this.tool === 'arrow') return 'crosshair';
    if (this.tool === 'sticky' || this.tool === 'text' || this.tool === 'math' || this.tool === 'code') return 'crosshair';
    if (this.tool === 'image') return 'copy';
    return 'default';
  }

  setPenMode(mode: 'normal' | 'smart') {
    this.penMode = mode;
  }

  setTool(t: ToolType) {
    if (t !== this.tool && (this.isDown || this.isPanning || this.isDragging || this.isResizing || this.isBoxing || this.isLassoing)) {
      this.cancelPointer();
    }
    this.tool = t;
    if (t !== 'eraser') this.eraserCursorPoint = null;
    this.sel.clear(); this.onSel?.([]);
    this.dirty = true;
    this.onCursor?.(this.cursorForTool());
  }

  /** End any transient pointer gesture safely on pointercancel, lost focus, tool switch, or teardown. */
  cancelPointer(event?: PointerEvent) {
    if (event && this.activePointerId !== null && Number.isFinite(event.pointerId) && event.pointerId !== this.activePointerId) return;
    if (this.isErasing) this.finishErasing();
    if (this.isPanning) { this.isPanning = false; this.panButton = null; }
    if (this.isResizing && this.resizeRef?.s) this.put(this.resizeRef.s as AnyShape);
    if (this.isDragging) {
      for (const [id, origin] of this.dragOrigins) {
        const current = this.shapes.get(id);
        if (current && 'x' in current && 'y' in current) this.put(moveShape(current, origin.x, origin.y));
      }
    }
    if (this.currId) {
      let shape = this.shapes.get(this.currId);
      if (shape?.type === 'pen' && event) {
        this.appendPenSamples(event);
        shape = this.shapes.get(this.currId);
      }
      if (shape?.type === 'pen' && !this.activeSmartDrawing) this.flushPenPublish();
      if (shape?.type === 'pen' && this.activeSmartDrawing) {
        // Cancellation is never a recognition signal: publish the original sampled ink.
        this.put(shape, {persist:true});
      }
      this.currId = null;
      this.activeSmartDrawing = false;
      this.isDown = false;
      this.saveH();
    }
    if (this.isDragging || this.isResizing) this.saveH();
    if (this.pendingPenPublishRaf !== null) {
      cancelAnimationFrame(this.pendingPenPublishRaf);
      this.pendingPenPublishRaf = null;
    }
    this.isDown = false;
    this.activePointerId = null;
    this.isDragging = false;
    this.isResizing = false;
    this.resizeH = '';
    this.resizeRef = null;
    this.isBoxing = false;
    this.isLassoing = false;
    this.lassoPts = [];
    this.eraserLastPoint = null;
    this.onCursor?.(this.cursorForTool());
    this.dirty = true;
  }

  deleteSel() {
    this.deleteShapes([...this.sel]);
    this.sel.clear(); this.onSel?.([]); this.saveH();
  }

  dupSel() {
    const originals = [...this.sel].map(id => this.shapes.get(id)).filter((shape): shape is AnyShape => Boolean(shape));
    const newIds = new Map(originals.map(shape => [shape.id, uid()]));
    const offset = 24;
    for (const shape of originals) {
      const clone: any = JSON.parse(JSON.stringify(shape));
      clone.id = newIds.get(shape.id);
      if (typeof clone.x === 'number') { clone.x += offset; clone.y += offset; }
      if (typeof clone.x1 === 'number') { clone.x1 += offset; clone.y1 += offset; clone.x2 += offset; clone.y2 += offset; }
      if (Array.isArray(clone.pts)) clone.pts = clone.pts.map((point: number[]) => [point[0] + offset, point[1] + offset, point[2]]);
      if (Array.isArray(clone.waypoints)) clone.waypoints = clone.waypoints.map(([x, y]: [number, number]) => [x + offset, y + offset]);
      if (clone.type === 'connector') {
        if (clone.sourceRef && newIds.has(clone.sourceRef.shapeId)) clone.sourceRef.shapeId = newIds.get(clone.sourceRef.shapeId);
        else clone.sourceRef = undefined;
        if (clone.targetRef && newIds.has(clone.targetRef.shapeId)) clone.targetRef.shapeId = newIds.get(clone.targetRef.shapeId);
        else clone.targetRef = undefined;
      }
      this.put(withComputedShapeBounds(clone as AnyShape));
    }
    this.sel.clear();
    for (const id of newIds.values()) this.sel.add(id);
    this.onSel?.([...this.sel]);
    this.saveH();
  }

  updateText(id: string, text: string) {
    const shape = this.shapes.get(id);
    if (shape && ('text' in (shape as any) || isLabelEditableShape(shape))) {
      this.put({ ...shape, text } as AnyShape);
      this.saveH();
    }
  }

  updateTextLive(id: string, text: string) {
    const shape = this.shapes.get(id);
    if (shape && ('text' in (shape as any) || isLabelEditableShape(shape))) this.put({ ...shape, text } as AnyShape);
  }

  updateFormulaLive(id: string, source: string, lastValidPreview: string, notify = true) {
    const shape = this.shapes.get(id);
    if (!shape || shape.type !== 'math' || (shape.text === source && shape.previewText === lastValidPreview)) return;
    this.put({ ...shape, text: source, previewText: lastValidPreview }, {
      redraw: id !== this.editingId,
      notify,
    });
  }

  updateFormula(id: string, source: string, lastValidPreview: string) {
    const shape = this.shapes.get(id);
    if (!shape || shape.type !== 'math') return;
    this.put({ ...shape, text: source, previewText: lastValidPreview });
    // Keep the edit session open for a final formula-layout measurement from the overlay.
    // The first unrelated tracked write starts a new item; undo/redo may also close it.
    this.pendingFormulaCaptureId = id;
  }

  updateCodeLive(id: string, text: string, language: CodeLanguage) {
    const shape = this.shapes.get(id);
    if (!shape || shape.type !== 'code') return;
    this.put({ ...shape, text, language: normalizeCodeLanguage(language) });
  }

  updateCodeLayoutLive(id: string, measuredHeight: number) {
    const shape = this.shapes.get(id);
    if (!shape || shape.type !== 'code' || shape.autoHeight === false || !Number.isFinite(measuredHeight)) return;
    const height = Math.max(1, Math.ceil(measuredHeight));
    if (height === shape.h) return;
    this.put({ ...shape, h: height, minX: shape.x, minY: shape.y, maxX: shape.x + shape.w, maxY: shape.y + height });
  }

  setCodeAutoHeight(id: string, enabled: boolean, fittedHeight: number) {
    const shape = this.shapes.get(id);
    if (!shape || shape.type !== 'code') return;
    const height = enabled && Number.isFinite(fittedHeight) ? Math.max(1, Math.ceil(fittedHeight)) : shape.h;
    if (shape.autoHeight === enabled && shape.h === height) return;
    this.put({ ...shape, autoHeight: enabled, h: height, minX: shape.x, minY: shape.y, maxX: shape.x + shape.w, maxY: shape.y + height });
  }

  updateCode(id: string, text: string, language: CodeLanguage) {
    const shape = this.shapes.get(id);
    if (!shape || shape.type !== 'code') return;
    this.put({ ...shape, text, language: normalizeCodeLanguage(language) });
    this.saveH();
  }

  deleteShape(id: string) {
    if (!this.del(id)) return;
    this.sel.delete(id);
    this.onSel?.([...this.sel]);
    this.saveH();
  }

  updateStyle(ids: string[], props: Partial<any>) {
    ids.forEach(id => {
      const shape = this.shapes.get(id);
      if (!shape) return;
      let next: AnyShape;
      if (shape.type === 'connector') {
        const connector = shape as ConnectorShape;
        next = { ...connector, ...props, color: props.color ?? props.stroke ?? connector.color, sw: props.sw ?? connector.sw };
      } else if (shape.type === 'line' || shape.type === 'arrow') {
        const line = shape as LineShape | ArrowShape;
        next = { ...line, ...props, color: props.color ?? props.stroke ?? line.color, sw: props.sw ?? line.sw } as AnyShape;
      } else {
        next = { ...shape, ...props } as AnyShape;
      }
      this.put(next);
    });
    this.saveH();
  }


  addImage(src: string, clientX: number, clientY: number) {
    const img = new Image();
    img.onload = () => {
      const w = this.clientToWorld(clientX, clientY);
      const W = img.naturalWidth;
      const H = img.naturalHeight;
      // cap at 800px wide if huge
      const scale = W > 800 ? 800/W : 1;
      const fw = W*scale, fh = H*scale;
      const id = uid();
      const s: ImageShape = {
        id, type:'image', src,
        x:w.x - fw/2, y:w.y - fh/2, w:fw, h:fh,
        naturalW:W, naturalH:H,
        minX:w.x-fw/2, minY:w.y-fh/2, maxX:w.x+fw/2, maxY:w.y+fh/2,
      };
      this.imgCache.set(src, img);
      this.put(s);
      this.sel.clear(); this.sel.add(id); this.onSel?.([id]);
      this.saveH();
    };
    img.src = src;
  }

  mark() { this.dirty = true; }

  getShapes() { return [...this.shapes.values()]; }

  getShape(id: string) { return this.shapes.get(id) ?? null; }

  private diagramContains(container: DiagramShape, child: DiagramShape): boolean {
    const containerDefinition = getShapeDefinition(container.shapeId), childDefinition = getShapeDefinition(child.shapeId);
    if (!containerDefinition || !childDefinition || !containerAcceptsSemanticChild(containerDefinition, childDefinition)) return false;
    return rotatedBoxCorners(child).every(([x, y]) => {
      const local = worldPointToObject(container, { x, y });
      return local.x >= -0.5 && local.y >= -0.5 && local.x <= container.w + 0.5 && local.y <= container.h + 0.5;
    });
  }

  private hasContainmentCycle(childId: string, containerId: string): boolean {
    let currentId: string | undefined = containerId;
    const visited = new Set<string>();
    while (currentId) {
      if (currentId === childId || visited.has(currentId)) return true;
      visited.add(currentId);
      const parent = this.shapes.get(currentId);
      currentId = parent?.type === 'diagram' ? (parent as DiagramShape).containerId : undefined;
    }
    return false;
  }

  private findContainingContainer(child: DiagramShape): DiagramShape | undefined {
    const candidates = [...this.shapes.values()].filter((candidate): candidate is DiagramShape => candidate.type === 'diagram'
      && candidate.id !== child.id && !this.hasContainmentCycle(child.id, candidate.id) && this.diagramContains(candidate, child));
    return candidates.sort((left, right) => left.w * left.h - right.w * right.h)[0];
  }

  private containedDescendants(containerId: string): DiagramShape[] {
    const descendants: DiagramShape[] = [], visited = new Set<string>([containerId]), queue = [containerId];
    while (queue.length) {
      const parentId = queue.shift()!;
      for (const candidate of this.shapes.values()) {
        if (candidate.type !== 'diagram' || (candidate as DiagramShape).containerId !== parentId || visited.has(candidate.id)) continue;
        visited.add(candidate.id); descendants.push(candidate as DiagramShape); queue.push(candidate.id);
      }
    }
    return descendants;
  }

  private detachContainedChildrenFrom(containerId: string, origin: object) {
    for (const candidate of this.shapes.values()) {
      if (candidate.type !== 'diagram' || (candidate as DiagramShape).containerId !== containerId) continue;
      const next = { ...(candidate as DiagramShape) };
      delete next.containerId;
      this.put(next, { origin, notify: false, syncAttachments: false });
    }
  }

  private reconcileContainerMembership(origin: object = this, autoAssign = true) {
    const diagrams = [...this.shapes.values()].filter((shape): shape is DiagramShape => shape.type === 'diagram');
    for (const child of diagrams) {
      const currentId = child.containerId;
      const current = currentId ? this.shapes.get(currentId) : undefined;
      let nextId = current?.type === 'diagram' && !this.hasContainmentCycle(child.id, current.id)
        && this.diagramContains(current as DiagramShape, child) ? current.id : undefined;
      if (!nextId && autoAssign) nextId = this.findContainingContainer(child)?.id;
      if (nextId === currentId) continue;
      const next = { ...child };
      delete next.containerId;
      if (nextId) next.containerId = nextId;
      this.put(next, { origin, notify: false, syncAttachments: false });
    }
  }

  /** Explicit semantic containment; normal drag/create completion also assigns the smallest valid container. */
  setShapeContainer(childId: string, containerId: string | null, commit = true): boolean {
    const child = this.shapes.get(childId);
    if (!child || child.type !== 'diagram') return false;
    if (containerId === null) {
      const next = { ...(child as DiagramShape) };
      delete next.containerId;
      this.put(next, { syncAttachments: false });
      if (commit) this.saveH();
      return true;
    }
    const parent = this.shapes.get(containerId);
    if (!parent || parent.type !== 'diagram' || this.hasContainmentCycle(childId, containerId)
      || !this.diagramContains(parent as DiagramShape, child as DiagramShape)) return false;
    this.put({ ...(child as DiagramShape), containerId }, { syncAttachments: false });
    if (commit) this.saveH();
    return true;
  }

  getConnectionPoints(id: string) {
    const shape = this.shapes.get(id);
    return shape && isConnectableShape(shape) && 'x' in shape
      ? connectionPointsForBox(shape as BoxShape)
      : [];
  }

  private definitionForEndpoint(shape: AnyShape): ShapeDefinition | undefined {
    if (shape.type === 'diagram' || shape.type === 'connector') return getShapeDefinition(shape.shapeId);
    return getShapeDefinitionForLegacyType(shape.type);
  }

  private connectionPointCandidates(
    x: number, y: number, excludeId: string, connectorDefinition: ShapeDefinition | undefined,
    side: 'source' | 'target',
  ): Array<{ point: { id: string; x: number; y: number }; shapeId: string; definition: ShapeDefinition | undefined; distance: number }> {
    const threshold = 16 / Math.max(0.04, this.cam.zoom);
    const candidates: Array<{ point: { id: string; x: number; y: number }; shapeId: string; definition: ShapeDefinition | undefined; distance: number }> = [];
    for (const shape of this.shapes.values()) {
      if (shape.id === excludeId || !isConnectableShape(shape) || !('x' in shape)) continue;
      const definition = this.definitionForEndpoint(shape);
      if (!connectorEndpointSideAllowed(connectorDefinition!, definition, side)) continue;
      let best: typeof candidates[number] | null = null;
      for (const point of connectionPointsForBox(shape as BoxShape)) {
        if (connectorDefinition?.connectorRule && connectorDefinition.connectorRule !== 'generic' && point.id === 'center') continue;
        const distance = Math.hypot(point.x - x, point.y - y);
        if (distance <= threshold && (!best || distance < best.distance)) best = { point, shapeId: shape.id, definition, distance };
      }
      if (best) candidates.push(best);
    }
    return candidates.sort((a, b) => a.distance - b.distance || a.shapeId.localeCompare(b.shapeId) || a.point.id.localeCompare(b.point.id));
  }

  private snapConnectorShape(connector: ConnectorShape) {
    const connectorDefinition = getShapeDefinition(connector.shapeId);
    const starts = this.connectionPointCandidates(connector.x1, connector.y1, connector.id, connectorDefinition, 'source');
    const ends = this.connectionPointCandidates(connector.x2, connector.y2, connector.id, connectorDefinition, 'target');
    type EndpointCandidate = (typeof starts)[number];
    let start: EndpointCandidate | null = starts[0] ?? null;
    let end: EndpointCandidate | null = ends[0] ?? null;
    if (connectorDefinition?.connectorRule && connectorDefinition.connectorRule !== 'generic' && start && end) {
      // Search the nearby endpoint pairs before rejecting one side: a slightly farther but
      // semantically valid pair wins over two individually-nearest incompatible objects.
      let bestPair: { start: typeof start; end: typeof end; distance: number } | null = null;
      const nearestByDefinition = (candidates: typeof starts) => {
        const nearest = new Map<ShapeDefinition | undefined, typeof candidates[number]>();
        for (const candidate of candidates) if (!nearest.has(candidate.definition)) nearest.set(candidate.definition, candidate);
        return [...nearest.values()];
      };
      const sourceDefinitions = nearestByDefinition(starts), targetDefinitions = nearestByDefinition(ends);
      for (const source of sourceDefinitions) for (const target of targetDefinitions) {
        if (!connectorEndpointPairAllowed(connectorDefinition, source.definition, target.definition)) continue;
        const distance = source.distance + target.distance;
        if (!bestPair || distance < bestPair.distance) bestPair = { start: source, end: target, distance };
      }
      if (bestPair) { start = bestPair.start; end = bestPair.end; }
      else if (start.distance <= end.distance) end = null;
      else start = null;
    }
    const next: ConnectorShape = { ...connector, sourceRef: undefined, targetRef: undefined };
    if (start) { next.x1 = start.point.x; next.y1 = start.point.y; next.sourceRef = { shapeId: start.shapeId, pointId: start.point.id }; }
    if (end) { next.x2 = end.point.x; next.y2 = end.point.y; next.targetRef = { shapeId: end.shapeId, pointId: end.point.id }; }
    this.put({ ...next, ...connectorBounds(next) }, { notify: false });
  }

  private updateAttachedConnectors(shapeId: string) {
    const target = this.shapes.get(shapeId);
    if (!target || !isConnectableShape(target) || !('x' in target)) return;
    const points = connectionPointsForBox(target as BoxShape);
    const pointById = new Map(points.map(point => [point.id, point]));
    for (const candidate of this.shapes.values()) {
      if (candidate.type !== 'connector') continue;
      const connector = candidate as ConnectorShape;
      const source = connector.sourceRef?.shapeId === shapeId ? pointById.get(connector.sourceRef.pointId) : undefined;
      const end = connector.targetRef?.shapeId === shapeId ? pointById.get(connector.targetRef.pointId) : undefined;
      if (!source && !end) continue;
      const next = { ...connector,
        ...(source ? { x1: source.x, y1: source.y } : {}),
        ...(end ? { x2: end.x, y2: end.y } : {}),
      };
      this.put({ ...next, ...connectorBounds(next) }, { notify: false });
    }
  }

  private detachConnectorsFrom(shapeId: string, origin: object = this) {
    for (const candidate of this.shapes.values()) {
      if (candidate.type !== 'connector') continue;
      const connector = candidate as ConnectorShape;
      if (connector.sourceRef?.shapeId !== shapeId && connector.targetRef?.shapeId !== shapeId) continue;
      const next = { ...connector, sourceRef: connector.sourceRef?.shapeId === shapeId ? undefined : connector.sourceRef,
        targetRef: connector.targetRef?.shapeId === shapeId ? undefined : connector.targetRef };
      this.put({ ...next, ...connectorBounds(next) }, { notify: false, origin });
    }
  }

  updateShapeParameters(id: string, params: Record<string, unknown>, commit = true) {
    const shape = this.shapes.get(id);
    if (!shape || !('x' in shape) || !('w' in shape)) return;
    const definition = shape.type === 'diagram' ? getShapeDefinition((shape as DiagramShape).shapeId)
      : getShapeDefinitionForLegacyType(shape.type);
    if (!definition) return;
    const editablePatch = normalizeShapeParameterPatch(definition, params);
    if (!Object.keys(editablePatch).length) return;
    const next = { ...shape, params: { ...((shape as any).params ?? {}), ...editablePatch } } as AnyShape;
    this.put(next);
    if (commit) this.saveH();
  }

  /** Update true local XYZ dimension factors without altering board position or outer rotation. */
  updateShapeScale3d(id: string, patch: Partial<Solid3DScale>, commit = true) {
    const shape = this.shapes.get(id);
    if (!shape || shape.type !== 'diagram') return;
    const diagram = shape as DiagramShape;
    const definition = getShapeDefinition(diagram.shapeId);
    if (!definition?.solid3d) return;
    const current = diagram.scale3d ?? solid3DScaleFromBounds(diagram.w, diagram.h, definition.width, definition.height,
      definition.geometry as import('./shapes/solid3d').Solid3DGeometry);
    const safe = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value)
      ? Math.max(0.01, Math.min(64, value)) : fallback;
    const scale3d = { x: safe(patch.x, current.x), y: safe(patch.y, current.y), z: safe(patch.z, current.z) };
    if (scale3d.x === current.x && scale3d.y === current.y && scale3d.z === current.z) return;
    this.put({ ...diagram, scale3d });
    if (commit) this.saveH();
  }

  updateDiagramData(id: string, patch: Record<string, unknown>, commit = true) {
    const shape = this.shapes.get(id);
    if (!shape || shape.type !== 'diagram') return;
    const diagram = shape as DiagramShape;
    const data = { ...(diagram.data ?? {}), ...patch };
    const definition = getShapeDefinition(diagram.shapeId);
    const params = definition ? deriveStructuredShapeParameters(definition, data, diagram.params) : diagram.params;
    this.put({ ...diagram, data, params });
    if (commit) this.saveH();
  }

  updateConnectorProperties(id: string, properties: Partial<Pick<ConnectorShape, 'lineStyle' | 'startMarker' | 'endMarker' | 'sourceCardinality' | 'targetCardinality' | 'label'>>, commit = true) {
    const shape = this.shapes.get(id);
    if (!shape || shape.type !== 'connector') return;
    const next = { ...shape, ...properties } as ConnectorShape;
    this.put({ ...next, ...connectorBounds(next) });
    if (commit) this.saveH();
  }

  addConnectorWaypoint(id: string, x: number, y: number, index?: number) {
    const shape = this.shapes.get(id);
    if (!shape || shape.type !== 'connector' || !Number.isFinite(x) || !Number.isFinite(y) || shape.waypoints.length >= 32) return;
    const waypoints = shape.waypoints.map(point => [point[0], point[1]] as [number, number]);
    const insertAt = Math.max(0, Math.min(waypoints.length, index ?? waypoints.length));
    waypoints.splice(insertAt, 0, [x, y]);
    const next = { ...shape, waypoints };
    this.put({ ...next, ...connectorBounds(next) }); this.saveH();
  }

  removeConnectorWaypoint(id: string, index: number) {
    const shape = this.shapes.get(id);
    if (!shape || shape.type !== 'connector' || !Number.isInteger(index) || index < 0 || index >= shape.waypoints.length) return;
    const next = { ...shape, waypoints: shape.waypoints.filter((_, waypointIndex) => waypointIndex !== index) };
    this.put({ ...next, ...connectorBounds(next) }); this.saveH();
  }

  private reassertRemoteDeletions() {
    const resurrected = [...this.remoteDeletedKeys].filter(id => this.yMap.has(id));
    if (!resurrected.length) return;
    this.transactMap(() => resurrected.forEach(id => this.yMap.delete(id)), this.remoteRepairOrigin);
  }

  undo() {
    if (!this.undoManager.canUndo()) return;
    this.pendingFormulaCaptureId = null;
    this.undoManager.stopCapturing();
    this.undoManager.undo();
    // Y.UndoManager protects remote map writes but can restore a value after a peer's map delete.
    // Reapply only those latest externally deleted keys, without adding a local history item.
    this.reassertRemoteDeletions();
  }

  redo() {
    if (!this.undoManager.canRedo()) return;
    this.pendingFormulaCaptureId = null;
    this.undoManager.stopCapturing();
    this.undoManager.redo();
    this.reassertRemoteDeletions();
  }

  destroy() {
    if (this.destroyed) return;
    this.cancelPointer();
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    if (this.overlayAttachTimer !== null) clearTimeout(this.overlayAttachTimer);
    this.overlayAttachTimer = null;
    this.yMap.unobserve(this.onYMapChange);
    this.undoManager.doc.off('afterTransaction', this.undoManager.afterTransactionHandler);
    this.undoManager.clear();
    this.remoteDeletedKeys.clear();
    this.codePreviewCache.clear();
    this.overlayDiv?.remove();
  }

  // ─── render loop ─────────────────────────────────────────────────────────
  private loop = () => {
    if (this.destroyed) return;
    this.raf = requestAnimationFrame(this.loop);
    if (!this.dirty) return;
    this.dirty = false;
    this.render();
  };

  private vpBox() {
    const a = this.clientToWorld(this.cv.getBoundingClientRect().left, this.cv.getBoundingClientRect().top);
    const b = this.clientToWorld(this.cv.getBoundingClientRect().right, this.cv.getBoundingClientRect().bottom);
    return { minX:a.x-200, minY:a.y-200, maxX:b.x+200, maxY:b.y+200 };
  }

  private render() {
    const {cx, cv, cam} = this;
    cx.resetTransform();
    cx.fillStyle = '#f8f8f5';
    cx.fillRect(0, 0, cv.width, cv.height);
    cx.translate(cv.width/2, cv.height/2);
    cx.scale(cam.zoom, cam.zoom);
    cx.translate(-cam.x, -cam.y);

    this.drawGrid();

    const vp = this.vpBox();
    const visible = this.rtree.search(vp).sort((a,b) => a.id.localeCompare(b.id));
    visible.forEach(s => {
      if (s.id !== this.editingId) this.drawShape(s);
    });

    if (this.tool === 'eraser' && this.eraserCursorPoint) {
      const radius = ERASER_RADIUS_PX / cam.zoom;
      cx.save();
      cx.beginPath(); cx.arc(this.eraserCursorPoint.x, this.eraserCursorPoint.y, radius, 0, Math.PI * 2);
      cx.fillStyle = 'rgba(255,255,255,.18)'; cx.fill();
      cx.strokeStyle = 'rgba(255,255,255,.95)'; cx.lineWidth = 3 / cam.zoom; cx.stroke();
      cx.beginPath(); cx.arc(this.eraserCursorPoint.x, this.eraserCursorPoint.y, radius, 0, Math.PI * 2);
      cx.strokeStyle = 'rgba(15,23,42,.95)'; cx.lineWidth = 1.2 / cam.zoom; cx.stroke();
      cx.restore();
    }

    // Update overlay transforms
    this.wrapperDiv.style.transform = `translate(${cv.width/2}px, ${cv.height/2}px) scale(${cam.zoom}) translate(${-cam.x}px, ${-cam.y}px)`;
    this.onCameraChange?.(this.cam);
    
    // Rebuild overlays only if necessary
    let overlayHtml = '';
    const domShapes = visible.filter(s => ['sticky','math','code','text','image'].includes(s.type)) as any[];
    const codePreviewMarkup = new Map<string, string>();
    let stateSignature = '';

    domShapes.forEach(s => {
      if (s.type === 'code') {
        const language = normalizeCodeLanguage(s.language);
        const source = String(s.text ?? '');
        codePreviewMarkup.set(s.id, this.codePreviewCache.render(s.id, source, language, () => {
          if (!this.destroyed) this.dirty = true;
        }));
        const preview = this.codePreviewCache.snapshot(s.id);
        stateSignature += `syntax:${preview?.engine}:${preview?.version}|`;
      }
      stateSignature += `${s.id}:${(s as any).text ?? ''}:${(s as any).previewText ?? ''}:${(s as any).language||''}:${(s as any).w}:${(s as any).h}:${(s as any).x}:${(s as any).y}:${(s as any).rotation ?? 0}:${s.type==='image'?(s as any).src:''}:sel${this.sel.has(s.id)}|`;
    });
    stateSignature += `editing:${this.editingId}`;

    if (this.lastOverlayState !== stateSignature) {
      this.lastOverlayState = stateSignature;
      domShapes.forEach(s => {
      if (s.id !== this.editingId) {
        let content = '';
        if (s.type === 'image') {
          overlayHtml += `<div id="ol_${s.id}" style="position:absolute; left:${s.x}px; top:${s.y}px; width:${s.w}px; height:${s.h}px; transform:rotate(${s.rotation ?? 0}deg); transform-origin:center center; pointer-events:auto;"><img src="${(s as any).src}" style="width:100%; height:100%; display:block; pointer-events:none;" /></div>`;
        } else if (s.type === 'sticky') {
          content = ((s as any).text||'').replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
          overlayHtml += `<div id="ol_${s.id}" class="board-sticky-overlay" style="position:absolute; left:${s.x}px; top:${s.y}px; width:${s.w}px; height:${s.h}px; transform:rotate(${s.rotation ?? 0}deg); transform-origin:center center; font-size:${((s as any).fs||14)}px; font-family:'Inter',system-ui,sans-serif; color:rgba(15,15,15,0.8); padding:16px; box-sizing:border-box; overflow-y:auto; overflow-x:hidden; white-space:pre-wrap; word-break:break-word; border-radius:3px; background:${(s as any).bg}; box-shadow:0 4px 16px rgba(0,0,0,0.1); pointer-events:auto;"><div style="position:absolute; top:0; right:0; width:14px; height:14px; background:rgba(0,0,0,0.08); clip-path:polygon(100% 0, 0 0, 100% 100%);"></div>${content}</div>`;
        } else if (s.type === 'math') {
          const source = String((s as any).text ?? '');
          const storedPreview = (s as any).previewText;
          const hasValidPreview = typeof storedPreview === 'string' && storedPreview.trim().length > 0;
          const previewSource = hasValidPreview ? storedPreview : source;
          const stalePreview = hasValidPreview && previewSource !== source;
          try {
            const ast = parseTelex(previewSource);
            content = renderFormulaStatic(ast, (s.fs || 14));
          } catch {
            content = '<span class="fm-render-error" role="status">Formula could not be parsed; source is preserved.</span>';
          }
          const status = stalePreview ? '<span class="fm-preview-stale" role="status" aria-label="Showing the last valid formula preview">Last valid preview</span>' : '';
          const boxWidth = Math.max(48, Number(s.w) || 0), boxHeight = Math.max(36, Number(s.h) || 0);
          overlayHtml += `<div id="ol_${s.id}" class="board-math-preview" aria-label="Rendered mathematical formula${stalePreview ? '; showing the last valid preview while the draft is invalid' : ''}" style="position:absolute; left:${s.x}px; top:${s.y}px; width:${boxWidth}px; height:${boxHeight}px; transform:rotate(${s.rotation ?? 0}deg); transform-origin:center center; font-size:${(s.fs||14)}px; color:#000; padding:16px; box-sizing:border-box; overflow:visible; background:transparent; border-radius:4px; pointer-events:auto;">${content}${status}</div>`;
        } else if (s.type === 'code') {
          const language = normalizeCodeLanguage((s as any).language);
          const languageLabel = CODE_LANGUAGES.find(option => option.value === language)?.label ?? language;
          const preview = this.codePreviewCache.snapshot(s.id);
          const engine = preview?.engine ?? 'language-aware-fallback';
          const fallbackLabel = engine === 'codemirror' ? '' : '; using language-aware fallback highlighting';
          const rows = codePreviewMarkup.get(s.id) ?? '';
          overlayHtml += `<div id="ol_${s.id}" class="board-code-preview" role="region" tabindex="0" data-language="${language}" data-highlight-engine="${engine}" aria-label="${languageLabel} syntax-highlighted code preview; source spacing and line breaks are preserved${fallbackLabel}" style="position:absolute; left:${s.x}px; top:${s.y}px; width:${s.w}px; height:${s.h}px; transform:rotate(${s.rotation ?? 0}deg); transform-origin:center center; font-size:${(s.fs||14)}px; font-family:'JetBrains Mono','SFMono-Regular',Consolas,monospace; line-height:1.5; color:#d4d4d4; box-sizing:border-box; overflow:auto; background:#1b2430; border-radius:6px; border:1px solid #344253; pointer-events:auto; overscroll-behavior:contain;"><div class="board-code-lines">${rows}</div></div>`;
        } else if (s.type === 'text') {
          content = ((s as any).text||'').replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
          overlayHtml += `<div id="ol_${s.id}" style="position:absolute; left:${s.x}px; top:${s.y}px; width:${s.w}px; height:${s.h}px; transform:rotate(${s.rotation ?? 0}deg); transform-origin:center center; font-size:${(s.fs||14)}px; font-family:'Inter',system-ui,sans-serif; color:${(s as any).color||'#1e293b'}; padding:16px; box-sizing:border-box; overflow:hidden; white-space:pre-wrap; word-break:break-word; pointer-events:auto;">${content}</div>`;
        }

        if (this.sel.has(s.id)) {
          const z = Math.max(0.04, this.cam.zoom), p = 4 / z, hs = 4 / z, border = 1.5 / z, rotation = s.rotation ?? 0;
          const handles = [[-p, -p], [s.w / 2, -p], [s.w + p, -p], [s.w + p, s.h / 2], [s.w + p, s.h + p],
            [s.w / 2, s.h + p], [-p, s.h + p], [-p, s.h / 2]];
          overlayHtml += `<div style="position:absolute; left:${s.x}px; top:${s.y}px; width:${s.w}px; height:${s.h}px; transform:rotate(${rotation}deg); transform-origin:center center; pointer-events:none;">
            <div style="position:absolute; left:${-p}px; top:${-p}px; width:${s.w + p * 2}px; height:${s.h + p * 2}px; border:${border}px solid #3b82f6; border-radius:${3 / z}px; box-sizing:border-box;"></div>
            ${handles.map(([x, y]) => `<div style="position:absolute; left:${x - hs}px; top:${y - hs}px; width:${hs * 2}px; height:${hs * 2}px; background:#fff; border:${border}px solid #3b82f6; border-radius:50%; box-sizing:border-box;"></div>`).join('')}
            <div style="position:absolute; left:${s.w / 2 - border / 2}px; top:${-22 / z}px; width:${border}px; height:${18 / z}px; background:#3b82f6;"></div>
            <div style="position:absolute; left:${s.w / 2 - hs}px; top:${-26 / z - hs}px; width:${hs * 2}px; height:${hs * 2}px; background:#fff; border:${border}px solid #3b82f6; border-radius:50%;"></div>
          </div>`;
        }
      }
    });
      this.wrapperDiv.innerHTML = overlayHtml;
    }

    // selection box marquee
    if (this.isBoxing) {
      const x0=Math.min(this.boxA.x,this.boxB.x), y0=Math.min(this.boxA.y,this.boxB.y);
      const w=Math.abs(this.boxA.x-this.boxB.x), h=Math.abs(this.boxA.y-this.boxB.y);
      cx.fillStyle='rgba(59,130,246,0.1)'; cx.fillRect(x0,y0,w,h);
      cx.strokeStyle='#3b82f6'; cx.lineWidth=1/cam.zoom; cx.strokeRect(x0,y0,w,h);
    }

    if (this.isLassoing && this.lassoPts.length > 0) {
      cx.beginPath();
      cx.moveTo(this.lassoPts[0].x, this.lassoPts[0].y);
      for(let i=1; i<this.lassoPts.length; i++) cx.lineTo(this.lassoPts[i].x, this.lassoPts[i].y);
      cx.fillStyle='rgba(59,130,246,0.1)'; cx.fill();
      cx.strokeStyle='#3b82f6'; cx.lineWidth=1.5/cam.zoom; cx.setLineDash([5/cam.zoom, 5/cam.zoom]);
      cx.stroke();
      cx.setLineDash([]); // reset
    }

    // selection outlines + resize handles
    this.sel.forEach(id => {
      const s = this.shapes.get(id);
      if (s) this.drawSelection(s);
    });
  }

  private drawGrid() {
    const { cx, cam } = this;
    const vp = this.vpBox();
    let step = 40;
    for (let count = 0; count < 12 && step * cam.zoom < 28; count++) step *= 2;
    for (let count = 0; count < 12 && step * cam.zoom > 76; count++) step /= 2;

    const startX = Math.floor(vp.minX / step);
    const startY = Math.floor(vp.minY / step);
    const endX = Math.ceil(vp.maxX / step);
    const endY = Math.ceil(vp.maxY / step);
    const majorEvery = 4;
    cx.save();

    cx.beginPath();
    for (let index = startX; index <= endX; index++) {
      if (index % majorEvery === 0) continue;
      const x = index * step;
      cx.moveTo(x, vp.minY);
      cx.lineTo(x, vp.maxY);
    }
    for (let index = startY; index <= endY; index++) {
      if (index % majorEvery === 0) continue;
      const y = index * step;
      cx.moveTo(vp.minX, y);
      cx.lineTo(vp.maxX, y);
    }
    cx.strokeStyle = 'rgba(78, 91, 108, 0.075)';
    cx.lineWidth = 0.65 / cam.zoom;
    cx.stroke();

    cx.beginPath();
    for (let index = startX; index <= endX; index++) {
      if (index % majorEvery !== 0) continue;
      const x = index * step;
      cx.moveTo(x, vp.minY);
      cx.lineTo(x, vp.maxY);
    }
    for (let index = startY; index <= endY; index++) {
      if (index % majorEvery !== 0) continue;
      const y = index * step;
      cx.moveTo(vp.minX, y);
      cx.lineTo(vp.maxX, y);
    }
    cx.strokeStyle = 'rgba(78, 91, 108, 0.12)';
    cx.lineWidth = 0.85 / cam.zoom;
    cx.stroke();
    cx.restore();
  }

  private cachedDiagramGeometry(shape: DiagramShape): CachedDiagramGeometry {
    const params = shape.params ?? {};
    const definition = getShapeDefinition(shape.shapeId)!;
    const scale = definition.solid3d
      ? shape.scale3d ?? solid3DScaleFromBounds(shape.w, shape.h, definition.width, definition.height, definition.geometry as import('./shapes/solid3d').Solid3DGeometry) : undefined;
    const key = `${shape.shapeId}|${shape.w}|${shape.h}|${JSON.stringify(params)}|${JSON.stringify(scale ?? null)}`;
    const cached = this.geometryCache.get(shape as object);
    if (cached?.key === key) return cached;
    const geometry = buildShapeGeometry(definition, shape.w, shape.h, params, definition.solid3d ? {
      scale, referenceWidth: definition.width, referenceHeight: definition.height,
    } : undefined);
    const { outline, decorations, decorationStyles, intrinsicFills, hiddenEdges, visibleFaces = [], projection } = geometry;
    const makePath = (commands: PathCommand[]) => {
      if (typeof Path2D === 'undefined') return undefined;
      const path = new Path2D();
      const supportsCommands = commands.every(({ op }) => {
        if (op === 'moveTo') return typeof path.moveTo === 'function';
        if (op === 'lineTo') return typeof path.lineTo === 'function';
        if (op === 'quadraticCurveTo') return typeof path.quadraticCurveTo === 'function';
        if (op === 'bezierCurveTo') return typeof path.bezierCurveTo === 'function';
        if (op === 'ellipse') return typeof path.ellipse === 'function';
        return typeof path.closePath === 'function';
      });
      return supportsCommands ? drawPathCommands(this.cx, commands, path) : undefined;
    };
    const entry: CachedDiagramGeometry = { key, outline, decorations, decorationStyles, intrinsicFills, hiddenEdges, visibleFaces, projection, path: makePath(outline),
      decorationPaths: decorations.map(makePath), intrinsicFillPaths: intrinsicFills.map(makePath), hiddenEdgePaths: hiddenEdges.map(makePath),
      visibleFacePaths: visibleFaces.map(face => makePath(face.commands)) };
    this.geometryCache.set(shape as object, entry);
    return entry;
  }

  private drawDiagramShape(shape: DiagramShape) {
    const definition = getShapeDefinition(shape.shapeId);
    if (!definition) return;
    const cx = this.cx, geometry = definition.geometry, params = shape.params ?? {};
    const cached = this.cachedDiagramGeometry(shape);
    const is3D = Boolean(definition.solid3d);
    const hasFill = geometryUsesFill(geometry) && fillIsVisible(shape.fill);
    const zoom = Math.max(0.04, this.cam.zoom);
    cx.save();
    cx.translate(shape.x, shape.y);
    cx.fillStyle = shape.fill; cx.strokeStyle = shape.stroke;
    cx.lineWidth = is3D ? Math.max(1.5, Math.min(2, shape.sw || 1.8)) / zoom : Math.max(0, shape.sw);
    cx.lineCap = 'round'; cx.lineJoin = 'round';
    const lineStyle = params.lineStyle;
    cx.setLineDash(lineStyle === 'dashed' ? [7, 4] : lineStyle === 'dotted' ? [2, 3] : []);
    if (params.callActivity === true) cx.lineWidth = Math.max(cx.lineWidth, shape.sw * 1.8);
    if (params.eventKind === 'end') cx.lineWidth = Math.max(cx.lineWidth, shape.sw * 2.2);
    const drawHiddenEdges = () => {
      if (!cached.hiddenEdges.length || (!is3D && shape.sw <= 0)) return;
      cx.save();
      if (is3D) { cx.lineWidth = 1.6 / zoom; cx.setLineDash([8 / zoom, 5 / zoom]); }
      else cx.setLineDash([4, 3]);
      for (let index = 0; index < cached.hiddenEdges.length; index++) {
        const path = cached.hiddenEdgePaths?.[index];
        if (path) cx.stroke(path);
        else { drawPathCommands(cx, cached.hiddenEdges[index]); cx.stroke(); }
      }
      cx.restore();
    };
    // Hidden 3D topology is the rear stroke pass: transparent faces reveal its dashes, while a
    // later opaque surface fill correctly occludes it. Visible semantic edges are stroked last.
    if (is3D) drawHiddenEdges();
    // Polyhedra fill depth-sorted faces; smooth curved solids fill continuous projected surface and draw only semantic edge curves.
    if (is3D && hasFill) {
      cx.fillStyle = shape.fill;
      const curvedSolid = ['sphere3d', 'cylinder3d', 'cone3d', 'coneFrustum3d'].includes(String(geometry));
      if (curvedSolid) {
        // A curved solid is a continuous surface. Fill its real projected silhouette once, then
        // render only its semantic rims/generators/equator; tessellation polygons are not strokes.
        if (cached.path) cx.fill(cached.path);
        else { drawPathCommands(cx, cached.outline); cx.fill(); }
      } else {
        for (let index = 0; index < cached.visibleFaces.length; index++) {
          const path = cached.visibleFacePaths?.[index];
          if (path) cx.fill(path);
          else { drawPathCommands(cx, cached.visibleFaces[index].commands); cx.fill(); }
        }
      }
    } else if (!is3D && hasFill) {
      if (cached.path) cx.fill(cached.path);
      else { drawPathCommands(cx, cached.outline); cx.fill(); }
    }
    if (cached.intrinsicFills.length) {
      cx.fillStyle = shape.stroke;
      cached.intrinsicFills.forEach((commands, index) => {
        const path = cached.intrinsicFillPaths?.[index];
        if (path) cx.fill(path);
        else { drawPathCommands(cx, commands); cx.fill(); }
      });
      cx.fillStyle = shape.fill;
    }
    if (!is3D) drawHiddenEdges();
    cx.setLineDash(lineStyle === 'dashed' ? [7, 4] : lineStyle === 'dotted' ? [2, 3] : []);
    // 3D `outline` is a projected fill/hit boundary, not a second stroke pass. Its actual
    // silhouette edges are already included once in the visible semantic edge/curve paths.
    if (shape.sw > 0 && !definition.solid3d) {
      if (cached.path) cx.stroke(cached.path);
      else { drawPathCommands(cx, cached.outline); cx.stroke(); }
    }
    for (let index = 0; index < cached.decorations.length; index++) {
      const decorationStyle = cached.decorationStyles[index] ?? lineStyle;
      cx.setLineDash(decorationStyle === 'dashed' ? [7, 4] : decorationStyle === 'dotted' ? [2, 3] : []);
      const path = cached.decorationPaths?.[index];
      if (path) cx.stroke(path);
      else { drawPathCommands(cx, cached.decorations[index]); cx.stroke(); }
    }
    cx.setLineDash([]);
    this.drawDiagramLabel(shape, definition);
    cx.restore();
  }

  private drawDiagramLabel(shape: DiagramShape, definition: ShapeDefinition) {
    const params = shape.params ?? {};
    const text = typeof shape.text === 'string' ? shape.text.trim() : (typeof params.title === 'string' ? params.title : '');
    const cx = this.cx, w = shape.w, h = shape.h, fs = Math.max(6, Math.min(96, shape.fs ?? 14));
    cx.save();
    cx.beginPath(); cx.rect(0, 0, w, h); cx.clip();
    cx.fillStyle = shape.textColor ?? '#1f2937';
    cx.textAlign = 'center'; cx.textBaseline = 'middle';
    cx.font = `${params.italicName === true ? 'italic ' : ''}${fs}px Inter, 'Segoe UI', sans-serif`;
    if (definition.geometry === 'table' && shape.data?.table && isRecord(shape.data.table) && Array.isArray(shape.data.table.columns)) {
      this.drawStructuredErTableLabel(shape, definition, shape.data.table.columns as unknown[]);
      cx.restore(); return;
    }
    if (definition.geometry === 'table' && shape.data?.classifier && isRecord(shape.data.classifier) && Array.isArray(shape.data.classifier.compartments)) {
      this.drawStructuredClassifierLabel(shape, definition, shape.data.classifier.compartments as unknown[]);
      cx.restore(); return;
    }
    if (definition.geometry === 'column' && shape.data?.column && isRecord(shape.data.column)) {
      const column = shape.data.column;
      const key = column.key === 'primary' ? 'PK' : column.key === 'foreign' ? 'FK' : '';
      const name = typeof column.name === 'string' && column.name.trim() ? column.name.trim() : 'column';
      const type = typeof column.type === 'string' && column.type.trim() ? ` : ${column.type.trim()}` : '';
      const pad = Math.max(2, Math.min(8, w * 0.05));
      cx.font = `${Math.max(4, Math.min(fs, h * 0.42))}px Inter, 'Segoe UI', sans-serif`;
      if (key) { cx.textAlign = 'center'; cx.fillText(key, w * 0.16, h / 2, w * 0.25); }
      cx.textAlign = 'left'; cx.fillText(`${name}${type}`, w * 0.36 + pad * 0.25, h / 2, Math.max(1, w * 0.64 - pad));
      cx.restore(); return;
    }
    if (definition.geometry === 'umlLifeline') {
      const headerHeight = h * 0.22;
      cx.font = `600 ${Math.max(4, Math.min(fs, headerHeight * 0.58))}px Inter, 'Segoe UI', sans-serif`;
      cx.fillText(text, w / 2, headerHeight / 2, Math.max(1, w - 10));
      cx.restore(); return;
    }
    if (definition.geometry === 'umlActorParticipant') {
      cx.font = `600 ${Math.max(4, Math.min(fs, h * 0.075))}px Inter, 'Segoe UI', sans-serif`;
      cx.fillText(text, w / 2, h * 0.35, Math.max(1, w - 8));
      cx.restore(); return;
    }
    if (definition.geometry === 'umlRole') {
      const stereotype = typeof params.stereotype === 'string' ? params.stereotype : '';
      if (stereotype) {
        cx.font = `600 ${Math.max(4, Math.min(fs * 0.62, h * 0.10))}px Inter, 'Segoe UI', sans-serif`;
        cx.fillText(stereotype, w / 2, h * 0.76, Math.max(1, w - 8));
      }
      cx.font = `600 ${Math.max(5, Math.min(fs, h * 0.16))}px Inter, 'Segoe UI', sans-serif`;
      cx.fillText(text, w / 2, h * 0.91, Math.max(1, w - 8));
      cx.restore(); return;
    }
    if (definition.geometry === 'activityPartition' || definition.geometry === 'umlCompositeState') {
      const titleHeight = definition.geometry === 'activityPartition' ? h * 0.24 : h * 0.29;
      cx.font = `600 ${Math.max(4, Math.min(fs, titleHeight * 0.56))}px Inter, 'Segoe UI', sans-serif`;
      cx.fillText(text, w / 2, titleHeight / 2, Math.max(1, w - 12));
      cx.restore(); return;
    }
    if (definition.geometry === 'ellipse' && params.key === 'foreign') {
      cx.textAlign = 'left';
      cx.font = `750 ${Math.max(4, Math.min(fs * 0.62, h * 0.15))}px Inter, 'Segoe UI', sans-serif`;
      cx.fillText('FK', w * 0.22, h * 0.24, Math.max(1, w * 0.22));
      cx.textAlign = 'center';
      cx.font = `${Math.max(5, Math.min(fs, h * 0.24))}px Inter, 'Segoe UI', sans-serif`;
      cx.fillText(text, w / 2, h * 0.55, Math.max(1, w * 0.78));
      cx.restore(); return;
    }
    if (definition.geometry === 'umlBoundary' || (definition.geometry === 'frame' && params.componentGlyph !== true)) {
      cx.textAlign = 'left'; cx.textBaseline = 'top'; cx.font = `600 ${Math.max(4, Math.min(fs, h * 0.22))}px Inter, 'Segoe UI', sans-serif`;
      cx.fillText(text, Math.min(8, w * 0.06), Math.min(5, h * 0.06), Math.max(1, w - 16));
      cx.restore(); return;
    }
    const insetLeft = definition.geometry === 'pool' || definition.geometry === 'lane' ? w * 0.18 : Math.max(3, w * 0.05);
    const insetRight = Math.max(3, w * 0.05), maxWidth = Math.max(1, w - insetLeft - insetRight);
    const lines = text.split('\n').slice(0, 80).filter(line => !/^[-─━]{2,}$/.test(line.trim()));
    const wrapped: string[] = [];
    for (const line of lines) {
      if (!line) { wrapped.push(''); continue; }
      const words = line.split(/\s+/); let current = '';
      for (const word of words) {
        const next = current ? `${current} ${word}` : word;
        if (current && cx.measureText(next).width > maxWidth) { wrapped.push(current); current = word; }
        else current = next;
      }
      if (current) wrapped.push(current);
    }
    const stereotype = typeof params.stereotype === 'string' ? params.stereotype : '';
    if (stereotype) wrapped.unshift(stereotype);
    const lineHeight = Math.min(fs * 1.28, Math.max(4, h / Math.max(2, wrapped.length + 0.4)));
    const visibleLines = Math.max(1, Math.floor((h - 4) / lineHeight));
    const clipped = wrapped.slice(0, visibleLines);
    if (definition.geometry === 'pool' || definition.geometry === 'lane') {
      cx.translate(w * 0.075, h / 2); cx.rotate(-Math.PI / 2);
      cx.fillText(clipped.join(' ').slice(0, 60), 0, 0, Math.max(1, h - 10));
    } else {
      const totalHeight = clipped.length * lineHeight;
      let y = (h - totalHeight) / 2 + lineHeight / 2;
      for (const line of clipped) {
        if (!line) { y += lineHeight; continue; }
        cx.fillText(line, insetLeft + maxWidth / 2, y, maxWidth);
        y += lineHeight;
      }
    }
    cx.restore();
  }

  private drawStructuredErTableLabel(shape: DiagramShape, definition: ShapeDefinition, rawColumns: unknown[]) {
    const cx = this.cx, w = shape.w, h = shape.h, fs = Math.max(6, Math.min(96, shape.fs ?? 14));
    const columns = rawColumns.filter(isRecord).slice(0, 32);
    const layout = structuredTableLayout(h, columns.length + 1);
    const title = typeof shape.text === 'string' && shape.text.trim() ? shape.text.trim() : definition.label;
    const left = Math.max(2, Math.min(8, w * 0.05)), maxWidth = Math.max(1, w - left * 2);
    cx.textAlign = 'left'; cx.textBaseline = 'middle'; cx.fillStyle = shape.textColor ?? '#1f2937';
    if (layout.rowHeight >= 4) {
      cx.font = `600 ${Math.max(3.5, Math.min(fs, layout.rowHeight * 0.68))}px Inter, 'Segoe UI', sans-serif`;
      cx.fillText(title, left, layout.rowCenters[0], maxWidth);
    }
    columns.forEach((column, index) => {
      const rowHeight = layout.rowHeight;
      if (rowHeight < 4) return;
      const key = column.key === 'primary' ? 'PK  ' : column.key === 'foreign' ? 'FK  ' : '';
      const name = typeof column.name === 'string' && column.name.trim() ? column.name.trim() : `column ${index + 1}`;
      const type = typeof column.type === 'string' && column.type.trim() ? ` : ${column.type.trim()}` : '';
      cx.font = `${Math.max(3.5, Math.min(fs, rowHeight * 0.66))}px Inter, 'Segoe UI', sans-serif`;
      cx.fillText(`${key}${name}${type}`, left, layout.rowCenters[index + 1], maxWidth);
    });
  }

  private drawStructuredClassifierLabel(shape: DiagramShape, definition: ShapeDefinition, rawCompartments: unknown[]) {
    const cx = this.cx, w = shape.w, h = shape.h, fs = Math.max(6, Math.min(96, shape.fs ?? 14));
    const compartments = rawCompartments.filter(isRecord).slice(0, 4);
    const layout = structuredTableLayout(h, compartments.length + 1), bandHeight = layout.rowHeight;
    const title = typeof shape.text === 'string' && shape.text.trim() ? shape.text.trim() : definition.label;
    const stereotype = typeof shape.params?.stereotype === 'string' ? shape.params.stereotype : '';
    const left = Math.max(3, Math.min(8, w * 0.05)), maxWidth = Math.max(1, w - left * 2);
    cx.fillStyle = shape.textColor ?? '#1f2937'; cx.textAlign = 'center'; cx.textBaseline = 'middle';
    if (stereotype) {
      const halfLine = bandHeight / 2;
      if (halfLine >= 2.5) {
        cx.font = `${Math.max(2.5, Math.min(fs * 0.68, halfLine * 0.78))}px Inter, 'Segoe UI', sans-serif`;
        cx.fillText(stereotype, w / 2, bandHeight * 0.25, maxWidth);
        cx.font = `${shape.params?.italicName === true ? 'italic ' : ''}${Math.max(3, Math.min(fs, halfLine * 0.82))}px Inter, 'Segoe UI', sans-serif`;
        cx.fillText(title, w / 2, bandHeight * 0.72, maxWidth);
      }
    } else if (bandHeight >= 3) {
      cx.font = `${shape.params?.italicName === true ? 'italic ' : ''}${Math.max(3, Math.min(fs, bandHeight * 0.72))}px Inter, 'Segoe UI', sans-serif`;
      cx.fillText(title, w / 2, bandHeight / 2, maxWidth);
    }
    if (shape.params?.underlineName === true && bandHeight >= 4) {
      const lineWidth = Math.min(w * 0.75, cx.measureText(title).width);
      cx.beginPath(); cx.moveTo(w / 2 - lineWidth / 2, bandHeight * 0.83); cx.lineTo(w / 2 + lineWidth / 2, bandHeight * 0.83);
      cx.strokeStyle = shape.textColor ?? '#1f2937'; cx.lineWidth = Math.max(0.75, Math.min(1.5, fs / 14)); cx.stroke();
    }
    compartments.forEach((compartment, index) => {
      const values = Array.isArray(compartment.items) ? compartment.items.filter((item: unknown): item is string => typeof item === 'string').slice(0, 20) : [];
      if (!values.length) return;
      const lineHeight = bandHeight / values.length;
      if (lineHeight < 4) return;
      cx.textAlign = 'left'; cx.font = `${Math.max(3, Math.min(fs, lineHeight * 0.78))}px Inter, 'Segoe UI', sans-serif`;
      const pad = Math.max(3, Math.min(8, w * 0.05));
      const bandTop = bandHeight * (index + 1);
      values.forEach((value: string, lineIndex: number) => cx.fillText(value, pad, bandTop + lineHeight * (lineIndex + 0.5), Math.max(1, w - pad * 2)));
    });
  }

  private connectorLabelVisual(connector: ConnectorShape, route = getConnectorRoute(connector)): ConnectorLabelVisual | null {
    if (!connector.label?.trim()) return null;
    const cx = this.cx;
    cx.save(); cx.font = '12px Inter, \'Segoe UI\', sans-serif';
    const text = fitConnectorLabel(connector.label, value => cx.measureText(value).width);
    const textWidth = Math.min(280, cx.measureText(text).width);
    cx.restore();
    const layout = connectorLabelLayout(route, { startMarker: connector.startMarker, endMarker: connector.endMarker,
      sourceCardinality: connector.sourceCardinality, targetCardinality: connector.targetCardinality,
      strokeWidth: connector.sw, labelWidth: textWidth, labelHeight: CONNECTOR_LABEL_HEIGHT });
    return { text, x: layout.x, y: layout.y, width: layout.width, height: layout.height, textWidth };
  }

  private drawConnectorShape(connector: ConnectorShape) {
    const cx = this.cx, def = getShapeDefinition(connector.shapeId);
    if (!def) return;
    const points = getConnectorRoute(connector);
    cx.save(); cx.strokeStyle = connector.color; cx.fillStyle = connector.color; cx.lineWidth = Math.max(0.5, connector.sw);
    cx.lineCap = 'round'; cx.lineJoin = 'round';
    cx.setLineDash(connector.lineStyle === 'dashed' ? [8, 5] : connector.lineStyle === 'dotted' ? [2, 4] : []);
    cx.beginPath();
    cx.moveTo(points[0][0], points[0][1]);
    for (let index = 1; index < points.length; index++) cx.lineTo(points[index][0], points[index][1]);
    cx.stroke(); cx.setLineDash([]);
    const label = this.connectorLabelVisual(connector, points);
    if (label) {
      // Keep the route visible around the glyphs: an opaque label plate can erase the line
      // across short and waypoint routes. A board-colored text halo keeps the label legible
      // without hiding the connector or its endpoints.
      cx.save(); cx.font = '12px Inter, \'Segoe UI\', sans-serif'; cx.textAlign = 'center'; cx.textBaseline = 'middle';
      cx.strokeStyle = '#f8f8f5'; cx.lineWidth = 4; cx.lineJoin = 'round';
      cx.strokeText(label.text, label.x, label.y, 280);
      cx.fillStyle = connector.color; cx.fillText(label.text, label.x, label.y, 280);
      cx.restore();
    }
    // Markers are painted after the plate so a short-route label can never erase an arrowhead.
    const firstNext = points[1] ?? [connector.x2, connector.y2];
    const lastPrevious = points.at(-2) ?? [connector.x1, connector.y1];
    const startAngle = Math.atan2(points[0][1] - firstNext[1], points[0][0] - firstNext[0]);
    const endAngle = Math.atan2(points.at(-1)![1] - lastPrevious[1], points.at(-1)![0] - lastPrevious[0]);
    this.drawEndpointMarker(connector.startMarker, connector.x1, connector.y1, startAngle, connector.sw, connector.color, connector.sourceCardinality);
    this.drawEndpointMarker(connector.endMarker, connector.x2, connector.y2, endAngle, connector.sw, connector.color, connector.targetCardinality);
    cx.restore();
  }

  private drawEndpointMarker(marker: EndpointMarker, x: number, y: number, angle: number, width: number, color: string, cardinality?: string) {
    const cx = this.cx;
    if (cardinality) {
      drawCardinalityMarker(cx, cardinality, x, y, angle, Math.max(9, width * 3), color);
      return;
    }
    if (marker === 'none') return;
    const size = Math.max(8, width * 3.1), ux = Math.cos(angle), uy = Math.sin(angle), nx = -uy, ny = ux;
    const baseX = x - ux * size, baseY = y - uy * size;
    cx.save(); cx.lineWidth = Math.max(1, width); cx.strokeStyle = String(cx.strokeStyle); cx.fillStyle = ['hollowTriangle', 'diamond', 'circle', 'zeroOrOne'].includes(marker) ? '#ffffff' : String(cx.fillStyle);
    if (marker === 'bar') {
      cx.beginPath(); cx.moveTo(x + nx * size * 0.42, y + ny * size * 0.42); cx.lineTo(x - nx * size * 0.42, y - ny * size * 0.42); cx.stroke();
    } else if (marker === 'circle' || marker === 'zeroOrOne') {
      cx.beginPath(); cx.arc(x - ux * size * 0.5, y - uy * size * 0.5, size * 0.25, 0, Math.PI * 2); cx.fill(); cx.stroke();
      if (marker === 'zeroOrOne') drawEndpointMarkerAt(cx, 'bar', baseX - ux * size * 0.15, baseY - uy * size * 0.15, angle, size * 0.45);
    } else if (marker === 'crowFoot') {
      drawCrowFoot(cx, x, y, angle, size);
    } else {
      const half = size * 0.43;
      const tip: [number, number] = [x, y];
      const left: [number, number] = [baseX + nx * half, baseY + ny * half];
      const right: [number, number] = [baseX - nx * half, baseY - ny * half];
      cx.beginPath(); cx.moveTo(...tip); cx.lineTo(...left); cx.lineTo(...right); cx.closePath();
      if (marker === 'arrow' || marker === 'blockArrow' || marker === 'filledDiamond') cx.fill();
      else if (marker === 'diamond') {
        const backX = x - ux * size * 1.8, backY = y - uy * size * 1.8;
        cx.moveTo(backX, backY); cx.lineTo(...left); cx.lineTo(x, y); cx.lineTo(...right); cx.closePath(); cx.fill(); cx.stroke();
      } else cx.stroke();
    }
    cx.restore();
  }

  private drawShape(s: AnyShape) {
    const cx = this.cx;
    cx.save();
    if (isRotatableBox(s) && (s.rotation ?? 0) !== 0) {
      const box = s as BoxShape, centerX = box.x + box.w / 2, centerY = box.y + box.h / 2;
      cx.translate(centerX, centerY); cx.rotate((box.rotation ?? 0) * Math.PI / 180); cx.translate(-centerX, -centerY);
    }
    if (s.type !== 'diagram' && s.type !== 'connector' && !('vertices' in s && Array.isArray(s.vertices) && s.vertices.length >= 3)) {
      const definition = getShapeDefinitionForLegacyType(s.type);
      if (definition?.kind === 'shape' && 'x' in s && 'y' in s && 'w' in s && 'h' in s && 'fill' in s && 'stroke' in s) {
        const legacyShape = s as BoxShape & { fill: string; stroke: string; sw?: number };
        this.drawDiagramShape({ ...legacyShape, type: 'diagram', shapeId: definition.id,
          params: { ...(definition.defaultParams ?? {}), ...(legacyShape.params ?? {}) },
          fill: legacyShape.fill, stroke: legacyShape.stroke, sw: legacyShape.sw ?? 2,
          text: legacyShape.text ?? '', fs: legacyShape.fs ?? this.style.fontSize,
          textColor: legacyShape.textColor ?? '#1f2937',
        } as DiagramShape);
        cx.restore();
        return;
      }
    }

    switch (s.type) {
      case 'pen': {
        const hasMeasuredPressure = s.pts.some(point => Number.isFinite(point[2]) && Math.abs(point[2]! - 0.5) > 0.02);
        const outline = getStroke(s.pts, {
          size: Math.max(0.1, s.size),
          thinning: 0.4,
          smoothing: 0.5,
          streamline: 0.25,
          easing: pressure => pressure,
          simulatePressure: s.simulatePressure ?? !hasMeasuredPressure,
          start: {cap:true, taper:0},
          end: {cap:true, taper:0},
          last:true,
        });
        if (!outline.length) break;
        cx.fillStyle = s.color;
        if (outline.length < 4) {
          const point = s.pts[0];
          if (point) {
            cx.beginPath(); cx.arc(point[0], point[1], Math.max(0.5, s.size / 2), 0, Math.PI * 2); cx.fill();
          }
          break;
        }
        // getStroke returns a filled outline, not a centerline. Follow the library's
        // midpoint/quadratic construction so outline corners remain smooth and the
        // generated start/end cap geometry is preserved.
        const path = new Path2D();
        path.moveTo(outline[0][0], outline[0][1]);
        const first = outline[1], second = outline[2];
        path.quadraticCurveTo(first[0], first[1], (first[0] + second[0]) / 2, (first[1] + second[1]) / 2);
        for (let index = 2; index < outline.length - 1; index++) {
          const control = outline[index], next = outline[index + 1];
          path.quadraticCurveTo(control[0], control[1], (control[0] + next[0]) / 2, (control[1] + next[1]) / 2);
        }
        path.closePath();
        cx.fill(path);
        break;
      }
      case 'line': {
        const line = s as LineShape;
        cx.strokeStyle = line.color; cx.lineWidth = line.sw; cx.lineCap = 'round';
        cx.beginPath(); cx.moveTo(line.x1, line.y1); cx.lineTo(line.x2, line.y2); cx.stroke();
        break;
      }
      case 'curve': {
        const curve = s as CurveShape;
        if (curve.pts.length < 2) break;
        cx.strokeStyle = curve.color; cx.lineWidth = curve.sw; cx.lineCap = 'round'; cx.lineJoin = 'round';
        cx.beginPath(); cx.moveTo(curve.pts[0][0], curve.pts[0][1]);
        for (let index = 0; index < curve.pts.length - 1; index++) {
          const previous = curve.pts[Math.max(0, index - 1)];
          const current = curve.pts[index];
          const next = curve.pts[index + 1];
          const following = curve.pts[Math.min(curve.pts.length - 1, index + 2)];
          cx.bezierCurveTo(
            current[0] + (next[0] - previous[0]) / 6,
            current[1] + (next[1] - previous[1]) / 6,
            next[0] - (following[0] - current[0]) / 6,
            next[1] - (following[1] - current[1]) / 6,
            next[0], next[1],
          );
        }
        cx.stroke();
        break;
      }
      case 'diagram': {
        this.drawDiagramShape(s as DiagramShape);
        break;
      }
      case 'connector': {
        this.drawConnectorShape(s as ConnectorShape);
        break;
      }
      case 'rect': {
        const shape = s as RectShape; const [rx,ry,rw,rh]=nr(shape.x,shape.y,shape.w,shape.h);
        cx.fillStyle=shape.fill; cx.strokeStyle=shape.stroke; cx.lineWidth=shape.sw;
        if (shape.vertices?.length === 4) {
          const vertices = getShapeVertices(shape, false);
          cx.beginPath(); cx.moveTo(vertices[0][0], vertices[0][1]);
          vertices.slice(1).forEach(([x, y]) => cx.lineTo(x, y));
          cx.closePath();
        } else {
          cx.beginPath(); cx.roundRect(rx,ry,rw,rh,0);
        }
        cx.fill(); if(shape.sw>0) cx.stroke(); break;
      }
      case 'rounded-rect': {
        const shape = s as RectShape; const {x,y,w,h,fill,stroke,sw} = shape; const [rx,ry,rw,rh]=nr(x,y,w,h);
        const radius = Number.isFinite(shape.params?.cornerRadius) ? Number(shape.params?.cornerRadius) : 16;
        cx.fillStyle=fill; cx.strokeStyle=stroke; cx.lineWidth=sw;
        cx.beginPath(); cx.roundRect(rx,ry,rw,rh,Math.max(0, Math.min(radius, Math.min(rw, rh) / 2))); cx.fill(); if(sw>0) cx.stroke(); break;
      }
      case 'ellipse': {
        const {x,y,w,h,fill,stroke,sw} = s; const [rx,ry,rw,rh]=nr(x,y,w,h);
        cx.fillStyle=fill; cx.strokeStyle=stroke; cx.lineWidth=sw;
        cx.beginPath(); cx.ellipse(rx+rw/2,ry+rh/2,rw/2,rh/2,0,0,Math.PI*2);
        cx.fill(); if(sw>0) cx.stroke(); break;
      }
      case 'triangle': {
        const shape = s as TriShape;
        const vertices = getShapeVertices(shape, false);
        cx.fillStyle=shape.fill; cx.strokeStyle=shape.stroke; cx.lineWidth=shape.sw;
        cx.beginPath(); cx.moveTo(vertices[0][0], vertices[0][1]);
        vertices.slice(1).forEach(([x, y]) => cx.lineTo(x, y));
        cx.closePath(); cx.fill(); if(shape.sw>0) cx.stroke(); break;
      }
      case 'diamond': {
        const {x,y,w,h,fill,stroke,sw} = s; const [rx,ry,rw,rh]=nr(x,y,w,h);
        cx.fillStyle=fill; cx.strokeStyle=stroke; cx.lineWidth=sw;
        cx.beginPath(); cx.moveTo(rx+rw/2,ry); cx.lineTo(rx+rw,ry+rh/2); cx.lineTo(rx+rw/2,ry+rh); cx.lineTo(rx,ry+rh/2); cx.closePath();
        cx.fill(); if(sw>0) cx.stroke(); break;
      }
      case 'star': {
        const {x,y,w,h,fill,stroke,sw} = s as StarShape; const [rx,ry,rw,rh]=nr(x,y,w,h);
        const pcx=rx+rw/2, pcy=ry+rh/2, ro=Math.min(rw,rh)/2, ri=ro*0.42;
        cx.fillStyle=fill; cx.strokeStyle=stroke; cx.lineWidth=sw;
        cx.beginPath();
        for(let i=0;i<10;i++){
          const r=i%2===0?ro:ri, a=(i*Math.PI/5)-Math.PI/2;
          const px=pcx+r*Math.cos(a), py=pcy+r*Math.sin(a);
          if(i===0) cx.moveTo(px,py); else cx.lineTo(px,py);
        }
        cx.closePath(); cx.fill(); if(sw>0) cx.stroke(); break;
      }
      case 'callout': {
        const {x,y,w,h,fill,stroke,sw} = s as CalloutShape; const [rx,ry,rw,rh]=nr(x,y,w,h);
        cx.fillStyle=fill; cx.strokeStyle=stroke; cx.lineWidth=sw;
        cx.beginPath(); cx.roundRect(rx,ry,rw,rh,8);
        cx.moveTo(rx+20, ry+rh); cx.lineTo(rx+10, ry+rh+20); cx.lineTo(rx+30, ry+rh);
        cx.fill(); if(sw>0) cx.stroke(); break;
      }
      case 'pentagon': case 'hexagon': case 'parallelogram': case 'trapezoid': case 'right-triangle': {
        const shape = s as PolygonShape;
        const vertices = getShapeVertices(shape, false);
        if (vertices.length < 3) break;
        cx.fillStyle = shape.fill; cx.strokeStyle = shape.stroke; cx.lineWidth = shape.sw;
        cx.beginPath(); cx.moveTo(vertices[0][0], vertices[0][1]);
        for (let index = 1; index < vertices.length; index++) cx.lineTo(vertices[index][0], vertices[index][1]);
        cx.closePath(); cx.fill(); if (shape.sw > 0) cx.stroke(); break;
      }
      case 'arrow': {
        const {x1,y1,x2,y2,color,sw}=s;
        cx.strokeStyle=color; cx.fillStyle=color; cx.lineWidth=sw; cx.lineCap='round';
        cx.beginPath(); cx.moveTo(x1,y1); cx.lineTo(x2,y2); cx.stroke();
        const ang=Math.atan2(y2-y1,x2-x1), AL=10+sw*3;
        cx.beginPath(); cx.moveTo(x2,y2);
        cx.lineTo(x2-AL*Math.cos(ang-0.42),y2-AL*Math.sin(ang-0.42));
        cx.lineTo(x2-AL*Math.cos(ang+0.42),y2-AL*Math.sin(ang+0.42));
        cx.closePath(); cx.fill(); break;
      }
      case 'sticky':
      case 'text':
      case 'math':
      case 'code': {
        // Shapes with heavily stylized HTML elements, fonts, backgrounds, flexbox wraps (like sticky, text, code, math)
        // have been fully shifted to be natively rendered by DOM in sync with their overlay HTML counterparts
        // Thus their visual rendering code is fully abstracted outwards resolving any cross Z-index Canvas/DOM layer tearing
        break;
      }
      case 'image': {
        // Rendered via HTML overlay for z-ordering consistency
        break;
      }
    }
    if (s.type !== 'diagram' && isLabelEditableShape(s) && 'x' in s && 'w' in s
      && 'text' in s && typeof s.text === 'string' && s.text.length) {
      const box = s as BoxShape, fs = box.fs ?? 14;
      cx.fillStyle = box.textColor ?? '#1f2937'; cx.font = `${fs}px Inter, 'Segoe UI', sans-serif`;
      cx.textAlign = 'center'; cx.textBaseline = 'middle';
      const lines = String(box.text).split('\n').slice(0, 80), lineHeight = Math.min(fs * 1.25, box.h / Math.max(1, lines.length));
      let y = box.y + box.h / 2 - lineHeight * (lines.length - 1) / 2;
      for (const line of lines) { cx.fillText(line, box.x + box.w / 2, y, Math.max(8, box.w - 16)); y += lineHeight; }
    }
    cx.restore();
  }

  private drawSelection(shape: AnyShape) {
    if (['sticky', 'text', 'math', 'code', 'image'].includes(shape.type)) return; // DOM overlays own their focus/selection chrome.
    const { cx, cam } = this, zoom = Math.max(0.04, cam.zoom), handleRadius = 5 / zoom;
    cx.save(); cx.strokeStyle = '#3b82f6'; cx.fillStyle = '#ffffff'; cx.lineWidth = 2 / zoom;
    cx.setLineDash([5 / zoom, 4 / zoom]);
    if (shape.type === 'connector') {
      const connector = shape as ConnectorShape, points = getConnectorRoute(connector);
      cx.beginPath(); cx.moveTo(points[0][0], points[0][1]);
      for (let index = 1; index < points.length; index++) cx.lineTo(points[index][0], points[index][1]);
      cx.stroke(); cx.setLineDash([]);
      const handles: [number, number][] = [[connector.x1, connector.y1], [connector.x2, connector.y2], ...connector.waypoints];
      for (const [x, y] of handles) {
        cx.beginPath(); cx.arc(x, y, handleRadius, 0, Math.PI * 2); cx.fill(); cx.stroke();
      }
      if (hasConnectorRotationHandle(connector)) {
        const rotate = { x: (shape.minX + shape.maxX) / 2, y: shape.minY - 24 / zoom };
        cx.beginPath(); cx.moveTo((shape.minX + shape.maxX) / 2, shape.minY); cx.lineTo(rotate.x, rotate.y); cx.stroke();
        cx.setLineDash([]); cx.beginPath(); cx.arc(rotate.x, rotate.y, handleRadius, 0, Math.PI * 2); cx.fill(); cx.stroke();
      }
      cx.restore(); return;
    }
    if (shape.type === 'line' || shape.type === 'arrow') {
      const line = shape as LineShape | ArrowShape;
      cx.beginPath(); cx.moveTo(line.x1, line.y1); cx.lineTo(line.x2, line.y2); cx.stroke(); cx.setLineDash([]);
      for (const [x, y] of [[line.x1, line.y1], [line.x2, line.y2]]) {
        cx.beginPath(); cx.arc(x, y, handleRadius, 0, Math.PI * 2); cx.fill(); cx.stroke();
      }
      cx.restore(); return;
    }
    if ('x' in shape && 'w' in shape) {
      const box = shape as BoxShape;
      const diagramDefinition = box.type === 'diagram' ? getShapeDefinition((box as DiagramShape).shapeId) : undefined;
      const solidShape = box.type === 'diagram' && diagramDefinition?.solid3d ? box as DiagramShape : null;
      const corners = solidShape ? this.solidSelectionCorners(solidShape) : rotatedBoxCorners(box);
      cx.beginPath(); cx.moveTo(corners[0][0], corners[0][1]);
      for (let index = 1; index < corners.length; index++) cx.lineTo(corners[index][0], corners[index][1]);
      cx.closePath(); cx.stroke(); cx.setLineDash([]);
      const handles = solidShape ? this.solidResizeHandlePoints(solidShape) : getBoxHandlePoints(box);
      for (const [, x, y] of handles) {
        cx.beginPath(); cx.arc(x, y, handleRadius, 0, Math.PI * 2); cx.fill(); cx.stroke();
      }
      if (!solidShape) {
        const topMid = objectPointToWorld(box, { x: box.w / 2, y: 0 });
        const rotate = getRotationHandlePoint(box, zoom);
        cx.beginPath(); cx.moveTo(topMid.x, topMid.y); cx.lineTo(rotate[0], rotate[1]); cx.stroke();
        cx.beginPath(); cx.arc(rotate[0], rotate[1], handleRadius, 0, Math.PI * 2); cx.fill(); cx.stroke();
      }
      cx.restore(); return;
    }
    const width = Math.max(0, shape.maxX - shape.minX), height = Math.max(0, shape.maxY - shape.minY);
    cx.setLineDash([]); cx.strokeRect(shape.minX, shape.minY, width, height);
    cx.restore();
  }

  private saveH() {
    this.pendingFormulaCaptureId = null;
    this.undoManager.stopCapturing();
    while (this.undoManager.undoStack.length > 100) this.undoManager.undoStack.shift();
    while (this.undoManager.redoStack.length > 100) this.undoManager.redoStack.shift();
  }
}

// ─── pure helpers ─────────────────────────────────────────────────────────────
function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function isBoxShapeTool(value: string): value is BoxShapeTool {
  return getShapeDefinitionByToolId(value)?.kind === 'shape';
}

export function isConnectorTool(value: string): value is ConnectorTool {
  return getShapeDefinitionByToolId(value)?.kind === 'connector';
}

export function isConnectorShape(shape: AnyShape): boolean {
  return shape.type === 'connector' || shape.type === 'line' || shape.type === 'arrow';
}

export function isLabelEditableShape(shape: AnyShape): boolean {
  if (['sticky', 'text', 'math', 'code'].includes(shape.type)) return true;
  if (shape.type === 'diagram') return Boolean(getShapeDefinition((shape as DiagramShape).shapeId));
  return isBoxShapeTool(shape.type) && 'x' in shape && 'w' in shape;
}

export function isFixedShapeLabel(shape: AnyShape): boolean {
  if (shape.type === 'diagram') return Boolean(getShapeDefinition((shape as DiagramShape).shapeId));
  return isBoxShapeTool(shape.type) && 'x' in shape && 'w' in shape;
}

function isConnectableShape(shape: AnyShape): boolean {
  if (shape.type === 'diagram') return Boolean(getShapeDefinition((shape as DiagramShape).shapeId));
  return isBoxShapeTool(shape.type) && !['image', 'text', 'math', 'code', 'sticky'].includes(shape.type) && 'x' in shape;
}

function isRotatableBox(shape: AnyShape): shape is RotatableShape {
  return 'x' in shape && 'y' in shape && 'w' in shape && 'h' in shape;
}

function localSolidProjectedBounds(shape: DiagramShape) {
  const definition = getShapeDefinition(shape.shapeId);
  if (!definition?.solid3d) return { minX: 0, minY: 0, maxX: shape.w, maxY: shape.h };
  const scale = shape.scale3d ?? solid3DScaleFromBounds(shape.w, shape.h, definition.width, definition.height, definition.geometry as import('./shapes/solid3d').Solid3DGeometry);
  return buildShapeGeometry(definition, shape.w, shape.h, shape.params ?? definition.defaultParams ?? {}, {
    scale, referenceWidth: definition.width, referenceHeight: definition.height,
  }).projection?.projectedBounds ?? { minX: 0, minY: 0, maxX: shape.w, maxY: shape.h };
}

function projectedSolidWorldCorners(shape: DiagramShape): [number, number][] {
  const bounds = localSolidProjectedBounds(shape), centerX = shape.x + shape.w / 2, centerY = shape.y + shape.h / 2;
  return [[bounds.minX, bounds.minY], [bounds.maxX, bounds.minY], [bounds.maxX, bounds.maxY], [bounds.minX, bounds.maxY]].map(([x, y]) =>
    rotatePoint(shape.x + x, shape.y + y, centerX, centerY, shape.rotation ?? 0));
}

interface SolidProjectedSize { width: number; height: number; }
const solidProjectedSizeCache = new Map<string, SolidProjectedSize>();

/** Measure the shared canonical projection once at unit scale; uniform object scale is linear. */
function unitSolidProjectedSize(definition: ShapeDefinition, params: Readonly<Record<string, unknown>>): SolidProjectedSize {
  const key = `${definition.id}|${definition.width}x${definition.height}|${JSON.stringify(params)}`;
  const cached = solidProjectedSizeCache.get(key);
  if (cached) return cached;
  const bounds = buildShapeGeometry(definition, definition.width, definition.height, params, {
    scale: { x: 1, y: 1, z: 1 }, referenceWidth: definition.width, referenceHeight: definition.height,
  }).projection?.projectedBounds;
  const measured = { width: Math.max(1, (bounds?.maxX ?? definition.width) - (bounds?.minX ?? 0)),
    height: Math.max(1, (bounds?.maxY ?? definition.height) - (bounds?.minY ?? 0)) };
  if (solidProjectedSizeCache.size >= 256) {
    const oldestKey = solidProjectedSizeCache.keys().next().value;
    if (oldestKey !== undefined) solidProjectedSizeCache.delete(oldestKey);
  }
  solidProjectedSizeCache.set(key, measured);
  return measured;
}

/** A 3D draw gesture is free: its projected width and height set independent local X/Y dimensions. */
function getShapeCreationResizePolicy(definition?: ShapeDefinition): ShapeResizePolicy {
  return definition?.solid3d ? { mode: 'free' } : getShapeResizePolicy(definition);
}

type SolidScaleFitMode = 'create' | 'resize' | 'uniform';

function fitSolidScaleToProjectedBounds(
  shape: DiagramShape,
  definition: ShapeDefinition,
  baseScale: Solid3DScale,
  targetWidth: number,
  targetHeight: number,
  mode: SolidScaleFitMode = 'resize',
): Solid3DScale {
  const safeScale = (value: number) => Math.max(0.01, Math.min(64, Number.isFinite(value) ? value : 1));
  const target = { width: Math.max(1, Number.isFinite(targetWidth) ? targetWidth : 1),
    height: Math.max(1, Number.isFinite(targetHeight) ? targetHeight : 1) };
  const params = shape.params ?? definition.defaultParams ?? {};
  const unit = unitSolidProjectedSize(definition, params);
  if (mode === 'uniform') {
    // Click-to-create and canonical defaults keep the semantic shape (Cube remains equal-edge,
    // Sphere remains isotropic); only the overall local size follows the reference box.
    const factor = Math.min(target.width / unit.width, target.height / unit.height);
    const uniform = safeScale(factor * Math.cbrt(safeScale(baseScale.x) * safeScale(baseScale.y) * safeScale(baseScale.z)));
    return { x: uniform, y: uniform, z: uniform };
  }

  let scale: Solid3DScale = { x: safeScale(baseScale.x), y: safeScale(baseScale.y), z: safeScale(baseScale.z) };
  if (mode === 'create') {
    // Establish the common depth/overall scale from the tighter projected side, then solve X and
    // Y independently. The draw box therefore changes real local geometry instead of skewing a
    // 2D path or locking all three model axes together.
    const overall = Math.min(target.width / unit.width, target.height / unit.height);
    scale = { x: safeScale(scale.x * overall), y: safeScale(scale.y * overall), z: safeScale(scale.z * overall) };
  }

  const projectedSize = (candidate: Solid3DScale): SolidProjectedSize => {
    const bounds = buildShapeGeometry(definition, definition.width, definition.height, params, {
      scale: candidate, referenceWidth: definition.width, referenceHeight: definition.height,
    }).projection?.projectedBounds;
    return { width: Math.max(1e-6, (bounds?.maxX ?? definition.width) - (bounds?.minX ?? 0)),
      height: Math.max(1e-6, (bounds?.maxY ?? definition.height) - (bounds?.minY ?? 0)) };
  };
  const error = (size: SolidProjectedSize) => ((size.width - target.width) / target.width) ** 2
    + ((size.height - target.height) / target.height) ** 2;

  // Fit the actual projected bounds with the fixed-depth Z scale and independent local X/Y scales.
  // The orthographic support bounds are piecewise linear in these positive scale factors, so a
  // damped two-variable Newton solve converges quickly and remains stable across orientation changes.
  let size = projectedSize(scale);
  for (let iteration = 0; iteration < 12; iteration++) {
    const residualX = target.width - size.width, residualY = target.height - size.height;
    if (Math.max(Math.abs(residualX) / target.width, Math.abs(residualY) / target.height) < 0.001) break;
    const stepX = Math.max(0.0005, scale.x * 0.01), stepY = Math.max(0.0005, scale.y * 0.01);
    const xLo = Math.max(0.01, scale.x - stepX), xHi = Math.min(64, scale.x + stepX);
    const yLo = Math.max(0.01, scale.y - stepY), yHi = Math.min(64, scale.y + stepY);
    const probeXLo = projectedSize({ ...scale, x: xLo }), probeXHi = projectedSize({ ...scale, x: xHi });
    const probeYLo = projectedSize({ ...scale, y: yLo }), probeYHi = projectedSize({ ...scale, y: yHi });
    const dWidthX = (probeXHi.width - probeXLo.width) / Math.max(1e-8, xHi - xLo);
    const dHeightX = (probeXHi.height - probeXLo.height) / Math.max(1e-8, xHi - xLo);
    const dWidthY = (probeYHi.width - probeYLo.width) / Math.max(1e-8, yHi - yLo);
    const dHeightY = (probeYHi.height - probeYLo.height) / Math.max(1e-8, yHi - yLo);
    const determinant = dWidthX * dHeightY - dWidthY * dHeightX;
    let deltaX = 0, deltaY = 0;
    if (Math.abs(determinant) > 1e-8) {
      deltaX = (residualX * dHeightY - dWidthY * residualY) / determinant;
      deltaY = (dWidthX * residualY - residualX * dHeightX) / determinant;
    } else {
      // At an edge-on/degenerate view the two projected dimensions can be coupled. Use the
      // normalized least-squares gradient rather than inventing a screen-space rotation/fill fix.
      const gradientX = -(residualX * dWidthX / target.width ** 2 + residualY * dHeightX / target.height ** 2);
      const gradientY = -(residualX * dWidthY / target.width ** 2 + residualY * dHeightY / target.height ** 2);
      const magnitude = Math.max(Math.abs(gradientX), Math.abs(gradientY), 1e-8);
      deltaX = -gradientX / magnitude * Math.max(0.02, scale.x * 0.15);
      deltaY = -gradientY / magnitude * Math.max(0.02, scale.y * 0.15);
    }
    const maxStepX = Math.max(0.05, scale.x * 0.75), maxStepY = Math.max(0.05, scale.y * 0.75);
    deltaX = Math.max(-maxStepX, Math.min(maxStepX, deltaX));
    deltaY = Math.max(-maxStepY, Math.min(maxStepY, deltaY));
    const previousError = error(size);
    let accepted: { scale: Solid3DScale; size: SolidProjectedSize } | null = null;
    for (const damping of [1, 0.5, 0.25, 0.125, 0.0625]) {
      const candidate = { x: safeScale(scale.x + deltaX * damping), y: safeScale(scale.y + deltaY * damping), z: scale.z };
      const candidateSize = projectedSize(candidate);
      if (error(candidateSize) < previousError - 1e-12) { accepted = { scale: candidate, size: candidateSize }; break; }
    }
    if (!accepted) break;
    scale = accepted.scale;
    size = accepted.size;
  }
  return scale;
}

function withComputedShapeBounds<T extends AnyShape>(shape: T): T {
  if (shape.type === 'connector') return { ...shape, ...connectorBounds(shape as ConnectorShape) } as T;
  if (shape.type === 'diagram' && getShapeDefinition((shape as DiagramShape).shapeId)?.solid3d) {
    const corners = projectedSolidWorldCorners(shape as DiagramShape), xs = corners.map(point => point[0]), ys = corners.map(point => point[1]);
    return { ...shape, minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) } as T;
  }
  if (isRotatableBox(shape)) return { ...shape, ...rotatedBoxBounds(shape) } as T;
  return shape;
}

function getBoxHandlePoints(box: BoxShape): [string, number, number][] {
  const corners = rotatedBoxCorners(box);
  const mid = (a: [number, number], b: [number, number]): [number, number] => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const points: [string, number, number][] = [
    ['nw', ...corners[0]], ['n', ...mid(corners[0], corners[1])], ['ne', ...corners[1]],
    ['e', ...mid(corners[1], corners[2])], ['se', ...corners[2]], ['s', ...mid(corners[2], corners[3])],
    ['sw', ...corners[3]], ['w', ...mid(corners[3], corners[0])],
  ];
  return points;
}

function getRotationHandlePoint(box: BoxShape, zoom: number): [number, number] {
  const point = objectPointToWorld(box, { x: box.w / 2, y: -24 / Math.max(0.04, zoom) });
  return [point.x, point.y];
}

/** Public route wrapper; Canvas interaction and picker previews share one route builder. */
export function getConnectorRoute(connector: ConnectorShape): [number, number][] {
  const definition = getShapeDefinition(connector.shapeId);
  return buildConnectorRoute({ routeKind: definition?.routeKind, x1: connector.x1, y1: connector.y1,
    x2: connector.x2, y2: connector.y2, waypoints: connector.waypoints });
}

/** Only non-collinear routes need a whole-path rotation handle; straight slopes are endpoint-edited. */
function hasConnectorRotationHandle(connector: ConnectorShape): boolean {
  const route = getConnectorRoute(connector);
  if (route.length < 3) return false;
  const [startX, startY] = route[0], [endX, endY] = route[route.length - 1];
  return route.slice(1, -1).some(([x, y]) => Math.abs((x - startX) * (endY - startY) - (y - startY) * (endX - startX)) > 1e-6);
}

function drawEndpointMarkerAt(ctx: CanvasRenderingContext2D, marker: 'bar', x: number, y: number, angle: number, size: number) {
  const nx = -Math.sin(angle), ny = Math.cos(angle);
  ctx.beginPath(); ctx.moveTo(x + nx * size * 0.45, y + ny * size * 0.45); ctx.lineTo(x - nx * size * 0.45, y - ny * size * 0.45); ctx.stroke();
  void marker;
}

function drawCrowFoot(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, size: number) {
  const ux = Math.cos(angle), uy = Math.sin(angle), nx = -uy, ny = ux;
  const baseX = x - ux * size * 0.55, baseY = y - uy * size * 0.55, half = size * 0.48;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(baseX + nx * half, baseY + ny * half);
  ctx.moveTo(x, y); ctx.lineTo(baseX, baseY); ctx.moveTo(x, y); ctx.lineTo(baseX - nx * half, baseY - ny * half); ctx.stroke();
}

function drawCardinalityMarker(ctx: CanvasRenderingContext2D, cardinality: string, x: number, y: number, angle: number, size: number, color: string) {
  const ux = Math.cos(angle), uy = Math.sin(angle), nx = -uy, ny = ux;
  ctx.save(); ctx.strokeStyle = color; ctx.fillStyle = '#ffffff'; ctx.lineWidth = 1.5;
  if (cardinality === 'many' || cardinality === 'one-or-many' || cardinality === 'zero-or-many') drawCrowFoot(ctx, x, y, angle, size);
  if (cardinality === 'one' || cardinality === 'one-or-many') drawEndpointMarkerAt(ctx, 'bar', x - ux * (cardinality === 'one-or-many' ? size * 0.7 : 0), y - uy * (cardinality === 'one-or-many' ? size * 0.7 : 0), angle, size * 0.75);
  if (cardinality === 'zero-or-one' || cardinality === 'zero-or-many') {
    const offset = cardinality === 'zero-or-one' ? size * 0.45 : size * 0.85;
    ctx.beginPath(); ctx.arc(x - ux * offset, y - uy * offset, size * 0.22, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    if (cardinality === 'zero-or-one') drawEndpointMarkerAt(ctx, 'bar', x - ux * size * 1.05, y - uy * size * 1.05, angle, size * 0.75);
  }
  void nx; void ny;
  ctx.restore();
}

function withoutRepeatedClosingVertex(points: [number, number][]): [number, number][] {
  const first = points[0], last = points.at(-1);
  if (points.length > 1 && first && last && first[0] === last[0] && first[1] === last[1]) return points.slice(0, -1);
  return points;
}

/** World-space polygon used by polygon primitives and their hit/erase geometry. */
export function getShapeVertices(shape: AnyShape, applyRotation = true): [number, number][] {
  if (!('x' in shape && 'w' in shape && 'h' in shape)) return [];
  const box = shape as BoxShape, [x, y, w, h] = nr(box.x, box.y, box.w, box.h);
  const centerX = x + w / 2, centerY = y + h / 2;
  if (shape.type === 'diagram') {
    const definition = getShapeDefinition((shape as DiagramShape).shapeId);
    if (!definition || ['actor', 'umlRole', 'umlDestroy', 'annotation', 'umlLifeline'].includes(definition.geometry)) return [];
    const diagram = shape as DiagramShape;
    const solidOptions = definition.solid3d ? { scale: diagram.scale3d ?? solid3DScaleFromBounds(w, h, definition.width, definition.height, definition.geometry as import('./shapes/solid3d').Solid3DGeometry),
      referenceWidth: definition.width, referenceHeight: definition.height } : undefined;
    return withoutRepeatedClosingVertex(flattenFirstPath(buildGeometryCommands(definition.geometry, w, h, diagram.params, solidOptions), 8))
      .map(([px, py]) => applyRotation ? rotatePoint(x + px, y + py, centerX, centerY, box.rotation ?? 0) : [x + px, y + py]);
  }
  let vertices: [number, number][] = [];
  if (box.vertices && box.vertices.length >= 3) {
    vertices = box.vertices.map(([nx, ny]) => [x + nx * w, y + ny * h]);
  } else if (getShapeDefinitionForLegacyType(shape.type)?.kind === 'shape') {
    const definition = getShapeDefinitionForLegacyType(shape.type)!;
    vertices = withoutRepeatedClosingVertex(flattenFirstPath(buildGeometryCommands(definition.geometry, w, h,
      { ...(definition.defaultParams ?? {}), ...(box.params ?? {}) }), 12)).map(([px, py]) => [x + px, y + py]);
  } else {
    const left = x, right = x + w, top = y, bottom = y + h;
    const corners: Record<string, [number, number][]> = {
      rect: [[left, top], [right, top], [right, bottom], [left, bottom]],
      'rounded-rect': [[left, top], [right, top], [right, bottom], [left, bottom]],
      triangle: [[centerX, top], [right, bottom], [left, bottom]],
      'right-triangle': [[left, top], [right, bottom], [left, bottom]],
      diamond: [[centerX, top], [right, centerY], [centerX, bottom], [left, centerY]],
      parallelogram: [[left + w * 0.24, top], [right, top], [right - w * 0.24, bottom], [left, bottom]],
      trapezoid: [[left + w * 0.22, top], [right - w * 0.22, top], [right, bottom], [left, bottom]],
      callout: [[left, top], [right, top], [right, bottom], [left + w * 0.30, bottom], [left + w * 0.20, bottom + 20], [left + w * 0.22, bottom], [left, bottom]],
    };
    if (corners[shape.type]) vertices = corners[shape.type];
    else if (shape.type === 'ellipse') vertices = Array.from({ length: 48 }, (_, index): [number, number] => {
      const angle = index / 48 * Math.PI * 2;
      return [centerX + Math.cos(angle) * w / 2, centerY + Math.sin(angle) * h / 2];
    });
    else if (shape.type === 'star') {
      const points = Math.max(3, Math.round(Number(box.params?.points) || 5));
      const inner = Math.max(0.12, Math.min(0.88, Number(box.params?.innerRatio) || 0.42));
      vertices = Array.from({ length: points * 2 }, (_, index): [number, number] => {
        const radius = index % 2 ? inner : 1, angle = index * Math.PI / points - Math.PI / 2;
        return [centerX + Math.cos(angle) * w / 2 * radius, centerY + Math.sin(angle) * h / 2 * radius];
      });
    } else if (shape.type === 'pentagon' || shape.type === 'hexagon') {
      const sides = shape.type === 'pentagon' ? 5 : 6;
      vertices = Array.from({ length: sides }, (_, index): [number, number] => {
        const angle = index / sides * Math.PI * 2 - Math.PI / 2;
        return [centerX + Math.cos(angle) * w / 2, centerY + Math.sin(angle) * h / 2];
      });
    }
  }
  return vertices.map(([px, py]) => applyRotation ? rotatePoint(px, py, centerX, centerY, box.rotation ?? 0) : [px, py]);
}

function getDiagramPathGroups(shape: DiagramShape): { outlines: [number, number][][]; decorations: [number, number][][]; intrinsicFills: [number, number][][] } {
  const definition = getShapeDefinition(shape.shapeId);
  if (!definition) return { outlines: [], decorations: [], intrinsicFills: [] };
  const geometry = buildShapeGeometry(definition, shape.w, shape.h, shape.params, definition.solid3d ? {
    scale: shape.scale3d ?? solid3DScaleFromBounds(shape.w, shape.h, definition.width, definition.height, definition.geometry as import('./shapes/solid3d').Solid3DGeometry),
    referenceWidth: definition.width, referenceHeight: definition.height,
  } : undefined);
  const localOutlines = flattenCommandPaths(geometry.outline, 10);
  const localDecorations = [...geometry.decorations, ...geometry.hiddenEdges].flatMap(commands => flattenCommandPaths(commands, 10));
  const localIntrinsicFills = geometry.intrinsicFills.flatMap(commands => flattenCommandPaths(commands, 10));
  const cx = shape.x + shape.w / 2, cy = shape.y + shape.h / 2;
  const transform = (paths: [number, number][][]) => paths.map(path => path.map(([x, y]) => rotatePoint(shape.x + x, shape.y + y, cx, cy, shape.rotation ?? 0)));
  return { outlines: transform(localOutlines), decorations: transform(localDecorations), intrinsicFills: transform(localIntrinsicFills) };
}

function pointTouchesDiagram(shape: DiagramShape, point: { x: number; y: number }, tolerance: number): boolean {
  const definition = getShapeDefinition(shape.shapeId);
  if (!definition) return false;
  const { outlines, decorations, intrinsicFills } = getDiagramPathGroups(shape);
  if (definition.geometry === 'annotation' || definition.geometry === 'umlLifeline' || definition.geometry === 'umlActorParticipant' || definition.geometry === 'umlRole') {
    const centerX = shape.x + shape.w / 2, centerY = shape.y + shape.h / 2;
    const [localX, localY] = unrotatePoint(point.x, point.y, centerX, centerY, shape.rotation ?? 0);
    const x = localX - shape.x, y = localY - shape.y;
    if (definition.geometry === 'annotation') return x >= 0 && x <= shape.w && y >= 0 && y <= shape.h;
    if (definition.geometry === 'umlActorParticipant' && x >= 0 && x <= shape.w && y >= shape.h * 0.28 && y <= shape.h * 0.42) return true;
    if (definition.geometry === 'umlRole' && x >= 0 && x <= shape.w && y >= shape.h * 0.68 && y <= shape.h) return true;
    const headerHeight = shape.h * 0.22;
    if (x >= 0 && x <= shape.w && y >= 0 && y <= headerHeight) return true;
  }
  if (geometryUsesFill(definition.geometry) && outlines.some(path => path.length >= 3 && pointInsidePolygon(point, path))) return true;
  if (intrinsicFills.some(path => path.length >= 3 && pointInsidePolygon(point, path))) return true;
  const paths = [...outlines, ...decorations], threshold = tolerance + Math.max(0, shape.sw) / 2;
  return paths.some(path => path.slice(1).some((sample, index) => pointToSegmentDistance(point,
    { x: path[index][0], y: path[index][1] }, { x: sample[0], y: sample[1] }) <= threshold));
}

function segmentTouchesDiagram(shape: DiagramShape, from: { x: number; y: number }, to: { x: number; y: number }, radius: number): boolean {
  const definition = getShapeDefinition(shape.shapeId);
  if (!definition) return false;
  const { outlines, decorations, intrinsicFills } = getDiagramPathGroups(shape), strokeRadius = radius + Math.max(0, shape.sw) / 2;
  const filled = geometryUsesFill(definition.geometry) && fillIsVisible(shape.fill);
  for (const path of outlines) if (segmentTouchesPolygon(from, to, path, strokeRadius, filled)) return true;
  for (const path of intrinsicFills) if (segmentTouchesPolygon(from, to, path, strokeRadius, true)) return true;
  for (const path of decorations) {
    for (let index = 1; index < path.length; index++) {
      if (segmentDistance(from, to, { x: path[index - 1][0], y: path[index - 1][1] }, { x: path[index][0], y: path[index][1] }) <= strokeRadius) return true;
    }
  }
  return false;
}

function flattenCommandPaths(commands: readonly PathCommand[], steps = 8): [number, number][][] {
  const paths: [number, number][][] = [];
  let points: [number, number][] = [], current: [number, number] = [0, 0], start: [number, number] = [0, 0];
  const finish = () => { if (points.length) paths.push(points); points = []; };
  for (const item of commands) {
    const [a, b, c, d, e, f, g, h] = item.values;
    if (item.op === 'moveTo') {
      finish(); current = [a, b]; start = current; points.push(current);
    } else if (item.op === 'lineTo') {
      current = [a, b]; points.push(current);
    } else if (item.op === 'quadraticCurveTo') {
      const from = current;
      for (let index = 1; index <= steps; index++) {
        const t = index / steps, u = 1 - t;
        points.push([u * u * from[0] + 2 * u * t * a + t * t * c, u * u * from[1] + 2 * u * t * b + t * t * d]);
      }
      current = [c, d];
    } else if (item.op === 'bezierCurveTo') {
      const from = current;
      for (let index = 1; index <= steps; index++) {
        const t = index / steps, u = 1 - t;
        points.push([u ** 3 * from[0] + 3 * u * u * t * a + 3 * u * t * t * c + t ** 3 * e,
          u ** 3 * from[1] + 3 * u * u * t * b + 3 * u * t * t * d + t ** 3 * f]);
      }
      current = [e, f];
    } else if (item.op === 'ellipse') {
      const cx = a, cy = b, rx = c, ry = d, rotation = e, startAngle = f, endAngle = g, anti = Boolean(h);
      let sweep = endAngle - startAngle;
      if (anti && sweep > 0) sweep -= Math.PI * 2;
      if (!anti && sweep < 0) sweep += Math.PI * 2;
      const count = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI * 2) * steps * 4));
      const cosR = Math.cos(rotation), sinR = Math.sin(rotation);
      for (let index = 1; index <= count; index++) {
        const angle = startAngle + sweep * index / count;
        points.push([cx + rx * Math.cos(angle) * cosR - ry * Math.sin(angle) * sinR,
          cy + rx * Math.cos(angle) * sinR + ry * Math.sin(angle) * cosR]);
      }
      current = points.at(-1) ?? current;
    } else if (item.op === 'closePath') {
      if (points.length && (points.at(-1)![0] !== start[0] || points.at(-1)![1] !== start[1])) points.push(start);
      current = start;
    }
  }
  finish();
  return paths;
}

function flattenFirstPath(commands: readonly PathCommand[], steps = 8): [number, number][] {
  return flattenCommandPaths(commands, steps)[0] ?? [];
}

function pointToSegmentDistance(point: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

function orientation2d(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function lineSegmentsCross(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }, d: { x: number; y: number }): boolean {
  const abC = orientation2d(a, b, c), abD = orientation2d(a, b, d);
  const cdA = orientation2d(c, d, a), cdB = orientation2d(c, d, b);
  return abC * abD < 0 && cdA * cdB < 0;
}

function segmentDistance(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }, d: { x: number; y: number }): number {
  if (lineSegmentsCross(a, b, c, d)) return 0;
  return Math.min(pointToSegmentDistance(a, c, d), pointToSegmentDistance(b, c, d), pointToSegmentDistance(c, a, b), pointToSegmentDistance(d, a, b));
}

function pointInsidePolygon(point: { x: number; y: number }, vertices: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const [xi, yi] = vertices[i], [xj, yj] = vertices[j];
    if ((yi > point.y) !== (yj > point.y) && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function isClosedPath(points: readonly [number, number][]): boolean {
  return points.length >= 4 && Math.hypot(points[0][0] - points.at(-1)![0], points[0][1] - points.at(-1)![1]) <= 1e-6;
}

function shapeStrokeWidth(shape: AnyShape): number {
  return 'sw' in shape && typeof shape.sw === 'number' ? Math.max(0, shape.sw) : 0;
}

function lassoTouchesArea(lasso: [number, number][], region: [number, number][], radius = 0): boolean {
  if (lasso.length < 3 || region.length < 3) return lassoTouchesPolyline(lasso, region, radius);
  if (lasso.some(([x, y]) => pointInsidePolygon({ x, y }, region))
    || region.some(([x, y]) => pointInsidePolygon({ x, y }, lasso))) return true;
  for (let index = 0; index < lasso.length; index++) {
    const a = lasso[index], b = lasso[(index + 1) % lasso.length];
    for (let regionIndex = 0; regionIndex < region.length; regionIndex++) {
      const c = region[regionIndex], d = region[(regionIndex + 1) % region.length];
      if (segmentDistance({ x: a[0], y: a[1] }, { x: b[0], y: b[1] },
        { x: c[0], y: c[1] }, { x: d[0], y: d[1] }) <= radius) return true;
    }
  }
  return false;
}

function lassoTouchesPolyline(lasso: [number, number][], line: [number, number][], radius: number): boolean {
  if (lasso.length < 3 || !line.length) return false;
  if (line.some(([x, y]) => pointInsidePolygon({ x, y }, lasso))) return true;
  const lineSegments: Array<[[number, number], [number, number]]> = line.length === 1
    ? [[line[0], line[0]]]
    : line.slice(1).map((point, index) => [line[index], point]);
  for (const [a, b] of lineSegments) for (let index = 0; index < lasso.length; index++) {
    const c = lasso[index], d = lasso[(index + 1) % lasso.length];
    if (segmentDistance({ x: a[0], y: a[1] }, { x: b[0], y: b[1] },
      { x: c[0], y: c[1] }, { x: d[0], y: d[1] }) <= radius) return true;
  }
  return false;
}

function circlePolygon(center: [number, number], radius: number, segments = 24): [number, number][] {
  return Array.from({ length: segments }, (_, index) => {
    const angle = index * Math.PI * 2 / segments;
    return [center[0] + Math.cos(angle) * radius, center[1] + Math.sin(angle) * radius];
  });
}

function legacyArrowHeadPolygon(arrow: ArrowShape): [number, number][] {
  const angle = Math.atan2(arrow.y2 - arrow.y1, arrow.x2 - arrow.x1), length = 10 + arrow.sw * 3;
  return [[arrow.x2, arrow.y2],
    [arrow.x2 - length * Math.cos(angle - 0.42), arrow.y2 - length * Math.sin(angle - 0.42)],
    [arrow.x2 - length * Math.cos(angle + 0.42), arrow.y2 - length * Math.sin(angle + 0.42)]];
}

function connectorMarkerPaths(marker: EndpointMarker | undefined, point: [number, number], neighbor: [number, number], size: number): [number, number][][] {
  if (!marker || marker === 'none') return [];
  const dx = point[0] - neighbor[0], dy = point[1] - neighbor[1], length = Math.max(1e-6, Math.hypot(dx, dy));
  const ux = dx / length, uy = dy / length, nx = -uy, ny = ux;
  const base = (distance: number, side: number): [number, number] => [point[0] - ux * distance + nx * size * side,
    point[1] - uy * distance + ny * size * side];
  const closed = (points: [number, number][]) => [...points, points[0]];
  const line = (a: [number, number], b: [number, number]) => [a, b];
  const triangle = closed([point, base(size * 1.55, 0.58), base(size * 1.55, -0.58)]);
  const diamond = closed([point, base(size * 0.85, 0.72), base(size * 1.7, 0), base(size * 0.85, -0.72)]);
  if (marker === 'arrow' || marker === 'blockArrow') return [triangle];
  if (marker === 'openArrow') return [line(base(size * 1.55, 0.6), point), line(point, base(size * 1.55, -0.6))];
  if (marker === 'hollowTriangle') return [triangle];
  if (marker === 'diamond' || marker === 'filledDiamond') return [diamond];
  if (marker === 'circle' || marker === 'zeroOrOne') return [circlePolygon([point[0] - ux * size * 0.5, point[1] - uy * size * 0.5], size * 0.25)];
  if (marker === 'bar') return [line([point[0] + nx * size * 0.45, point[1] + ny * size * 0.45],
    [point[0] - nx * size * 0.45, point[1] - ny * size * 0.45])];
  if (marker === 'crowFoot') return [line(point, base(size * 1.6, 0.62)), line(point, base(size * 1.6, 0)), line(point, base(size * 1.6, -0.62))];
  // One/many cardinality endpoint glyphs are compound; a conservative envelope encloses all their strokes.
  return [circlePolygon(point, size * 1.2)];
}

function segmentTouchesPolygon(
  from: { x: number; y: number },
  to: { x: number; y: number },
  vertices: [number, number][],
  radius: number,
  filled: boolean,
): boolean {
  if (vertices.length < 3) return false;
  if (filled && (pointInsidePolygon(from, vertices) || pointInsidePolygon(to, vertices))) return true;
  for (let index = 0; index < vertices.length; index++) {
    const [x1, y1] = vertices[index], [x2, y2] = vertices[(index + 1) % vertices.length];
    if (segmentDistance(from, to, { x: x1, y: y1 }, { x: x2, y: y2 }) <= radius) return true;
  }
  return false;
}

function fillIsVisible(fill: string | undefined): boolean {
  if (!fill || fill === 'transparent' || fill === 'none') return false;
  const rgba = fill.match(/^rgba?\([^)]*,\s*([\d.]+)\s*\)$/i);
  return !rgba || Number(rgba[1]) > 0;
}

function eraserSegmentTouchesShape(
  shape: AnyShape,
  from: { x: number; y: number },
  to: { x: number; y: number },
  radius: number,
): boolean {
  if (shape.type === 'pen') {
    const pen = shape as PenShape;
    const threshold = radius + Math.max(0, pen.size) / 2;
    if (pen.pts.length === 1) return Math.hypot(from.x - pen.pts[0][0], from.y - pen.pts[0][1]) <= threshold;
    for (let index = 1; index < pen.pts.length; index++) {
      const [x1, y1] = pen.pts[index - 1], [x2, y2] = pen.pts[index];
      if (segmentDistance(from, to, { x: x1, y: y1 }, { x: x2, y: y2 }) <= threshold) return true;
    }
    return false;
  }
  if (shape.type === 'line') {
    const line = shape as LineShape;
    return segmentDistance(from, to, { x: line.x1, y: line.y1 }, { x: line.x2, y: line.y2 }) <= radius + line.sw / 2;
  }
  if (shape.type === 'curve') {
    const curve = shape as CurveShape;
    const threshold = radius + curve.sw / 2;
    if (curve.pts.length === 1) return segmentDistance(from, to,
      { x: curve.pts[0][0], y: curve.pts[0][1] }, { x: curve.pts[0][0], y: curve.pts[0][1] }) <= threshold;
    for (let index = 1; index < curve.pts.length; index++) {
      const previous = curve.pts[index - 1], current = curve.pts[index];
      if (segmentDistance(from, to, { x: previous[0], y: previous[1] }, { x: current[0], y: current[1] }) <= threshold) return true;
    }
    return false;
  }
  if (shape.type === 'connector') {
    const connector = shape as ConnectorShape, route = getConnectorRoute(connector), threshold = radius + connector.sw / 2;
    if (route.slice(1).some((point, index) => segmentDistance(from, to,
      { x: route[index][0], y: route[index][1] }, { x: point[0], y: point[1] }) <= threshold)) return true;
    if (connector.label?.trim()) {
      const middle = route[Math.floor(route.length / 2)] ?? [connector.x1, connector.y1];
      const labelWidth = Math.min(280, connector.label.trim().slice(0, 512).length * 8.4) + 8;
      const labelHeight = 18;
      const plate: [number, number][] = [[middle[0] - labelWidth / 2, middle[1] - labelHeight / 2],
        [middle[0] + labelWidth / 2, middle[1] - labelHeight / 2],
        [middle[0] + labelWidth / 2, middle[1] + labelHeight / 2],
        [middle[0] - labelWidth / 2, middle[1] + labelHeight / 2]];
      return segmentTouchesPolygon(from, to, plate, radius, true);
    }
    return false;
  }
  if (shape.type === 'arrow') {
    const arrow = shape as ArrowShape;
    const width = radius + arrow.sw / 2;
    if (segmentDistance(from, to, { x: arrow.x1, y: arrow.y1 }, { x: arrow.x2, y: arrow.y2 }) <= width) return true;
    const angle = Math.atan2(arrow.y2 - arrow.y1, arrow.x2 - arrow.x1), headLength = 10 + arrow.sw * 3;
    const head: [number, number][] = [
      [arrow.x2, arrow.y2],
      [arrow.x2 - headLength * Math.cos(angle - 0.42), arrow.y2 - headLength * Math.sin(angle - 0.42)],
      [arrow.x2 - headLength * Math.cos(angle + 0.42), arrow.y2 - headLength * Math.sin(angle + 0.42)],
    ];
    return segmentTouchesPolygon(from, to, head, radius, true);
  }
  if (shape.type === 'diagram') return segmentTouchesDiagram(shape as DiagramShape, from, to, radius);
  if (isBoxShapeTool(shape.type)) {
    const vertices = getShapeVertices(shape);
    const fill = 'fill' in shape ? shape.fill : undefined;
    const strokeWidth = 'sw' in shape ? shape.sw : 0;
    return segmentTouchesPolygon(from, to, vertices, radius + strokeWidth / 2, fillIsVisible(fill));
  }
  if ('x' in shape && 'w' in shape && 'h' in shape) {
    const box = shape as BoxShape;
    const vertices: [number, number][] = [
      [box.x, box.y], [box.x + box.w, box.y], [box.x + box.w, box.y + box.h], [box.x, box.y + box.h],
    ];
    // Text-like, sticky, image, and formula objects use their existing rectangular hit area.
    return segmentTouchesPolygon(from, to, vertices, radius, true);
  }
  return false;
}

function normalizeDragBox(
  origin: { x: number; y: number },
  pointer: { x: number; y: number },
  resizePolicy: ShapeResizePolicy = { mode: 'free' },
) {
  let x = Math.min(origin.x, pointer.x), y = Math.min(origin.y, pointer.y);
  let w = Math.abs(pointer.x - origin.x), h = Math.abs(pointer.y - origin.y);
  if (resizePolicy.mode === 'aspect') {
    const ratio = resizePolicy.aspectRatio;
    const width = Math.max(w, h * ratio, Math.max(1, ratio));
    h = width / ratio;
    x = pointer.x < origin.x ? origin.x - width : origin.x;
    y = pointer.y < origin.y ? origin.y - h : origin.y;
    w = width;
  }
  return { x, y, w, h };
}

function uid() { return Date.now().toString(36)+Math.random().toString(36).slice(2,6); }

function nr(x:number,y:number,w:number,h:number):[number,number,number,number]{
  return [w<0?x+w:x, h<0?y+h:y, Math.abs(w), Math.abs(h)];
}

function getXY(s: AnyShape): {x:number,y:number} {
  if ('x' in s) return {x:(s as any).x, y:(s as any).y};
  if (s.type==='line' || s.type==='arrow' || s.type==='connector') return {x:(s as LineShape | ArrowShape | ConnectorShape).x1, y:(s as LineShape | ArrowShape | ConnectorShape).y1};
  return {x:s.minX, y:s.minY};
}

function moveShape(s: AnyShape, nx: number, ny: number): AnyShape {
  if (s.type==='pen') {
    const p=s as PenShape; const dx=nx-p.minX, dy=ny-p.minY;
    return {...p, pts:p.pts.map(q=>[q[0]+dx,q[1]+dy,q[2]]), minX:nx, minY:ny, maxX:p.maxX+dx, maxY:p.maxY+dy};
  }
  if (s.type==='line') {
    const line=s as LineShape; const dx=nx-line.x1, dy=ny-line.y1;
    return {...line, x1:nx, y1:ny, x2:line.x2+dx, y2:line.y2+dy,
      minX:Math.min(nx,line.x2+dx), minY:Math.min(ny,line.y2+dy),
      maxX:Math.max(nx,line.x2+dx), maxY:Math.max(ny,line.y2+dy)};
  }
  if (s.type==='curve') {
    const curve=s as CurveShape; const dx=nx-curve.minX, dy=ny-curve.minY;
    return {...curve, pts:curve.pts.map(point=>[point[0]+dx,point[1]+dy,point[2]]),
      minX:nx, minY:ny, maxX:curve.maxX+dx, maxY:curve.maxY+dy};
  }
  if (s.type==='arrow') {
    const a=s as ArrowShape; const dx=nx-a.x1, dy=ny-a.y1;
    return {...a, x1:nx,y1:ny,x2:a.x2+dx,y2:a.y2+dy, minX:Math.min(nx,a.x2+dx),minY:Math.min(ny,a.y2+dy),maxX:Math.max(nx,a.x2+dx),maxY:Math.max(ny,a.y2+dy)};
  }
  if (s.type==='connector') {
    const connector=s as ConnectorShape; const dx=nx-connector.x1, dy=ny-connector.y1;
    const next={...connector,x1:nx,y1:ny,x2:connector.x2+dx,y2:connector.y2+dy,
      waypoints:connector.waypoints.map(([x,y])=>[x+dx,y+dy] as [number,number]), sourceRef:undefined,targetRef:undefined};
    return {...next,...connectorBounds(next)};
  }
  if ('x' in s) { const b=s as any; return withComputedShapeBounds({...b, x:nx, y:ny}); }
  return s;
}


