import { listShapePickerDefinitions } from './registry';
import { SHAPE_CATEGORIES, type ShapeCategory, type ShapeDefinition } from './types';

/**
 * Search indexes one canonical picker entry per visible definition. Hidden compatibility
 * definitions are intentionally excluded; any useful legacy spellings must be declared as
 * searchAliases on their canonical visible replacement.
 */
export const MAX_SHAPE_SEARCH_QUERY_LENGTH = 256;

export interface ShapeSearchField {
  readonly source: 'label' | 'picker-label' | 'alias' | 'keyword' | 'semantic-role' | 'solid-family'
    | 'identity' | 'legacy-type' | 'default-label' | 'parameter-label' | 'category' | 'notation' | 'description';
  readonly text: string;
  readonly normalized: string;
  readonly priority: number;
}

export interface ShapeSearchDocument {
  readonly definition: ShapeDefinition;
  readonly fields: readonly ShapeSearchField[];
}

const CATEGORY_TERMS: Readonly<Record<ShapeCategory, readonly string[]>> = {
  Basic: ['basic shapes', 'general shapes'],
  '3D Shapes': ['3d', '3d solids', 'three dimensional', 'solid geometry'],
  Flowchart: ['flow chart', 'process diagram', 'process mapping'],
  'ERD / Database': ['erd', 'database', 'entity relationship', 'entity relationship diagram', 'data modeling'],
  'Use Case Diagram': ['use case', 'use-case', 'uml use case', 'uml use-case diagram'],
  'Class Diagram': ['class diagram', 'uml class diagram', 'software class diagram'],
  'Sequence Diagram': ['sequence diagram', 'uml sequence diagram', 'interaction diagram'],
  'Activity Diagram': ['activity diagram', 'uml activity diagram', 'workflow activity'],
  'State Diagram': ['state diagram', 'state machine', 'uml state machine', 'statechart'],
};

/** Accent-insensitive, case-insensitive tokenization; IDs, slashes, dots and hyphens split naturally. */
export function normalizeShapeSearchText(value: string): string {
  return value.normalize('NFKD').replace(/\p{Diacritic}/gu, '').toLowerCase()
    .match(/[\p{L}\p{N}]+/gu)?.join(' ') ?? '';
}

const categoryOrder = new Map<string, number>(SHAPE_CATEGORIES.map((category, index) => [category, index]));
const compareNormalized = (a: string, b: string) => {
  const left = normalizeShapeSearchText(a);
  const right = normalizeShapeSearchText(b);
  return left < right ? -1 : left > right ? 1 : 0;
};

function searchFields(definition: ShapeDefinition): ShapeSearchField[] {
  const fields: ShapeSearchField[] = [];
  const add = (source: ShapeSearchField['source'], text: string | undefined, priority: number) => {
    if (!text?.trim()) return;
    const normalized = normalizeShapeSearchText(text);
    if (!normalized || fields.some(field => field.source === source && field.normalized === normalized)) return;
    fields.push({ source, text, normalized, priority });
  };

  add('label', definition.label, 0);
  for (const label of Object.values(definition.pickerLabels ?? {})) add('picker-label', label, 0);
  for (const alias of definition.searchAliases ?? []) add('alias', alias, 1);
  for (const keyword of definition.searchKeywords ?? []) add('keyword', keyword, 2);
  add('semantic-role', definition.semantic?.role, 2);
  add('solid-family', definition.solid3d?.family, 3);
  add('identity', definition.id, 4);
  add('identity', definition.toolId, 4);
  add('legacy-type', definition.legacyType, 4);
  add('default-label', definition.defaultLabel, 4);
  add('default-label', definition.defaultText, 4);
  for (const parameter of definition.parameterMetadata ?? []) {
    if (parameter.status === 'user-editable' && parameter.control) add('parameter-label', parameter.label, 4);
  }
  add('category', definition.category, 5);
  for (const category of definition.pickerCategories ?? []) {
    add('category', category, 5);
    for (const term of CATEGORY_TERMS[category]) add('category', term, 5);
  }
  for (const term of CATEGORY_TERMS[definition.category]) add('category', term, 5);
  add('notation', definition.semantic?.notation, 5);
  add('description', definition.description, 6);
  return fields;
}

const pickerDefinitions = listShapePickerDefinitions();
const canonicalIds = new Set<string>();
const documents: ShapeSearchDocument[] = [];
for (const definition of pickerDefinitions) {
  if (canonicalIds.has(definition.id)) continue;
  canonicalIds.add(definition.id);
  documents.push({ definition, fields: searchFields(definition) });
}

/** Immutable, auditable view of the search corpus (only canonical visible picker entries). */
export function listShapeSearchDocuments(): readonly ShapeSearchDocument[] {
  return documents;
}

function fieldMatchScore(field: ShapeSearchField, query: string, queryTokens: readonly string[]): number | null {
  const value = field.normalized;
  if (value === query) return field.priority * 10;
  if (value.startsWith(query)) return field.priority * 10 + 1;
  if (value.includes(query)) return field.priority * 10 + 2;
  const fieldTokens = value.split(' ');
  if (queryTokens.every(token => fieldTokens.some(fieldToken => fieldToken.includes(token))))
    return field.priority * 10 + 3;
  return null;
}

/**
 * Search contract: every query token must match a searchable field; exact display names outrank
 * aliases, semantic vocabulary, IDs/legacy spellings, taxonomy, and description text, in that
 * order. Ties use the registry's category order then stable label and semantic ID ordering.
 */
export function searchShapeDefinitions(query: string): readonly ShapeDefinition[] {
  if (typeof query !== 'string' || query.length > MAX_SHAPE_SEARCH_QUERY_LENGTH) return [];
  const normalizedQuery = normalizeShapeSearchText(query.trim());
  if (!normalizedQuery) return [];
  const queryTokens = [...new Set(normalizedQuery.split(' ').filter(Boolean))];
  if (!queryTokens.length || queryTokens.length > 16) return [];

  const ranked: Array<{ definition: ShapeDefinition; score: number; categoryIndex: number }> = [];
  const seen = new Set<string>();
  for (const document of documents) {
    const { definition } = document;
    if (seen.has(definition.id)) continue;
    const matchingScores = document.fields.map(field => fieldMatchScore(field, normalizedQuery, queryTokens))
      .filter((score): score is number => score !== null);
    if (!matchingScores.length) continue;
    seen.add(definition.id);
    ranked.push({ definition, score: Math.min(...matchingScores), categoryIndex: categoryOrder.get(definition.category) ?? Number.MAX_SAFE_INTEGER });
  }

  ranked.sort((a, b) => a.score - b.score || a.categoryIndex - b.categoryIndex
    || compareNormalized(a.definition.label, b.definition.label)
    || (a.definition.id < b.definition.id ? -1 : a.definition.id > b.definition.id ? 1 : 0));
  return ranked.map(result => result.definition);
}
