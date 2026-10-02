import * as Y from 'yjs';

export interface StoredYjsUpdate {
  id: number;
  update: Uint8Array;
}

export interface LoadedYjsBoard {
  snapshot?: Uint8Array;
  updates: StoredYjsUpdate[];
}

export interface YjsUpdateStorage {
  load(boardId: string): Promise<LoadedYjsBoard>;
  append(boardId: string, updates: Uint8Array[]): Promise<number[]>;
  compact(boardId: string, snapshot: Uint8Array, throughUpdateId: number): Promise<void>;
  close?(): void;
}

export interface LocalPersistenceStatus {
  state: 'saved' | 'saving' | 'error';
  pendingUpdates: number;
  error?: string;
}

export class LocalBoardRecoveryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'LocalBoardRecoveryError';
  }
}

function asUpdate(value: Uint8Array | ArrayBuffer): Uint8Array {
  return value instanceof Uint8Array ? value.slice() : new Uint8Array(value.slice(0));
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionResult(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
  });
}

/** Append-only Yjs update log with periodic atomic snapshot compaction. */
export class IndexedDbYjsUpdateStorage implements YjsUpdateStorage {
  private databasePromise: Promise<IDBDatabase> | null = null;

  private database(): Promise<IDBDatabase> {
    if (this.databasePromise) return this.databasePromise;
    if (typeof indexedDB === 'undefined') {
      return Promise.reject(new Error('This browser does not provide IndexedDB for local board recovery.'));
    }

    this.databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('antiwhite-local-boards', 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains('snapshots')) database.createObjectStore('snapshots', { keyPath: 'boardId' });
        if (!database.objectStoreNames.contains('updates')) {
          const updates = database.createObjectStore('updates', { keyPath: 'id', autoIncrement: true });
          updates.createIndex('boardId', 'boardId', { unique: false });
        }
      };
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => database.close();
        resolve(database);
      };
      request.onerror = () => reject(request.error ?? new Error('Could not open local board storage.'));
      request.onblocked = () => reject(new Error('Local board storage is blocked by another open tab.'));
    }).catch(error => {
      this.databasePromise = null;
      throw error;
    });
    return this.databasePromise!;
  }

  async load(boardId: string): Promise<LoadedYjsBoard> {
    const database = await this.database();
    const transaction = database.transaction(['snapshots', 'updates'], 'readonly');
    const done = transactionResult(transaction);
    try {
      const snapshotRequest = transaction.objectStore('snapshots').get(boardId) as IDBRequest<{ update?: Uint8Array | ArrayBuffer } | undefined>;
      const updateRequest = transaction.objectStore('updates').index('boardId').getAll(IDBKeyRange.only(boardId)) as IDBRequest<Array<{ id: number; update: Uint8Array | ArrayBuffer }>>;
      const [snapshot, updates] = await Promise.all([requestResult(snapshotRequest), requestResult(updateRequest)]);
      await done;
      return {
        snapshot: snapshot?.update ? asUpdate(snapshot.update) : undefined,
        updates: updates.sort((left, right) => left.id - right.id).map(record => ({ id: record.id, update: asUpdate(record.update) })),
      };
    } catch (error) {
      try { await done; } catch { /* Keep the originating request error. */ }
      throw error;
    }
  }

  async append(boardId: string, updates: Uint8Array[]): Promise<number[]> {
    if (!updates.length) return [];
    const database = await this.database();
    const transaction = database.transaction('updates', 'readwrite');
    const done = transactionResult(transaction);
    try {
      const store = transaction.objectStore('updates');
      const requests = updates.map(update => store.add({ boardId, update: update.slice() }));
      const ids = await Promise.all(requests.map(request => requestResult(request) as Promise<number>));
      await done;
      return ids;
    } catch (error) {
      try { transaction.abort(); } catch { /* The transaction may already be inactive. */ }
      try { await done; } catch { /* Keep the originating request error. */ }
      throw error;
    }
  }

  async compact(boardId: string, snapshot: Uint8Array, throughUpdateId: number): Promise<void> {
    const database = await this.database();
    const transaction = database.transaction(['snapshots', 'updates'], 'readwrite');
    const done = transactionResult(transaction);
    try {
      transaction.objectStore('snapshots').put({ boardId, update: snapshot.slice() });
      const updates = transaction.objectStore('updates');
      const cursorRequest = updates.index('boardId').openCursor(IDBKeyRange.only(boardId));
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) return;
        const record = cursor.value as { id: number };
        if (record.id <= throughUpdateId) cursor.delete();
        cursor.continue();
      };
      await done;
    } catch (error) {
      try { transaction.abort(); } catch { /* The transaction may already be inactive. */ }
      try { await done; } catch { /* Keep the originating request error. */ }
      throw error;
    }
  }

  close(): void {
    void this.databasePromise?.then(database => database.close()).catch(() => {});
    this.databasePromise = null;
  }
}

/**
 * Persists every Y.Doc update without delaying the editor. Failed writes stay queued in memory
 * and are reported; a later update/retry can flush them without replacing newer document state.
 */
export class LocalYjsPersistence {
  private readonly doc: Y.Doc;
  private readonly boardId: string;
  private readonly storage: YjsUpdateStorage;
  private readonly onStatus: (status: LocalPersistenceStatus) => void;
  private readonly compactAfterUpdates: number;
  private readonly pending: Uint8Array[] = [];
  private started = false;
  private flushPromise: Promise<void> | null = null;
  private lastPersistedUpdateId = 0;
  private updatesSinceSnapshot = 0;
  private lastError: unknown = null;
  private readonly pageHideListener = () => { void this.flush(); };
  private readonly visibilityListener = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') void this.retry();
  };

  constructor(
    doc: Y.Doc,
    boardId: string,
    storage: YjsUpdateStorage,
    onStatus: (status: LocalPersistenceStatus) => void = () => {},
    compactAfterUpdates = 200,
  ) {
    this.doc = doc;
    this.boardId = boardId;
    this.storage = storage;
    this.onStatus = onStatus;
    this.compactAfterUpdates = compactAfterUpdates;
  }

  async restore(): Promise<void> {
    let loaded: LoadedYjsBoard;
    try {
      loaded = await this.storage.load(this.boardId);
      if (loaded.snapshot) Y.applyUpdate(this.doc, loaded.snapshot, 'local-board-restore');
      for (const record of loaded.updates) Y.applyUpdate(this.doc, record.update, 'local-board-restore');
    } catch (error) {
      throw new LocalBoardRecoveryError('The saved local board could not be restored; no empty board was initialized.', { cause: error });
    }

    this.lastPersistedUpdateId = loaded.updates.at(-1)?.id ?? 0;
    this.updatesSinceSnapshot = loaded.updates.length;
    if (loaded.updates.length > 0) {
      try {
        await this.storage.compact(this.boardId, Y.encodeStateAsUpdate(this.doc), this.lastPersistedUpdateId);
        this.updatesSinceSnapshot = 0;
      } catch (error) {
        this.lastError = error;
        this.publish('error', error);
      }
    }
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.doc.on('update', this.handleUpdate);
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', this.pageHideListener);
      document.addEventListener('visibilitychange', this.visibilityListener);
    }
    if (!this.lastError) this.publish('saved');
  }

  private readonly handleUpdate = (update: Uint8Array): void => {
    this.pending.push(update.slice());
    this.lastError = null;
    this.publish('saving');
    void this.flush();
  };

  async flush(): Promise<void> {
    if (!this.started && this.pending.length === 0) return;
    if (this.flushPromise) return this.flushPromise;

    const task = (async () => {
      while (this.pending.length > 0) {
        const batch = this.pending.splice(0);
        try {
          const ids = await this.storage.append(this.boardId, batch);
          this.lastPersistedUpdateId = Math.max(this.lastPersistedUpdateId, ...ids);
          this.updatesSinceSnapshot += batch.length;
        } catch (error) {
          this.pending.unshift(...batch);
          this.lastError = error;
          this.publish('error', error);
          return;
        }
      }
      this.publish('saved');
      if (this.updatesSinceSnapshot >= this.compactAfterUpdates && this.lastPersistedUpdateId > 0) {
        const watermark = this.lastPersistedUpdateId;
        const snapshot = Y.encodeStateAsUpdate(this.doc);
        try {
          await this.storage.compact(this.boardId, snapshot, watermark);
          this.updatesSinceSnapshot = 0;
        } catch (error) {
          this.lastError = error;
          this.publish('error', error);
        }
      }
    })();
    this.flushPromise = task.finally(() => {
      this.flushPromise = null;
      if (this.started && this.pending.length > 0 && !this.lastError) void this.flush();
    });
    return this.flushPromise;
  }

  async retry(): Promise<void> {
    if (!this.started) return;
    this.lastError = null;
    if (this.pending.length) this.publish('saving');
    await this.flush();
  }

  destroy(): void {
    if (!this.started) return;
    this.started = false;
    this.doc.off('update', this.handleUpdate);
    if (typeof window !== 'undefined') {
      window.removeEventListener('pagehide', this.pageHideListener);
      document.removeEventListener('visibilitychange', this.visibilityListener);
    }
    void this.flush();
  }

  private publish(state: LocalPersistenceStatus['state'], error?: unknown): void {
    this.onStatus({
      state,
      pendingUpdates: this.pending.length,
      ...(error ? { error: error instanceof Error ? error.message : String(error) } : {}),
    });
  }
}
