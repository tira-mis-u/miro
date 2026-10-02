import { HighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';

/** Shared syntax colors for the real CodeMirror language extensions. */
export const codeHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: '#c586c0' },
  { tag: tags.operator, color: '#d4d4d4' },
  { tag: tags.punctuation, color: '#c8c8c8' },
  { tag: tags.string, color: '#ce9178' },
  { tag: tags.regexp, color: '#d16969' },
  { tag: tags.escape, color: '#d7ba7d' },
  { tag: tags.number, color: '#b5cea8' },
  { tag: tags.comment, color: '#6a9955', fontStyle: 'italic' },
  { tag: tags.variableName, color: '#9cdcfe' },
  { tag: tags.propertyName, color: '#9cdcfe' },
  { tag: tags.definition(tags.variableName), color: '#dcdcaa' },
  { tag: tags.function(tags.variableName), color: '#dcdcaa' },
  { tag: tags.typeName, color: '#4ec9b0' },
  { tag: tags.className, color: '#4ec9b0' },
  { tag: tags.namespace, color: '#4ec9b0' },
  { tag: tags.annotation, color: '#dcdcaa' },
  { tag: tags.bool, color: '#569cd6' },
  { tag: tags.atom, color: '#569cd6' },
  { tag: tags.constant(tags.variableName), color: '#4fc1ff' },
  { tag: tags.meta, color: '#9cdcfe' },
  { tag: tags.invalid, color: '#f48771', textDecoration: 'underline wavy' },
]);
