import type { Extension } from '@codemirror/state';

export const CODE_LANGUAGES = [
  { value: 'c', label: 'C' },
  { value: 'cpp', label: 'C++' },
  { value: 'csharp', label: 'C#' },
  { value: 'java', label: 'Java' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'python', label: 'Python' },
  { value: 'pascal', label: 'Pascal' },
  { value: 'php', label: 'PHP' },
  { value: 'sql', label: 'SQL' },
] as const;

export type CodeLanguage = typeof CODE_LANGUAGES[number]['value'];
export const DEFAULT_CODE_LANGUAGE: CodeLanguage = 'javascript';

export function normalizeCodeLanguage(language: unknown): CodeLanguage {
  return CODE_LANGUAGES.some(option => option.value === language)
    ? language as CodeLanguage
    : DEFAULT_CODE_LANGUAGE;
}

/** Load the actual CodeMirror language support (official Lezer modes where available). */
export async function loadCodeLanguageExtension(language: CodeLanguage): Promise<Extension> {
  switch (language) {
    case 'c': {
      const [{ c }, { StreamLanguage }] = await Promise.all([
        import('@codemirror/legacy-modes/mode/clike'),
        import('@codemirror/language'),
      ]);
      return StreamLanguage.define(c);
    }
    case 'cpp':
      return (await import('@codemirror/lang-cpp')).cpp();
    case 'csharp': {
      const [{ csharp }, { StreamLanguage }] = await Promise.all([
        import('@codemirror/legacy-modes/mode/clike'),
        import('@codemirror/language'),
      ]);
      return StreamLanguage.define(csharp);
    }
    case 'java':
      return (await import('@codemirror/lang-java')).java();
    case 'javascript':
      return (await import('@codemirror/lang-javascript')).javascript();
    case 'python':
      return (await import('@codemirror/lang-python')).python();
    case 'pascal': {
      const [{ pascal }, { StreamLanguage }] = await Promise.all([
        import('@codemirror/legacy-modes/mode/pascal'),
        import('@codemirror/language'),
      ]);
      return StreamLanguage.define(pascal);
    }
    case 'php':
      return (await import('@codemirror/lang-php')).php();
    case 'sql':
      return (await import('@codemirror/lang-sql')).sql();
  }
}
