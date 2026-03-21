import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

export const ydoc    = new Y.Doc();
export const yShapes = ydoc.getMap<any>('shapes');

// Connect to realtime server (non-blocking — app works offline too)
try {
  new WebsocketProvider('ws://localhost:1234', 'board-1', ydoc, { connect: true });
} catch (_) { /* server not running, works offline */ }
