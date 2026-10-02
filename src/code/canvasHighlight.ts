import { EditorState } from '@codemirror/state';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { highlightTree, tagHighlighter, tags } from '@lezer/highlight';
import { loadCodeLanguageExtension, type CodeLanguage } from './languages';

export interface CodeTokenRange {
  from: number;
  to: number;
  token: CodeTokenClass;
}

export type CodeTokenClass =
  | 'keyword' | 'operator' | 'punctuation' | 'string' | 'regexp' | 'escape'
  | 'number' | 'comment' | 'variable' | 'property' | 'definition' | 'function'
  | 'type' | 'annotation' | 'constant' | 'constantName' | 'meta' | 'invalid';

export type CodeHighlightEngine = 'codemirror' | 'language-aware-fallback';

export interface CodePreviewSnapshot {
  source: string;
  language: CodeLanguage;
  html: string;
  engine: CodeHighlightEngine;
  version: number;
}

const TOKEN_CLASSES: Record<CodeTokenClass, string> = {
  keyword: 'board-code-token-keyword',
  operator: 'board-code-token-operator',
  punctuation: 'board-code-token-punctuation',
  string: 'board-code-token-string',
  regexp: 'board-code-token-regexp',
  escape: 'board-code-token-escape',
  number: 'board-code-token-number',
  comment: 'board-code-token-comment',
  variable: 'board-code-token-variable',
  property: 'board-code-token-property',
  definition: 'board-code-token-definition',
  function: 'board-code-token-function',
  type: 'board-code-token-type',
  annotation: 'board-code-token-annotation',
  constant: 'board-code-token-constant',
  constantName: 'board-code-token-constant-name',
  meta: 'board-code-token-meta',
  invalid: 'board-code-token-invalid',
};

const TOKEN_RULES = [
  { tag: tags.invalid, class: TOKEN_CLASSES.invalid },
  { tag: tags.definition(tags.variableName), class: TOKEN_CLASSES.definition },
  { tag: tags.function(tags.variableName), class: TOKEN_CLASSES.function },
  { tag: tags.constant(tags.variableName), class: TOKEN_CLASSES.constantName },
  { tag: tags.typeName, class: TOKEN_CLASSES.type },
  { tag: tags.className, class: TOKEN_CLASSES.type },
  { tag: tags.namespace, class: TOKEN_CLASSES.type },
  { tag: tags.annotation, class: TOKEN_CLASSES.annotation },
  { tag: tags.bool, class: TOKEN_CLASSES.constant },
  { tag: tags.atom, class: TOKEN_CLASSES.constant },
  { tag: tags.keyword, class: TOKEN_CLASSES.keyword },
  { tag: tags.comment, class: TOKEN_CLASSES.comment },
  { tag: tags.string, class: TOKEN_CLASSES.string },
  { tag: tags.regexp, class: TOKEN_CLASSES.regexp },
  { tag: tags.escape, class: TOKEN_CLASSES.escape },
  { tag: tags.number, class: TOKEN_CLASSES.number },
  { tag: tags.propertyName, class: TOKEN_CLASSES.property },
  { tag: tags.variableName, class: TOKEN_CLASSES.variable },
  { tag: tags.operator, class: TOKEN_CLASSES.operator },
  { tag: tags.punctuation, class: TOKEN_CLASSES.punctuation },
  { tag: tags.meta, class: TOKEN_CLASSES.meta },
] as const;
const canvasHighlighter = tagHighlighter(TOKEN_RULES);
const extensionPromises = new Map<CodeLanguage, ReturnType<typeof loadCodeLanguageExtension>>();

function cachedLanguageExtension(language: CodeLanguage) {
  let promise = extensionPromises.get(language);
  if (!promise) {
    promise = loadCodeLanguageExtension(language).catch(error => {
      extensionPromises.delete(language);
      throw error;
    });
    extensionPromises.set(language, promise);
  }
  return promise;
}

/** Escape code as text. It is never inserted into a tag or attribute context. */
export function escapeCodePreviewText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\r/g, '&#13;');
}

function tokenNameFromClasses(classes: string): string | undefined {
  return classes.split(/\s+/).find(className => Object.values(TOKEN_CLASSES).includes(className));
}

/** Render exact source slices into numbered logical rows; syntax spans never change source text. */
export function renderCodePreviewRows(source: string, ranges: readonly CodeTokenRange[] = []): string {
  const rowBounds: [number, number][] = [];
  let rowStart = 0;
  for (let index = 0; index < source.length; index++) {
    if (source.charCodeAt(index) === 10) {
      rowBounds.push([rowStart, index]);
      rowStart = index + 1;
    }
  }
  // This deliberately creates a final empty row when the source ends in a newline.
  rowBounds.push([rowStart, source.length]);

  const rows = rowBounds.map(([from, to], rowIndex) => {
    let cursor = from;
    let html = '';
    for (const range of ranges) {
      if (range.to <= from) continue;
      if (range.from >= to) break;
      const tokenFrom = Math.max(cursor, from, range.from);
      const tokenTo = Math.min(to, range.to);
      if (tokenFrom > cursor) html += escapeCodePreviewText(source.slice(cursor, tokenFrom));
      if (tokenTo > tokenFrom) {
        const className = TOKEN_CLASSES[range.token];
        html += `<span class="board-code-token ${className}">${escapeCodePreviewText(source.slice(tokenFrom, tokenTo))}</span>`;
        cursor = tokenTo;
      }
    }
    if (cursor < to) html += escapeCodePreviewText(source.slice(cursor, to));
    return `<div class="board-code-row" data-line="${rowIndex + 1}"><span class="board-code-line-number">${rowIndex + 1}</span><code class="board-code-line">${html}</code></div>`;
  });
  return rows.join('');
}

async function parseCodeRanges(source: string, language: CodeLanguage): Promise<CodeTokenRange[]> {
  const extension = await cachedLanguageExtension(language);
  const state = EditorState.create({ doc: source, extensions: [extension] });
  const tree = ensureSyntaxTree(state, state.doc.length, 1200) ?? syntaxTree(state);
  const ranges: CodeTokenRange[] = [];
  highlightTree(tree, canvasHighlighter, (from, to, classes) => {
    const className = tokenNameFromClasses(classes);
    if (!className || to <= from) return;
    const token = (Object.keys(TOKEN_CLASSES) as CodeTokenClass[])
      .find(key => TOKEN_CLASSES[key] === className);
    if (token) ranges.push({ from, to, token });
  });
  return ranges;
}

const KEYWORDS: Record<CodeLanguage, Set<string>> = {
  c: new Set('auto break case char const continue default do double else enum extern float for goto if int long register return short signed sizeof static struct switch typedef union unsigned void volatile while _bool _complex _imaginary'.split(' ')),
  cpp: new Set('alignas alignof and asm auto bool break case catch char class const constexpr const_cast continue decltype default delete do double dynamic_cast else enum explicit export extern false float for friend goto if inline int long mutable namespace new noexcept not nullptr operator or private protected public register reinterpret_cast return short signed sizeof static static_assert static_cast struct switch template this thread_local throw true try typedef typeid typename union unsigned using virtual void volatile wchar_t while'.split(' ')),
  csharp: new Set('abstract as base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern false finally fixed float for foreach goto if implicit in int interface internal is lock long namespace new null object operator out override params private protected public readonly ref return sbyte sealed short sizeof stackalloc static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using virtual void volatile while async await var yield'.split(' ')),
  java: new Set('abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null var'.split(' ')),
  javascript: new Set('async await break case catch class const continue debugger default delete do else export extends false finally for from function get if import in instanceof let new null of return set static super switch this throw true try typeof undefined var void while with yield'.split(' ')),
  python: new Set('and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield'.split(' ')),
  pascal: new Set('and array asm begin case const constructor destructor div do downto else end file for function goto if implementation in inherited inline interface label mod nil not object of or packed procedure program record repeat set shl shr string then to type unit until uses var while with xor'.split(' ')),
  php: new Set('abstract and array as break callable case catch class clone const continue declare default do echo else elseif empty endfor endforeach endif endswitch endwhile eval exit extends final finally fn for foreach function global goto if implements include include_once instanceof insteadof interface isset list namespace new or print private protected public readonly require require_once return static switch throw trait try unset use var while xor yield true false null'.split(' ')),
  sql: new Set('add all alter and any as asc begin between by case cast check column commit constraint create cross current_date current_time database default delete desc distinct drop else end escape except exists fetch for foreign from full grant group having in index inner insert intersect into is join key left like limit not null offset on or order outer primary references right rollback row rows select set table then to truncate union unique update use values view when where with'.split(' ')),
};

const CONSTANTS: Record<CodeLanguage, Set<string>> = {
  c: new Set('true false null NULL nullptr'.split(' ')),
  cpp: new Set('true false nullptr NULL'.split(' ')),
  csharp: new Set('true false null'.split(' ')),
  java: new Set('true false null'.split(' ')),
  javascript: new Set('true false null undefined NaN Infinity'.split(' ')),
  python: new Set('True False None NotImplemented Ellipsis'.split(' ')),
  pascal: new Set('true false nil'.split(' ')),
  php: new Set('true false null TRUE FALSE NULL'.split(' ')),
  sql: new Set('true false null unknown'.split(' ')),
};

function addFallbackRange(ranges: CodeTokenRange[], from: number, to: number, token: CodeTokenClass) {
  if (to > from) ranges.push({ from, to, token });
}

function isIdentifierStartAt(source: string, index: number): number {
  const codePoint = source.codePointAt(index);
  if (codePoint === undefined) return 0;
  const character = String.fromCodePoint(codePoint);
  return /[\p{L}_$]/u.test(character) ? character.length : 0;
}

function isIdentifierPartAt(source: string, index: number): number {
  const codePoint = source.codePointAt(index);
  if (codePoint === undefined) return 0;
  const character = String.fromCodePoint(codePoint);
  return /[\p{L}\p{N}_$]/u.test(character) ? character.length : 0;
}

function commentEnd(source: string, start: number, endMarker: string): number {
  const end = source.indexOf(endMarker, start + 2);
  return end < 0 ? source.length : end + endMarker.length;
}

/** Conservative, language-aware lexical fallback used only if a Lezer mode cannot load. */
export function tokenizeCodeFallback(source: string, language: CodeLanguage): CodeTokenRange[] {
  const ranges: CodeTokenRange[] = [];
  const slashComments = ['c', 'cpp', 'csharp', 'java', 'javascript', 'php', 'pascal'].includes(language);
  let index = 0;
  while (index < source.length) {
    const start = index;
    const ch = source[index];

    if (source.startsWith('/*', index) && ['c', 'cpp', 'csharp', 'java', 'javascript', 'php', 'sql'].includes(language)) {
      index = commentEnd(source, index, '*/');
      addFallbackRange(ranges, start, index, 'comment');
      continue;
    }
    if ((language === 'pascal' && source.startsWith('(*', index))) {
      index = commentEnd(source, index, '*)');
      addFallbackRange(ranges, start, index, 'comment');
      continue;
    }
    if (language === 'pascal' && ch === '{') {
      const end = source.indexOf('}', index + 1);
      index = end < 0 ? source.length : end + 1;
      addFallbackRange(ranges, start, index, 'comment');
      continue;
    }
    if ((slashComments && source.startsWith('//', index)) || (language === 'sql' && source.startsWith('--', index)) ||
        ((language === 'python' || language === 'php' || language === 'sql') && ch === '#')) {
      const end = source.indexOf('\n', index);
      index = end < 0 ? source.length : end;
      addFallbackRange(ranges, start, index, 'comment');
      continue;
    }

    if (ch === '"' || ch === "'" || (ch === '`' && language === 'javascript')) {
      const quote = ch;
      const triple = language === 'python' && source.startsWith(quote.repeat(3), index);
      const delimiter = quote.repeat(triple ? 3 : 1);
      index += delimiter.length;
      while (index < source.length) {
        if (source[index] === '\\') { index = Math.min(source.length, index + 2); continue; }
        if (source.startsWith(delimiter, index)) { index += delimiter.length; break; }
        if (!triple && source[index] === '\n') break;
        index++;
      }
      addFallbackRange(ranges, start, index, 'string');
      continue;
    }

    const number = source.slice(index).match(/^(?:0[xX][\da-fA-F]+|0[bB][01]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/);
    if (number && (/[\d.]/.test(ch))) {
      index += number[0].length;
      addFallbackRange(ranges, start, index, 'number');
      continue;
    }

    const startLength = isIdentifierStartAt(source, index);
    if (startLength) {
      index += startLength;
      while (index < source.length) {
        const nextLength = isIdentifierPartAt(source, index);
        if (!nextLength) break;
        index += nextLength;
      }
      const value = source.slice(start, index);
      const lower = value.toLowerCase();
      if (CONSTANTS[language].has(value) || CONSTANTS[language].has(lower)) addFallbackRange(ranges, start, index, 'constant');
      else if (KEYWORDS[language].has(value) || KEYWORDS[language].has(lower)) addFallbackRange(ranges, start, index, 'keyword');
      else {
        let next = index;
        while (/\s/.test(source[next] ?? '')) next++;
        let previous = start - 1;
        while (/\s/.test(source[previous] ?? '')) previous--;
        const token: CodeTokenClass = source[next] === '(' ? 'function'
          : source[previous] === '.' ? 'property'
          : /^[\p{Lu}]/u.test(value) ? 'type'
          : 'variable';
        addFallbackRange(ranges, start, index, token);
      }
      continue;
    }

    if (ch === '#' && ['c', 'cpp', 'csharp'].includes(language)) {
      const lineStart = source.lastIndexOf('\n', index - 1) + 1;
      if (!source.slice(lineStart, index).trim()) {
        const end = source.indexOf('\n', index);
        index = end < 0 ? source.length : end;
        addFallbackRange(ranges, start, index, 'meta');
        continue;
      }
    }

    if ('{}()[];,.:'.includes(ch)) addFallbackRange(ranges, start, ++index, 'punctuation');
    else if ('+-*/%=!<>|&^~?'.includes(ch)) addFallbackRange(ranges, start, ++index, 'operator');
    else index++;
  }
  return ranges;
}

export async function buildCodePreviewRows(source: string, language: CodeLanguage): Promise<{
  html: string;
  engine: CodeHighlightEngine;
}> {
  try {
    const ranges = await parseCodeRanges(source, language);
    if (source.length > 0 && ranges.length === 0) throw new Error('The loaded parser produced no token styles.');
    return { html: renderCodePreviewRows(source, ranges), engine: 'codemirror' };
  } catch {
    return {
      html: renderCodePreviewRows(source, tokenizeCodeFallback(source, language)),
      engine: 'language-aware-fallback',
    };
  }
}

interface CachedPreview extends CodePreviewSnapshot {
  pending: Promise<void>;
}

/**
 * Caches tokenized canvas previews by object id and exact source/language. The
 * immediate language-aware lexical pass prevents a monochrome flash; an actual
 * CodeMirror/Lezer parse replaces it asynchronously when the mode is available.
 */
export class CanvasCodePreviewCache {
  private entries = new Map<string, CachedPreview>();

  render(id: string, source: string, language: CodeLanguage, onReady?: () => void): string {
    const existing = this.entries.get(id);
    if (existing?.source === source && existing.language === language) return existing.html;

    const entry: CachedPreview = {
      source,
      language,
      html: renderCodePreviewRows(source, tokenizeCodeFallback(source, language)),
      engine: 'language-aware-fallback',
      version: 0,
      pending: Promise.resolve(),
    };
    this.entries.set(id, entry);
    entry.pending = buildCodePreviewRows(source, language).then(result => {
      if (this.entries.get(id) !== entry) return;
      if (entry.html !== result.html || entry.engine !== result.engine) {
        entry.html = result.html;
        entry.engine = result.engine;
        entry.version++;
        onReady?.();
      }
    });
    return entry.html;
  }

  async waitFor(id: string): Promise<CodePreviewSnapshot | undefined> {
    const entry = this.entries.get(id);
    if (!entry) return undefined;
    await entry.pending;
    const latest = this.entries.get(id);
    if (!latest) return undefined;
    const { source, language, html, engine, version } = latest;
    return { source, language, html, engine, version };
  }

  snapshot(id: string): CodePreviewSnapshot | undefined {
    const entry = this.entries.get(id);
    if (!entry) return undefined;
    const { source, language, html, engine, version } = entry;
    return { source, language, html, engine, version };
  }

  forget(id: string) {
    this.entries.delete(id);
  }

  clear() {
    this.entries.clear();
  }
}
