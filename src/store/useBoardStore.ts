import * as Y from 'yjs';
import { HocuspocusProvider, WebSocketStatus } from '@hocuspocus/provider';
import type { AnyShape } from '../engine/CanvasEngine';
import { IndexedDbYjsUpdateStorage, LocalYjsPersistence, type LocalPersistenceStatus, type YjsUpdateStorage } from './localYjsPersistence';

export const BOARD_ID = 'board-1';
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

function connectRealtime(): void {
  if (realtimeProvider || typeof window === 'undefined') return;
  const url = new URL('/ws', window.location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  try {
    realtimeProvider = new HocuspocusProvider({
      url: url.toString(),
      name: BOARD_ID,
      document: ydoc,
      onStatus: ({ status }) => publishStatus({
        sync: status === WebSocketStatus.Connected ? 'connected' : status === WebSocketStatus.Connecting ? 'connecting' : 'disconnected',
      }),
      onSynced: ({ state }) => publishStatus({ sync: state ? 'synced' : 'connected' }),
      onUnsyncedChanges: ({ number }) => publishStatus({ unsyncedRemoteChanges: number > 0 }),
      onDisconnect: () => publishStatus({ sync: 'disconnected' }),
    });
  } catch (error) {
    publishStatus({ sync: 'disconnected', message: error instanceof Error ? error.message : String(error) });
  }
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
