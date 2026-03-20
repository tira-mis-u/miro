import { useEffect, useRef } from 'react';
import type { PointerEvent } from 'react';
import { useUIStore, yShapes } from './store/useBoardStore';
import { CanvasEngine } from './engine/CanvasEngine';
import { Square, MousePointer2, Pen } from 'lucide-react';

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<CanvasEngine | null>(null);
  
  const { tool, setTool } = useUIStore();

  useEffect(() => {
    if (canvasRef.current && !engineRef.current) {
      engineRef.current = new CanvasEngine(canvasRef.current, yShapes);
      
      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        if(!engineRef.current) return;
        const cam = engineRef.current.camera;

        if (e.ctrlKey) {
          const zoomChange = e.deltaY > 0 ? 0.9 : 1.1;
          engineRef.current.setCamera(cam.x, cam.y, cam.zoom * zoomChange);
        } else {
          engineRef.current.setCamera(cam.x + e.deltaX / cam.zoom, cam.y + e.deltaY / cam.zoom, cam.zoom);
        }
      };

      canvasRef.current.addEventListener('wheel', onWheel, { passive: false });
    }
  }, []);

  useEffect(() => {
    if(engineRef.current) {
      engineRef.current.setTool(tool);
    }
  }, [tool]);

  const handlePointerDown = (e: PointerEvent) => engineRef.current?.handlePointerDown(e);
  const handlePointerMove = (e: PointerEvent) => engineRef.current?.handlePointerMove(e);
  const handlePointerUp = () => engineRef.current?.handlePointerUp();

  return (
    <div className="w-screen h-screen relative bg-neutral-100 overflow-hidden select-none">
      <canvas 
        ref={canvasRef} 
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        className="block touch-none cursor-crosshair"
      />

      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center bg-white/95 backdrop-blur-md px-4 py-2 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.12)] border border-neutral-200 gap-2">
        <button 
          onClick={() => setTool('cursor')} 
          className={`p-3 rounded-lg transition-all ${tool === 'cursor' ? 'bg-blue-50 text-blue-600' : 'hover:bg-neutral-100 text-neutral-600'}`}
        >
          <MousePointer2 width={24} height={24} strokeWidth={2} />
        </button>
        <div className="w-px h-8 bg-neutral-200 mx-2" />
        <button 
          onClick={() => setTool('pen')} 
          className={`p-3 rounded-lg transition-all ${tool === 'pen' ? 'bg-blue-50 text-blue-600' : 'hover:bg-neutral-100 text-neutral-600'}`}
        >
          <Pen width={24} height={24} strokeWidth={2} />
        </button>
        <button 
          onClick={() => setTool('rect')} 
          className={`p-3 rounded-lg transition-all ${tool === 'rect' ? 'bg-blue-50 text-blue-600' : 'hover:bg-neutral-100 text-neutral-600'}`}
        >
          <Square width={24} height={24} strokeWidth={2} />
        </button>
      </div>

      <div className="absolute top-4 right-4 flex items-center gap-2 bg-white px-3 py-1.5 rounded-full shadow border border-neutral-200 text-sm font-medium">
        <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
        Realtime Sync
      </div>
    </div>
  );
}

export default App;
