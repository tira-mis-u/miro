export const CODE_LINE_HEIGHT_RATIO = 1.5;
export const CODE_EDITOR_TOOLBAR_HEIGHT = 36;
export const CODE_EDITOR_BORDER_WIDTH = 1;
export const CODE_EDITOR_VERTICAL_PADDING = 9;
export const DEFAULT_CODE_FONT_SIZE = 14;

export interface CodeEditorLayoutMetrics {
  lineCount: number;
  lineHeight: number;
  paddingTop: number;
  paddingBottom: number;
  toolbarHeight: number;
  borderTop: number;
  borderBottom: number;
}

function nonNegative(value: number, fallback = 0): number {
  return Number.isFinite(value) ? Math.max(0, value) : fallback;
}

/** Minimum shell height that fits the toolbar, editor padding, and every source line. */
export function codeBlockHeightFromMetrics(metrics: CodeEditorLayoutMetrics): number {
  const lineCount = Math.max(1, Math.floor(nonNegative(metrics.lineCount, 1)));
  const lineHeight = Math.max(1, nonNegative(metrics.lineHeight, DEFAULT_CODE_FONT_SIZE * CODE_LINE_HEIGHT_RATIO));
  return Math.ceil(
    lineCount * lineHeight +
    nonNegative(metrics.paddingTop, CODE_EDITOR_VERTICAL_PADDING) +
    nonNegative(metrics.paddingBottom, CODE_EDITOR_VERTICAL_PADDING) +
    nonNegative(metrics.toolbarHeight, CODE_EDITOR_TOOLBAR_HEIGHT) +
    nonNegative(metrics.borderTop, CODE_EDITOR_BORDER_WIDTH) +
    nonNegative(metrics.borderBottom, CODE_EDITOR_BORDER_WIDTH),
  );
}

/** Compact initial size; CodeMirror replaces this estimate with measured DOM metrics on mount. */
export function initialCodeBlockHeight(fontSize = DEFAULT_CODE_FONT_SIZE): number {
  const safeFontSize = Math.max(10, Math.min(28, Number.isFinite(fontSize) ? fontSize : DEFAULT_CODE_FONT_SIZE));
  return codeBlockHeightFromMetrics({
    lineCount: 1,
    lineHeight: safeFontSize * CODE_LINE_HEIGHT_RATIO,
    paddingTop: CODE_EDITOR_VERTICAL_PADDING,
    paddingBottom: CODE_EDITOR_VERTICAL_PADDING,
    toolbarHeight: CODE_EDITOR_TOOLBAR_HEIGHT,
    borderTop: CODE_EDITOR_BORDER_WIDTH,
    borderBottom: CODE_EDITOR_BORDER_WIDTH,
  });
}
