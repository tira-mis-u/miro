const svgCursor = (svg: string, hotX: number, hotY: number, fallback: string) =>
  `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${hotX} ${hotY}, ${fallback}`;

const outlined = (path: string, innerFill = '#111827') =>
  `<path d="${path}" fill="${innerFill}" stroke="#fff" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/><path d="${path}" fill="${innerFill}" stroke="#111827" stroke-width="1.1" stroke-linejoin="round" stroke-linecap="round"/>`;

const arrowSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">${outlined('M4 2.5v17l4.4-4.2 3.2 6.2 2.6-1.3-3.1-6.1 6.4-.3z')}</svg>`;
const textSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M12 3v18M7 4h10M7 20h10" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round"/><path d="M12 3v18M7 4h10M7 20h10" fill="none" stroke="#111827" stroke-width="2.3" stroke-linecap="round"/></svg>`;
const crosshairSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4" fill="#fff" stroke="#111827" stroke-width="3"/><path d="M12 1v6M12 17v6M1 12h6M17 12h6" stroke="#fff" stroke-width="4"/><path d="M12 1v6M12 17v6M1 12h6M17 12h6" stroke="#111827" stroke-width="1.6"/></svg>`;
const grabPath = 'M8 12V6a2 2 0 0 1 4 0v5-7a2 2 0 0 1 4 0v7-5a2 2 0 0 1 4 0v7-3a2 2 0 0 1 4 0v5a7 7 0 0 1-7 7h-3a6 6 0 0 1-5-3l-3-4a2 2 0 0 1 3-3l3 3';
const grabSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">${outlined(grabPath)}</svg>`;
const grabClosedPath = 'M6 12l3-2V7a2 2 0 0 1 4 0v3-4a2 2 0 0 1 4 0v4-2a2 2 0 0 1 4 0v5a7 7 0 0 1-7 7h-2a7 7 0 0 1-6-4l-2-3a2 2 0 0 1 2-3z';
const grabbingSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">${outlined(grabClosedPath)}</svg>`;
const moveSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M12 2 8.8 5.2h2v4h-4v-2L3.5 10.5 6.8 13.8v-2h4v4h-2L12 19l3.2-3.2h-2v-4h4v2l3.3-3.3-3.3-3.3v2h-4v-4h2z" fill="#111827" stroke="#fff" stroke-width="2.8" stroke-linejoin="round"/><path d="M12 4.2 10.8 5.5h1.3v4.8H7.3V9L5.5 10.7l1.8 1.8v-1.3h4.8V16h-1.3l1.2 1.3 1.3-1.3h-1.3v-4.8h4.8v1.3l1.8-1.8-1.8-1.7v1.3H12V5.5h1.3z" fill="#111827"/></svg>`;
const pointerSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M5 3v15l4-3.5 3 6 2.7-1.4-3-6 6-.2z" fill="#111827" stroke="#fff" stroke-width="4" stroke-linejoin="round"/><path d="M5 3v15l4-3.5 3 6 2.7-1.4-3-6 6-.2z" fill="#111827" stroke="#111827" stroke-width="1" stroke-linejoin="round"/></svg>`;

export const HIGH_CONTRAST_CURSORS = {
  default: svgCursor(arrowSvg, 3, 2, 'default'),
  pointer: svgCursor(pointerSvg, 5, 2, 'pointer'),
  text: svgCursor(textSvg, 12, 12, 'text'),
  crosshair: svgCursor(crosshairSvg, 12, 12, 'crosshair'),
  grab: svgCursor(grabSvg, 12, 11, 'grab'),
  grabbing: svgCursor(grabbingSvg, 12, 11, 'grabbing'),
  move: svgCursor(moveSvg, 12, 12, 'move'),
} as const;

export function visibleCursor(cursor: string): string {
  return HIGH_CONTRAST_CURSORS[cursor as keyof typeof HIGH_CONTRAST_CURSORS] ?? cursor;
}
