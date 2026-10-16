import * as Y from 'yjs';
import { HocuspocusProvider, WebSocketStatus } from '@hocuspocus/provider';
import type { AnyShape } from '../engine/CanvasEngine';
import { IndexedDbYjsUpdateStorage, LocalYjsPersistence, type LocalPersistenceStatus, type YjsUpdateStorage } from './localYjsPersistence';
import { initCollabPresence } from './collabPresence';

export function getBoardId(): string {
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    const custom = params.get('board')?.trim();
    if (custom) return custom;
  }
  return 'board-1';
}

export const BOARD_ID = getBoardId();
export const ydoc = new Y.Doc();
export const yShapes = ydoc.getMap<AnyShape>('shapes');

export type BoardSyncState = 'connecting' | 'connected' | 'disconnected' | 'synced';
export type BoardLocalState = 'restoring' | 'saved' | 'saving' | 'error' | 'unavailable';
export type BoardInitializationPhase = 'restoring' | 'ready' | 'error';

export interface BoardRuntimeStatus {
  phase: BoardInitializationPhase;
  local: BoardLocalState;
  sync: BoardSyncState;
  unsyncedRemoteChanges: boolean;
  message?: string;
}

let runtimeStatus: BoardRuntimeStatus = {
  phase: 'restoring',
  local: 'restoring',
  sync: 'disconnected',
  unsyncedRemoteChanges: false,
};
const statusListeners = new Set<() => void>();
let initialization: Promise<void> | null = null;
let localPersistence: LocalYjsPersistence | null = null;
let realtimeProvider: HocuspocusProvider | null = null;
let localState: BoardLocalState = 'restoring';
let localMessage: string | undefined;

export function subscribeBoardRuntimeStatus(listener: () => void): () => void {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

export function getBoardRuntimeStatus(): BoardRuntimeStatus {
  return runtimeStatus;
}

function publishStatus(patch: Partial<BoardRuntimeStatus>): void {
  const next = { ...runtimeStatus, ...patch };
  if (next.phase === runtimeStatus.phase && next.local === runtimeStatus.local && next.sync === runtimeStatus.sync &&
      next.unsyncedRemoteChanges === runtimeStatus.unsyncedRemoteChanges && next.message === runtimeStatus.message) return;
  runtimeStatus = next;
  statusListeners.forEach(listener => listener());
}

function receiveLocalStatus(status: LocalPersistenceStatus): void {
  localState = status.state;
  localMessage = status.error;
  publishStatus({ local: localState, message: localMessage });
}

/**
 * Dynamically resolves WebSocket URL based on current page URL, supporting:
 * - Current domain & port changes (never hardcoded to localhost)
 * - Auto-negotiation of HTTPS -> wss: and HTTP -> ws:
 * - Query parameter override (?ws_url=...) or environment variable (VITE_WS_URL)
 * - Reverse proxy subpaths (e.g., /miro/ws, /boards/ws)
 */
export function resolveRealtimeWsUrl(path = '/ws'): string {
  if (typeof window === 'undefined') return '';
  try {
    const params = new URLSearchParams(window.location.search);
    const custom = params.get('ws_url');
    if (custom && custom.trim()) return custom.trim();
  } catch {
    // Ignore URL parse errors
  }

  const envWs = (import.meta as unknown as { env?: { VITE_WS_URL?: string } }).env?.VITE_WS_URL;
  if (typeof envWs === 'string' && envWs.trim()) {
    return envWs.trim();
  }

  const isSecure = window.location.protocol === 'https:';
  const wsProtocol = isSecure ? 'wss:' : 'ws:';
  const url = new URL(path, window.location.href);
  url.protocol = wsProtocol;
  return url.toString();
}

function connectRealtime(): void {
  if (realtimeProvider || typeof window === 'undefined') return;
  const wsUrl = resolveRealtimeWsUrl('/ws');
  try {
    const currentBoardId = getBoardId();
    realtimeProvider = new HocuspocusProvider({
      url: wsUrl,
      name: currentBoardId,
      document: ydoc,
      onStatus: ({ status }) => {
        publishStatus({
          sync: status === WebSocketStatus.Connected ? 'connected' : status === WebSocketStatus.Connecting ? 'connecting' : 'disconnected',
        });
        if (status === WebSocketStatus.Connected && realtimeProvider?.awareness) {
          initCollabPresence(realtimeProvider.awareness);
        }
      },
      onSynced: ({ state }) => publishStatus({ sync: state ? 'synced' : 'connected' }),
      onUnsyncedChanges: ({ number }) => publishStatus({ unsyncedRemoteChanges: number > 0 }),
      onDisconnect: () => publishStatus({ sync: 'disconnected' }),
    });

    if (realtimeProvider.awareness) {
      initCollabPresence(realtimeProvider.awareness);
    }
  } catch (error) {
    publishStatus({ sync: 'disconnected', message: error instanceof Error ? error.message : String(error) });
  }
}

export function getRealtimeProvider(): HocuspocusProvider | null {
  return realtimeProvider;
}

export function getBoardAwareness(): import('y-protocols/awareness').Awareness | null {
  return realtimeProvider?.awareness ?? null;
}

/** Restore local Yjs content before mounting the board engine or opening realtime sync. */
export function initializeBoardStore(createStorage: () => YjsUpdateStorage = () => new IndexedDbYjsUpdateStorage()): Promise<void> {
  if (initialization) return initialization;
  localState = 'restoring';
  localMessage = undefined;
  publishStatus({ phase: 'restoring', local: 'restoring', message: undefined });

  const storage = createStorage();
  const persistence = new LocalYjsPersistence(ydoc, BOARD_ID, storage, receiveLocalStatus);
  initialization = (async () => {
    await persistence.restore();
    localPersistence = persistence;
    persistence.start();
    connectRealtime();
    publishStatus({ phase: 'ready', local: localState, sync: realtimeProvider?.isSynced ? 'synced' : runtimeStatus.sync, message: localMessage });
  })().catch(error => {
    persistence.destroy();
    storage.close?.();
    localPersistence = null;
    initialization = null;
    const message = error instanceof Error ? error.message : String(error);
    publishStatus({ phase: 'error', local: 'error', message });
    throw error;
  });
  return initialization;
}

/** Explicit escape hatch for browsers that deny IndexedDB; never silently start an empty board. */
export function continueWithoutLocalRecovery(): void {
  localPersistence?.destroy();
  localPersistence = null;
  localState = 'unavailable';
  localMessage = 'Local recovery is unavailable. Changes may not survive a page reload.';
  connectRealtime();
  publishStatus({ phase: 'ready', local: 'unavailable', message: localMessage });
}

export async function retryLocalBoardPersistence(): Promise<void> {
  await localPersistence?.retry();
}

export function getBoardYDoc(): Y.Doc {
  return ydoc;
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    localPersistence?.destroy();
    realtimeProvider?.destroy();
  });
}
