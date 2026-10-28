const svgCursor = (svg: string, hotX: number, hotY: number, fallback: string) =>
  `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${hotX} ${hotY}, ${fallback}`;

// Miro-authentic arrow cursor matching collaboration presence
const miroArrowSvg = (color: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M0 0L0 16.5L4.5 12.5L8.2 20.5L10.8 19.5L7.2 11.5L13.5 11.5Z" fill="${color}" stroke="#ffffff" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>`;

// Clean precision crosshair (clean intersecting lines with user color & high contrast, without gun aim circle)
const cleanCrosshairSvg = (color: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M12 2v20M2 12h20" stroke="#ffffff" stroke-width="3.5" stroke-linecap="round"/><path d="M12 2v20M2 12h20" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/></svg>`;

const textSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M12 3v18M7 4h10M7 20h10" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round"/><path d="M12 3v18M7 4h10M7 20h10" fill="none" stroke="#111827" stroke-width="2.3" stroke-linecap="round"/></svg>`;
// Clean modern open hand cursor matching Lucide icon geometry
const grabSvg = (color: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"><g stroke="#ffffff" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2"/><path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/></g><g stroke="${color}" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2"/><path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/></g></svg>`;

// Clean modern closed fist grabbing cursor
const grabbingSvg = (color: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"><g stroke="#ffffff" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 11.5V9a2 2 0 0 0-2-2a2 2 0 0 0-2 2v1.4"/><path d="M14 10V8a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2"/><path d="M10 9.9V9a2 2 0 0 0-2-2a2 2 0 0 0-2 2v5"/><path d="M6 14a2 2 0 0 0-2-2a2 2 0 0 0-2 2"/><path d="M18 11a2 2 0 1 1 4 0v3a8 8 0 0 1-8 8h-4a8 8 0 0 1-8-8 2 2 0 1 1 4 0"/></g><g stroke="${color}" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M18 11.5V9a2 2 0 0 0-2-2a2 2 0 0 0-2 2v1.4"/><path d="M14 10V8a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2"/><path d="M10 9.9V9a2 2 0 0 0-2-2a2 2 0 0 0-2 2v5"/><path d="M6 14a2 2 0 0 0-2-2a2 2 0 0 0-2 2"/><path d="M18 11a2 2 0 1 1 4 0v3a8 8 0 0 1-8 8h-4a8 8 0 0 1-8-8 2 2 0 1 1 4 0"/></g></svg>`;
const moveSvg = (color: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M12 2 8.8 5.2h2v4h-4v-2L3.5 10.5 6.8 13.8v-2h4v4h-2L12 19l3.2-3.2h-2v-4h4v2l3.3-3.3-3.3-3.3v2h-4v-4h2z" fill="${color}" stroke="#fff" stroke-width="2.8" stroke-linejoin="round"/><path d="M12 4.2 10.8 5.5h1.3v4.8H7.3V9L5.5 10.7l1.8 1.8v-1.3h4.8V16h-1.3l1.2 1.3 1.3-1.3h-1.3v-4.8h4.8v1.3l1.8-1.8-1.8-1.7v1.3H12V5.5h1.3z" fill="${color}"/></svg>`;

export function getCustomCursors(userColor = '#2563eb') {
  return {
    default: svgCursor(miroArrowSvg(userColor), 0, 0, 'default'),
    pointer: svgCursor(miroArrowSvg(userColor), 0, 0, 'pointer'),
    text: svgCursor(textSvg, 12, 12, 'text'),
    crosshair: svgCursor(cleanCrosshairSvg(userColor), 12, 12, 'crosshair'),
    grab: svgCursor(grabSvg(userColor), 11, 11, 'grab'),
    grabbing: svgCursor(grabbingSvg(userColor), 11, 11, 'grabbing'),
    move: svgCursor(moveSvg(userColor), 12, 12, 'move'),
  } as const;
}

export const HIGH_CONTRAST_CURSORS = getCustomCursors('#2563eb');

export function visibleCursor(cursor: string, userColor = '#2563eb'): string {
  const cursors = getCustomCursors(userColor);
  if (cursor === 'default') return cursors.default;
  if (cursor === 'pointer') return cursors.pointer;
  if (cursor === 'crosshair') return cursors.crosshair;
  if (cursor === 'text') return cursors.text;
  if (cursor === 'grab') return cursors.grab;
  if (cursor === 'grabbing') return cursors.grabbing;
  if (cursor === 'move') return cursors.move;
  return cursor;
}
