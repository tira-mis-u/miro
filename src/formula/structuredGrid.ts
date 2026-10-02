export type StructuredGridLayout = 'array' | 'matrix' | 'aligned' | 'cases';
export type StructuredGridDelimiter = 'none' | 'braces' | 'left-brace' | 'left-square' | 'square' | 'parentheses' | 'bars';

/** Editable cell data shown in the Math Tools grid. Layout is deliberately not user-selectable. */
export interface StructuredGridDraft {
  delimiter: StructuredGridDelimiter;
  cells: string[][];
}

/** The source environment is retained internally so legacy formulas keep their original rendering semantics. */
export interface StructuredGridSpan {
  start: number;
  end: number;
  layout: StructuredGridLayout;
  draft: StructuredGridDraft;
}

export const MAX_GRID_DIMENSION = 8;

export const STRUCTURED_GRID_DELIMITERS: { value: StructuredGridDelimiter; label: string; preview: string; previewLatex?: string }[] = [
  { value: 'none', label: 'No delimiter', preview: 'x' },
  { value: 'parentheses', label: 'Parentheses', preview: '(x)' },
  { value: 'square', label: 'Square brackets', preview: '[x]' },
  { value: 'left-square', label: 'Left square bracket', preview: '[x', previewLatex: '\\left[x\\right.' },
  { value: 'braces', label: 'Curly braces', preview: '{x}' },
  { value: 'left-brace', label: 'Left brace', preview: '\\leftbrace{x}' },
  { value: 'bars', label: 'Vertical bars', preview: '|x|' },
];

export function normalizeStructuredGrid(draft: StructuredGridDraft): StructuredGridDraft {
  const rows = draft.cells.slice(0, MAX_GRID_DIMENSION);
  const columns = Math.max(1, Math.min(MAX_GRID_DIMENSION, rows.length ? Math.max(...rows.map(row => row.length)) : 1));
  const normalizedRows = Array.from({ length: Math.max(1, rows.length) }, (_, row) =>
    Array.from({ length: columns }, (_, column) => rows[row]?.[column] ?? '□'),
  );
  const delimiters: StructuredGridDelimiter[] = ['none', 'braces', 'left-brace', 'left-square', 'square', 'parentheses', 'bars'];
  return {
    delimiter: delimiters.includes(draft.delimiter) ? draft.delimiter : 'none',
    cells: normalizedRows,
  };
}

/** Cell text is literal LaTeX source; updates clone the draft so sibling cells remain independently editable. */
export function updateStructuredGridCell(input: StructuredGridDraft, rowIndex: number, columnIndex: number, value: string): StructuredGridDraft {
  const draft = normalizeStructuredGrid(input);
  if (!draft.cells[rowIndex] || columnIndex < 0 || columnIndex >= draft.cells[rowIndex].length) return draft;
  const cells = draft.cells.map(row => [...row]);
  cells[rowIndex][columnIndex] = value;
  return { ...draft, cells };
}

/** Kept as data helpers for imported/legacy grids; the UI now changes dimensions only through Create/Reconfigure. */
export function addStructuredGridRow(input: StructuredGridDraft): StructuredGridDraft {
  const draft = normalizeStructuredGrid(input);
  if (draft.cells.length >= MAX_GRID_DIMENSION) return draft;
  const columns = draft.cells[0]?.length ?? 1;
  return { ...draft, cells: [...draft.cells.map(row => [...row]), Array.from({ length: columns }, () => '')] };
}

export function removeStructuredGridRow(input: StructuredGridDraft): StructuredGridDraft {
  const draft = normalizeStructuredGrid(input);
  if (draft.cells.length <= 1) return draft;
  return { ...draft, cells: draft.cells.slice(0, -1).map(row => [...row]) };
}

export function addStructuredGridColumn(input: StructuredGridDraft): StructuredGridDraft {
  const draft = normalizeStructuredGrid(input);
  if ((draft.cells[0]?.length ?? 1) >= MAX_GRID_DIMENSION) return draft;
  return { ...draft, cells: draft.cells.map(row => [...row, '']) };
}

export function removeStructuredGridColumn(input: StructuredGridDraft): StructuredGridDraft {
  const draft = normalizeStructuredGrid(input);
  if ((draft.cells[0]?.length ?? 1) <= 1) return draft;
  return { ...draft, cells: draft.cells.map(row => row.slice(0, -1)) };
}

/** Detect whether a requested smaller size would remove any non-empty cell before asking for confirmation. */
export function hasPopulatedCellsOutsideDimensions(input: StructuredGridDraft, rowCount: number, columnCount: number): boolean {
  const draft = normalizeStructuredGrid(input);
  return draft.cells.some((row, rowIndex) => row.some((cell, columnIndex) =>
    (rowIndex >= rowCount || columnIndex >= columnCount) && cell.trim() !== '' && cell.trim() !== '□',
  ));
}

/** Resize while retaining every overlapping cell and leaving newly-created cells blank. */
export function resizeStructuredGrid(input: StructuredGridDraft | null, rowCount: number, columnCount: number): StructuredGridDraft {
  const rows = Math.max(1, Math.min(MAX_GRID_DIMENSION, Math.floor(rowCount)));
  const columns = Math.max(1, Math.min(MAX_GRID_DIMENSION, Math.floor(columnCount)));
  const current = input ? normalizeStructuredGrid(input) : null;
  return {
    delimiter: current?.delimiter ?? 'none',
    cells: Array.from({ length: rows }, (_, rowIndex) =>
      Array.from({ length: columns }, (_, columnIndex) => current?.cells[rowIndex]?.[columnIndex] ?? ''),
    ),
  };
}

/** Serializes the editable cell model to a standard KaTeX-compatible matrix environment. */
export function serializeStructuredGrid(input: StructuredGridDraft): string {
  const draft = normalizeStructuredGrid(input);
  const rows = draft.cells.map(row => row.map(cell => {
    const value = !cell.trim() || cell === '□' ? '\\square' : cell;
    return `{${value}}`;
  }).join(' & ')).join(' \\\\ ');
  const body = `\\begin{matrix}${rows}\\end{matrix}`;
  switch (draft.delimiter) {
    case 'braces': return `\\left\\{${body}\\right\\}`;
    case 'left-brace': return `\\left\\{${body}\\right.`;
    case 'left-square': return `\\left[${body}\\right.`;
    case 'square': return `\\left[${body}\\right]`;
    case 'parentheses': return `\\left(${body}\\right)`;
    case 'bars': return `\\left|${body}\\right|`;
    default: return body;
  }
}

function findBalancedGroupEnd(source: string, openingIndex: number): number {
  if (source[openingIndex] !== '{') return -1;
  let depth = 0;
  for (let index = openingIndex; index < source.length; index++) {
    const character = source[index];
    if (character === '\\') { index++; continue; }
    if (character === '{') depth++;
    else if (character === '}' && --depth === 0) return index + 1;
  }
  return -1;
}

function splitTopLevel(source: string, separator: ',' | ';' | '&'): string[] {
  const parts: string[] = [];
  let start = 0;
  let braces = 0;
  let brackets = 0;
  let parens = 0;
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (character === '\\') { index++; continue; }
    if (character === '{') braces++;
    else if (character === '}') braces = Math.max(0, braces - 1);
    else if (character === '[') brackets++;
    else if (character === ']') brackets = Math.max(0, brackets - 1);
    else if (character === '(') parens++;
    else if (character === ')') parens = Math.max(0, parens - 1);
    if (character === separator && braces === 0 && brackets === 0 && parens === 0) {
      parts.push(source.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(source.slice(start));
  return parts;
}

function splitRows(source: string): string[] {
  const rows: string[] = [];
  let start = 0;
  let braces = 0;
  let brackets = 0;
  let parens = 0;
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (character === '\\' && source[index + 1] === '\\' && braces === 0 && brackets === 0 && parens === 0) {
      rows.push(source.slice(start, index));
      index++;
      start = index + 1;
      while (/\s/.test(source[start] || '')) start++;
      index = start - 1;
      continue;
    }
    if (character === '\\') { index++; continue; }
    if (character === '{') braces++;
    else if (character === '}') braces = Math.max(0, braces - 1);
    else if (character === '[') brackets++;
    else if (character === ']') brackets = Math.max(0, brackets - 1);
    else if (character === '(') parens++;
    else if (character === ')') parens = Math.max(0, parens - 1);
  }
  rows.push(source.slice(start));
  return rows;
}

function unwrapCell(source: string): string {
  const value = source.trim();
  if (!value.startsWith('{')) return value;
  const end = findBalancedGroupEnd(value, 0);
  if (end !== value.length) return value;
  const inner = value.slice(1, -1);
  return inner === '\\square' ? '□' : inner;
}

function environmentEnd(source: string, start: number, environment: string): { bodyEnd: number; commandEnd: number } | null {
  const commandPattern = /\\(begin|end)\{([a-zA-Z*]+)\}/g;
  commandPattern.lastIndex = start;
  let depth = 1;
  let match: RegExpExecArray | null;
  while ((match = commandPattern.exec(source))) {
    if (match[2] !== environment) continue;
    if (match[1] === 'begin') depth++;
    else if (--depth === 0) return { bodyEnd: match.index, commandEnd: commandPattern.lastIndex };
  }
  return null;
}

function parseStandardEnvironment(source: string, beginIndex: number): StructuredGridSpan | null {
  const begin = /\\begin\{(array|matrix|aligned|cases)\}/.exec(source.slice(beginIndex));
  if (!begin || begin.index !== 0) return null;
  const layout = begin[1] as StructuredGridLayout;
  const commandEnd = beginIndex + begin[0].length;
  let bodyStart = commandEnd;
  if (layout === 'array') {
    while (/\s/.test(source[bodyStart] || '')) bodyStart++;
    const specEnd = findBalancedGroupEnd(source, bodyStart);
    if (specEnd < 0) return null;
    bodyStart = specEnd;
  }
  const environmentRange = environmentEnd(source, bodyStart, layout);
  if (!environmentRange) return null;
  const { bodyEnd } = environmentRange;
  const environmentEndIndex = environmentRange.commandEnd;

  let start = beginIndex;
  let delimiter: StructuredGridDelimiter = layout === 'cases' ? 'left-brace' : 'none';
  const leftDelimiter = /\\left(\\\{|\[|\(|\|)\s*$/.exec(source.slice(0, beginIndex));
  if (leftDelimiter) {
    start = beginIndex - leftDelimiter[0].length;
    const token = leftDelimiter[1];
    delimiter = token === '\\{' ? 'braces' : token === '[' ? 'square' : token === '(' ? 'parentheses' : 'bars';
  }

  let end = environmentEndIndex;
  if (layout !== 'cases') {
    const rightDelimiter = /^\s*\\right(\\\}|\]|\)|\||\.)/.exec(source.slice(end));
    if (rightDelimiter) {
      const token = rightDelimiter[1];
      end += rightDelimiter[0].length;
      if (token === '.') delimiter = delimiter === 'square' ? 'left-square' : 'left-brace';
      else if (token === '\\}') delimiter = 'braces';
      else if (token === ']') delimiter = 'square';
      else if (token === ')') delimiter = 'parentheses';
      else delimiter = 'bars';
    }
  }

  const body = source.slice(bodyStart, bodyEnd);
  const rows = splitRows(body).slice(0, MAX_GRID_DIMENSION).map(row =>
    splitTopLevel(row, '&').slice(0, MAX_GRID_DIMENSION).map(unwrapCell),
  );
  return { start, end, layout, draft: normalizeStructuredGrid({ delimiter, cells: rows }) };
}

function parseLegacyGrid(source: string, commandStart: number): StructuredGridSpan | null {
  const bracketStart = source.indexOf('[', commandStart);
  if (bracketStart < 0) return null;
  let bracketDepth = 0;
  let bracketEnd = -1;
  for (let index = bracketStart; index < source.length; index++) {
    const character = source[index];
    if (character === '\\') { index++; continue; }
    if (character === '[') bracketDepth++;
    else if (character === ']' && --bracketDepth === 0) { bracketEnd = index + 1; break; }
  }
  if (bracketEnd < 0) return null;
  let bodyStart = bracketEnd;
  while (/\s/.test(source[bodyStart] || '')) bodyStart++;
  if (source[bodyStart] !== '{') return null;
  const end = findBalancedGroupEnd(source, bodyStart);
  if (end < 0) return null;
  const optionText = source.slice(bracketStart + 1, bracketEnd - 1);
  const [rawLayout, rawDelimiter] = optionText.split(',').map(value => value.trim());
  const body = source.slice(bodyStart + 1, end - 1);
  const rows = splitTopLevel(body, ';').slice(0, MAX_GRID_DIMENSION).map(row =>
    splitTopLevel(row, ',').slice(0, MAX_GRID_DIMENSION).map(unwrapCell),
  );
  const layout = (['array', 'matrix', 'aligned', 'cases'] as const).find(value => value === rawLayout) ?? 'array';
  const delimiter = (['none', 'braces', 'left-brace', 'left-square', 'square', 'parentheses', 'bars'] as const).find(value => value === rawDelimiter) ?? 'none';
  return { start: commandStart, end, layout, draft: normalizeStructuredGrid({ delimiter, cells: rows }) };
}

export function findStructuredGridAt(source: string, selectionStart: number, selectionEnd = selectionStart): StructuredGridSpan | null {
  const candidates: StructuredGridSpan[] = [];
  const environments = /\\begin\{(?:array|matrix|aligned|cases)\}/g;
  let match: RegExpExecArray | null;
  while ((match = environments.exec(source))) {
    const span = parseStandardEnvironment(source, match.index);
    if (span) candidates.push(span);
  }
  const legacy = /\\?grid\s*\[/g;
  while ((match = legacy.exec(source))) {
    const span = parseLegacyGrid(source, match.index);
    if (span) candidates.push(span);
  }
  return candidates
    .filter(span => selectionStart >= span.start && selectionEnd <= span.end)
    .sort((left, right) => (left.end - left.start) - (right.end - right.start))[0] ?? null;
}
