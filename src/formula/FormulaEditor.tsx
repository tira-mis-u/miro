// ─── Formula editor: rendered-equation view plus an explicit LaTeX source mode ───
import * as React from 'react';
import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react';
import type { FormulaNode } from './types';
import { parseTelex } from './parser';
import { renderFormulaToHTML } from './renderer';
import { parseRenderableFormula, resolveInitialFormulaPreview } from './validation';
import { createRow, createPlaceholder, createText } from './ast';
import { structureById } from './catalog';
import MathToolsPanel from './MathToolsPanel';
import FormulaSourceEditor, { type FormulaSourceEditorHandle } from './FormulaSourceEditor';
import { LatestPreviewGate } from './latestPreview';
import { findStructuredGridAt, serializeStructuredGrid, type StructuredGridDraft } from './structuredGrid';
import { replaceTextRange, resolveTemplateSelection } from './input';
import { parseSourceText } from '../editor/sourceText';
import './formula.css';

function safeParseFormula(source: string): FormulaNode {
  try { return parseTelex(source); }
  catch { return createRow([createText(source)]); }
}

interface FormulaEditorProps {
  initialText: string;
  initialPreviewText?: string;
  fontSize: number;
  zoom: number;
  worldX: number;
  worldY: number;
  cam: { x: number; y: number };
  view: { w: number; h: number };
  onTextChange: (text: string, lastValidPreview?: string) => void;
  onCommit: (source?: string, lastValidPreview?: string) => void;
  onASTChange?: (ast: FormulaNode) => void;
  onResize?: (w: number, h: number) => void;
  onMove?: (x: number, y: number) => void;
  clickX?: number;
  clickY?: number;
}

type FormulaEditorMode = 'rendered' | 'source';
interface PendingFormulaCommit { source: string; preview: string }

const EDITOR_TOOLBAR_HEIGHT = 44;
const SOURCE_NOTE_HEIGHT = 32;
const SOURCE_ERROR_HEIGHT = 36;
const EDITOR_BORDER_ALLOWANCE = 2;

export default function FormulaEditor({
  initialText,
  initialPreviewText,
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
  onMove,
}: FormulaEditorProps) {
  const [initialProjection] = useState(() => resolveInitialFormulaPreview(initialText, initialPreviewText, fontSize));
  const [inputText, setInputText] = useState(initialText);
  const inputTextRef = useRef(initialText);
  const [ast, setAst] = useState<FormulaNode>(() => initialProjection.ast ?? (
    initialProjection.previewText ? safeParseFormula(initialProjection.previewText) : createRow([createPlaceholder()])
  ));
  const lastValidTextRef = useRef(initialProjection.ast ? initialText : initialProjection.previewText);
  const [sourceError, setSourceError] = useState(initialProjection.sourceError);
  const refreshInitialPreviewRef = useRef(initialProjection.refreshStoredPreview);
  const [mode, setMode] = useState<FormulaEditorMode>('rendered');
  const [sourceContentHeight, setSourceContentHeight] = useState(60);
  const [toolsMaxHeight, setToolsMaxHeight] = useState<number | undefined>(undefined);
  const [workspaceSize, setWorkspaceSize] = useState({ w: view.w, h: view.h });
  const [panelPosition, setPanelPosition] = useState({ editorX: 0, editorY: 0, toolsX: 0, toolsY: 0 });
  const [isDragging, setIsDragging] = useState(false);

  const sourceEditorRef = useRef<FormulaSourceEditorHandle>(null);
  const structuredGridRangeRef = useRef<{ start: number; end: number; source: string } | null>(null);
  const editorPanelRef = useRef<HTMLDivElement>(null);
  const toolsContainerRef = useRef<HTMLDivElement>(null);
  const mathMeasureRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const previewGateRef = useRef(new LatestPreviewGate());
  const pendingCommitRef = useRef<PendingFormulaCommit | null>(null);
  const commitStartedRef = useRef(false);
  const sourceFocusOnShowRef = useRef(false);
  const dragStart = useRef({ wx: worldX, wy: worldY, mx: 0, my: 0 });
  const onTextChangeRef = useRef(onTextChange);
  const onCommitRef = useRef(onCommit);
  const onResizeRef = useRef(onResize);
  const onASTChangeRef = useRef(onASTChange);
  onTextChangeRef.current = onTextChange;
  onCommitRef.current = onCommit;
  onResizeRef.current = onResize;
  onASTChangeRef.current = onASTChange;

  const safeZoom = Math.max(0.01, zoom);
  const availableView = {
    w: workspaceSize.w > 0 ? workspaceSize.w : view.w,
    h: workspaceSize.h > 0 ? workspaceSize.h : view.h,
  };
  const screenX = (worldX - cam.x) * zoom + availableView.w / 2;
  const screenY = (worldY - cam.y) * zoom + availableView.h / 2;
  const editorWidth = Math.max(1, Math.min(560, Math.max(1, availableView.w - 24) / safeZoom));
  // Leave room beside the editor on wide workspaces, but let the palette use most of narrow viewports.
  const toolsWidth = Math.max(1, Math.min(640, availableView.w - 16, 300 + availableView.w * 0.42));
  const maxPanelHeight = Math.max(1, (availableView.h - 16) / safeZoom);
  const sourceChromeHeight = EDITOR_TOOLBAR_HEIGHT + SOURCE_NOTE_HEIGHT +
    (sourceError ? SOURCE_ERROR_HEIGHT : 0) + EDITOR_BORDER_ALLOWANCE;
  const maxSourceHeight = Math.max(1, maxPanelHeight - sourceChromeHeight);
  const previewHTML = useMemo(() => renderFormulaToHTML(ast, fontSize), [ast, fontSize]);

  const initialSourceCursor = useMemo(() => {
    const parsed = parseSourceText(initialText);
    if (clickX === undefined || clickY === undefined) return parsed.normalized.length;
    const charWidth = Math.max(4, 8 * zoom);
    const lineHeight = Math.max(12, 25.6 * zoom);
    const leftPadding = (screenX + 56 * zoom);
    const topPadding = (screenY + (EDITOR_TOOLBAR_HEIGHT + SOURCE_NOTE_HEIGHT + 8) * zoom);
    const dx = Math.max(0, clickX - leftPadding);
    const dy = Math.max(0, clickY - topPadding);
    const lines = parsed.normalized.split('\n');
    const row = Math.min(lines.length - 1, Math.floor(dy / lineHeight));
    let offset = 0;
    for (let index = 0; index < row; index++) offset += lines[index].length + 1;
    const column = Math.min(lines[row]?.length ?? 0, Math.round(dx / charWidth));
    return Math.min(parsed.normalized.length, offset + column);
  }, [initialText, clickX, clickY, screenX, screenY, zoom]);

  const onDragDown = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(true);
    dragStart.current = { wx: worldX, wy: worldY, mx: event.clientX, my: event.clientY };
  };

  useEffect(() => {
    if (!isDragging) return;
    const move = (event: MouseEvent) => {
      const dx = event.clientX - dragStart.current.mx;
      const dy = event.clientY - dragStart.current.my;
      onMove?.(dragStart.current.wx + dx / zoom, dragStart.current.wy + dy / zoom);
    };
    const up = () => setIsDragging(false);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [isDragging, onMove, zoom]);

  useEffect(() => {
    editorPanelRef.current?.focus({ preventScroll: true });
  }, []);

  useLayoutEffect(() => {
    const workspace = editorPanelRef.current?.parentElement;
    if (!workspace) return;
    const measureWorkspace = () => {
      const rect = workspace.getBoundingClientRect();
      setWorkspaceSize(current => Math.abs(current.w - rect.width) < 0.5 && Math.abs(current.h - rect.height) < 0.5
        ? current : { w: rect.width, h: rect.height });
    };
    measureWorkspace();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measureWorkspace);
      return () => window.removeEventListener('resize', measureWorkspace);
    }
    const observer = new ResizeObserver(measureWorkspace);
    observer.observe(workspace);
    return () => observer.disconnect();
  }, [view.w, view.h]);

  const updateAST = useCallback((source: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const revision = previewGateRef.current.begin();
    debounceRef.current = setTimeout(() => {
      if (!previewGateRef.current.isCurrent(revision)) return;
      const candidate = parseRenderableFormula(source, fontSize);
      if (!previewGateRef.current.isCurrent(revision)) return;
      if (candidate) {
        setAst(candidate);
        setSourceError(false);
        lastValidTextRef.current = source;
        onTextChangeRef.current(source, source);
        onASTChangeRef.current?.(candidate);
      } else {
        setSourceError(true);
        onTextChangeRef.current(source, lastValidTextRef.current);
      }
    }, 30);
  }, [fontSize]);

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    previewGateRef.current.invalidate();
  }, []);

  useEffect(() => {
    if (!refreshInitialPreviewRef.current) return;
    refreshInitialPreviewRef.current = false;
    onTextChangeRef.current(initialText, initialText);
  }, [initialText]);

  const handleSourceChange = useCallback((source: string) => {
    inputTextRef.current = source;
    setInputText(source);
    // The authoritative source is written immediately; only the derived KaTeX validation is coalesced.
    onTextChangeRef.current(source, lastValidTextRef.current);
    updateAST(source);
  }, [updateAST]);

  const requestSourceMode = useCallback((focus = true) => {
    if (mode === 'source') {
      sourceFocusOnShowRef.current = false;
      if (focus) {
        sourceEditorRef.current?.requestMeasure();
        sourceEditorRef.current?.focus();
      }
      return;
    }
    sourceFocusOnShowRef.current = focus;
    setMode('source');
  }, [mode]);

  const showRenderedEquation = useCallback(() => {
    const source = sourceEditorRef.current?.getText() ?? inputTextRef.current;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    previewGateRef.current.invalidate();
    const candidate = parseRenderableFormula(source, fontSize);
    let preview = lastValidTextRef.current;
    if (candidate) {
      setAst(candidate);
      setSourceError(false);
      lastValidTextRef.current = source;
      preview = source;
      onASTChangeRef.current?.(candidate);
    } else {
      setSourceError(true);
    }
    onTextChangeRef.current(source, preview);
    setMode('rendered');
  }, [fontSize]);

  const measureRenderedEquation = useCallback(() => {
    const measured = mathMeasureRef.current?.getBoundingClientRect();
    return {
      width: Math.max(48, (measured?.width ?? 0) + 32),
      height: Math.max(36, (measured?.height ?? 0) + 32),
    };
  }, []);

  const commitDraft = useCallback(() => {
    if (commitStartedRef.current || pendingCommitRef.current) return;
    commitStartedRef.current = true;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    previewGateRef.current.invalidate();
    const source = sourceEditorRef.current?.getText() ?? inputTextRef.current;
    const candidate = parseRenderableFormula(source, fontSize);
    let preview = lastValidTextRef.current;
    if (candidate) {
      setAst(candidate);
      setSourceError(false);
      lastValidTextRef.current = source;
      preview = source;
      onASTChangeRef.current?.(candidate);
    } else {
      setSourceError(true);
    }
    inputTextRef.current = source;
    setInputText(source);
    onTextChangeRef.current(source, preview);

    if (mode === 'source') {
      pendingCommitRef.current = { source, preview };
      setMode('rendered');
      return;
    }

    const measured = measureRenderedEquation();
    onResizeRef.current?.(measured.width, measured.height);
    onCommitRef.current(source, preview);
  }, [fontSize, measureRenderedEquation, mode]);

  useLayoutEffect(() => {
    if (mode !== 'source' || !sourceFocusOnShowRef.current) return;
    sourceFocusOnShowRef.current = false;
    sourceEditorRef.current?.requestMeasure();
    sourceEditorRef.current?.focus();
  }, [mode]);

  useLayoutEffect(() => {
    if (mode !== 'source') return;
    const chrome = EDITOR_TOOLBAR_HEIGHT + SOURCE_NOTE_HEIGHT +
      (sourceError ? SOURCE_ERROR_HEIGHT : 0) + EDITOR_BORDER_ALLOWANCE;
    onResizeRef.current?.(editorWidth, chrome + sourceContentHeight);
  }, [mode, sourceContentHeight, sourceError, editorWidth]);

  useLayoutEffect(() => {
    if (mode !== 'rendered') return;
    const measured = measureRenderedEquation();
    onResizeRef.current?.(measured.width, measured.height);
    if (pendingCommitRef.current) {
      const pending = pendingCommitRef.current;
      pendingCommitRef.current = null;
      onCommitRef.current(pending.source, pending.preview);
    }
  }, [mode, previewHTML, measureRenderedEquation]);

  const insertSymbol = useCallback((symbol: string) => {
    const editor = sourceEditorRef.current;
    if (!editor) return;
    const source = parseSourceText(editor.getText()).normalized;
    const { from, to } = editor.getSelection();
    const insertion = parseSourceText(symbol).normalized;
    structuredGridRangeRef.current = null;
    const replacement = replaceTextRange(source, from, to, insertion);
    editor.replaceRange(from, to, insertion, replacement.selectionStart, replacement.selectionEnd);
    inputTextRef.current = editor.getText();
    setInputText(inputTextRef.current);
    requestSourceMode(true);
  }, [requestSourceMode]);

  const insertStructure = useCallback((type: string) => {
    const structure = structureById(type);
    const editor = sourceEditorRef.current;
    if (!structure || !editor) return;
    const { from, to } = editor.getSelection();
    const insertion = parseSourceText(structure.insertion).normalized;
    structuredGridRangeRef.current = null;
    const selection = resolveTemplateSelection(insertion, from, structure.focusPlaceholder);
    editor.replaceRange(from, to, insertion, selection.selectionStart, selection.selectionEnd);
    inputTextRef.current = editor.getText();
    setInputText(inputTextRef.current);
    requestSourceMode(true);
  }, [requestSourceMode]);

  const loadStructuredGrid = useCallback((): StructuredGridDraft | null => {
    const editor = sourceEditorRef.current;
    if (!editor) return null;
    const source = parseSourceText(editor.getText()).normalized;
    const { from, to } = editor.getSelection();
    const span = findStructuredGridAt(source, from, to);
    if (!span) return null;
    structuredGridRangeRef.current = { start: span.start, end: span.end, source: source.slice(span.start, span.end) };
    return span.draft;
  }, []);

  const insertStructuredGrid = useCallback((draft: StructuredGridDraft) => {
    const editor = sourceEditorRef.current;
    if (!editor) return;
    const source = parseSourceText(editor.getText()).normalized;
    const loaded = structuredGridRangeRef.current;
    const rangeIsCurrent = !!loaded && source.slice(loaded.start, loaded.end) === loaded.source;
    const selection = editor.getSelection();
    const start = rangeIsCurrent ? loaded.start : selection.from;
    const end = rangeIsCurrent ? loaded.end : selection.to;
    const insertion = serializeStructuredGrid(draft);
    const replacement = replaceTextRange(source, start, end, insertion);
    structuredGridRangeRef.current = null;
    const emptyCellOffset = insertion.indexOf('\\square');
    const cursorStart = emptyCellOffset >= 0 ? start + emptyCellOffset : replacement.selectionStart;
    const cursorEnd = emptyCellOffset >= 0 ? cursorStart + '\\square'.length : cursorStart;
    editor.replaceRange(start, end, insertion, cursorStart, cursorEnd);
    inputTextRef.current = editor.getText();
    setInputText(inputTextRef.current);
    requestSourceMode(true);
  }, [requestSourceMode]);

  const repositionPanels = useCallback(() => {
    const editor = editorPanelRef.current;
    const tools = toolsContainerRef.current;
    const workspace = editor?.parentElement;
    if (!editor || !tools || !workspace) return;
    const workspaceRect = workspace.getBoundingClientRect();
    const editorRect = editor.getBoundingClientRect();
    const toolsWrapperRect = tools.getBoundingClientRect();
    const toolsSurface = tools.querySelector('.math-tools-panel') as HTMLDivElement | null;
    const toolsRect = toolsSurface?.getBoundingClientRect() ?? toolsWrapperRect;
    const toolsOffsetX = toolsRect.left - toolsWrapperRect.left;
    const toolsOffsetY = toolsRect.top - toolsWrapperRect.top;
    const margin = 8;
    const gap = 8;
    const clamp = (value: number, max: number) => Math.min(Math.max(value, margin), Math.max(margin, max - margin));

    const editorX = clamp(screenX, workspaceRect.width - editorRect.width);
    let editorY = clamp(screenY, workspaceRect.height - editorRect.height);
    const maxToolsX = workspaceRect.width - toolsRect.width;
    const maxToolsY = workspaceRect.height - toolsRect.height;
    const leftX = editorX - toolsRect.width - gap;
    const rightFits = editorX + editorRect.width + gap + toolsRect.width <= workspaceRect.width - margin;
    const leftFits = leftX >= margin;
    const stackHeightLimit = Math.max(1, workspaceRect.height - margin * 2 - editorRect.height - gap);
    const requestedToolsMaxHeight = !rightFits && !leftFits ? stackHeightLimit : undefined;
    setToolsMaxHeight(current => current === requestedToolsMaxHeight ||
      (current !== undefined && requestedToolsMaxHeight !== undefined && Math.abs(current - requestedToolsMaxHeight) < 0.5)
      ? current : requestedToolsMaxHeight);

    let toolsX = editorX + editorRect.width + gap;
    let toolsY = editorY;

    if (toolsX + toolsRect.width > workspaceRect.width - margin) {
      if (leftX >= margin) {
        toolsX = leftX;
      } else {
        toolsX = clamp(editorX, maxToolsX);
        const stackedHeight = editorRect.height + gap + toolsRect.height;
        if (stackedHeight <= workspaceRect.height - margin * 2) {
          const clampRange = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));
          const belowEditorY = clampRange(screenY, margin, workspaceRect.height - margin - stackedHeight);
          const aboveEditorY = clampRange(screenY, margin + toolsRect.height + gap, workspaceRect.height - editorRect.height - margin);
          if (Math.abs(belowEditorY - screenY) <= Math.abs(aboveEditorY - screenY)) {
            editorY = belowEditorY;
            toolsY = editorY + editorRect.height + gap;
          } else {
            editorY = aboveEditorY;
            toolsY = editorY - toolsRect.height - gap;
          }
        } else {
          toolsY = clamp(editorY + editorRect.height + gap, maxToolsY);
        }
      }
    }

    toolsX = clamp(toolsX, maxToolsX);
    toolsY = clamp(toolsY, maxToolsY);
    const toolsWrapperX = toolsX - toolsOffsetX;
    const toolsWrapperY = toolsY - toolsOffsetY;
    setPanelPosition(current => {
      if (Math.abs(current.editorX - editorX) < 0.5 && Math.abs(current.editorY - editorY) < 0.5 &&
          Math.abs(current.toolsX - toolsWrapperX) < 0.5 && Math.abs(current.toolsY - toolsWrapperY) < 0.5) return current;
      return { editorX, editorY, toolsX: toolsWrapperX, toolsY: toolsWrapperY };
    });
  }, [screenX, screenY]);

  useLayoutEffect(() => {
    repositionPanels();
  }, [repositionPanels, editorWidth, toolsWidth, maxPanelHeight, toolsMaxHeight, mode, sourceContentHeight, sourceError]);

  useLayoutEffect(() => {
    const editor = editorPanelRef.current;
    const tools = toolsContainerRef.current?.querySelector('.math-tools-panel');
    if (!editor || !tools || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => repositionPanels());
    observer.observe(editor);
    observer.observe(tools);
    return () => observer.disconnect();
  }, [repositionPanels]);

  const commitRef = useRef(commitDraft);
  commitRef.current = commitDraft;
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (editorPanelRef.current?.contains(target) || toolsContainerRef.current?.contains(target)) return;
      commitRef.current();
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
  }, []);

  return (
    <>
      <div
        ref={editorPanelRef}
        className="formula-editor-panel"
        tabIndex={-1}
        role="dialog"
        aria-label="Math formula editor"
        style={{
          left: panelPosition.editorX,
          top: panelPosition.editorY,
          width: editorWidth,
          maxWidth: editorWidth,
          maxHeight: maxPanelHeight,
          transform: `scale(${zoom})`,
          transformOrigin: 'top left',
          zIndex: 1001,
        }}
        onPointerDown={event => event.stopPropagation()}
        onMouseDown={event => event.stopPropagation()}
        onBlurCapture={event => {
          const target = event.relatedTarget as HTMLElement | null;
          if (target && (event.currentTarget.contains(target) || target.closest('.math-tools-panel'))) return;
          commitRef.current();
        }}
        onDoubleClick={event => {
          if (mode === 'rendered') {
            event.preventDefault();
            requestSourceMode(true);
          }
        }}
        onKeyDown={event => {
          if (event.key === 'Escape' && mode === 'rendered') {
            event.preventDefault();
            commitDraft();
          }
        }}
      >
        <div className="formula-editor-toolbar">
          <div className="formula-editor-drag-handle" onMouseDown={onDragDown} title="Drag to move this formula">
            <span className="formula-editor-drag-grip" aria-hidden="true">⠿</span>
            <span className="formula-editor-title">Math formula</span>
          </div>
          <div className="formula-editor-mode-switch" role="group" aria-label="Formula editing view">
            <button type="button" aria-pressed={mode === 'rendered'} onClick={showRenderedEquation}>Rendered</button>
            <button type="button" aria-pressed={mode === 'source'} onClick={() => requestSourceMode(true)}>Edit LaTeX</button>
          </div>
          <button type="button" className="formula-editor-done" onClick={commitDraft} aria-label="Finish editing formula" title="Finish editing">
            Done
          </button>
        </div>

        <div className="formula-editor-content">
          {mode === 'rendered' && (
            <div
              className="formula-rendered-surface"
              role="region"
              aria-label="Rendered equation, read-only"
              dangerouslySetInnerHTML={{ __html: previewHTML }}
            />
          )}
          <FormulaSourceEditor
            ref={sourceEditorRef}
            value={inputText}
            initialCursor={initialSourceCursor}
            fontSize={fontSize}
            maxHeight={maxSourceHeight}
            active={mode === 'source'}
            onChange={handleSourceChange}
            onLayout={height => setSourceContentHeight(current => current === height ? current : height)}
            onCommit={commitDraft}
          />
          {mode === 'rendered' && sourceError && (
            <div className="formula-source-status" role="status" aria-live="polite">
              Draft is incomplete or unsupported; showing the last renderable equation. The LaTeX source is preserved.
            </div>
          )}
          {mode === 'source' && sourceError && (
            <div className="formula-source-status" role="status" aria-live="polite">
              Draft is incomplete or unsupported; edit the LaTeX source or switch to the last renderable equation.
            </div>
          )}
        </div>
      </div>

      <div
        ref={toolsContainerRef}
        className="math-tools-pinned-container"
        style={{
          position: 'absolute',
          left: panelPosition.toolsX,
          top: panelPosition.toolsY,
          zIndex: 1000,
          pointerEvents: 'none',
        }}
      >
        <div style={{ pointerEvents: 'auto' }}>
          <MathToolsPanel
            onInsertSymbol={insertSymbol}
            onInsertStructure={insertStructure}
            onLoadStructuredGrid={loadStructuredGrid}
            onInsertStructuredGrid={insertStructuredGrid}
            width={toolsWidth}
            maxHeight={toolsMaxHeight}
            zoom={1}
          />
        </div>
      </div>

      {/* Offscreen KaTeX measurement is used only to fit the rendered board shape, never shown as an editor preview. */}
      <div
        ref={mathMeasureRef}
        className="formula-measurement"
        aria-hidden="true"
        style={{ fontSize }}
        dangerouslySetInnerHTML={{ __html: previewHTML }}
      />
    </>
  );
}
