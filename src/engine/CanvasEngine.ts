import RBush from 'rbush';
import * as Y from 'yjs';
import { getStroke } from 'perfect-freehand';

export interface BaseShape {
  id: string;
  type: string;
  color: string;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface RectShape extends BaseShape {
  type: 'rect';
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PenShape extends BaseShape {
  type: 'pen';
  points: number[][]; // [x, y, pressure]
}

export type Shape = RectShape | PenShape;

// Thể hiện cấu trúc lưu trên RBush (yêu cầu property maxX, maxY, minX, minY)
interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  id: string;
}

export class CanvasEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private yShapes: Y.Map<any>;
  private spatialIndex: RBush<BBox>;
  private animationFrameId: number = 0;
  private needsRender: boolean = true;

  // Camera Toạ độ World
  public camera = { x: 0, y: 0, zoom: 1 };
  
  // Lưu giữ sự kiện cho mouse từ React gửi vào Engine
  public activeTool: 'cursor' | 'pen' | 'rect' = 'pen';
  private isDrawing = false;
  private currentShapeId: string | null = null;

  constructor(canvas: HTMLCanvasElement, yShapes: Y.Map<any>) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false }) as CanvasRenderingContext2D; // Tối ưu GPU
    this.yShapes = yShapes;
    this.spatialIndex = new RBush<BBox>();

    // Fix resize
    window.addEventListener('resize', this.onResize);
    this.onResize();

    // Re-render khi có update từ Yjs (CRDT Realtime từ máy khác hoặc máy mình)
    this.yShapes.observeDeep(() => {
      this.rebuildIndex();
      this.triggerRender();
    });

    this.rebuildIndex();
    this.renderLoop();
  }

  // Chuyển Toạ độ chuột (Screen Space) -> Toạ độ thế giới (World Space)
  public screenToWorld(x: number, y: number) {
    return {
      x: (x - this.canvas.width / 2) / this.camera.zoom + this.camera.x,
      y: (y - this.canvas.height / 2) / this.camera.zoom + this.camera.y
    };
  }

  // Sự kiện chuột/Pointer do Layer bên React chích thẳng vào
  public handlePointerDown(e: React.PointerEvent) {
    const worldPos = this.screenToWorld(e.clientX, e.clientY);
    
    if (this.activeTool === 'pen') {
      this.isDrawing = true;
      this.currentShapeId = Math.random().toString(36).substr(2, 9);
      
      const newShape: PenShape = {
        id: this.currentShapeId,
        type: 'pen',
        color: '#ff0000', // Sẽ custom được từ UI React sau
        points: [[worldPos.x, worldPos.y, e.pressure || 0.5]],
        minX: worldPos.x, minY: worldPos.y,
        maxX: worldPos.x, maxY: worldPos.y,
      };
      
      this.yShapes.set(this.currentShapeId, newShape);
      this.triggerRender();
      
    } else if (this.activeTool === 'rect') {
       this.isDrawing = true;
       this.currentShapeId = Math.random().toString(36).substr(2, 9);
       
       const newShape: RectShape = {
         id: this.currentShapeId,
         type: 'rect',
         color: '#0000ff',
         x: worldPos.x, y: worldPos.y,
         width: 0, height: 0,
         minX: worldPos.x, minY: worldPos.y,
         maxX: worldPos.x, maxY: worldPos.y,
       };
       this.yShapes.set(this.currentShapeId, newShape);
       this.triggerRender();
    }
  }

  public handlePointerMove(e: React.PointerEvent) {
    if (!this.isDrawing || !this.currentShapeId) return;
    const worldPos = this.screenToWorld(e.clientX, e.clientY);

    const shape = this.yShapes.get(this.currentShapeId) as Shape;
    if (!shape) return;

    if (shape.type === 'pen') {
      const points = [...shape.points, [worldPos.x, worldPos.y, e.pressure || 0.5]];
      
      // Update BoundingBox
      const minX = Math.min(...points.map(p => p[0]));
      const maxX = Math.max(...points.map(p => p[0]));
      const minY = Math.min(...points.map(p => p[1]));
      const maxY = Math.max(...points.map(p => p[1]));

      this.yShapes.set(this.currentShapeId, { ...shape, points, minX, maxX, minY, maxY });
      this.triggerRender();
    } 
    else if (shape.type === 'rect') {
      const width = worldPos.x - shape.x;
      const height = worldPos.y - shape.y;
      
      const minX = Math.min(shape.x, worldPos.x);
      const maxX = Math.max(shape.x, worldPos.x);
      const minY = Math.min(shape.y, worldPos.y);
      const maxY = Math.max(shape.y, worldPos.y);

      this.yShapes.set(this.currentShapeId, { ...shape, width, height, minX, maxX, minY, maxY });
      this.triggerRender();
    }
  }

  public handlePointerUp() {
    this.isDrawing = false;
    this.currentShapeId = null;
  }

  public setCamera(x: number, y: number, zoom: number) {
    this.camera = { x, y, zoom };
    this.triggerRender();
  }
  
  public setTool(tool: 'cursor' | 'pen' | 'rect') {
    this.activeTool = tool;
  }

  public triggerRender() {
    this.needsRender = true;
  }

  private onResize = () => {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
    this.triggerRender();
  };

  private rebuildIndex() {
    // Spatial indexing để Cull objects nằm ngoài Viewport
    const elements: BBox[] = [];
    this.yShapes.forEach((shape: Shape) => {
      elements.push({
        id: shape.id,
        minX: shape.minX,
        minY: shape.minY,
        maxX: shape.maxX,
        maxY: shape.maxY
      });
    });
    this.spatialIndex.clear();
    this.spatialIndex.load(elements);
  }

  private getViewportBBox(): BBox {
    // Tính khung hiển thị trên Camera để filter object
    const start = this.screenToWorld(0, 0);
    const end = this.screenToWorld(this.canvas.width, this.canvas.height);
    return {
      minX: start.x, minY: start.y,
      maxX: end.x, maxY: end.y,
      id: "viewport"
    };
  }

  private renderLoop = () => {
    if (this.needsRender) {
      this.draw();
      this.needsRender = false;
    }
    this.animationFrameId = requestAnimationFrame(this.renderLoop);
  };

  private draw() {
    const { ctx, canvas, camera } = this;
    
    // Clear nền
    ctx.resetTransform();
    ctx.fillStyle = '#f8f9fa';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Camera Transform (Infinite Canvas)
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-camera.x, -camera.y);

    // Draw Grid
    this.drawDotGrid(ctx, camera);

    // Culling
    const viewportBox = this.getViewportBBox();
    const visibleShapes = this.spatialIndex.search(viewportBox);

    // Vẽ từng hình
    for (const item of visibleShapes) {
      const shape = this.yShapes.get(item.id) as Shape;
      if (!shape) continue;

      if (shape.type === 'rect') {
        const { x, y, width, height, color } = shape as RectShape;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.roundRect(x, y, width, height, 8);
        ctx.fill();
        ctx.strokeStyle = '#222';
        ctx.lineWidth = 1;
        ctx.stroke();
      } else if (shape.type === 'pen') {
        const outline = getStroke(shape.points, {
             size: 8,
             thinning: 0.5,
             smoothing: 0.5,
             streamline: 0.5,
        });
        
        ctx.fillStyle = shape.color;
        
        const path = new Path2D();
        if(!outline.length) continue;
        path.moveTo(outline[0][0], outline[0][1]);
        for (let i = 1; i < outline.length; i++) {
            path.lineTo(outline[i][0], outline[i][1]);
        }
        path.closePath();
        ctx.fill(path);
      }
    }
  }
  
  private drawDotGrid(ctx: CanvasRenderingContext2D, camera: any) {
    const DOT_SPACING = 50;
    const vp = this.getViewportBBox();
    
    // Tính biên Grid theo Viewport
    const startX = Math.floor(vp.minX / DOT_SPACING) * DOT_SPACING;
    const startY = Math.floor(vp.minY / DOT_SPACING) * DOT_SPACING;
    
    ctx.fillStyle = '#ccc';
    for (let x = startX; x <= vp.maxX; x += DOT_SPACING) {
      for (let y = startY; y <= vp.maxY; y += DOT_SPACING) {
        ctx.beginPath();
        ctx.arc(x, y, 2 / camera.zoom, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  public destroy() {
    window.removeEventListener('resize', this.onResize);
    cancelAnimationFrame(this.animationFrameId);
  }
}
