export type PaletteExpandedSections = Readonly<Record<string, boolean>>;

export const DEFAULT_PALETTE_EXPANDED: PaletteExpandedSections = Object.freeze({ functions: true });

export function isPaletteSectionExpanded(state: PaletteExpandedSections, sectionId: string): boolean {
  return state[sectionId] === true;
}

/** Toggle only the selected section so independent accordion state is preserved. */
export function togglePaletteSection(state: PaletteExpandedSections, sectionId: string): PaletteExpandedSections {
  return { ...state, [sectionId]: !isPaletteSectionExpanded(state, sectionId) };
}
