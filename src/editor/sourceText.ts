import { Annotation, StateEffect, StateField, type ChangeSet } from '@codemirror/state';

export type LineSeparator = '\n' | '\r\n' | '\r';

export interface ParsedSourceText {
  /** CodeMirror's canonical document text; line endings are represented as LF. */
  normalized: string;
  /** One original separator for each logical line break in `normalized`. */
  separators: LineSeparator[];
  /** Used for newly typed line breaks and for content without a corresponding original break. */
  preferredSeparator: LineSeparator;
}

export interface RefLike<T> { current: T }

const LINE_BREAK = /\r\n|\r|\n/g;

/** Split a source string without losing the exact line-ending sequence. */
export function parseSourceText(source: string): ParsedSourceText {
  const separators: LineSeparator[] = [];
  const normalized = source.replace(LINE_BREAK, separator => {
    separators.push(separator as LineSeparator);
    return '\n';
  });
  return {
    normalized,
    separators,
    preferredSeparator: separators[0] ?? '\n',
  };
}

/** Convert a source-text offset to the corresponding CodeMirror (LF-normalized) offset. */
export function normalizeSourceOffset(source: string, offset: number): number {
  const clamped = Math.max(0, Math.min(source.length, Number.isFinite(offset) ? Math.floor(offset) : 0));
  return parseSourceText(source.slice(0, clamped)).normalized.length;
}

/** Restore each tracked source line ending while leaving all other characters untouched. */
export function restoreSourceLineEndings(
  normalized: string,
  separators: readonly LineSeparator[],
  fallback: LineSeparator = '\n',
): string {
  let index = 0;
  return normalized.replace(/\n/g, () => separators[index++] ?? fallback);
}

function countLineBreaksBefore(text: string, position: number): number {
  let count = 0;
  const end = Math.max(0, Math.min(text.length, position));
  for (let index = 0; index < end; index++) if (text[index] === '\n') count++;
  return count;
}

/**
 * Carry line-ending metadata through one CodeMirror transaction. Existing line breaks keep their
 * exact separator when they survive; newly inserted breaks use paste-provided separators first,
 * then the document's preferred separator.
 */
export function reconcileSourceLineEndings(
  oldNormalized: string,
  newNormalized: string,
  oldSeparators: readonly LineSeparator[],
  changes: Pick<ChangeSet, 'iterChangedRanges' | 'iterChanges' | 'mapPos'>,
  preferredSeparator: LineSeparator,
  insertedSeparators: readonly LineSeparator[] = [],
): LineSeparator[] {
  const nextSeparators = Array.from({ length: (newNormalized.match(/\n/g) ?? []).length }, () => preferredSeparator);
  const insertedBreakPositions: number[] = [];

  changes.iterChanges((_fromA, _toA, fromB, _toB, inserted) => {
    const text = inserted.toString();
    for (let index = 0; index < text.length; index++) {
      if (text[index] === '\n') insertedBreakPositions.push(fromB + index);
    }
  });

  insertedBreakPositions.forEach((position, index) => {
    const breakIndex = countLineBreaksBefore(newNormalized, position);
    const separator = insertedSeparators.length ? insertedSeparators[index % insertedSeparators.length] : preferredSeparator;
    if (breakIndex < nextSeparators.length) nextSeparators[breakIndex] = separator;
  });

  const changedRanges: [number, number][] = [];
  changes.iterChangedRanges((fromA, toA) => {
    if (toA > fromA) changedRanges.push([fromA, toA]);
  });

  let oldBreakIndex = 0;
  for (let oldPosition = 0; oldPosition < oldNormalized.length; oldPosition++) {
    if (oldNormalized[oldPosition] !== '\n') continue;
    const separator = oldSeparators[oldBreakIndex] ?? preferredSeparator;
    const breakWasReplaced = changedRanges.some(([from, to]) => from <= oldPosition && to > oldPosition);
    oldBreakIndex++;
    if (breakWasReplaced) continue;

    const newPosition = changes.mapPos(oldPosition, 1);
    if (newPosition < 0 || newNormalized[newPosition] !== '\n') continue;
    const nextBreakIndex = countLineBreaksBefore(newNormalized, newPosition);
    if (nextBreakIndex < nextSeparators.length) nextSeparators[nextBreakIndex] = separator;
  }

  return nextSeparators;
}

/** Convert a selected normalized substring to clipboard text with its original separators. */
export function restoreSelectedLineEndings(
  normalizedSelection: string,
  fullNormalized: string,
  selectionFrom: number,
  separators: readonly LineSeparator[],
  fallback: LineSeparator,
): string {
  const firstBreak = countLineBreaksBefore(fullNormalized, selectionFrom);
  let localBreak = 0;
  return normalizedSelection.replace(/\n/g, () => separators[firstBreak + localBreak++] ?? fallback);
}

/**
 * State effects make separator snapshots participate in CodeMirror undo/redo. Without this field,
 * CodeMirror's LF-normalized document would restore the text but not mixed original separators.
 */
export const setSourceTextMetadata = StateEffect.define<ParsedSourceText>();
export const externalSourceTextSync = Annotation.define<boolean>();

export function createSourceTextField(
  initialSource: RefLike<ParsedSourceText>,
  pendingInsertedSeparators: RefLike<LineSeparator[]>,
): StateField<ParsedSourceText> {
  return StateField.define<ParsedSourceText>({
    create: () => initialSource.current,
    update(current, transaction) {
      for (const effect of transaction.effects) {
        if (effect.is(setSourceTextMetadata)) return effect.value;
      }
      if (!transaction.docChanged) return current;
      const normalized = transaction.newDoc.toString();
      const separators = reconcileSourceLineEndings(
        transaction.startState.doc.toString(),
        normalized,
        current.separators,
        transaction.changes,
        current.preferredSeparator,
        pendingInsertedSeparators.current,
      );
      pendingInsertedSeparators.current = [];
      return { normalized, separators, preferredSeparator: current.preferredSeparator };
    },
  });
}
