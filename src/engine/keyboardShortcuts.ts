import type { ToolType } from './CanvasEngine';

export type CanvasShortcutAction =
  | { type: 'pan'; dx: number; dy: number }
  | { type: 'undo' | 'redo' | 'duplicate' | 'delete' | 'clear-selection' | 'open-image' }
  | { type: 'tool'; tool: ToolType };

interface ShortcutKeyInput {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
}

/** Pure key-to-action mapping shared with the canvas listener and integration tests. */
export function getCanvasShortcutAction(
  event: ShortcutKeyInput,
  selectionEmpty: boolean,
): CanvasShortcutAction | null {
  if (selectionEmpty && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
    const pan: Record<string, [number, number]> = {
      ArrowUp: [0, 50],
      ArrowDown: [0, -50],
      ArrowLeft: [50, 0],
      ArrowRight: [-50, 0],
    };
    const [dx, dy] = pan[event.key];
    return { type: 'pan', dx, dy };
  }

  const ctrl = event.ctrlKey || event.metaKey;
  if (ctrl && event.key === 'z') return { type: 'undo' };
  if (ctrl && (event.key === 'y' || event.key === 'Z')) return { type: 'redo' };
  if (ctrl && event.key === 'd') return { type: 'duplicate' };
  if (event.key === 'Delete' || event.key === 'Backspace') return { type: 'delete' };

  const toolByKey: Record<string, ToolType | 'img'> = {
    v: 'select', p: 'pen', e: 'eraser', s: 'sticky',
    t: 'text', r: 'rect', o: 'ellipse', a: 'block-arrow', i: 'img',
  };
  const action = toolByKey[event.key.toLowerCase()];
  if (action === 'img') return { type: 'open-image' };
  if (action) return { type: 'tool', tool: action };
  if (event.key === 'Escape') return { type: 'clear-selection' };
  return null;
}
