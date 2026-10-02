import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { indentWithTab, defaultKeymap, history, historyKeymap, invertedEffects } from '@codemirror/commands';
import { EditorState, Compartment, Transaction } from '@codemirror/state';
import {
  bracketMatching,
  defaultHighlightStyle,
  indentOnInput,
  indentUnit,
  syntaxHighlighting,
} from '@codemirror/language';
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from '@codemirror/view';
import { Check, Code2 } from 'lucide-react';
import { CODE_LANGUAGES, loadCodeLanguageExtension, type CodeLanguage } from './languages';
import { CODE_EDITOR_BORDER_WIDTH, CODE_EDITOR_TOOLBAR_HEIGHT, CODE_EDITOR_VERTICAL_PADDING, CODE_LINE_HEIGHT_RATIO, codeBlockHeightFromMetrics } from './layout';
import { codeHighlightStyle } from './theme';
import {
  createSourceTextField,
  externalSourceTextSync,
  normalizeSourceOffset,
  parseSourceText,
  restoreSelectedLineEndings,
  restoreSourceLineEndings,
  setSourceTextMetadata,
  type ParsedSourceText,
  type LineSeparator,
} from '../editor/sourceText';

interface CodeEditorProps {
  value: string;
  language: CodeLanguage;
  initialCursor?: number;
  fontSize: number;
  autoHeight: boolean;
  onChange: (value: string) => void;
  onLayout: (height: number) => void;
  onAutoHeightChange: (enabled: boolean, fittedHeight: number) => void;
  onLanguageChange: (language: CodeLanguage) => void;
  onCommit: () => void;
}

const CODE_FONT = "'JetBrains Mono', 'SFMono-Regular', Consolas, 'Liberation Mono', monospace";
const CODE_LINE_HEIGHT = CODE_LINE_HEIGHT_RATIO;

function readCodeEditorHeight(view: EditorView, host: HTMLDivElement, fallbackFontSize: number): number {
  const shell = host.closest('.code-editor-shell');
  const toolbar = shell?.querySelector<HTMLElement>('.code-editor-toolbar');
  const shellStyle = shell ? window.getComputedStyle(shell) : null;
  const scrollerStyle = window.getComputedStyle(view.scrollDOM);
  const lastLine = view.lineBlockAt(view.state.doc.length);
  const lineHeight = lastLine.height || view.defaultLineHeight || fallbackFontSize * CODE_LINE_HEIGHT;
  const number = (value: string | undefined, fallback: number) => {
    const parsed = Number.parseFloat(value ?? '');
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  return codeBlockHeightFromMetrics({
    lineCount: view.state.doc.lines,
    lineHeight,
    paddingTop: number(scrollerStyle.paddingTop, CODE_EDITOR_VERTICAL_PADDING),
    paddingBottom: number(scrollerStyle.paddingBottom, CODE_EDITOR_VERTICAL_PADDING),
    toolbarHeight: toolbar?.getBoundingClientRect().height || CODE_EDITOR_TOOLBAR_HEIGHT,
    borderTop: number(shellStyle?.borderTopWidth, CODE_EDITOR_BORDER_WIDTH),
    borderBottom: number(shellStyle?.borderBottomWidth, CODE_EDITOR_BORDER_WIDTH),
  });
}

const codeEditorTheme = EditorView.theme({
  '&': {
    height: '100%',
    color: '#d4d4d4',
    backgroundColor: '#1b2430',
    fontSize: 'var(--code-font-size, 14px)',
  },
  '.cm-scroller': {
    overflow: 'auto',
    padding: '9px 0',
    fontFamily: CODE_FONT,
    lineHeight: String(CODE_LINE_HEIGHT),
    whiteSpace: 'pre',
    cursor: 'var(--aw-cursor-text, text)',
  },
  '.cm-content': {
    minHeight: '100%',
    padding: '0 14px',
    lineHeight: String(CODE_LINE_HEIGHT),
    whiteSpace: 'pre',
    userSelect: 'text',
    WebkitUserSelect: 'text',
    caretColor: '#F2A310',
  },
  '.cm-line': { lineHeight: String(CODE_LINE_HEIGHT), padding: '0' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#F2A310' },
  '.cm-gutters': {
    color: '#758398',
    backgroundColor: '#161e28',
    borderRight: '1px solid #303b49',
    lineHeight: String(CODE_LINE_HEIGHT),
  },
  '.cm-gutterElement': { lineHeight: String(CODE_LINE_HEIGHT), fontFamily: CODE_FONT },
  '.cm-lineNumbers .cm-gutterElement': { minWidth: '2.8em', padding: '0 9px 0 5px' },
  '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,.035)' },
  '.cm-activeLineGutter': { color: '#b9c4d1', backgroundColor: 'rgba(255,255,255,.035)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'rgba(59,130,246,.38) !important',
  },
  '.cm-matchingBracket': {
    color: '#fff !important',
    backgroundColor: 'rgba(242,163,16,.18)',
    outline: '1px solid rgba(242,163,16,.75)',
  },
  '.cm-scroller::-webkit-scrollbar': { width: '9px', height: '9px' },
}, { dark: true });

const pairOpeners: Record<string, string> = { '(': ')', '[': ']', '{': '}' };

function insertPairedNewline(view: EditorView): boolean {
  if (view.composing) return false;
  const selection = view.state.selection.main;
  if (!selection.empty || selection.from < 1) return false;
  const position = selection.from;
  const before = view.state.sliceDoc(position - 1, position);
  const after = view.state.sliceDoc(position, position + 1);
  if (pairOpeners[before] !== after) return false;

  const line = view.state.doc.lineAt(position);
  const baseIndent = line.text.match(/^[\t ]*/)?.[0] ?? '';
  const unit = view.state.facet(indentUnit) || '  ';
  const innerIndent = baseIndent + unit;
  const insert = `\n${innerIndent}\n${baseIndent}`;
  view.dispatch({
    changes: { from: position, to: position, insert },
    selection: { anchor: position + 1 + innerIndent.length },
    scrollIntoView: true,
    userEvent: 'input',
  });
  return true;
}

export default function CodeEditor({
  value,
  language,
  initialCursor,
  fontSize,
  autoHeight,
  onChange,
  onLayout,
  onAutoHeightChange,
  onLanguageChange,
  onCommit,
}: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const languageSlot = useRef(new Compartment());
  const metricsFrameRef = useRef<number | null>(null);
  const changeRef = useRef(onChange);
  const layoutRef = useRef(onLayout);
  const commitRef = useRef(onCommit);
  const languageRef = useRef(onLanguageChange);
  const fontSizeRef = useRef(fontSize);
  const sourceTextRef = useRef<ParsedSourceText>(parseSourceText(value));
  const initialSourceRef = useRef<ParsedSourceText>(parseSourceText(value));
  const pendingInsertedSeparatorsRef = useRef<LineSeparator[]>([]);
  const sourceMetadataFieldRef = useRef<ReturnType<typeof createSourceTextField> | null>(null);
  if (!sourceMetadataFieldRef.current) {
    sourceMetadataFieldRef.current = createSourceTextField(initialSourceRef, pendingInsertedSeparatorsRef);
  }

  useEffect(() => { changeRef.current = onChange; }, [onChange]);
  useEffect(() => { layoutRef.current = onLayout; }, [onLayout]);
  useEffect(() => { commitRef.current = onCommit; }, [onCommit]);
  useEffect(() => { languageRef.current = onLanguageChange; }, [onLanguageChange]);
  useEffect(() => { fontSizeRef.current = fontSize; }, [fontSize]);

  const scheduleLayout = useCallback((view: EditorView) => {
    if (metricsFrameRef.current !== null) window.cancelAnimationFrame(metricsFrameRef.current);
    metricsFrameRef.current = window.requestAnimationFrame(() => {
      metricsFrameRef.current = null;
      const host = hostRef.current;
      if (!host || viewRef.current !== view) return;
      layoutRef.current(readCodeEditorHeight(view, host, fontSizeRef.current));
    });
  }, []);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const initialSource = parseSourceText(value);
    sourceTextRef.current = initialSource;
    initialSourceRef.current = initialSource;
    const rawCursor = initialCursor ?? value.length;
    const start = normalizeSourceOffset(value, rawCursor);
    const sourceMetadataField = sourceMetadataFieldRef.current!;
    const state = EditorState.create({
      doc: initialSource.normalized,
      selection: { anchor: start },
      extensions: [
        languageSlot.current.of([]),
        EditorView.contentAttributes.of({ 'aria-label': 'Source code', spellcheck: 'false' }),
        EditorState.languageData.of(() => [{ closeBrackets: { brackets: ['(', '[', '{', "'", '"'] } }]),
        EditorView.clipboardInputFilter.of(text => {
          const pasted = parseSourceText(text);
          pendingInsertedSeparatorsRef.current = pasted.separators;
          return pasted.normalized;
        }),
        EditorView.clipboardOutputFilter.of((text, clipboardState) => {
          const selection = clipboardState.selection.main;
          const source = clipboardState.field(sourceMetadataField);
          if (clipboardState.selection.ranges.length > 1) {
            return restoreSourceLineEndings(text, [], source.preferredSeparator);
          }
          return restoreSelectedLineEndings(text, clipboardState.doc.toString(), selection.from,
            source.separators, source.preferredSeparator);
        }),
        sourceMetadataField,
        invertedEffects.of(transaction => {
          if (!transaction.docChanged || transaction.annotation(externalSourceTextSync)) return [];
          const previous = transaction.startState.field(sourceMetadataField, false);
          return previous ? [setSourceTextMetadata.of(previous)] : [];
        }),
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        history(),
        drawSelection(),
        bracketMatching(),
        closeBrackets(),
        indentOnInput(),
        indentUnit.of('  '),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        syntaxHighlighting(codeHighlightStyle),
        codeEditorTheme,
        keymap.of([
          ...closeBracketsKeymap,
          ...historyKeymap,
          indentWithTab,
          { key: 'Enter', run: insertPairedNewline },
          { key: 'Escape', run: () => { commitRef.current(); return true; } },
          ...defaultKeymap,
        ]),
        EditorView.updateListener.of(update => {
          if (!update.docChanged) return;
          const source = update.state.field(sourceMetadataField);
          sourceTextRef.current = source;
          const external = update.transactions.some(transaction => transaction.annotation(externalSourceTextSync));
          if (!external) {
            changeRef.current(restoreSourceLineEndings(source.normalized, source.separators, source.preferredSeparator));
          }
          pendingInsertedSeparatorsRef.current = [];
          scheduleLayout(update.view);
        }),
      ],
    });

    const view = new EditorView({ state, parent: host });
    view.dom.style.setProperty('--code-font-size', `${Math.max(10, Math.min(28, fontSize))}px`);
    viewRef.current = view;
    view.focus();
    view.dispatch({ selection: { anchor: start } });
    scheduleLayout(view);
    return () => {
      if (metricsFrameRef.current !== null) window.cancelAnimationFrame(metricsFrameRef.current);
      metricsFrameRef.current = null;
      view.destroy();
      viewRef.current = null;
    };
    // The editor instance is intentionally stable for the lifetime of one code object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const next = parseSourceText(value);
    const view = viewRef.current;
    if (!view) {
      sourceTextRef.current = next;
      initialSourceRef.current = next;
      return;
    }
    const field = sourceMetadataFieldRef.current!;
    if (view.state.doc.toString() === next.normalized) {
      sourceTextRef.current = next;
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
    sourceTextRef.current = view.state.field(field);
  }, [value]);

  useEffect(() => {
    let cancelled = false;
    loadCodeLanguageExtension(language).then(extension => {
      if (cancelled) return;
      const view = viewRef.current;
      view?.dispatch({ effects: languageSlot.current.reconfigure(extension) });
      if (view) scheduleLayout(view);
    }).catch(error => {
      // Keep the editor usable as plain text if a lazily-loaded grammar chunk is unavailable.
      console.error(`Could not load ${language} syntax mode`, error);
      if (!cancelled) {
        const view = viewRef.current;
        view?.dispatch({ effects: languageSlot.current.reconfigure([]) });
        if (view) scheduleLayout(view);
      }
    });
    return () => { cancelled = true; };
  }, [language, scheduleLayout]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    fontSizeRef.current = fontSize;
    view.dom.style.setProperty('--code-font-size', `${Math.max(10, Math.min(28, fontSize))}px`);
    scheduleLayout(view);
  }, [fontSize, scheduleLayout]);

  return (
    <div className="code-editor-shell" aria-label="Code block editor"
      onPointerDown={event => event.stopPropagation()}
      onDoubleClick={event => event.stopPropagation()}
      onWheel={event => event.stopPropagation()}
      onContextMenu={event => event.stopPropagation()}
      onBlurCapture={event => {
        const shell = event.currentTarget;
        if (event.relatedTarget instanceof Node && shell.contains(event.relatedTarget)) return;
        window.setTimeout(() => {
          if (!shell.contains(document.activeElement)) commitRef.current();
        }, 0);
      }}>
      <div className="code-editor-toolbar">
        <div className="code-editor-title"><Code2 size={14} aria-hidden="true" /><span>Code</span></div>
        <label className="code-language-control">
          <span>Language</span>
          <select
            aria-label="Code language"
            value={language}
            onChange={event => languageRef.current(event.target.value as CodeLanguage)}
            onPointerDown={event => event.stopPropagation()}
          >
            {CODE_LANGUAGES.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <button type="button" className="code-editor-fit-height" aria-pressed={autoHeight}
          aria-label={autoHeight ? 'Disable automatic CodeBlock height' : 'Fit CodeBlock height to source lines'}
          title={autoHeight ? 'Auto height is on; click to keep a manual height' : 'Fit height to the current source lines'}
          onClick={() => {
            const view = viewRef.current;
            const host = hostRef.current;
            if (!view || !host) return;
            onAutoHeightChange(!autoHeight, readCodeEditorHeight(view, host, fontSizeRef.current));
          }}>
          {autoHeight ? 'Auto' : 'Fit'}
        </button>
        <button type="button" className="code-editor-done" onClick={() => commitRef.current()} aria-label="Finish editing code" title="Finish editing">
          <Check size={14} aria-hidden="true" /><span>Done</span>
        </button>
      </div>
      <div ref={hostRef} className="code-editor-cm-host" aria-label="Source code editor" />
    </div>
  );
}
