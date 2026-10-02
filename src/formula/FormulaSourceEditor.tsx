import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { history, historyKeymap, defaultKeymap, invertedEffects, isolateHistory } from '@codemirror/commands';
import { EditorState, Transaction } from '@codemirror/state';
import { bracketMatching } from '@codemirror/language';
import { drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view';
import { fitSourceEditorHeight } from './sourceLayout';
import {
  createSourceTextField,
  externalSourceTextSync,
  parseSourceText,
  restoreSelectedLineEndings,
  restoreSourceLineEndings,
  setSourceTextMetadata,
  type LineSeparator,
  type ParsedSourceText,
} from '../editor/sourceText';

const SOURCE_FONT = "'JetBrains Mono', 'SFMono-Regular', Consolas, 'Liberation Mono', monospace";
const SOURCE_LINE_HEIGHT = 1.6;
const SOURCE_VERTICAL_PADDING = 9;
const MIN_SOURCE_HEIGHT = 60;

export interface FormulaSourceEditorHandle {
  getText(): string;
  getSelection(): { from: number; to: number };
  replaceRange(from: number, to: number, insertion: string, selectionStart: number, selectionEnd: number): void;
  focus(): void;
  setSelection(from: number, to?: number): void;
  requestMeasure(): void;
}

interface FormulaSourceEditorProps {
  value: string;
  initialCursor: number;
  fontSize: number;
  maxHeight: number;
  active: boolean;
  onChange: (value: string) => void;
  onLayout: (height: number) => void;
  onCommit: () => void;
}

interface SourceMeasure {
  naturalHeight: number;
  availableHeight: number;
  lineHeight: number;
}

const sourceEditorTheme = EditorView.theme({
  '&': {
    height: 'auto',
    color: '#192536',
    backgroundColor: '#fff',
    fontSize: 'var(--formula-source-font-size, 15px)',
  },
  '.cm-scroller': {
    height: '100%',
    overflowX: 'hidden',
    overflowY: 'hidden',
    padding: `${SOURCE_VERTICAL_PADDING}px 0`,
    fontFamily: SOURCE_FONT,
    lineHeight: String(SOURCE_LINE_HEIGHT),
    whiteSpace: 'pre-wrap',
    cursor: 'var(--aw-cursor-text, text)',
  },
  '.cm-content': {
    minHeight: '100%',
    padding: '0 12px',
    lineHeight: String(SOURCE_LINE_HEIGHT),
    whiteSpace: 'pre-wrap',
    userSelect: 'text',
    WebkitUserSelect: 'text',
    caretColor: '#2563eb',
  },
  '.cm-line': { lineHeight: String(SOURCE_LINE_HEIGHT), padding: '0' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#2563eb' },
  '.cm-gutters': {
    color: '#758398',
    backgroundColor: '#f6f8fb',
    borderRight: '1px solid #e2e8f0',
    lineHeight: String(SOURCE_LINE_HEIGHT),
  },
  '.cm-gutterElement': { lineHeight: String(SOURCE_LINE_HEIGHT), fontFamily: SOURCE_FONT, fontSize: 'inherit' },
  '.cm-lineNumbers .cm-gutterElement': { minWidth: '2.8em', padding: '0 9px 0 5px' },
  '.cm-activeLine': { backgroundColor: 'rgba(59,130,246,.035)' },
  '.cm-activeLineGutter': { color: '#334155', backgroundColor: 'rgba(59,130,246,.05)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'rgba(59,130,246,.28) !important',
  },
  '.cm-matchingBracket': {
    color: '#172033 !important',
    backgroundColor: 'rgba(59,130,246,.14)',
    outline: '1px solid rgba(59,130,246,.55)',
  },
}, { dark: false });

function safeFontSize(value: number): number {
  return Math.max(12, Math.min(26, Number.isFinite(value) ? value : 16));
}

function safeHeight(value: number): number {
  return Math.max(1, Number.isFinite(value) ? value : 1);
}

const FormulaSourceEditor = forwardRef<FormulaSourceEditorHandle, FormulaSourceEditorProps>(function FormulaSourceEditor({
  value,
  initialCursor,
  fontSize,
  maxHeight,
  active,
  onChange,
  onLayout,
  onCommit,
}, forwardedRef) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const metadataRef = useRef<ParsedSourceText>(parseSourceText(value));
  const initialSourceRef = useRef<ParsedSourceText>(parseSourceText(value));
  const valueRef = useRef(value);
  const pendingInsertedSeparatorsRef = useRef<LineSeparator[]>([]);
  const sourceMetadataFieldRef = useRef<ReturnType<typeof createSourceTextField> | null>(null);
  if (!sourceMetadataFieldRef.current) {
    sourceMetadataFieldRef.current = createSourceTextField(initialSourceRef, pendingInsertedSeparatorsRef);
  }
  const activeRef = useRef(active);
  const maxHeightRef = useRef(maxHeight);
  const changeRef = useRef(onChange);
  const layoutRef = useRef(onLayout);
  const commitRef = useRef(onCommit);
  const fontSizeRef = useRef(fontSize);
  const lastReportedHeightRef = useRef<number | null>(null);
  const lastHostWidthRef = useRef(0);
  const measureKeyRef = useRef({});

  activeRef.current = active;
  maxHeightRef.current = maxHeight;
  changeRef.current = onChange;
  layoutRef.current = onLayout;
  commitRef.current = onCommit;
  fontSizeRef.current = fontSize;
  valueRef.current = value;

  const scheduleLayout = (view: EditorView) => {
    if (!activeRef.current || viewRef.current !== view) return;
    view.requestMeasure({
      key: measureKeyRef.current,
      read: currentView => {
        const bounds = currentView.dom.getBoundingClientRect();
        const lineHeight = currentView.defaultLineHeight || safeFontSize(fontSizeRef.current) * SOURCE_LINE_HEIGHT;
        const scrollerStyle = window.getComputedStyle(currentView.scrollDOM);
        const number = (value: string | null) => {
          const parsed = Number.parseFloat(value ?? '');
          return Number.isFinite(parsed) ? parsed : SOURCE_VERTICAL_PADDING;
        };
        const paddingTop = number(scrollerStyle.paddingTop);
        const paddingBottom = number(scrollerStyle.paddingBottom);
        const contentHeight = Math.max(lineHeight, currentView.contentHeight);
        const naturalHeight = Math.ceil(contentHeight + paddingTop + paddingBottom);
        return {
          naturalHeight,
          availableHeight: safeHeight(maxHeightRef.current),
          lineHeight,
          visibleWidth: bounds.width,
        } satisfies SourceMeasure & { visibleWidth: number };
      },
      write: (measure, currentView) => {
        if (!activeRef.current || measure.visibleWidth <= 0 || viewRef.current !== currentView) return;
        const fit = fitSourceEditorHeight(measure.naturalHeight, measure.availableHeight, MIN_SOURCE_HEIGHT);
        const height = fit.height;
        const needsScroll = fit.needsVerticalScroll;
        const heightValue = `${height}px`;
        if (currentView.dom.style.height !== heightValue) currentView.dom.style.height = heightValue;
        currentView.scrollDOM.style.overflowY = needsScroll ? 'auto' : 'hidden';
        currentView.scrollDOM.style.overflowX = 'hidden';
        currentView.scrollDOM.style.maxHeight = heightValue;
        if (!needsScroll && currentView.scrollDOM.scrollTop !== 0) currentView.scrollDOM.scrollTop = 0;
        if (lastReportedHeightRef.current !== height) {
          lastReportedHeightRef.current = height;
          layoutRef.current(height);
        }
      },
    });
  };

  useImperativeHandle(forwardedRef, () => ({
    getText() {
      const view = viewRef.current;
      if (!view) return valueRef.current;
      const metadata = metadataRef.current;
      return restoreSourceLineEndings(view.state.doc.toString(), metadata.separators, metadata.preferredSeparator);
    },
    getSelection() {
      const selection = viewRef.current?.state.selection.main;
      return selection ? { from: selection.from, to: selection.to } : { from: 0, to: 0 };
    },
    replaceRange(from, to, insertion, selectionStart, selectionEnd) {
      const view = viewRef.current;
      if (!view) return;
      const parsed = parseSourceText(insertion);
      pendingInsertedSeparatorsRef.current = parsed.separators;
      view.dispatch({
        changes: { from, to, insert: parsed.normalized },
        selection: { anchor: selectionStart, head: selectionEnd },
        scrollIntoView: true,
        userEvent: 'input.type',
        annotations: isolateHistory.of('full'),
      });
    },
    focus() { viewRef.current?.focus(); },
    setSelection(from, to = from) {
      const view = viewRef.current;
      if (!view) return;
      const safeFrom = Math.max(0, Math.min(view.state.doc.length, from));
      const safeTo = Math.max(safeFrom, Math.min(view.state.doc.length, to));
      view.dispatch({ selection: { anchor: safeFrom, head: safeTo }, scrollIntoView: true });
    },
    requestMeasure() {
      const view = viewRef.current;
      if (view) scheduleLayout(view);
    },
  }), []);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const initial = parseSourceText(valueRef.current);
    metadataRef.current = initial;
    initialSourceRef.current = initial;
    const start = Math.max(0, Math.min(initial.normalized.length, initialCursor));
    const sourceMetadataField = sourceMetadataFieldRef.current!;
    const state = EditorState.create({
      doc: initial.normalized,
      selection: { anchor: start },
      extensions: [
        EditorView.contentAttributes.of({ 'aria-label': 'LaTeX source', spellcheck: 'false' }),
        lineNumbers(),
        EditorView.lineWrapping,
        highlightActiveLineGutter(),
        highlightActiveLine(),
        history(),
        drawSelection(),
        bracketMatching(),
        closeBrackets(),
        sourceEditorTheme,
        EditorView.clipboardInputFilter.of(text => {
          const parsed = parseSourceText(text);
          pendingInsertedSeparatorsRef.current = parsed.separators;
          return parsed.normalized;
        }),
        EditorView.clipboardOutputFilter.of((text, clipboardState) => {
          const selection = clipboardState.selection.main;
          const metadata = clipboardState.field(sourceMetadataField);
          if (clipboardState.selection.ranges.length > 1) {
            return restoreSourceLineEndings(text, [], metadata.preferredSeparator);
          }
          return restoreSelectedLineEndings(
            text,
            clipboardState.doc.toString(),
            selection.from,
            metadata.separators,
            metadata.preferredSeparator,
          );
        }),
        sourceMetadataField,
        invertedEffects.of(transaction => {
          if (!transaction.docChanged || transaction.annotation(externalSourceTextSync)) return [];
          const previous = transaction.startState.field(sourceMetadataField, false);
          return previous ? [setSourceTextMetadata.of(previous)] : [];
        }),
        keymap.of([
          ...closeBracketsKeymap,
          ...historyKeymap,
          { key: 'Escape', run: () => { commitRef.current(); return true; } },
          ...defaultKeymap,
        ]),
        EditorView.updateListener.of(update => {
          if (!update.docChanged) {
            if (update.transactions.some(transaction => transaction.isUserEvent('input.paste'))) {
              pendingInsertedSeparatorsRef.current = [];
            }
            return;
          }
          const metadata = update.state.field(sourceMetadataField);
          metadataRef.current = metadata;
          const external = update.transactions.some(transaction => transaction.annotation(externalSourceTextSync));
          if (!external) {
            changeRef.current(restoreSourceLineEndings(metadata.normalized, metadata.separators, metadata.preferredSeparator));
          }
          pendingInsertedSeparatorsRef.current = [];
          scheduleLayout(update.view);
        }),
      ],
    });

    const view = new EditorView({ state, parent: host });
    view.dom.style.setProperty('--formula-source-font-size', `${safeFontSize(fontSizeRef.current)}px`);
    viewRef.current = view;

    const observer = new ResizeObserver(entries => {
      const width = entries[0]?.contentRect.width ?? 0;
      if (width <= 0 || !activeRef.current || Math.abs(width - lastHostWidthRef.current) < 0.5) return;
      lastHostWidthRef.current = width;
      scheduleLayout(view);
    });
    observer.observe(host);

    if (activeRef.current) scheduleLayout(view);
    return () => {
      observer.disconnect();
      view.destroy();
      viewRef.current = null;
      pendingInsertedSeparatorsRef.current = [];
    };
    // The editor is intentionally stable for one formula-edit session; source changes are dispatched below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    const next = parseSourceText(value);
    const field = sourceMetadataFieldRef.current!;
    if (!view) {
      metadataRef.current = next;
      initialSourceRef.current = next;
      return;
    }
    if (view.state.doc.toString() === next.normalized) {
      metadataRef.current = next;
      view.dispatch({
        effects: setSourceTextMetadata.of(next),
        annotations: Transaction.addToHistory.of(false),
      });
      return;
    }
    const cursor = Math.min(view.state.selection.main.head, next.normalized.length);
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: next.normalized },
      effects: setSourceTextMetadata.of(next),
      selection: { anchor: cursor },
      annotations: [Transaction.addToHistory.of(false), externalSourceTextSync.of(true)],
    });
    metadataRef.current = view.state.field(field);
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dom.style.setProperty('--formula-source-font-size', `${safeFontSize(fontSize)}px`);
    lastReportedHeightRef.current = null;
    if (active) {
      lastHostWidthRef.current = hostRef.current?.getBoundingClientRect().width ?? 0;
      scheduleLayout(view);
    }
  }, [active, fontSize, maxHeight]);

  return (
    <div className="formula-source-editor-region" aria-hidden={!active} style={{ display: active ? 'flex' : 'none' }}>
      <div className="formula-source-note">LaTeX source · rendered equation is read-only, not WYSIWYG.</div>
      <div ref={hostRef} className="formula-source-cm-host" aria-label="LaTeX source editor" />
    </div>
  );
});

export default FormulaSourceEditor;
