export interface SourceEditorFit {
  naturalHeight: number;
  height: number;
  needsVerticalScroll: boolean;
}

/** Fit CodeMirror's measured document height to the actual remaining editor viewport. */
export function fitSourceEditorHeight(naturalHeight: number, maxHeight: number, minHeight = 60): SourceEditorFit {
  const natural = Math.max(1, Number.isFinite(naturalHeight) ? Math.ceil(naturalHeight) : minHeight);
  const available = Math.max(1, Number.isFinite(maxHeight) ? Math.floor(maxHeight) : natural);
  const minimum = Math.min(available, Math.max(1, Number.isFinite(minHeight) ? Math.floor(minHeight) : 60));
  const height = Math.min(Math.max(minimum, natural), available);
  return { naturalHeight: natural, height, needsVerticalScroll: natural > available };
}
