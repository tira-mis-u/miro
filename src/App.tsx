import * as React from 'react';
import { useEffect, useRef, useState, useCallback } from 'react';
import {
  MousePointer2, Hand, PenLine, Eraser, StickyNote, Type,
  Square, Circle, Triangle, Diamond, Star, MoveRight,
  ImageIcon, Undo2, Redo2, ZoomIn, ZoomOut, Maximize2,
  Share2, Play, Timer, Video, MessageSquare, MoreHorizontal,
  Copy, Trash2, Palette, X, ChevronDown, Check,
  Code, Calculator, AppWindow
} from 'lucide-react';
import { CanvasEngine } from './engine/CanvasEngine';
import type { ToolType, StickyShape, AnyShape } from './engine/CanvasEngine';
import { yShapes } from './store/useBoardStore';

// ─── Palettes ─────────────────────────────────────────────────────────────────
const PALETTE = ['#000000', '#f9a8d4', '#ef4444', '#f97316', '#22c55e', '#3b82f6', '#a855f7'];
const STICKY_COLORS = ['#fde047', '#fca5a5', '#fdba74', '#86efac', '#93c5fd', '#d8b4fe'];

const SELECT_TOOLS: {id:ToolType; Icon:React.FC<any>; label:string}[] = [
  {id:'select', Icon:MousePointer2, label:'Select'},
  {id:'lasso-select', Icon:MousePointer2, label:'Lasso Select'}, // Reuse icon for now
];

const ERASER_TOOLS: {id:ToolType; Icon:React.FC<any>; label:string}[] = [
  {id:'eraser', Icon:Eraser, label:'Object Eraser'},
  {id:'eraser-stroke', Icon:Eraser, label:'Stroke Eraser'}, // Reuse icon for now
];

const TEXT_TOOLS: {id:ToolType; Icon:React.FC<any>; label:string}[] = [
  {id:'text', Icon:Type, label:'Text'},
  {id:'math', Icon:Calculator, label:'Math LaTeX'},
  {id:'code', Icon:Code, label:'Code Block'},
];

const SHAPE_TOOLS: {id:ToolType; Icon:React.FC<any>; label:string}[] = [
  {id:'rect', Icon:Square, label:'Rectangle'},
  {id:'rounded-rect', Icon:AppWindow, label:'Rounded Rect'},
  {id:'ellipse', Icon:Circle, label:'Circle'},
  {id:'diamond', Icon:Diamond, label:'Diamond'},
  {id:'star', Icon:Star, label:'Star'},
  {id:'triangle', Icon:Triangle, label:'Triangle'},
  {id:'callout', Icon:MessageSquare, label:'Callout'},
  {id:'arrow', Icon:MoveRight, label:'Arrow'},
];

const MATH_SYMBOLS = {
  'Greek': [['\\alpha','α'],['\\beta','β'],['\\gamma','γ'],['\\delta','δ'],['\\pi','π'],['\\theta','θ'],['\\sigma','σ'],['\\Omega','Ω']],
  'Operators': [['\\sum','∑'],['\\int','∫'],['\\partial','∂'],['\\sqrt','√'],['\\infty','∞'],['\\neq','≠'],['\\approx','≈'],['\\le','≤'],['\\ge','≥']],
  'Arrows': [['\\rightarrow','→'],['\\leftarrow','←'],['\\leftrightarrow','↔'],['\\Rightarrow','⇒'],['\\Leftarrow','⇐']]
};

const AUTO_REPLACE: Record<string, string> = {
  'sum': '∑', 'int': '∫', 'alpha': 'α', 'beta': 'β', 'pi': 'π', 'delta': 'δ', 'theta': 'θ', 'sqrt': '√', 'inf': '∞',
  'approx': '≈', 'neq': '≠', 'le': '≤', 'ge': '≥', 'to': '→', 'Rightarrow': '⇒', 'exists': '∃', 'forall': '∀'
};

function PopoverItem({active, onClick, Icon, label, grid}:{active:boolean; onClick:(e:React.MouseEvent)=>void; Icon:any; label:string; grid?:boolean}) {
  if (grid) {
    return (
      <button onClick={onClick} title={label}
        className={`w-10 h-10 flex items-center justify-center rounded-lg transition-all ${active ? 'bg-[#F2A310]/15' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'}`}>
        <Icon size={18} className={active ? 'text-[#F2A310]' : ''} />
      </button>
    );
  }
  return (
    <button onClick={onClick} title={label}
      className={`w-full flex items-center gap-3 px-3 h-10 rounded-lg transition-all ${active ? 'bg-[#F2A310]/15' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 font-medium'}`}>
      <div className={`p-1.5 rounded-md ${active ? 'bg-transparent text-[#F2A310]' : 'bg-gray-100 text-gray-400'}`}>
        <Icon size={14} />
      </div>
      <span className={`text-[13px] ${active ? 'font-bold text-[#111]' : 'font-medium text-gray-700'}`}>{label}</span>
      {active && <Check size={14} className="ml-auto text-[#F2A310] stroke-[2.5px]" />}
    </button>
  );
}

function SideBtn({label,active,onClick,children}:{label:string;active?:boolean;onClick:(e:React.MouseEvent)=>void;children:React.ReactNode}) {
  return (
    <button onClick={onClick}
      className={[
        'relative group w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-100',
        active
          ? 'bg-[#F2A310] text-[#111] shadow-[0_2px_10px_rgba(242,163,16,.5)]'
          : 'text-white/50 hover:text-white hover:bg-white/[.11]',
      ].join(' ')}>
      {children}
      <span className="pointer-events-none absolute left-[calc(100%+10px)] top-1/2 -translate-y-1/2 z-[9999] px-2 py-1 rounded-lg bg-gray-900 text-white text-[11px] font-medium whitespace-nowrap opacity-0 scale-95 group-hover:opacity-100 group-hover:scale-100 transition-all duration-150 shadow-xl">
        {label}
      </span>
    </button>
  );
}

// Removed ColorSwatch as it was declared but never read.

export default function App() {
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const wrapRef    = useRef<HTMLDivElement>(null);
  const engRef     = useRef<CanvasEngine|null>(null);
  const fileRef    = useRef<HTMLInputElement>(null);
  const nameRef    = useRef<HTMLInputElement>(null);
  // store last image-drop position
  const imgPosRef  = useRef({x:0, y:0});

  const [tool,      setToolSt]    = useState<ToolType>('pen');
  const [zoom,      setZoom]      = useState(1);
  const [cursor,    setCursor]    = useState('crosshair');
  const [boardName, setBoardName] = useState('Untitled');
  const [editName,  setEditName]  = useState(false);
  const [selIds,    setSelIds]    = useState<string[]>([]);

  // text/sticky edit overlay
  const [editShape, setEditShape] = useState<AnyShape | null>(null);
  const editShapeRef = useRef<AnyShape | null>(null);
  const internalSetEditShape = (s: AnyShape | null) => {
    setEditShape(s);
    editShapeRef.current = s;
  };

  const [editText,  setEditText]  = useState('');
  const [editBox,   setEditBox]   = useState({l:0,t:0,w:0,h:0});

  // style panel
  const [panelOpen, setPanelOpen] = useState(false);
  const [penColor,  setPenColor]  = useState('#ef4444');
  const [penSize,   setPenSize]   = useState(6);
  const [fill,      setFill]      = useState('transparent');
  const [stroke,    setStroke]    = useState('#ef4444');
  const [sw,        setSw]        = useState(2);
  const [stickyBg,  setStickyBg]  = useState('#fef08a');
  const [fontSize,  setFontSize]  = useState(14);

  const [openGroup, setOpenGroup] = useState<'shapes'|'text'|'select'|'eraser'|null>(null);
  const [lastTextTool, setLastTextTool] = useState<ToolType>('text');
  const [lastShapeTool, setLastShapeTool] = useState<ToolType>('rect');
  const [lastSelectTool, setLastSelectTool] = useState<ToolType>('select');
  const [lastEraserTool, setLastEraserTool] = useState<ToolType>('eraser');

  const setTool = (t: ToolType, keepOpen: boolean = false) => {
    setToolSt(t);
    // When manually selecting a tool, close any other open groups
    if (!keepOpen) setOpenGroup(null); 
    engRef.current?.setTool(t);
    if (['text','math','code'].includes(t)) setLastTextTool(t);
    if (SHAPE_TOOLS.some(s => s.id === t)) setLastShapeTool(t);
    if (['select','lasso-select'].includes(t)) setLastSelectTool(t);
    if (['eraser','eraser-stroke'].includes(t)) setLastEraserTool(t);
  };

  // ── init engine ────────────────────────────────────────────────────────
  useEffect(() => {
    const cv = canvasRef.current, wrap = wrapRef.current;
    if (!cv || !wrap || engRef.current) return;

    // set canvas physical pixels = container size
    cv.width  = wrap.clientWidth;
    cv.height = wrap.clientHeight;

    const eng = new CanvasEngine(cv, yShapes);
    engRef.current = eng;

    eng.onSel    = ids => setSelIds(ids);
    eng.onZoom   = z   => setZoom(z);
    eng.onCursor = c   => setCursor(c);
    eng.onTool   = t   => setToolSt(t);
    
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
      // If we are editing THIS shape and it's being resized/moved, sync EVERYTHING!
      if (editShapeRef.current?.id === s.id && 'x' in s && 'y' in s) {
        const sp = eng.worldToClient((s as any).x, (s as any).y);
        setEditBox({
          l: sp.x,
          t: sp.y,
          w: (s as any).w * eng.cam.zoom,
          h: (s as any).h * eng.cam.zoom,
        });
        internalSetEditShape(s); // Update the state object so App.tsx knows the latest FS/W/H/X/Y
      }
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

    eng.onEditText = shape => {
      eng.setEditingId(shape.id);
      const s = shape as any;
      const sp = eng.worldToClient(s.x, s.y);
      setEditBox({
        l: sp.x,
        t: sp.y,
        w: s.w * eng.cam.zoom,
        h: s.h * eng.cam.zoom,
      });
      internalSetEditShape(shape);
      setEditText(s.text || '');
    };

    // Global click listener to close popovers when hitting board/outside
    const h = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.group/pop') && !target.closest('aside')) {
        setOpenGroup(null);
      }
    };
    window.addEventListener('mousedown', h, true);

    // wheel: zoom or pan
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        eng.zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.1 : 0.9);
      } else {
        eng.panBy(e.deltaX, e.deltaY);
      }
    };
    cv.addEventListener('wheel', onWheel, {passive:false});

    // pointer events on window so drag works outside canvas
    const onMove = (e: PointerEvent) => eng.pointerMove(e);
    const onUp   = (e: PointerEvent) => { if (e.button !== 1) eng.pointerUp(); };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup',   onUp);

    // resize → update canvas size
    const ro = new ResizeObserver(() => {
      cv.width  = wrap.clientWidth;
      cv.height = wrap.clientHeight;
      eng.mark();
    });
    ro.observe(wrap);

    return () => {
      ro.disconnect();
      window.removeEventListener('mousedown', h, true);
      cv.removeEventListener('wheel', onWheel);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup',   onUp);
      eng.destroy();
      engRef.current = null;
    };
  }, []);

  // sync style options
  useEffect(() => {
    const eng = engRef.current; if (!eng) return;
    eng.style = {penColor, penSize, fill, stroke, sw, stickyBg, fontSize};
  }, [penColor, penSize, fill, stroke, sw, stickyBg, fontSize]);

  // document title
  useEffect(() => { document.title = `${boardName} — Antiwhite`; }, [boardName]);

  // re-position edit overlay when zoom changes
  useEffect(() => {
    if (!editShape || !engRef.current) return;
    const eng = engRef.current;
    const s = editShape as any;
    const sp  = eng.worldToClient(s.x, s.y);
    setEditBox({l:sp.x, t:sp.y, w:s.w*eng.cam.zoom, h:s.h*eng.cam.zoom});
  }, [zoom, editShape]);

  // Math Auto-Replace
  useEffect(() => {
    if (!editShape || editShape.type !== 'math' || !editText.endsWith(' ')) return;
    const parts = editText.split(/(\s+)/);
    let changed = false;
    const newParts = parts.map(p => {
      if (p.startsWith('\\')) {
        const key = p.slice(1).trim();
        if (AUTO_REPLACE[key]) { changed = true; return AUTO_REPLACE[key]; }
      }
      return p;
    });
    if (changed) setEditText(newParts.join(''));
  }, [editText, editShape]);

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement)?.tagName;
      if (tag==='INPUT'||tag==='TEXTAREA') return;
      if (editShape) { if (e.key==='Escape') commitEdit(); return; }
      const eng = engRef.current; if (!eng) return;
      
      // Arrow panning
      if (eng.sel.size === 0 && ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) {
        e.preventDefault();
        const pd = 50;
        if (e.key==='ArrowUp') eng.panBy(0, pd);
        if (e.key==='ArrowDown') eng.panBy(0, -pd);
        if (e.key==='ArrowLeft') eng.panBy(pd, 0);
        if (e.key==='ArrowRight') eng.panBy(-pd, 0);
        return;
      }

      const ctrl = e.ctrlKey||e.metaKey;
      if      (ctrl && e.key==='z')                { e.preventDefault(); eng.undo(); }
      else if (ctrl&&(e.key==='y'||e.key==='Z'))   { e.preventDefault(); eng.redo(); }
      else if (ctrl && e.key==='d')                { e.preventDefault(); eng.dupSel(); }
      else if (e.key==='Delete'||e.key==='Backspace') eng.deleteSel();
      else {
        const m: Record<string,ToolType|'img'> = {
          v:'select',h:'hand',p:'pen',e:'eraser',s:'sticky',
          t:'text',r:'rect',o:'ellipse',a:'arrow',i:'img',
        };
        const act = m[e.key.toLowerCase()];
        if (act==='img') fileRef.current?.click();
        else if (act) setTool(act);
        else if (e.key==='Escape') {
          eng.sel.clear(); setSelIds([]); eng.mark();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editShape, setTool]);

  const commitEdit = useCallback(() => {
    if (!editShape) return;
    const eng = engRef.current;
    if (!eng) return;
    
    eng.setEditingId(null);
    if (editText.trim() === '') {
      eng.deleteShape(editShape.id);
    } else {
      eng.updateText(editShape.id, editText);
    }
    internalSetEditShape(null);
  }, [editShape, editText]);

  // image: capture cursor position at click, then open file dialog
  const onImageToolClick = (e: React.MouseEvent) => {
    imgPosRef.current = {x: e.clientX, y: e.clientY};
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

  const zoomBy    = (d: number) => { const e=engRef.current; if(!e) return; e.setCamera(e.cam.x,e.cam.y,Math.max(.04,Math.min(16,e.cam.zoom+d))); };
  const resetZoom = () => engRef.current?.setCamera(0,0,1);

  return (
    <div className="w-screen h-screen flex flex-col overflow-hidden select-none"
         style={{fontFamily:"'Inter','Segoe UI',system-ui,sans-serif",background:'#f8f8f5'}}>

      {/* ══ TOPBAR ══════════════════════════════════════════════════════════ */}
      <header style={{background:'linear-gradient(180deg,#1e2235,#1a1d2e)',height:48,flexShrink:0}}
              className="flex items-center px-3 gap-2 z-50 border-b border-white/[.06] shadow-[0_1px_16px_rgba(0,0,0,.4)]">
        <div className="flex items-center gap-2 pr-3 border-r border-white/[.12] shrink-0 cursor-pointer">
          <svg width="26" height="26" viewBox="0 0 28 28"><rect width="28" height="28" rx="6" fill="#F2A310"/><path d="M7 20l7-12 7 12h-2.5l-1.5-3h-6l-1.5 3H7zm4-5h6l-3-6-3 6z" fill="#111"/></svg>
          <span className="text-white font-bold text-[17px] tracking-[-0.4px]">antiwhite</span>
        </div>

        <div className="flex items-center gap-1 min-w-0">
          <span className="text-white/35 text-[13px] shrink-0">Boards /</span>
          {editName ? (
            <input ref={nameRef} value={boardName}
              onChange={e=>setBoardName(e.target.value||'Untitled')}
              onBlur={()=>setEditName(false)}
              onKeyDown={e=>{if(e.key==='Enter'||e.key==='Escape'){e.preventDefault();setEditName(false);}}}
              className="text-white text-[13px] font-semibold bg-white/10 border border-white/25 rounded-md px-2 py-0.5 outline-none min-w-[100px] max-w-[220px]"
              autoFocus/>
          ) : (
            <button onClick={()=>{setEditName(true);setTimeout(()=>nameRef.current?.select(),15);}}
              className="flex items-center gap-1 text-white text-[13px] font-semibold px-2 py-0.5 rounded-md hover:bg-white/10 transition-colors group/n">
              <span className="truncate max-w-[180px]">{boardName}</span>
              <ChevronDown size={12} className="text-white/35 group-hover/n:text-white/60 shrink-0"/>
            </button>
          )}
        </div>

        <div className="flex-1"/>

        <div className="flex items-center gap-0.5 shrink-0">
          <div className="flex -space-x-1.5 mr-2">
            {['#6366f1','#22c55e','#f97316'].map((c,i)=>(
              <div key={i} className="w-7 h-7 rounded-full border-2 border-[#1a1d2e] flex items-center justify-center text-[10px] font-bold text-white"
                   style={{background:c,zIndex:3-i}}>{String.fromCharCode(65+i)}</div>
            ))}
          </div>
          <button className="flex items-center gap-1.5 px-3 h-8 rounded-lg border border-white/[.18] text-white/70 hover:text-white hover:bg-white/[.09] text-[12px] font-medium transition-all">
            <Play size={11} strokeWidth={2.5} className="fill-current"/> Present
          </button>
          <button className="flex items-center gap-1.5 px-3.5 h-8 rounded-lg text-[#111] text-[12px] font-bold ml-1"
                  style={{background:'#F2A310'}}
                  onMouseEnter={e=>(e.currentTarget.style.background='#f5b820')}
                  onMouseLeave={e=>(e.currentTarget.style.background='#F2A310')}>
            <Share2 size={12} strokeWidth={2.5}/> Share
          </button>
          <div className="w-8 h-8 rounded-full ml-2 bg-gradient-to-br from-violet-500 to-sky-400 flex items-center justify-center text-[11px] font-bold text-white border-2 border-[#1a1d2e] cursor-pointer shrink-0">U</div>
        </div>
      </header>

      {/* ══ BODY ════════════════════════════════════════════════════════════ */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* SIDEBAR */}
        <aside style={{background:'linear-gradient(180deg,#1e2235,#1a1d2e)',width:56,flexShrink:0}}
               className="flex flex-col items-center py-2 z-50 border-r border-white/[.06] shadow-[2px_0_12px_rgba(0,0,0,.2)] overflow-visible relative">
          <div className="flex flex-col items-center gap-0.5 w-full px-2">
            {/* SELECT GROUP */}
            <div className="relative group/pop w-full flex justify-center">
              <SideBtn label="Select Tools" active={['select','lasso-select'].includes(tool)} 
                       onClick={()=>{ const next = openGroup==='select'?null:'select'; setOpenGroup(next); if(next) setTool(lastSelectTool, true); }}>
                {(() => {
                  const active = ['select','lasso-select'].includes(tool) ? tool : lastSelectTool;
                  const entry = SELECT_TOOLS.find(t=>t.id===active);
                  return entry ? <entry.Icon size={17}/> : <MousePointer2 size={17}/>;
                })()}
              </SideBtn>
              {openGroup==='select' && (
                <div className="absolute left-full ml-2 top-0 bg-white p-2 rounded-xl shadow-2xl border border-gray-100 z-[100] flex flex-col gap-1 w-48">
                  {SELECT_TOOLS.map(t => (
                    <PopoverItem key={t.id} active={(tool==='select'||tool==='lasso-select') ? tool===t.id : lastSelectTool===t.id} Icon={t.Icon} label={t.label} onClick={()=>{setTool(t.id);}} />
                  ))}
                </div>
              )}
            </div>

            <SideBtn label="Hand (H)" active={tool==='hand'} onClick={()=>setTool('hand')}><Hand size={17}/></SideBtn>
            <div className="w-7 h-px bg-white/10 my-1.5"/>
            <SideBtn label="Pen (P)" active={tool==='pen'} onClick={()=>setTool('pen')}><PenLine size={17}/></SideBtn>
            
            {/* ERASER GROUP */}
            <div className="relative group/pop w-full flex justify-center">
              <SideBtn label="Eraser Tools" active={['eraser','eraser-stroke'].includes(tool)} 
                       onClick={()=>{ const next = openGroup==='eraser'?null:'eraser'; setOpenGroup(next); if(next) setTool(lastEraserTool, true); }}>
                {(() => {
                  const active = ['eraser','eraser-stroke'].includes(tool) ? tool : lastEraserTool;
                  const entry = ERASER_TOOLS.find(t=>t.id===active);
                  return entry ? <entry.Icon size={17}/> : <Eraser size={17}/>;
                })()}
              </SideBtn>
              {openGroup==='eraser' && (
                <div className="absolute left-full ml-2 top-0 bg-white p-2 rounded-xl shadow-2xl border border-gray-100 z-[100] flex flex-col gap-1 w-48">
                  {ERASER_TOOLS.map(t => (
                    <PopoverItem key={t.id} active={(tool==='eraser'||tool==='eraser-stroke') ? tool===t.id : lastEraserTool===t.id} Icon={t.Icon} label={t.label} onClick={()=>{setTool(t.id);}} />
                  ))}
                </div>
              )}
            </div>
            <div className="w-7 h-px bg-white/10 my-1.5"/>
            <SideBtn label="Sticky (S)" active={tool==='sticky'} onClick={()=>setTool('sticky')}><StickyNote size={17}/></SideBtn>
            
            {/* TEXT GROUP */}
            <div className="relative group/pop w-full flex justify-center">
              <SideBtn label="Text Tools" active={['text','math','code'].includes(tool)} 
                       onClick={()=>{ const next = openGroup==='text'?null:'text'; setOpenGroup(next); if(next) setTool(lastTextTool, true); }}>
                {(() => {
                  const active = ['text','math','code'].includes(tool) ? tool : lastTextTool;
                  if (active === 'math') return <Calculator size={17}/>;
                  if (active === 'code') return <Code size={17}/>;
                  return <Type size={17}/>;
                })()}
              </SideBtn>
              {openGroup==='text' && (
                <div className="absolute left-full ml-2 top-0 bg-white p-2 rounded-xl shadow-2xl border border-gray-100 z-[100] flex flex-col gap-1 w-48">
                  {TEXT_TOOLS.map(t => (
                    <PopoverItem key={t.id} active={['text','math','code'].includes(tool) ? tool===t.id : lastTextTool===t.id} Icon={t.Icon} label={t.label} onClick={()=>{setTool(t.id);}} />
                  ))}
                </div>
              )}
            </div>

            {/* SHAPES GROUP */}
            <div className="relative group/pop w-full flex justify-center">
              <SideBtn label="Shapes" active={SHAPE_TOOLS.some(s=>s.id===tool)} 
                       onClick={()=>{ const next = openGroup==='shapes'?null:'shapes'; setOpenGroup(next); if(next) setTool(lastShapeTool, true); }}>
                {(() => {
                   const active = SHAPE_TOOLS.some(s=>s.id===tool) ? tool : lastShapeTool;
                   const entry = SHAPE_TOOLS.find(s=>s.id===active);
                   return entry ? React.createElement(entry.Icon, {size:17}) : <Square size={17}/>;
                })()}
              </SideBtn>
              {openGroup==='shapes' && (
                <div className="absolute left-full ml-2 top-0 bg-white p-2 rounded-xl shadow-2xl border border-gray-100 z-[100] w-64">
                   <div className="grid grid-cols-4 gap-1 mb-2">
                    {SHAPE_TOOLS.map(t => (
                      <PopoverItem key={t.id} active={SHAPE_TOOLS.some(s=>s.id===tool) ? tool===t.id : lastShapeTool===t.id} Icon={t.Icon} label={t.label} grid onClick={()=>{setTool(t.id);}} />
                    ))}
                  </div>
                  <button className="w-full py-2 text-[11px] font-bold text-blue-600 hover:bg-blue-50 rounded-lg border border-blue-100 transition-colors uppercase tracking-wider">
                    More Shapes
                  </button>
                </div>
              )}
            </div>

            <div className="w-7 h-px bg-white/10 my-1.5"/>
            <SideBtn label="Image (I)" onClick={onImageToolClick}>
              <ImageIcon size={17}/>
            </SideBtn>
          </div>
          <div className="mt-auto flex flex-col items-center gap-0.5 w-full px-2 pb-1">
            <div className="w-7 h-px bg-white/10 mb-1.5"/>
            <SideBtn label="Colors & Styles" active={panelOpen} onClick={()=>setPanelOpen(v=>!v)}>
              <div className="w-5 h-5 rounded-full border-2 border-white/30 overflow-hidden">
                <div className="w-full h-full rounded-full" style={{background:penColor}}/>
              </div>
            </SideBtn>
            <SideBtn label="Undo (Ctrl+Z)" onClick={()=>engRef.current?.undo()}><Undo2 size={16} strokeWidth={1.8}/></SideBtn>
            <SideBtn label="Redo (Ctrl+Y)" onClick={()=>engRef.current?.redo()}><Redo2 size={16} strokeWidth={1.8}/></SideBtn>
          </div>
        </aside>

        {/* CANVAS AREA */}
        <div ref={wrapRef} className="relative flex-1 min-w-0 min-h-0 overflow-hidden"
          onPointerDown={e => {
            const eng = engRef.current; if (!eng) return;
            // 1. Image tool bypass
            if (tool === 'image') {
              imgPosRef.current = {x:e.clientX, y:e.clientY};
              fileRef.current?.click();
              return;
            }
            // 2. Intercept DOM scrollbar clicks for sticky notes to allow native scrolling explicitly
            const target = e.target as HTMLElement;
            const sticky = target.closest('[id^="ol_"]');
            if (sticky && (sticky as HTMLElement).scrollHeight > (sticky as HTMLElement).clientHeight) {
              const rect = sticky.getBoundingClientRect();
              // If click is on the right-hand scrollbar gutter, we let browser handle it (no select/drag)
              if (e.clientX >= rect.right - 20) return;
            }
            // 3. Normal engine pointer down
            eng.pointerDown(e.nativeEvent);
          }}
          onPointerMove={e => engRef.current?.pointerMove(e.nativeEvent)}
          onPointerUp={() => engRef.current?.pointerUp()}
          onDoubleClick={e => engRef.current?.doubleClick(e.nativeEvent)}
          onContextMenu={e => e.preventDefault()}
        >
          <canvas
            ref={canvasRef}
            style={{cursor, position:'absolute', inset:0, width:'100%', height:'100%', display:'block', touchAction:'none'}}
          />

          {/* Text / sticky edit overlay */}
          {editShape && (
            <div style={{
              position:'fixed', zIndex:530, /* above overlays but maybe below topbar? Topbar is 50, but overlays are inside container */
              left:editBox.l, top:editBox.t,
            }}>
              {/* Math Realtime Preview */}
              {editShape.type === 'math' && (
                <div className="mb-2 p-3 bg-white border border-gray-200 shadow-lg rounded-xl flex items-center justify-center overflow-auto min-h-[40px]"
                     dangerouslySetInnerHTML={{
                       __html: window.katex ? window.katex.renderToString(editText || ' ', {throwOnError:false, displayMode:true}) : editText
                     }}
                />
              )}

              <div className="relative group/editbox" style={{
                  width: editBox.w, height: editBox.h,
                  boxSizing: 'border-box',
                  boxShadow: editShape.type==='sticky' ? '0 12px 48px rgba(0,0,0,0.18)' : editShape.type==='code' ? '0 12px 64px rgba(0,0,0,0.45)' : 'none',
                  borderRadius: editShape.type==='sticky' ? 3 : editShape.type==='code' ? 6 : 4,
                  overflow: 'visible',
                  background: editShape.type==='sticky' ? (editShape as StickyShape).bg : editShape.type==='code' ? '#1e1e1e' : 'transparent',
                  border: editShape.type==='code' ? '1px solid #444' : editShape.type==='sticky' ? 'none' : 'none',
                  outline: 'none',
                  outlineOffset: '-2px',
                }}>
                <div style={{
                    position: 'absolute',
                    inset: -4,
                    border: '2.5px solid #3b82f6',
                    borderRadius: 3,
                    pointerEvents: 'none',
                    zIndex: 10
                  }}>
                    {/* resize handles (simulated indicators) */}
                    {[-1,0,1].map(x=>[-1,0,1].map(y => {
                      if(x===0 && y===0) return null;
                      const L = x===-1 ? -5 : x===0 ? 'calc(50% - 5px)' : 'calc(100% - 5px)';
                      const T = y===-1 ? -5 : y===0 ? 'calc(50% - 5px)' : 'calc(100% - 5px)';
                      return <div key={`${x}${y}`} style={{ position:'absolute', left:L, top:T, width:10, height:10, background:'#fff', border:'1.5px solid #3b82f6', borderRadius:'50%' }} />;
                    }))}
                </div>
                <textarea
                  autoFocus
                  value={editText}
                  onChange={e=>{
                    const val = e.target.value;
                    setEditText(val);
                    if (engRef.current) {
                      // Prevent drag-resize text loss by updating engine map directly with typing
                      engRef.current.updateTextLive(editShape.id, val);
                    }
                    if (editShape.type !== 'sticky' && engRef.current) {
                      const s = editShape as any;
                      const font = editShape.type === 'code' ? `${Math.max(11, s.fs * zoom)}px "'JetBrains Mono',monospace"` : `${Math.max(11, s.fs * zoom)}px "'Inter','Segoe UI',sans-serif"`;
                      const m = (window as any).measureTextS(val, font, editShape.type === 'code', zoom);
                      
                      const paddingW = editShape.type === 'code' ? 62 : 40;
                      const paddingH = editShape.type === 'code' ? 24 : 40;
                      const nw = (m.w / zoom) + paddingW;
                      const nh = (m.h / zoom) + paddingH;
                      
                      setEditBox(prev => ({...prev, w: nw * zoom, h: nh * zoom}));
                      engRef.current.updateSize(editShape.id, nw, nh);
                    }
                  }}
                  onBlur={commitEdit}
                  onKeyDown={e=>{
                    if(e.key==='Escape'){e.preventDefault();commitEdit();}
                    if (editShape.type === 'math' && e.key === ' ' && !e.shiftKey) {
                      const words = (e.target as HTMLTextAreaElement).value.split(/\s+/);
                      const last = words[words.length - 1];
                      if (last && last.startsWith('\\') && AUTO_REPLACE[last.slice(1)]) {
                        e.preventDefault();
                        const newText = (e.target as HTMLTextAreaElement).value.slice(0, (e.target as HTMLTextAreaElement).value.lastIndexOf(last)) + AUTO_REPLACE[last.slice(1)] + ' ';
                        setEditText(newText);
                      }
                    }
                  }}
                  style={{
                    width: editShape.type === 'code' ? `calc(100% - ${30*zoom}px)` : '100%',
                    height: '100%',
                    marginLeft: editShape.type === 'code' ? `${30*zoom}px` : 0,
                    background: 'transparent',
                    fontSize: Math.max(11, (editShape as any).fs * zoom),
                    padding: editShape.type==='code' ? `${12*zoom}px ${16*zoom}px` : `${16*zoom}px`,
                    fontFamily: editShape.type === 'code' ? "'JetBrains Mono','Fira Code',monospace" : "'Inter','Segoe UI',sans-serif",
                    color: editShape.type === 'code' ? '#e2e8f0' : (editShape.type==='text'||editShape.type==='math' ? '#000' : 'rgba(0,0,0,0.8)'),
                    caretColor: editShape.type === 'code' ? '#fff' : '#3b82f6',
                    lineHeight:1.5, boxSizing:'border-box', resize:'none',
                    border: 'none',
                    borderRadius: 0,
                    outline:'none',
                    display: 'block',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    overflowWrap: 'break-word',
                    overflowX: 'hidden',
                    overflowY: editShape.type==='code' || editShape.type==='sticky' ? 'auto' : 'hidden',
                  }}
                />

                {/* Code Highlighter + Line Numbers */}
                {editShape.type === 'code' && (
                  <>
                    <div style={{
                      position:'absolute', left:0, top:0, bottom:0, width:30,
                      background:'#2d2d2d', borderRight:'1px solid #444',
                      display:'flex', flexDirection:'column', alignItems:'center',
                      paddingTop:12, fontSize: Math.max(9, (editShape as any).fs * zoom * 0.8),
                      fontFamily: "'JetBrains Mono',monospace", color:'#666',
                      pointerEvents:'none', userSelect:'none'
                    }}>
                      {(editText||' ').split('\n').map((_,i) => <div key={i} style={{lineHeight:1.8}}>{i+1}</div>)}
                    </div>
                    <div style={{
                      position:'absolute', inset:0, pointerEvents:'none',
                      marginLeft: 30, padding: '12px 16px',
                      fontSize: Math.max(11, (editShape as any).fs * zoom),
                      fontFamily: "'JetBrains Mono',monospace",
                      lineHeight:1.5, whiteSpace:'pre-wrap', overflow:'hidden',
                      color: '#e2e8f0',
                    }}
                    dangerouslySetInnerHTML={{
                      __html: `<pre style="margin:0; font-family:inherit;"><code class="language-javascript">${editText ? editText.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c] as string)) : ' '}</code></pre>`
                    }}
                    />
                  </>
                )}
              </div>
            </div>
          )}

          {/* Math Panel (Left) */}
          {editShape?.type === 'math' && (
            <div className="absolute left-[68px] top-1/2 -translate-y-1/2 w-80 bg-white shadow-[0_12px_60px_rgba(0,0,0,.2)] rounded-2xl border border-gray-100 z-50 overflow-hidden flex flex-col max-h-[80vh]">
              <div className="px-4 py-3 border-b border-gray-50 flex items-center justify-between bg-gray-50/50">
                <span className="text-[13px] font-semibold text-gray-800 flex items-center gap-2"><Calculator size={14} className="text-gray-500"/> Math Tools</span>
              </div>
              <div className="p-3 overflow-y-auto w-full flex-1">
                <div className="flex flex-col gap-4">
                  {Object.entries(MATH_SYMBOLS).map(([grp, syms]) => (
                    <div key={grp}>
                      <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 block mb-2">{grp}</span>
                      <div className="grid grid-cols-5 gap-1.5">
                        {syms.map(([tex, char]) => (
                          <button key={tex} onClick={(e)=>{e.stopPropagation(); setEditText(t => t + char);}}
                                  title={tex} className="h-9 flex items-center justify-center rounded-lg hover:bg-blue-50 hover:text-blue-600 text-[16px] border border-gray-100 transition-colors">
                            {char}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="p-3 bg-gray-50 text-[11px] text-gray-500 border-t border-gray-100">
                Tip: Type LaTeX like <code className="bg-white px-1 rounded border"> \alpha </code> and press Space to auto-replace.
              </div>
            </div>
          )}

          {/* Floating selection toolbar */}
          {selIds.length>0 && !editShape && (tool==='select'||tool==='lasso-select') && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-1
                            bg-white rounded-2xl shadow-[0_4px_32px_rgba(0,0,0,.14)]
                            px-3 py-1.5 border border-gray-100/80 backdrop-blur-sm">
              <span className="text-[11px] text-gray-400 font-medium pr-2 border-r border-gray-100">{selIds.length} selected</span>
              <button onClick={()=>engRef.current?.dupSel()}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] font-medium rounded-xl hover:bg-gray-50 text-gray-600 transition-colors">
                <Copy size={12}/> Duplicate
              </button>
              <button onClick={()=>{const ids=[...engRef.current!.sel];engRef.current?.updateStyle(ids,{fill,stroke,sw});}}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] font-medium rounded-xl hover:bg-gray-50 text-gray-600 transition-colors">
                <Palette size={12}/> Style
              </button>
              <div className="w-px h-4 bg-gray-100"/>
              <button onClick={()=>engRef.current?.deleteSel()}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] font-medium rounded-xl hover:bg-red-50 text-red-500 transition-colors">
                <Trash2 size={12}/> Delete
              </button>
            </div>
          )}

          {/* Zoom controls */}
          <div className="absolute bottom-6 right-6 z-40 flex items-center bg-white rounded-2xl shadow-[0_4px_24px_rgba(0,0,0,.12)] border border-gray-100 overflow-hidden">
            <button onClick={resetZoom} title="Reset 100%" className="w-9 h-9 flex items-center justify-center hover:bg-gray-50 text-gray-500 transition-colors border-r border-gray-100"><Maximize2 size={13}/></button>
            <button onClick={()=>zoomBy(-0.2)} title="Zoom out" className="w-9 h-9 flex items-center justify-center hover:bg-gray-50 text-gray-600 transition-colors"><ZoomOut size={14}/></button>
            <button onClick={resetZoom} className="h-9 px-2 min-w-[52px] text-[12px] font-bold text-gray-700 hover:bg-gray-50 transition-colors tabular-nums">{Math.round(zoom*100)}%</button>
            <button onClick={()=>zoomBy(0.2)} title="Zoom in" className="w-9 h-9 flex items-center justify-center hover:bg-gray-50 text-gray-600 transition-colors border-l border-gray-100"><ZoomIn size={14}/></button>
          </div>

          {/* Draggable Scrollbars */}
          <div className="absolute right-1 top-1/2 -translate-y-1/2 w-[10px] h-[100px] bg-gray-400/20 hover:bg-gray-400/40 rounded-full z-40 cursor-n-resize transition-colors"
               onMouseDown={(e) => {
                 e.stopPropagation();
                 const startY = e.clientY;
                 const startCamY = engRef.current?.cam.y || 0;
                 const h = (m: MouseEvent) => {
                   const dy = m.clientY - startY;
                   engRef.current?.setCamera(engRef.current.cam.x, startCamY + dy * 2, engRef.current.cam.zoom);
                 };
                 const u = () => { window.removeEventListener('mousemove', h); window.removeEventListener('mouseup', u); };
                 window.addEventListener('mousemove', h); window.addEventListener('mouseup', u);
               }}
          />
          <div className="absolute bottom-1 left-1/2 -translate-x-1/2 h-[10px] w-[100px] bg-gray-400/20 hover:bg-gray-400/40 rounded-full z-40 cursor-e-resize transition-colors"
               onMouseDown={(e) => {
                 e.stopPropagation();
                 const startX = e.clientX;
                 const startCamX = engRef.current?.cam.x || 0;
                 const h = (m: MouseEvent) => {
                   const dx = m.clientX - startX;
                   engRef.current?.setCamera(startCamX + dx * 2, engRef.current.cam.y, engRef.current.cam.zoom);
                 };
                 const u = () => { window.removeEventListener('mousemove', h); window.removeEventListener('mouseup', u); };
                 window.addEventListener('mousemove', h); window.addEventListener('mouseup', u);
               }}
          />

          {/* Minimized bottom-left tools */}
          <div className="absolute bottom-6 left-4 z-40 flex items-center gap-2 bg-white/90 backdrop-blur-md px-2 py-1.5 rounded-full shadow-[0_2px_16px_rgba(0,0,0,.09)] border border-gray-100/80">
             {[['Timer',Timer],['Video',Video],['Comments',MessageSquare],['More',MoreHorizontal]].map(([l,I]:any)=>(
              <button key={l} title={l} className="w-8 h-8 flex items-center justify-center rounded-full text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-all">
                <I size={16} strokeWidth={2}/>
              </button>
            ))}
          </div>

          {/* Hint bar */}
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 text-[11px] text-gray-400 bg-white/80 backdrop-blur-md px-4 py-1.5 rounded-full shadow-[0_2px_12px_rgba(0,0,0,.07)] border border-gray-100/60 whitespace-nowrap">
            <span>Scroll = pan</span><span className="w-px h-3 bg-gray-200"/><span>Ctrl+Scroll = zoom</span><span className="w-px h-3 bg-gray-200"/><span>Dbl-click = sticky</span>
          </div>
        </div>
      </div>

      {/* ══ COLOR PANEL ══════════════════════════════════════════════════════ */}
      {panelOpen && (
        <>
          <div className="fixed inset-0 z-[998]" onClick={()=>setPanelOpen(false)}/>
          <div className="fixed left-[68px] z-[999] bg-white rounded-2xl border border-gray-100 overflow-hidden"
               style={{top:'50%',transform:'translateY(-50%)',width:284,maxHeight:'82vh',boxShadow:'0 12px 60px rgba(0,0,0,.22)'}}>
            <div className="sticky top-0 bg-white z-10 flex items-center justify-between px-4 py-3 border-b border-gray-50">
              <div className="flex items-center gap-2"><Palette size={14} className="text-gray-400"/><span className="text-[13px] font-semibold text-gray-800">Colors & Styles</span></div>
              <button onClick={()=>setPanelOpen(false)} className="w-6 h-6 flex items-center justify-center rounded-md text-gray-300 hover:text-gray-600 hover:bg-gray-100"><X size={13}/></button>
            </div>
            <div className="p-4 space-y-5">
              {/* Pen */}
              <section>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Pen Color</span>
                  <span className="text-[10px] font-mono text-gray-400">{penColor}</span>
                </div>
                <div className="flex gap-1 flex-wrap mb-2">
                  {PALETTE.map(c => (
                    <button key={c} onClick={() => setPenColor(c)} className={`w-6 h-6 rounded border flex items-center justify-center ${penColor === c ? 'border-blue-500' : 'border-transparent'}`} style={{ background: c }}>{penColor === c && <Check size={10} color="#fff" />}</button>
                  ))}
                  <div className="relative">
                    <input type="color" value={penColor} onChange={e => setPenColor(e.target.value)} className="w-6 h-6 opacity-0 absolute inset-0 cursor-pointer" />
                    <button className="w-6 h-6 rounded border border-gray-300 flex items-center justify-center bg-transparent"><Palette size={12} color="#999" /></button>
                  </div>
                </div>
              </section>

              {/* Pen size */}
              <section>
                <div className="flex justify-between mb-2">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Pen Size</span>
                  <span className="text-[11px] text-gray-400">{penSize}px</span>
                </div>
                <input type="range" min={1} max={50} value={penSize} onChange={e => setPenSize(+e.target.value)} className="w-full h-1.5 accent-blue-500" />
              </section>

              {/* Font size */}
              <section>
                <div className="flex justify-between mb-2">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Font Size</span>
                  <span className="text-[11px] text-gray-400">{fontSize}px</span>
                </div>
                <input type="range" min={10} max={48} value={fontSize} onChange={e => setFontSize(+e.target.value)} className="w-full accent-blue-500 h-1.5" />
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
                    <button key={i} onClick={() => setFill(c)} className={`w-6 h-6 rounded border flex items-center justify-center ${fill === c ? 'border-blue-500' : 'border-transparent'}`} style={{ background: c }}>{fill === c && <Check size={10} color={c === '#ffffff' ? '#000' : '#fff'} />}</button>
                  ))}
                  <button onClick={() => setFill('transparent')} className={`w-6 h-6 rounded border border-dashed border-gray-300 flex items-center justify-center ${fill === 'transparent' ? 'border-blue-500 bg-gray-100' : 'bg-transparent'}`} title="Transparent"><X size={12} color="#999" /></button>
                  <div className="relative">
                    <input type="color" value={fill === 'transparent' ? '#ffffff' : fill} onChange={e => setFill(e.target.value)} className="w-6 h-6 opacity-0 absolute inset-0 cursor-pointer" />
                    <button className="w-6 h-6 rounded border border-gray-300 flex items-center justify-center bg-transparent"><Palette size={12} color="#999" /></button>
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
                    <button key={i} onClick={() => setStroke(c)} className={`w-6 h-6 rounded border flex items-center justify-center ${stroke === c ? 'border-blue-500' : 'border-transparent'}`} style={{ background: c }}>{stroke === c && <Check size={10} color={c === '#ffffff' ? '#000' : '#fff'} />}</button>
                  ))}
                  <button onClick={() => setStroke('transparent')} className={`w-6 h-6 rounded border border-dashed border-gray-300 flex items-center justify-center ${stroke === 'transparent' ? 'border-blue-500 bg-gray-100' : 'bg-transparent'}`} title="Transparent"><X size={12} color="#999" /></button>
                  <div className="relative">
                    <input type="color" value={stroke === 'transparent' ? '#ffffff' : stroke} onChange={e => setStroke(e.target.value)} className="w-6 h-6 opacity-0 absolute inset-0 cursor-pointer" />
                    <button className="w-6 h-6 rounded border border-gray-300 flex items-center justify-center bg-transparent"><Palette size={12} color="#999" /></button>
                  </div>
                </div>
                <div className="flex justify-between mb-2 mt-4">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Stroke Width</span>
                  <span className="text-[11px] text-gray-400">{sw}px</span>
                </div>
                <input type="range" min={0} max={50} value={sw} onChange={e => setSw(+e.target.value)} className="w-full h-1.5 accent-blue-500" />
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
                    <button key={c} onClick={() => setStickyBg(c)}
                      className={['w-6 h-6 rounded border flex items-center justify-center transition-all', stickyBg === c ? 'border-blue-500 scale-110' : 'border-transparent'].join(' ')}
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

      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onImageFile} />
    </div>
  );
}

