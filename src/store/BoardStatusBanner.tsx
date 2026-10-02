import { useSyncExternalStore } from 'react';
import { getBoardRuntimeStatus, retryLocalBoardPersistence, subscribeBoardRuntimeStatus } from './useBoardStore';

export default function BoardStatusBanner() {
  const status = useSyncExternalStore(subscribeBoardRuntimeStatus, getBoardRuntimeStatus, getBoardRuntimeStatus);
  if (status.phase !== 'ready') return null;

  if (status.local === 'error') {
    return (
      <div role="status" aria-live="polite" style={{ position: 'fixed', top: 72, left: '50%', transform: 'translateX(-50%)', zIndex: 1500,
        display: 'flex', alignItems: 'center', gap: 10, maxWidth: 'min(760px, calc(100vw - 24px))', padding: '9px 13px',
        color: '#7c2d12', background: '#fff7ed', border: '1px solid #fdba74', borderRadius: 10,
        boxShadow: '0 8px 24px rgba(15,23,42,.14)', font: '500 12px/1.4 Inter, Segoe UI, sans-serif' }}>
        <span>Local save is delayed or failed. Your edits remain in this tab; avoid reloading until saving recovers. {status.message}</span>
        <button type="button" onClick={() => { void retryLocalBoardPersistence(); }} style={{ flex: '0 0 auto', padding: '5px 8px', borderRadius: 6,
          background: '#ffedd5', color: '#7c2d12', fontWeight: 700 }}>Retry save</button>
      </div>
    );
  }

  if (status.local === 'saving') {
    return (
      <div role="status" aria-live="polite" style={{ position: 'fixed', top: 72, left: '50%', transform: 'translateX(-50%)', zIndex: 1500,
        maxWidth: 'min(720px, calc(100vw - 24px))', padding: '9px 13px', color: '#1e3a8a', background: '#eff6ff',
        border: '1px solid #bfdbfe', borderRadius: 10, boxShadow: '0 8px 24px rgba(15,23,42,.12)',
        font: '500 12px/1.4 Inter, Segoe UI, sans-serif' }}>
        {status.sync === 'disconnected'
          ? 'Saving edits locally; realtime sync is disconnected. Wait for local saving to finish before refreshing.'
          : 'Saving edits on this device. Wait for local saving to finish before refreshing.'}
      </div>
    );
  }

  if (status.local === 'unavailable') {
    return (
      <div role="status" aria-live="polite" style={{ position: 'fixed', top: 72, left: '50%', transform: 'translateX(-50%)', zIndex: 1500,
        maxWidth: 'min(720px, calc(100vw - 24px))', padding: '9px 13px', color: '#7c2d12', background: '#fff7ed',
        border: '1px solid #fdba74', borderRadius: 10, boxShadow: '0 8px 24px rgba(15,23,42,.14)',
        font: '500 12px/1.4 Inter, Segoe UI, sans-serif' }}>
        Local recovery is unavailable. Changes may not survive a page reload; {status.sync === 'disconnected' ? 'realtime sync is reconnecting.' : 'realtime sync is active.'}
      </div>
    );
  }

  if (status.sync === 'disconnected') {
    return (
      <div role="status" aria-live="polite" style={{ position: 'fixed', top: 72, left: '50%', transform: 'translateX(-50%)', zIndex: 1500,
        padding: '8px 12px', color: '#1e3a8a', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 9,
        boxShadow: '0 8px 24px rgba(15,23,42,.12)', font: '500 12px/1.35 Inter, Segoe UI, sans-serif' }}>
        Offline — edits are being saved on this device; realtime sync will retry.
      </div>
    );
  }

  if (status.unsyncedRemoteChanges) {
    return (
      <div role="status" aria-live="polite" style={{ position: 'fixed', top: 72, left: '50%', transform: 'translateX(-50%)', zIndex: 1500,
        padding: '8px 12px', color: '#854d0e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 9,
        boxShadow: '0 8px 24px rgba(15,23,42,.12)', font: '500 12px/1.35 Inter, Segoe UI, sans-serif' }}>
        Realtime updates are still syncing; local recovery remains active.
      </div>
    );
  }

  return null;
}
