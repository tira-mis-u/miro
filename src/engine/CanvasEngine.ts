import { getStroke } from 'perfect-freehand';
import * as Y from 'yjs';
import RBush from 'rbush';
import { parseTelex } from '../formula/parser';
import { renderFormulaStatic } from '../formula/renderer';
import { CODE_LANGUAGES, DEFAULT_CODE_LANGUAGE, normalizeCodeLanguage, type CodeLanguage } from '../code/languages';
import { CanvasCodePreviewCache } from '../code/canvasHighlight';
import { initialCodeBlockHeight } from '../code/layout';
import { recognizeSmartDrawing } from './smartDrawing';

export type ToolType =
  | 'select' | 'lasso-select' | 'pen' | 'eraser'
  | 'rect' | 'rounded-rect' | 'ellipse' | 'triangle' | 'diamond' | 'star' | 'callout'
  | 'pentagon' | 'hexagon' | 'parallelogram' | 'trapezoid' | 'right-triangle'
  | 'arrow' | 'sticky' | 'text' | 'math' | 'code' | 'image';

export type BoxShapeTool = 'rect' | 'rounded-rect' | 'ellipse' | 'triangle' | 'diamond' | 'star' | 'callout'
  | 'pentagon' | 'hexagon' | 'parallelogram' | 'trapezoid' | 'right-triangle';

export interface Camera { x: number; y: number; zoom: number; }

interface BaseShape { id:string; type:string; minX:number; minY:number; maxX:number; maxY:number; }
interface BoxShape  extends BaseShape { x:number; y:number; w:number; h:number; vertices?: [number, number][]; }

export interface PenShape     extends BaseShape { type:'pen';      pts:number[][]; color:string; size:number; }
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
export type AnyShape = PenShape|LineShape|CurveShape|RectShape|EllipseShape|TriShape|DiamShape|StarShape|CalloutShape|PolygonShape|ArrowShape|StickyShape|TextShape|ImageShape;

export interface StyleOptions {
  penColor:string; penSize:number;
  fill:string; stroke:string; sw:number;
  stickyBg:string; fontSize:number;
}

// ── cursor types for each resize handle ──────────────────────────────────────
const HANDLE_CURSORS: Record<string,string> = {
  nw:'nw-resize', ne:'ne-resize', sw:'sw-resize', se:'se-resize',
  n:'n-resize',   s:'s-resize',   e:'e-resize',   w:'w-resize',
};
const ERASER_RADIUS_PX = 11;
const MAX_PEN_STROKE_WIDTH = 50;
const SMART_DRAW_CONFIDENCE = 0.56;

export class CanvasEngine {
  private cv: HTMLCanvasElement;
  private cx: CanvasRenderingContext2D;
  private yMap: Y.Map<any>;
  private shapes: Map<string,AnyShape> = new Map();
  private rtree = new RBush<any>();

  public  cam: Camera = { x:0, y:0, zoom:1 };
  public  tool: ToolType = 'pen';
  public  penMode: 'normal' | 'smart' = 'normal';
  public  style: StyleOptions = {
    penColor:'#1e293b', penSize:6,
    fill:'#bfdbfe', stroke:'#1e40af', sw:2,
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
  public onEditText?: (s: StickyShape | TextShape, cx: number, cy: number) => void;
  public onCursor?:   (cursor:string) => void;
  public onTool?:     (tool:ToolType) => void;

  private hist: string[] = [];
  private hi = -1;

  private readonly onYMapChange = (event: Y.YMapEvent<AnyShape>) => {
    if (event.transaction.origin === this) return;
    let redraw = false;
    event.changes.keys.forEach((change, key) => {
      const old = this.shapes.get(key);
      if (old) this.rtree.remove(old);
      if (change.action === 'delete') {
        if (old?.type === 'code') this.codePreviewCache.forget(key);
        this.shapes.delete(key);
      } else {
        const shape = this.yMap.get(key);
        if (!shape) return;
        if (old?.type === 'code' && shape.type !== 'code') this.codePreviewCache.forget(key);
        this.shapes.set(key, shape);
        this.rtree.insert(shape);
      }
      if (key !== this.editingId) redraw = true;
    });
    if (redraw) this.dirty = true;
  };

  constructor(cv: HTMLCanvasElement, yMap: Y.Map<any>) {
    this.cv   = cv;
    this.cx   = cv.getContext('2d', {alpha:false})!;
    this.yMap = yMap;

    this.yMap.forEach((v:AnyShape) => { this.shapes.set(v.id, v); this.rtree.insert(v); });
    
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
  // clientX/Y → world coords  (accounts for canvas position on page)
  clientToWorld(cx: number, cy: number) {
    const r = this.cv.getBoundingClientRect();
    // canvas pixel position relative to canvas element
    const px = (cx - r.left) * (this.cv.width  / r.width);
    const py = (cy - r.top)  * (this.cv.height / r.height);
    // pixel → world
    return {
      x: (px - this.cv.width  / 2) / this.cam.zoom + this.cam.x,
      y: (py - this.cv.height / 2) / this.cam.zoom + this.cam.y,
    };
  }

  // world → canvas pixel (for drawing overlays from React)
  worldToClient(wx: number, wy: number) {
    const r    = this.cv.getBoundingClientRect();
    const scaleX = r.width  / this.cv.width;
    const scaleY = r.height / this.cv.height;
    const px = (wx - this.cam.x) * this.cam.zoom + this.cv.width  / 2;
    const py = (wy - this.cam.y) * this.cam.zoom + this.cv.height / 2;
    return { x: r.left + px * scaleX, y: r.top + py * scaleY };
  }

  // ─── pointer events (called with raw DOM events from window listener) ───
  pointerDown(e: PointerEvent) {
    if (e.target && (e.target as HTMLElement).closest('.formula-editor-panel, .popover, .math-tools-panel, .no-canvas, .zoom-controls, .panel-ui, .toolbar, .code-editor-shell')) return;
    if (e.button === 2 || e.button === 1) {
      e.preventDefault();
      this.isPanning = true;
      this.panButton = e.button;
      this.panRef = { sx: e.clientX, sy: e.clientY, cx: this.cam.x, cy: this.cam.y };
      this.onCursor?.('grabbing');
      return;
    }
    if (e.button !== 0) return;

    const w = this.clientToWorld(e.clientX, e.clientY);

    if (this.tool === 'eraser') {
      this.isDown = true;
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
      this.resizeH    = rh.h;
      const s = this.shapes.get(rh.id)!;
      this.resizeRef  = { wx:w.x, wy:w.y, s:JSON.parse(JSON.stringify(s)) };
      this.onCursor?.(HANDLE_CURSORS[rh.h] ?? 'nwse-resize');
      return;
    }

    // --- 1. HIT TEST for existing objects ---
    let hit: AnyShape | null = null;

    const rawHit = this.hitShape(w.x, w.y);
    if (rawHit) {
      if (this.tool === 'select' || this.tool === 'lasso-select') {
        hit = rawHit;
      } else if (['text', 'math', 'code'].includes(this.tool)) {
        if (['text', 'math', 'code'].includes(rawHit.type)) hit = rawHit;
      } else if (this.tool === 'sticky') {
        if (rawHit.type === 'sticky') hit = rawHit;
      } else if (isBoxShapeTool(this.tool) || this.tool === 'arrow') {
        if (isBoxShapeTool(rawHit.type) || rawHit.type === 'arrow') hit = rawHit;
      } else if (this.tool === 'image') {
        if (rawHit.type === 'image') hit = rawHit;
      }
    }

    if (hit) {
      if (!e.shiftKey && !this.sel.has(hit.id)) { this.sel.clear(); }
      this.sel.add(hit.id);
      this.onSel?.([...this.sel]);
      this.isDragging = true;
      this.dragRef = {wx:w.x, wy:w.y};
      this.dragOrigins.clear();
      this.sel.forEach(id => {
        const s = this.shapes.get(id);
        if (s) this.dragOrigins.set(id, getXY(s));
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
    if (this.tool === 'select' || this.tool === 'lasso-select') {
      // (Resize handle check was handled at the start of original pointerDown but let's re-verify)
      // Actually, resize handles should be checked FIRST before hitShape.
      // I'll put it back before hitShape in the final edit.
      if (this.tool === 'lasso-select') {
        this.isLassoing = true;
        this.lassoPts = [w];
      } else {
        this.isBoxing = true;
        this.boxA = w; this.boxB = w;
      }
      this.onCursor?.('default');
      this.dirty = true;
      return;
    }

    // ── PEN ──
    if (this.tool === 'pen') {
      this.isDown  = true;
      this.currId  = uid();
      this.activeSmartDrawing = this.penMode === 'smart';
      const s: PenShape = {
        id:this.currId, type:'pen',
        pts:[[w.x, w.y, e.pressure||0.5]],
        color:this.style.penColor, size:this.style.penSize,
        minX:w.x, minY:w.y, maxX:w.x, maxY:w.y,
      };
      this.put(s);
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

    // ── SHAPES + ARROW ──
    if (isBoxShapeTool(this.tool) || this.tool === 'arrow') {
      this.isDown = true;
      this.currId = uid();
      this.shapeOrigin = {x:w.x, y:w.y};
      if (this.tool === 'arrow') {
        this.put({ id:this.currId, type:'arrow', x1:w.x, y1:w.y, x2:w.x, y2:w.y,
          color:this.style.stroke, sw:this.style.sw,
          minX:w.x, minY:w.y, maxX:w.x, maxY:w.y } as ArrowShape);
      } else {
        this.put({ id:this.currId, type:this.tool,
          x:w.x, y:w.y, w:0, h:0,
          fill:this.style.fill, stroke:this.style.stroke, sw:this.style.sw,
          minX:w.x, minY:w.y, maxX:w.x, maxY:w.y } as any);
      }
    }
  }

  private appendPenSample(sample: PointerEvent) {
    const shape = this.currId ? this.shapes.get(this.currId) : undefined;
    if (!shape || shape.type !== 'pen') return;
    const w = this.clientToWorld(sample.clientX, sample.clientY);
    const pressure = sample.pressure || 0.5;
    const stroke = shape as PenShape;
    this.put({
      ...stroke,
      pts: [...stroke.pts, [w.x, w.y, pressure]],
      minX: Math.min(stroke.minX, w.x), maxX: Math.max(stroke.maxX, w.x),
      minY: Math.min(stroke.minY, w.y), maxY: Math.max(stroke.maxY, w.y),
    });
  }

  pointerMove(e: PointerEvent) {
    const w = this.clientToWorld(e.clientX, e.clientY);

    // ── panning ──
    if (this.isPanning) {
      const dsx = e.clientX - this.panRef.sx;
      const dsy = e.clientY - this.panRef.sy;
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
      this.sel.forEach(id => {
        const orig = this.dragOrigins.get(id);
        const s    = this.shapes.get(id);
        if (!orig || !s) return;
        this.put(moveShape(s, orig.x+dx, orig.y+dy));
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

    // Contextual cursor feedback while hovering on a selectable object or handle.
    if (!this.isDown && !this.isDragging && !this.isResizing && !this.isPanning) {
      if (this.tool === 'select') {
        const handle = this.hitResizeHandle(e.clientX, e.clientY);
        if (handle) this.onCursor?.(HANDLE_CURSORS[handle.h] ?? 'nwse-resize');
        else this.onCursor?.(this.hitShape(w.x, w.y) ? 'move' : 'default');
      } else if (this.tool === 'lasso-select') {
        this.onCursor?.('crosshair');
      }
    }

    // ── drawing / eraser tracking ──
    if (!this.isDown) return;
    const s = this.currId ? this.shapes.get(this.currId) : undefined;
    if (!s) return;

    // ── pen stroke ──
    if (s.type === 'pen') {
      const coalesced = this.activeSmartDrawing && typeof e.getCoalescedEvents === 'function'
        ? e.getCoalescedEvents()
        : [];
      if (coalesced.length > 0) coalesced.forEach(sample => this.appendPenSample(sample));
      else this.appendPenSample(e);
      return;
    }

    // ── arrow ──
    if (s.type === 'arrow') {
      const a = s as ArrowShape;
      this.put({ ...a, x2:w.x, y2:w.y,
        minX:Math.min(a.x1,w.x), minY:Math.min(a.y1,w.y),
        maxX:Math.max(a.x1,w.x), maxY:Math.max(a.y1,w.y) });
      return;
    }

    // ── box shapes ──
    if ('w' in s) {
      const ox = this.shapeOrigin.x, oy = this.shapeOrigin.y;
      const nx = Math.min(ox,w.x), ny = Math.min(oy,w.y);
      const nw = Math.abs(w.x-ox),  nh = Math.abs(w.y-oy);
      this.put({ ...(s as any), x:nx, y:ny, w:nw, h:nh,
        minX:nx, minY:ny, maxX:nx+nw, maxY:ny+nh });
    }
  }

  pointerUp(eventOrButton?: number | PointerEvent) {
    const event = typeof eventOrButton === 'number' ? undefined : eventOrButton;
    const button = typeof eventOrButton === 'number' ? eventOrButton : eventOrButton?.button;
    if (this.isPanning) {
      if (button !== undefined && this.panButton !== null && button !== this.panButton) return;
      this.isPanning = false;
      this.panButton = null;
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
      this.onCursor?.('move');
      this.saveH();
      return;
    }
    if (this.isResizing) {
      this.isResizing = false;
      this.resizeH    = '';
      this.resizeRef  = null;
      this.onCursor?.('default');
      this.saveH();
      return;
    }
    if (this.isBoxing) {
      this.isBoxing = false;
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
      // Poly bounding box
      if (this.lassoPts.length > 2) {
        const minX = Math.min(...this.lassoPts.map(p=>p.x)), maxX = Math.max(...this.lassoPts.map(p=>p.x));
        const minY = Math.min(...this.lassoPts.map(p=>p.y)), maxY = Math.max(...this.lassoPts.map(p=>p.y));
        
        const cands = this.rtree.search({minX, minY, maxX, maxY});
        cands.forEach(s => {
          const cx = s.minX + (s.maxX - s.minX) / 2;
          const cy = s.minY + (s.maxY - s.minY) / 2;
          // Basic Point In Polygon for shape centers
          let inside = false;
          for (let i = 0, j = this.lassoPts.length - 1; i < this.lassoPts.length; j = i++) {
            const xi = this.lassoPts[i].x, yi = this.lassoPts[i].y;
            const xj = this.lassoPts[j].x, yj = this.lassoPts[j].y;
            if (((yi > cy) != (yj > cy)) && (cx < (xj - xi) * (cy - yi) / (yj - yi) + xi)) inside = !inside;
          }
          if (inside) this.sel.add(s.id);
        });
        this.onSel?.([...this.sel]);
      }
      this.lassoPts = [];
      this.dirty = true;
      return;
    }

    if (this.isDown && event && event.button === 0 && this.activeSmartDrawing && this.currId) {
      this.appendPenSample(event);
    }

    if (this.isDown) {
      this.isDown = false;
      if (this.currId) {
        let s = this.shapes.get(this.currId);
        if (s?.type === 'pen' && this.activeSmartDrawing) {
          this.finalizeSmartStroke(s as PenShape);
          s = this.shapes.get(this.currId);
        }
        // give minimum size if just clicked
        if (s && 'w' in s && (s as any).w < 5 && (s as any).h < 5) {
          const b = s as any;
          this.put({ ...b, w:120, h:80, maxX:b.x+120, maxY:b.y+80 });
        } else if (s?.type === 'arrow') {
          const a = s as ArrowShape;
          if (Math.abs(a.x2-a.x1)<5 && Math.abs(a.y2-a.y1)<5)
            this.put({ ...a, x2:a.x1+120, maxX:a.x1+120 });
        }
        
        // SELECT the new shape
        if (this.currId && this.tool !== 'pen') {
          this.sel.clear();
          this.sel.add(this.currId);
          this.onSel?.([...this.sel]);
          this.dirty = true;
        } else if (this.tool === 'pen') {
          this.sel.clear(); this.onSel?.([]);
          this.dirty = true;
        }
        
        this.currId = null;
        this.activeSmartDrawing = false;
        this.saveH();
        this.mark();
      }
    }
  }

  doubleClick(e: MouseEvent) {
    const w = this.clientToWorld(e.clientX, e.clientY);
    const hit = this.hitShape(w.x, w.y);
    if (hit && (hit.type==='sticky'||hit.type==='text'||hit.type==='math'||hit.type==='code')) {
      this.onEditText?.(hit as StickyShape|TextShape, e.clientX, e.clientY);
    }
  }

  public updateSize(id: string, w: number, h: number) {
    const shape = this.shapes.get(id);
    if (!shape || !('w' in shape) || (shape.w === w && shape.h === h)) return;
    const resized = { ...shape, w, h } as any;
    resized.maxX = resized.x + w;
    resized.maxY = resized.y + h;
    this.put(resized, { redraw: id !== this.editingId });
  }

  public updatePos(id: string, x: number, y: number) {
    const s = this.shapes.get(id);
    if (s && 'x' in s) {
      // For box shapes (sticky, text, math, code, rect, etc.)
      const b = s as any;
      const news = { ...b, x, y };
      news.minX = x;
      news.minY = y;
      news.maxX = x + b.w;
      news.maxY = y + b.h;
      this.put(news as AnyShape);
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
  private transactMap(work: () => void) {
    const document = this.yMap.doc;
    if (document) document.transact(work, this);
    else work();
  }

  private put(s: AnyShape, options: { redraw?: boolean; notify?: boolean } = {}) {
    const old = this.shapes.get(s.id);
    if (old) this.rtree.remove(old);
    this.shapes.set(s.id, s);
    this.rtree.insert(s);
    this.transactMap(() => this.yMap.set(s.id, s));
    if (options.redraw !== false) this.dirty = true;
    if (options.notify !== false) this.onShapeUpdate?.(s);
  }

  private deleteShapes(ids: string[]): string[] {
    const removed = ids.flatMap(id => {
      const shape = this.shapes.get(id);
      return shape ? [{ id, shape }] : [];
    });
    if (!removed.length) return [];
    this.transactMap(() => removed.forEach(({ id }) => this.yMap.delete(id)));
    removed.forEach(({ id, shape }) => {
      this.rtree.remove(shape);
      if (shape.type === 'code') this.codePreviewCache.forget(id);
      this.shapes.delete(id);
    });
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
    this.eraserLastPoint = null;
    if (!preserveCursor) this.eraserCursorPoint = null;
    if (this.eraseChanged) this.saveH();
    this.eraseChanged = false;
    this.dirty = true;
  }

  private finalizeSmartStroke(stroke: PenShape) {
    const result = recognizeSmartDrawing(stroke.pts, stroke.size);
    if (result.confidence < SMART_DRAW_CONFIDENCE) return;
    if (result.kind === 'line') {
      if (result.points.length < 2) return;
      const [first, last] = result.points;
      if (Math.hypot(last[0] - first[0], last[1] - first[1]) < 5) return;
      this.put({
        id: stroke.id, type: 'line',
        x1: first[0], y1: first[1], x2: last[0], y2: last[1],
        color: stroke.color, sw: stroke.size,
        minX: Math.min(first[0], last[0]), minY: Math.min(first[1], last[1]),
        maxX: Math.max(first[0], last[0]), maxY: Math.max(first[1], last[1]),
      } as LineShape);
      return;
    }
    if (result.kind === 'curve') {
      const points = result.points.map(point => [point[0], point[1], point[2] ?? 0.5]);
      if (points.length < 4) return;
      const xs = points.map(point => point[0]), ys = points.map(point => point[1]);
      const minX = Math.min(...xs), minY = Math.min(...ys), maxX = Math.max(...xs), maxY = Math.max(...ys);
      if (maxX - minX < 5 || maxY - minY < 5) return;
      this.put({
        id: stroke.id, type: 'curve', pts: points, color: stroke.color, sw: stroke.size,
        minX, minY, maxX, maxY,
      } as CurveShape);
      return;
    }
    if (result.kind !== 'rectangle' && result.kind !== 'ellipse' && result.kind !== 'triangle') return;
    const bounds = result.bounds;
    if (!bounds || bounds.w < 5 || bounds.h < 5) return;
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
  }

  private hitShape(wx: number, wy: number): AnyShape|null {
    const P = 8/this.cam.zoom;
    const hits = this.rtree.search({minX:wx-P, minY:wy-P, maxX:wx+P, maxY:wy+P}) as AnyShape[];
    const point = { x: wx, y: wy };
    const preciseHits = hits.filter(shape => {
      if (shape.type === 'line') {
        const line = shape as LineShape;
        return pointToSegmentDistance(point, { x: line.x1, y: line.y1 }, { x: line.x2, y: line.y2 }) <= P + line.sw / 2;
      }
      if (shape.type === 'curve') {
        const curve = shape as CurveShape;
        return curve.pts.length === 1
          ? Math.hypot(wx - curve.pts[0][0], wy - curve.pts[0][1]) <= P + curve.sw / 2
          : curve.pts.slice(1).some((sample, index) => pointToSegmentDistance(point,
            { x: curve.pts[index][0], y: curve.pts[index][1] }, { x: sample[0], y: sample[1] }) <= P + curve.sw / 2);
      }
      return true;
    });
    return preciseHits[preciseHits.length-1] ?? null;
  }

  // 8-handle resize detection (corners + edges)
  private hitResizeHandle(cx: number, cy: number): {id:string;h:string}|null {
    const R = 8; // screen pixels
    for (const [, s] of this.shapes) {
      if (!this.sel.has(s.id) || !('x' in s && 'w' in s)) continue;
      const b = s as any;
      const handles: [string, number, number][] = [
        ['nw', b.x,       b.y      ],
        ['n',  b.x+b.w/2, b.y      ],
        ['ne', b.x+b.w,   b.y      ],
        ['e',  b.x+b.w,   b.y+b.h/2],
        ['se', b.x+b.w,   b.y+b.h  ],
        ['s',  b.x+b.w/2, b.y+b.h  ],
        ['sw', b.x,       b.y+b.h  ],
        ['w',  b.x,       b.y+b.h/2],
      ];
      for (const [h, wx, wy] of handles) {
        const sp = this.worldToClient(wx, wy);
        if (Math.abs(cx-sp.x)<R && Math.abs(cy-sp.y)<R) return {id:s.id, h};
      }
    }
    return null;
  }

  private doResize(wx: number, wy: number) {
    if (!this.resizeRef) return;
    const o  = this.resizeRef.s as any;
    const dx = wx - this.resizeRef.wx;
    const dy = wy - this.resizeRef.wy;
    let {x,y,w,h} = o;
    const MIN_WIDTH = o.type === 'sticky' ? 120 : 20;
    const MIN_HEIGHT = o.type === 'sticky' ? 120 : o.type === 'code' ? initialCodeBlockHeight(o.fs) : 20;
    
    switch (this.resizeH) {
      case 'se': w = Math.max(MIN_WIDTH, o.w + dx); h = Math.max(MIN_HEIGHT, o.h + dy); break;
      case 'sw': w = Math.max(MIN_WIDTH, o.w - dx); x = o.x + o.w - w; h = Math.max(MIN_HEIGHT, o.h + dy); break;
      case 'ne': w = Math.max(MIN_WIDTH, o.w + dx); h = Math.max(MIN_HEIGHT, o.h - dy); y = o.y + o.h - h; break;
      case 'nw': w = Math.max(MIN_WIDTH, o.w - dx); x = o.x + o.w - w; h = Math.max(MIN_HEIGHT, o.h - dy); y = o.y + o.h - h; break;
      case 'e':  w = Math.max(MIN_WIDTH, o.w + dx); break;
      case 'w':  w = Math.max(MIN_WIDTH, o.w - dx); x = o.x + o.w - w; break;
      case 's':  h = Math.max(MIN_HEIGHT, o.h + dy); break;
      case 'n':  h = Math.max(MIN_HEIGHT, o.h - dy); y = o.y + o.h - h; break;
    }
    const resizedHeight = ['nw', 'ne', 'sw', 'se', 'n', 's'].includes(this.resizeH);
    const resizedShape = { ...o, x, y, w, h, minX:x, minY:y, maxX:x+w, maxY:y+h };
    if (o.type === 'code' && resizedHeight) resizedShape.autoHeight = false;
    this.put(resizedShape);
  }

  // ─── zoom ────────────────────────────────────────────────────────────────
  zoomAt(clientX: number, clientY: number, factor: number) {
    const r   = this.cv.getBoundingClientRect();
    const px  = (clientX - r.left) * (this.cv.width  / r.width);
    const py  = (clientY - r.top)  * (this.cv.height / r.height);
    const nz  = Math.max(0.04, Math.min(16, this.cam.zoom * factor));
    const wx  = (px - this.cv.width /2) / this.cam.zoom + this.cam.x;
    const wy  = (py - this.cv.height/2) / this.cam.zoom + this.cam.y;
    const nx  = wx - (px - this.cv.width /2) / nz;
    const ny  = wy - (py - this.cv.height/2) / nz;
    this.setCamera(nx, ny, nz);
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

  /** End any transient pointer gesture safely on pointercancel, lost focus, or tool switch. */
  cancelPointer() {
    if (this.isErasing) this.finishErasing();
    if (this.isPanning) { this.isPanning = false; this.panButton = null; }
    if (this.currId) {
      // A cancelled/lost-focus gesture is not a completed Smart Drawing gesture.
      // Keep its exact sampled pen path rather than applying any classifier cleanup.
      this.currId = null;
      this.activeSmartDrawing = false;
      this.isDown = false;
      this.saveH();
    }
    if (this.isDragging || this.isResizing) this.saveH();
    this.isDown = false;
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
    const newIds: string[] = [];
    this.sel.forEach(id => {
      const s = this.shapes.get(id); if (!s) return;
      const nid = uid();
      const c: any = {...JSON.parse(JSON.stringify(s)), id:nid};
      const off = 24;
      if (c.x  !== undefined) { c.x+=off;  c.y+=off;  }
      if (c.x1 !== undefined) { c.x1+=off; c.y1+=off; c.x2+=off; c.y2+=off; }
      if (c.type === 'curve' && Array.isArray(c.pts)) c.pts = c.pts.map((point: number[]) => [point[0] + off, point[1] + off, point[2]]);
      c.minX+=off; c.minY+=off; c.maxX+=off; c.maxY+=off;
      this.put(c); newIds.push(nid);
    });
    this.sel.clear();
    newIds.forEach(id => this.sel.add(id));
    this.onSel?.([...this.sel]);
    this.saveH();
  }

  updateText(id: string, text: string) {
    const s = this.shapes.get(id);
    if (s && 'text' in (s as any)) { 
      this.put({...s, text} as any); 
      this.saveH(); 
    }
  }

  updateTextLive(id: string, text: string) {
    const s = this.shapes.get(id);
    if (s && 'text' in (s as any)) this.put({ ...s, text } as any);
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
    this.saveH();
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
      const s = this.shapes.get(id); 
      if (!s) return;
      let next = { ...s, ...props };
      // 🚨 CRITICAL: Update RBush indices if x/y/w/h changed
      if ('x' in next && 'y' in next) {
        const b = next as any;
        next = { ...next, minX: b.x, minY: b.y, maxX: b.x + (b.w||0), maxY: b.y + (b.h||0) };
      }
      this.put(next as AnyShape); 
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

  private applyHistorySnapshot(entries: [string, AnyShape][]) {
    const desired = new Map(entries);
    this.transactMap(() => {
      for (const id of this.yMap.keys()) if (!desired.has(id)) this.yMap.delete(id);
      for (const [id, shape] of entries) this.yMap.set(id, shape);
    });

    this.shapes.clear();
    this.rtree.clear();
    this.codePreviewCache.clear();
    entries.forEach(([id, shape]) => {
      this.shapes.set(id, shape);
      this.rtree.insert(shape);
    });
    for (const id of this.sel) if (!desired.has(id)) this.sel.delete(id);
    this.onSel?.([...this.sel]);
    this.dirty = true;
  }

  undo() {
    if (this.hi <= 0) return;
    this.hi--;
    this.applyHistorySnapshot(JSON.parse(this.hist[this.hi]) as [string, AnyShape][]);
  }

  redo() {
    if (this.hi >= this.hist.length - 1) return;
    this.hi++;
    this.applyHistorySnapshot(JSON.parse(this.hist[this.hi]) as [string, AnyShape][]);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    if (this.overlayAttachTimer !== null) clearTimeout(this.overlayAttachTimer);
    this.overlayAttachTimer = null;
    this.yMap.unobserve(this.onYMapChange);
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
      stateSignature += `${s.id}:${(s as any).text ?? ''}:${(s as any).previewText ?? ''}:${(s as any).language||''}:${(s as any).w}:${(s as any).h}:${(s as any).x}:${(s as any).y}:${s.type==='image'?(s as any).src:''}:sel${this.sel.has(s.id)}|`;
    });
    stateSignature += `editing:${this.editingId}`;

    if (this.lastOverlayState !== stateSignature) {
      this.lastOverlayState = stateSignature;
      domShapes.forEach(s => {
      if (s.id !== this.editingId) {
        let content = '';
        if (s.type === 'image') {
          overlayHtml += `<div id="ol_${s.id}" style="position:absolute; left:${s.x}px; top:${s.y}px; width:${s.w}px; height:${s.h}px; pointer-events:auto;"><img src="${(s as any).src}" style="width:100%; height:100%; display:block; pointer-events:none;" /></div>`;
        } else if (s.type === 'sticky') {
          content = ((s as any).text||'').replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
          overlayHtml += `<div id="ol_${s.id}" class="board-sticky-overlay" style="position:absolute; left:${s.x}px; top:${s.y}px; width:${s.w}px; height:${s.h}px; font-size:${((s as any).fs||14)}px; font-family:'Inter',system-ui,sans-serif; color:rgba(15,15,15,0.8); padding:16px; box-sizing:border-box; overflow-y:auto; overflow-x:hidden; white-space:pre-wrap; word-break:break-word; border-radius:3px; background:${(s as any).bg}; box-shadow:0 4px 16px rgba(0,0,0,0.1); pointer-events:auto;"><div style="position:absolute; top:0; right:0; width:14px; height:14px; background:rgba(0,0,0,0.08); clip-path:polygon(100% 0, 0 0, 100% 100%);"></div>${content}</div>`;
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
          overlayHtml += `<div id="ol_${s.id}" class="board-math-preview" aria-label="Rendered mathematical formula${stalePreview ? '; showing the last valid preview while the draft is invalid' : ''}" style="position:absolute; left:${s.x}px; top:${s.y}px; width:${boxWidth}px; height:${boxHeight}px; font-size:${(s.fs||14)}px; color:#000; padding:16px; box-sizing:border-box; overflow:visible; background:transparent; border-radius:4px; pointer-events:auto;">${content}${status}</div>`;
        } else if (s.type === 'code') {
          const language = normalizeCodeLanguage((s as any).language);
          const languageLabel = CODE_LANGUAGES.find(option => option.value === language)?.label ?? language;
          const preview = this.codePreviewCache.snapshot(s.id);
          const engine = preview?.engine ?? 'language-aware-fallback';
          const fallbackLabel = engine === 'codemirror' ? '' : '; using language-aware fallback highlighting';
          const rows = codePreviewMarkup.get(s.id) ?? '';
          overlayHtml += `<div id="ol_${s.id}" class="board-code-preview" role="region" tabindex="0" data-language="${language}" data-highlight-engine="${engine}" aria-label="${languageLabel} syntax-highlighted code preview; source spacing and line breaks are preserved${fallbackLabel}" style="position:absolute; left:${s.x}px; top:${s.y}px; width:${s.w}px; height:${s.h}px; font-size:${(s.fs||14)}px; font-family:'JetBrains Mono','SFMono-Regular',Consolas,monospace; line-height:1.5; color:#d4d4d4; box-sizing:border-box; overflow:auto; background:#1b2430; border-radius:6px; border:1px solid #344253; pointer-events:auto; overscroll-behavior:contain;"><div class="board-code-lines">${rows}</div></div>`;
        } else if (s.type === 'text') {
          content = ((s as any).text||'').replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
          overlayHtml += `<div id="ol_${s.id}" style="position:absolute; left:${s.x}px; top:${s.y}px; width:${s.w}px; height:${s.h}px; font-size:${(s.fs||14)}px; font-family:'Inter',system-ui,sans-serif; color:${(s as any).color||'#1e293b'}; padding:16px; box-sizing:border-box; overflow:hidden; white-space:pre-wrap; word-break:break-word; pointer-events:auto;">${content}</div>`;
        }

        if (this.sel.has(s.id)) {
          const z = this.cam.zoom;
          const p = 4; // Padding (world pixels)
          const hs = 4 / z; // Handle size (screen-corrected world pixels)
          const sw = 1.5 / z; // Stroke width (screen-corrected world pixels)
          const hbw = 1 / z; // Handle border width

          overlayHtml += `
            <div style="position:absolute; left:${s.x - p}px; top:${s.y - p}px; width:${s.w + p*2}px; height:${s.h + p*2}px; border:${sw}px solid #3b82f6; border-radius:${3/z}px; pointer-events:none; box-sizing:border-box;"></div>
            <div style="position:absolute; left:${s.x - p - hs}px; top:${s.y - p - hs}px; width:${hs*2}px; height:${hs*2}px; background:#fff; border:${hbw}px solid #3b82f6; border-radius:50%; pointer-events:none;"></div>
            <div style="position:absolute; left:${s.x + (s.w/2) - hs}px; top:${s.y - p - hs}px; width:${hs*2}px; height:${hs*2}px; background:#fff; border:${hbw}px solid #3b82f6; border-radius:50%; pointer-events:none;"></div>
            <div style="position:absolute; left:${s.x + s.w + p - hs}px; top:${s.y - p - hs}px; width:${hs*2}px; height:${hs*2}px; background:#fff; border:${hbw}px solid #3b82f6; border-radius:50%; pointer-events:none;"></div>
            <div style="position:absolute; left:${s.x - p - hs}px; top:${s.y + (s.h/2) - hs}px; width:${hs*2}px; height:${hs*2}px; background:#fff; border:${hbw}px solid #3b82f6; border-radius:50%; pointer-events:none;"></div>
            <div style="position:absolute; left:${s.x + s.w + p - hs}px; top:${s.y + (s.h/2) - hs}px; width:${hs*2}px; height:${hs*2}px; background:#fff; border:${hbw}px solid #3b82f6; border-radius:50%; pointer-events:none;"></div>
            <div style="position:absolute; left:${s.x - p - hs}px; top:${s.y + s.h + p - hs}px; width:${hs*2}px; height:${hs*2}px; background:#fff; border:${hbw}px solid #3b82f6; border-radius:50%; pointer-events:none;"></div>
            <div style="position:absolute; left:${s.x + (s.w/2) - hs}px; top:${s.y + s.h + p - hs}px; width:${hs*2}px; height:${hs*2}px; background:#fff; border:${hbw}px solid #3b82f6; border-radius:50%; pointer-events:none;"></div>
            <div style="position:absolute; left:${s.x + s.w + p - hs}px; top:${s.y + s.h + p - hs}px; width:${hs*2}px; height:${hs*2}px; background:#fff; border:${hbw}px solid #3b82f6; border-radius:50%; pointer-events:none;"></div>
          `;
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

  private drawShape(s: AnyShape) {
    const cx = this.cx;
    cx.save();

    switch (s.type) {
      case 'pen': {
        const stroke = getStroke(s.pts, {
          size: s.size,
          thinning: 0.4,
          smoothing: 0.7,
          streamline: 0.5,
          easing: t => t,
          simulatePressure: !s.pts[0] || s.pts[0][2] === 0.5,
        });
        if (!stroke.length) break;
        cx.fillStyle = s.color;
        const path = new Path2D();
        path.moveTo(stroke[0][0], stroke[0][1]);
        for (let i=1; i<stroke.length; i++) {
          const [x0,y0]=stroke[i-1], [x1,y1]=stroke[i];
          path.quadraticCurveTo(x0, y0, (x0+x1)/2, (y0+y1)/2);
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
      case 'rect': {
        const shape = s as RectShape; const [rx,ry,rw,rh]=nr(shape.x,shape.y,shape.w,shape.h);
        cx.fillStyle=shape.fill; cx.strokeStyle=shape.stroke; cx.lineWidth=shape.sw;
        if (shape.vertices?.length === 4) {
          const vertices = getShapeVertices(shape);
          cx.beginPath(); cx.moveTo(vertices[0][0], vertices[0][1]);
          vertices.slice(1).forEach(([x, y]) => cx.lineTo(x, y));
          cx.closePath();
        } else {
          cx.beginPath(); cx.roundRect(rx,ry,rw,rh,0);
        }
        cx.fill(); if(shape.sw>0) cx.stroke(); break;
      }
      case 'rounded-rect': {
        const {x,y,w,h,fill,stroke,sw} = s as RectShape; const [rx,ry,rw,rh]=nr(x,y,w,h);
        cx.fillStyle=fill; cx.strokeStyle=stroke; cx.lineWidth=sw;
        cx.beginPath(); cx.roundRect(rx,ry,rw,rh,16); cx.fill(); if(sw>0) cx.stroke(); break;
      }
      case 'ellipse': {
        const {x,y,w,h,fill,stroke,sw} = s; const [rx,ry,rw,rh]=nr(x,y,w,h);
        cx.fillStyle=fill; cx.strokeStyle=stroke; cx.lineWidth=sw;
        cx.beginPath(); cx.ellipse(rx+rw/2,ry+rh/2,rw/2,rh/2,0,0,Math.PI*2);
        cx.fill(); if(sw>0) cx.stroke(); break;
      }
      case 'triangle': {
        const shape = s as TriShape;
        const vertices = getShapeVertices(shape);
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
        for(let i=0;i<10;i++){const r=i%2===0?ro:ri,a=(i*Math.PI/5)-Math.PI/2;i===0?cx.moveTo(pcx+r*Math.cos(a),pcy+r*Math.sin(a)):cx.lineTo(pcx+r*Math.cos(a),pcy+r*Math.sin(a));}
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
        const vertices = getShapeVertices(shape);
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
    cx.restore();
  }

  private drawSelection(s: AnyShape) {
    if (['sticky', 'text', 'math', 'code'].includes(s.type)) return; // Rendered as DOM HTML elements for robust Z-ordering
    const {cx, cam} = this;
    let x:number, y:number, w:number, h:number;
    if ('x' in s && 'w' in s) {
      const b=s as any; [x,y,w,h]=nr(b.x,b.y,b.w,b.h);
    } else {
      x=s.minX; y=s.minY; w=s.maxX-s.minX; h=s.maxY-s.minY;
    }
    const P = 4/cam.zoom;
    cx.save();
    
    // Primary Selection Border (Blue line)
    cx.strokeStyle = '#3b82f6';
    cx.lineWidth = 2.5 / cam.zoom;
    cx.setLineDash([]);
    cx.beginPath();
    cx.roundRect(x-P, y-P, w+P*2, h+P*2, 2/cam.zoom);
    cx.stroke();

    // 8 resize handles (Circular)
    const HS = 5 / cam.zoom;
    const handles: [number,number][] = [
      [x-P, y-P], [x+w/2, y-P], [x+w+P, y-P],
      [x+w+P, y+h/2], [x+w+P, y+h+P], [x+w/2, y+h+P],
      [x-P, y+h+P], [x-P, y+h/2]
    ];
    
    handles.forEach(([hx, hy]) => {
      cx.fillStyle = '#ffffff';
      cx.strokeStyle = '#3b82f6';
      cx.lineWidth = 1.5 / cam.zoom;
      cx.beginPath();
      cx.arc(hx, hy, HS, 0, Math.PI*2);
      cx.fill();
      cx.stroke();
    });
    
    cx.restore();
  }

  private saveH() {
    const snap = JSON.stringify([...this.shapes.entries()]);
    this.hist   = this.hist.slice(0, this.hi+1);
    this.hist.push(snap);
    this.hi     = this.hist.length-1;
    if (this.hist.length>100) { this.hist.shift(); this.hi--; }
  }
}

// ─── pure helpers ─────────────────────────────────────────────────────────────
const BOX_SHAPE_TYPES: readonly BoxShapeTool[] = [
  'rect', 'rounded-rect', 'ellipse', 'triangle', 'diamond', 'star', 'callout',
  'pentagon', 'hexagon', 'parallelogram', 'trapezoid', 'right-triangle',
];

export function isBoxShapeTool(value: string): value is BoxShapeTool {
  return BOX_SHAPE_TYPES.includes(value as BoxShapeTool);
}

/** World-space polygon used by polygon primitives and their hit/erase geometry. */
export function getShapeVertices(shape: AnyShape): [number, number][] {
  if (!('x' in shape && 'w' in shape && 'h' in shape)) return [];
  const box = shape as BoxShape;
  const [x, y, w, h] = nr(box.x, box.y, box.w, box.h);
  if (box.vertices && box.vertices.length >= 3) {
    return box.vertices.map(([nx, ny]) => [x + nx * w, y + ny * h]);
  }
  const left = x, right = x + w, top = y, bottom = y + h;
  const centerX = x + w / 2, centerY = y + h / 2;
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
  if (corners[shape.type]) return corners[shape.type];
  if (shape.type === 'ellipse') {
    return Array.from({ length: 48 }, (_, index): [number, number] => {
      const angle = (index / 48) * Math.PI * 2;
      return [centerX + Math.cos(angle) * w / 2, centerY + Math.sin(angle) * h / 2];
    });
  }
  if (shape.type === 'star') {
    const outer = Math.min(w, h) / 2;
    return Array.from({ length: 10 }, (_, index): [number, number] => {
      const radius = index % 2 === 0 ? outer : outer * 0.42;
      const angle = (index * Math.PI / 5) - Math.PI / 2;
      return [centerX + Math.cos(angle) * radius, centerY + Math.sin(angle) * radius];
    });
  }
  if (shape.type === 'pentagon' || shape.type === 'hexagon') {
    const sides = shape.type === 'pentagon' ? 5 : 6;
    return Array.from({ length: sides }, (_, index): [number, number] => {
      const angle = (index / sides) * Math.PI * 2 - Math.PI / 2;
      return [centerX + Math.cos(angle) * w / 2, centerY + Math.sin(angle) * h / 2];
    });
  }
  return [];
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

function uid() { return Date.now().toString(36)+Math.random().toString(36).slice(2,6); }

function nr(x:number,y:number,w:number,h:number):[number,number,number,number]{
  return [w<0?x+w:x, h<0?y+h:y, Math.abs(w), Math.abs(h)];
}

function getXY(s: AnyShape): {x:number,y:number} {
  if ('x' in s) return {x:(s as any).x, y:(s as any).y};
  if (s.type==='line' || s.type==='arrow') return {x:(s as LineShape | ArrowShape).x1, y:(s as LineShape | ArrowShape).y1};
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
  if ('x' in s) { const b=s as any; return {...b, x:nx, y:ny, minX:nx, minY:ny, maxX:nx+b.w, maxY:ny+b.h}; }
  return s;
}


