import { getStroke } from 'perfect-freehand';
import * as Y from 'yjs';
import RBush from 'rbush';
import { parseTelex } from '../formula/parser';
import { renderFormulaStatic } from '../formula/renderer';
import * as Prism from 'prismjs';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-java';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-sql';

export type ToolType =
  | 'select' | 'lasso-select' | 'hand' | 'pen' | 'eraser' | 'eraser-stroke'
  | 'rect' | 'rounded-rect' | 'ellipse' | 'triangle' | 'diamond' | 'star' | 'callout'
  | 'arrow' | 'sticky' | 'text' | 'math' | 'code' | 'image';

export interface Camera { x: number; y: number; zoom: number; }

interface BaseShape { id:string; type:string; minX:number; minY:number; maxX:number; maxY:number; }
interface BoxShape  extends BaseShape { x:number; y:number; w:number; h:number; }

export interface PenShape     extends BaseShape { type:'pen';      pts:number[][]; color:string; size:number; }
export interface RectShape    extends BoxShape  { type:'rect'|'rounded-rect'; fill:string; stroke:string; sw:number; }
export interface EllipseShape extends BoxShape  { type:'ellipse';  fill:string; stroke:string; sw:number; }
export interface TriShape     extends BoxShape  { type:'triangle'; fill:string; stroke:string; sw:number; }
export interface DiamShape    extends BoxShape  { type:'diamond';  fill:string; stroke:string; sw:number; }
export interface StarShape    extends BoxShape  { type:'star';     fill:string; stroke:string; sw:number; }
export interface CalloutShape extends BoxShape  { type:'callout';  fill:string; stroke:string; sw:number; }
export interface ArrowShape   extends BaseShape { type:'arrow';    x1:number;y1:number;x2:number;y2:number; color:string; sw:number; }
export interface StickyShape  extends BoxShape  { type:'sticky';   text:string; bg:string; fs:number; }
export interface TextShape    extends BoxShape  { type:'text'|'math'|'code'; text:string; color:string; fs:number; }
export interface ImageShape   extends BoxShape  { type:'image';    src:string; naturalW:number; naturalH:number; }
export type AnyShape = PenShape|RectShape|EllipseShape|TriShape|DiamShape|StarShape|CalloutShape|ArrowShape|StickyShape|TextShape|ImageShape;

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

export class CanvasEngine {
  private cv: HTMLCanvasElement;
  private cx: CanvasRenderingContext2D;
  private yMap: Y.Map<any>;
  private shapes: Map<string,AnyShape> = new Map();
  private rtree = new RBush<any>();

  public  cam: Camera = { x:0, y:0, zoom:1 };
  public  tool: ToolType = 'pen';
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
  private lastOverlayState = '';

  // interaction state
  private isDown    = false;
  private isPanning = false;
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
    
    // Wait for next tick so canvas is in DOM
    setTimeout(() => {
      if (this.cv.parentElement) this.cv.parentElement.appendChild(this.overlayDiv);
    }, 100);

    this.yMap.observe(ev => {
      ev.changes.keys.forEach((ch, key) => {
        const old = this.shapes.get(key);
        if (old) this.rtree.remove(old);
        if (ch.action === 'delete') {
          this.shapes.delete(key);
        } else {
          const s = this.yMap.get(key);
          this.shapes.set(key, s);
          this.rtree.insert(s);
        }
      });
      this.dirty = true;
    });

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
    if (e.button !== 0 && e.button !== 1) return; // Only left or middle (for pan)
    if (e.target && (e.target as HTMLElement).closest('.formula-editor-panel, .popover, .math-tools-panel, .no-canvas, .zoom-controls, .panel-ui, .toolbar')) return;

    const w = this.clientToWorld(e.clientX, e.clientY);

    if (this.tool === 'hand' || e.button === 1) {
      this.isPanning = true;
      this.panRef = {sx:e.clientX, sy:e.clientY, cx:this.cam.x, cy:this.cam.y};
      this.onCursor?.('grabbing');
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
      } else if (['rect', 'rounded-rect', 'ellipse', 'triangle', 'diamond', 'star', 'callout', 'arrow'].includes(this.tool)) {
        if (['rect', 'rounded-rect', 'ellipse', 'triangle', 'diamond', 'star', 'callout', 'arrow'].includes(rawHit.type)) hit = rawHit;
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

    // ── ERASER ──
    if (this.tool === 'eraser' || this.tool === 'eraser-stroke') {
      this.isDown = true;
      if (this.tool === 'eraser') this.eraseAt(w.x, w.y);
      else this.eraseStrokeAt(w.x, w.y);
      return;
    }

    // ── PEN ──
    if (this.tool === 'pen') {
      this.isDown  = true;
      this.currId  = uid();
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
        const s: TextShape = {
          id, type:this.tool as any, x:nx, y:ny, w:200, h:40,
          text: '', 
          color: this.tool === 'code' ? '#111' : '#000000', fs:this.style.fontSize,
          minX:nx, minY:ny, maxX:nx+200, maxY:ny+40,
        };
        this.put(s);
        this.sel.add(id); this.onSel?.([id]);
        this.saveH();
        setTimeout(() => this.onEditText?.(s, e.clientX, e.clientY), 30);
      }
      return;
    }

    // ── SHAPES + ARROW ──
    if (['rect','rounded-rect','ellipse','triangle','diamond','star','callout','arrow'].includes(this.tool)) {
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

    // ── hover: update cursor based on handle proximity ──
    if ((this.tool === 'select' || this.tool === 'lasso-select') && !this.isDown && !this.isDragging) {
      const rh = this.hitResizeHandle(e.clientX, e.clientY);
      if (rh) {
        this.onCursor?.(HANDLE_CURSORS[rh.h] ?? 'nwse-resize');
      } else {
        const hit = this.hitShape(w.x, w.y);
        this.onCursor?.(hit ? 'move' : 'default');
      }
    }

    // ── drawing / eraser tracking ──
    if (!this.isDown) return;
    const s = this.shapes.get(this.currId!);
    if (!s) { // If currId is null, it means we are in eraser mode
      if (this.tool === 'eraser') this.eraseAt(w.x, w.y);
      if (this.tool === 'eraser-stroke') this.eraseStrokeAt(w.x, w.y);
      return;
    }

    // ── pen stroke ──
    if (s.type === 'pen') {
      this.put({
        ...s,
        pts: [...s.pts, [w.x, w.y, e.pressure||0.5]],
        minX: Math.min(s.minX, w.x), maxX: Math.max(s.maxX, w.x),
        minY: Math.min(s.minY, w.y), maxY: Math.max(s.maxY, w.y),
      });
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

  pointerUp() {
    if (this.isPanning) {
      this.isPanning = false;
      this.onCursor?.(this.tool === 'hand' ? 'grab' : 'default');
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

    if (this.isDown) {
      this.isDown = false;
      if (this.currId) {
        const s = this.shapes.get(this.currId);
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
    const s = this.shapes.get(id);
    if (s && 'w' in s) {
      const news = { ...s, w, h } as any;
      news.maxX = news.x + w;
      news.maxY = news.y + h;
      this.put(news);
    }
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
  private put(s: AnyShape) {
    const old = this.shapes.get(s.id);
    if (old) this.rtree.remove(old);
    this.shapes.set(s.id, s);
    this.rtree.insert(s);
    this.yMap.set(s.id, s);
    this.dirty = true;
    this.onShapeUpdate?.(s);
  }

  private del(id: string) {
    const old = this.shapes.get(id);
    if (old) { this.rtree.remove(old); this.shapes.delete(id); }
    this.yMap.delete(id);
    this.dirty = true;
  }

  private eraseAt(wx: number, wy: number) {
    const r = (this.style.penSize * 3) / this.cam.zoom;
    const toKill = this.rtree.search({minX:wx-r, minY:wy-r, maxX:wx+r, maxY:wy+r}).map(s=>s.id);
    toKill.forEach(id => this.del(id));
  }

  private eraseStrokeAt(wx: number, wy: number) {
    const r = (this.style.penSize * 3) / this.cam.zoom;
    const hits = this.rtree.search({minX:wx-r, minY:wy-r, maxX:wx+r, maxY:wy+r});
    hits.forEach(s => {
      if (s.type === 'pen' && s.pts) {
        const pen = s as PenShape;
        const newPts = pen.pts.filter(p => Math.hypot(p[0]-wx, p[1]-wy) > r);
        if (newPts.length < pen.pts.length) {
          if (newPts.length < 2) this.del(s.id);
          else this.put({...pen, pts: newPts});
        }
      } else {
        this.del(s.id); // For non-pen shapes, stroke erase falls back to standard object erase
      }
    });
  }

  private hitShape(wx: number, wy: number): AnyShape|null {
    const P = 8/this.cam.zoom;
    const hits = this.rtree.search({minX:wx-P, minY:wy-P, maxX:wx+P, maxY:wy+P});
    return hits[hits.length-1] ?? null;
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
    const MIN = o.type === 'sticky' ? 120 : 20;
    
    switch (this.resizeH) {
      case 'se': w = Math.max(MIN, o.w + dx); h = Math.max(MIN, o.h + dy); break;
      case 'sw': w = Math.max(MIN, o.w - dx); x = o.x + o.w - w; h = Math.max(MIN, o.h + dy); break;
      case 'ne': w = Math.max(MIN, o.w + dx); h = Math.max(MIN, o.h - dy); y = o.y + o.h - h; break;
      case 'nw': w = Math.max(MIN, o.w - dx); x = o.x + o.w - w; h = Math.max(MIN, o.h - dy); y = o.y + o.h - h; break;
      case 'e':  w = Math.max(MIN, o.w + dx); break;
      case 'w':  w = Math.max(MIN, o.w - dx); x = o.x + o.w - w; break;
      case 's':  h = Math.max(MIN, o.h + dy); break;
      case 'n':  h = Math.max(MIN, o.h - dy); y = o.y + o.h - h; break;
    }
    this.put({ ...o, x, y, w, h, minX:x, minY:y, maxX:x+w, maxY:y+h });
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
  setTool(t: ToolType) {
    this.tool = t;
    this.sel.clear(); this.onSel?.([]);
    this.dirty = true;
    // set appropriate cursor
    const c =
      t==='hand'   ? 'grab' :
      t==='pen'||t==='eraser'||t==='eraser-stroke'||['rect','ellipse','triangle','diamond','star','arrow','lasso-select'].includes(t) ? 'crosshair' :
      t==='sticky'||t==='text'||t==='math'||t==='code' ? 'text' : 
      t==='image' ? 'cell' : 'default';
    this.onCursor?.(c);
  }

  deleteSel() {
    this.sel.forEach(id => this.del(id));
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
    if (s && 'text' in (s as any)) { 
      this.put({...s, text} as any); 
    }
  }


  deleteShape(id: string) {
    const s = this.shapes.get(id);
    if (s) {
      this.rtree.remove(s);
      this.shapes.delete(id);
      this.yMap.delete(id);
      this.sel.delete(id);
      this.onSel?.([...this.sel]);
      this.dirty = true;
      this.saveH();
    }
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

  undo() {
    if (this.hi<=0) return;
    this.hi--;
    const e: [string,AnyShape][] = JSON.parse(this.hist[this.hi]);
    this.yMap.clear(); this.shapes.clear();
    e.forEach(([id,s]) => { this.shapes.set(id,s); this.yMap.set(id,s); });
    this.dirty = true;
  }

  redo() {
    if (this.hi>=this.hist.length-1) return;
    this.hi++;
    const e: [string,AnyShape][] = JSON.parse(this.hist[this.hi]);
    this.yMap.clear(); this.shapes.clear();
    e.forEach(([id,s]) => { this.shapes.set(id,s); this.yMap.set(id,s); });
    this.dirty = true;
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.overlayDiv?.remove();
  }

  // ─── render loop ─────────────────────────────────────────────────────────
  private loop = () => {
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

    // Update overlay transforms
    this.wrapperDiv.style.transform = `translate(${cv.width/2}px, ${cv.height/2}px) scale(${cam.zoom}) translate(${-cam.x}px, ${-cam.y}px)`;
    this.onCameraChange?.(this.cam);
    
    // Rebuild overlays only if necessary
    let overlayHtml = '';
    const domShapes = visible.filter(s => ['sticky','math','code','text','image'].includes(s.type)) as any[];
    let stateSignature = '';

    domShapes.forEach(s => {
      stateSignature += `${s.id}:${(s as any).text||''}:${(s as any).w}:${(s as any).h}:${(s as any).x}:${(s as any).y}:${s.type==='image'?(s as any).src:''}:sel${this.sel.has(s.id)}|`;
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
          overlayHtml += `<div id="ol_${s.id}" style="position:absolute; left:${s.x}px; top:${s.y}px; width:${s.w}px; height:${s.h}px; font-size:${((s as any).fs||14)}px; font-family:'Inter',system-ui,sans-serif; color:rgba(15,15,15,0.8); padding:16px; box-sizing:border-box; overflow-y:auto; overflow-x:hidden; white-space:pre-wrap; word-break:break-word; border-radius:3px; background:${(s as any).bg}; box-shadow:0 4px 16px rgba(0,0,0,0.1); pointer-events:auto;"><div style="position:absolute; top:0; right:0; width:14px; height:14px; background:rgba(0,0,0,0.08); clip-path:polygon(100% 0, 0 0, 100% 100%);"></div>${content}</div>`;
        } else if (s.type === 'math') {
          try {
            const ast = parseTelex((s as any).text || '');
            content = renderFormulaStatic(ast, (s.fs || 14));
          } catch(e) { content = String(e); }
          overlayHtml += `<div id="ol_${s.id}" style="position:absolute; left:${s.x}px; top:${s.y}px; width:${s.w}px; height:${s.h}px; font-size:${(s.fs||14)}px; color:#000; padding:16px; box-sizing:border-box; overflow:hidden; background:transparent; border-radius:4px; pointer-events:auto;">${content}</div>`;
        } else if (s.type === 'code') {
          const lang = Prism.languages.javascript;
          try { content = Prism.highlight((s as any).text||' ', lang, 'javascript'); } catch(e) { content = (s as any).text; }
          const lineNums = ((s as any).text||' ').split('\n').map((_:any,i:number) => `<div style="line-height:1.5">${i+1}</div>`).join('');
          overlayHtml += `<div id="ol_${s.id}" style="position:absolute; left:${s.x}px; top:${s.y}px; width:${s.w}px; height:${s.h}px; font-size:${(s.fs||14)}px; font-family:'JetBrains Mono',monospace; color:#e2e8f0; box-sizing:border-box; overflow:hidden; display:flex; background:#1e1e1e; border-radius:6px; border:1px solid #444; pointer-events:none;"><div style="width:30px; background:#2d2d2d; border-right:1px solid #444; color:#666; display:flex; flex-direction:column; align-items:center; padding-top:12px; flex-shrink:0; font-size:0.8em; user-select:none;">${lineNums}</div><div style="padding:12px 16px; line-height:1.5; overflow:hidden; flex:1; min-width:0; min-height:0;"><pre style="margin:0; font-family:inherit; white-space:pre-wrap; word-break:break-all;"><code>${content}</code></pre></div></div>`;
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
    const {cx, cam} = this;
    const STEP = 40;
    const vp   = this.vpBox();
    const sx   = Math.floor(vp.minX/STEP)*STEP;
    const sy   = Math.floor(vp.minY/STEP)*STEP;
    const r    = Math.max(0.4, Math.min(1.6, 1.4/cam.zoom));
    cx.fillStyle = '#ccc9c0';
    for (let x=sx; x<=vp.maxX; x+=STEP)
      for (let y=sy; y<=vp.maxY; y+=STEP) {
        cx.beginPath(); cx.arc(x,y,r,0,Math.PI*2); cx.fill();
      }
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
      case 'rect': {
        const {x,y,w,h,fill,stroke,sw} = s as RectShape; const [rx,ry,rw,rh]=nr(x,y,w,h);
        cx.fillStyle=fill; cx.strokeStyle=stroke; cx.lineWidth=sw;
        cx.beginPath(); cx.roundRect(rx,ry,rw,rh,0); cx.fill(); if(sw>0) cx.stroke(); break;
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
        const {x,y,w,h,fill,stroke,sw} = s; const [rx,ry,rw,rh]=nr(x,y,w,h);
        cx.fillStyle=fill; cx.strokeStyle=stroke; cx.lineWidth=sw;
        cx.beginPath(); cx.moveTo(rx+rw/2,ry); cx.lineTo(rx+rw,ry+rh); cx.lineTo(rx,ry+rh); cx.closePath();
        cx.fill(); if(sw>0) cx.stroke(); break;
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
function uid() { return Date.now().toString(36)+Math.random().toString(36).slice(2,6); }

function nr(x:number,y:number,w:number,h:number):[number,number,number,number]{
  return [w<0?x+w:x, h<0?y+h:y, Math.abs(w), Math.abs(h)];
}

function getXY(s: AnyShape): {x:number,y:number} {
  if ('x' in s) return {x:(s as any).x, y:(s as any).y};
  if (s.type==='arrow') return {x:(s as ArrowShape).x1, y:(s as ArrowShape).y1};
  return {x:s.minX, y:s.minY};
}

function moveShape(s: AnyShape, nx: number, ny: number): AnyShape {
  if (s.type==='pen') {
    const p=s as PenShape; const dx=nx-p.minX, dy=ny-p.minY;
    return {...p, pts:p.pts.map(q=>[q[0]+dx,q[1]+dy,q[2]]), minX:nx, minY:ny, maxX:p.maxX+dx, maxY:p.maxY+dy};
  }
  if (s.type==='arrow') {
    const a=s as ArrowShape; const dx=nx-a.x1, dy=ny-a.y1;
    return {...a, x1:nx,y1:ny,x2:a.x2+dx,y2:a.y2+dy, minX:Math.min(nx,a.x2+dx),minY:Math.min(ny,a.y2+dy),maxX:Math.max(nx,a.x2+dx),maxY:Math.max(ny,a.y2+dy)};
  }
  if ('x' in s) { const b=s as any; return {...b, x:nx, y:ny, minX:nx, minY:ny, maxX:nx+b.w, maxY:ny+b.h}; }
  return s;
}


