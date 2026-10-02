export interface TextRangeReplacement {
  text: string;
  selectionStart: number;
  selectionEnd: number;
}

/** Replace exactly the clamped selection, or insert at the caret when the range is collapsed. */
export function replaceTextRange(source: string, start: number, end: number, insertion: string): TextRangeReplacement {
  const safeStart = Math.max(0, Math.min(source.length, Math.floor(Number.isFinite(start) ? start : 0)));
  const safeEnd = Math.max(safeStart, Math.min(source.length, Math.floor(Number.isFinite(end) ? end : safeStart)));
  const text = source.slice(0, safeStart) + insertion + source.slice(safeEnd);
  const caret = safeStart + insertion.length;
  return { text, selectionStart: caret, selectionEnd: caret };
}

/** Select the requested editable placeholder, or leave the caret immediately after a symbol-only insertion. */
export function resolveTemplateSelection(insertion: string, insertedAt: number, placeholderIndex: number): { selectionStart: number; selectionEnd: number } {
  let seen = 0;
  if (placeholderIndex >= 0) {
    for (let offset = 0; offset < insertion.length; offset++) {
      if (insertion[offset] !== '□') continue;
      if (seen === placeholderIndex) {
        const selectionStart = insertedAt + offset;
        return { selectionStart, selectionEnd: selectionStart + 1 };
      }
      seen++;
    }
  }
  const caret = insertedAt + insertion.length;
  return { selectionStart: caret, selectionEnd: caret };
}
