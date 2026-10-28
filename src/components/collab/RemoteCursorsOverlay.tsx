import { useEffect, useState, useMemo, useRef } from 'react';
import type { CanvasEngine } from '../../engine/CanvasEngine';
import {
  getCollabPeers,
  getLocalCollabReaction,
  subscribeCollabPresence,
  type CollabPeer,
  type CollabReaction,
} from '../../store/collabPresence';

export interface OnScreenCursorItem {
  peer: CollabPeer;
  screenX: number;
  screenY: number;
  opacity: number;
  isDrawing: boolean;
  isTeleport: boolean;
  isVisible: boolean;
}

export interface OffScreenIndicatorItem {
  peer: CollabPeer;
  edgeX: number;
  edgeY: number;
  angleDeg: number;
  side: 'left' | 'right' | 'top' | 'bottom';
  worldX: number;
  worldY: number;
}

export interface RemoteCursorsOverlayProps {
  engine: CanvasEngine | null;
  camera: { x: number; y: number; zoom: number };
}

export function RemoteCursorsOverlay({ engine, camera }: RemoteCursorsOverlayProps) {
  const [peers, setPeers] = useState<CollabPeer[]>(() => getCollabPeers());
  const [localReaction, setLocalReaction] = useState<CollabReaction | null>(() => getLocalCollabReaction());

  const overlayRef = useRef<HTMLDivElement>(null);
  const peersRef = useRef<CollabPeer[]>(peers);
  const cursorNodesRef = useRef<Map<number, HTMLDivElement>>(new Map());
  const lastScreenPosRef = useRef<Map<number, { x: number; y: number }>>(new Map());

  // Keep peersRef updated immediately without waiting for React re-render
  useEffect(() => {
    return subscribeCollabPresence(() => {
      const nextPeers = getCollabPeers();
      peersRef.current = nextPeers;
      setPeers(nextPeers);
      setLocalReaction(getLocalCollabReaction());
    });
  }, []);

  // Frame-accurate camera listener decoupled from React render loop.
  // Updates cursor DOM transforms in lockstep with CanvasEngine render frames.
  useEffect(() => {
    if (!engine) return;

    const unsubscribe = engine.addCameraFrameListener(() => {
      const overlayEl = overlayRef.current;
      if (!overlayEl) return;
      const now = Date.now();
      const currentPeers = peersRef.current;

      for (const p of currentPeers) {
        if (!p.cursor || now - p.cursor.lastUpdate >= 20000) continue;
        const node = cursorNodesRef.current.get(p.clientId);
        if (!node) continue;

        const pos = engine.worldToOverlay(p.cursor.x, p.cursor.y, overlayEl);
        const x = Math.round(pos.x * 10) / 10;
        const y = Math.round(pos.y * 10) / 10;
        node.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        lastScreenPosRef.current.set(p.clientId, { x, y });
      }
    });

    return unsubscribe;
  }, [engine]);

  const activeCursors = useMemo<{ onScreen: OnScreenCursorItem[]; offScreen: OffScreenIndicatorItem[] }>(() => {
    if (!engine) return { onScreen: [], offScreen: [] };
    const now = Date.now();
    const overlayEl = overlayRef.current;
    const parent = overlayEl?.parentElement;
    const width = overlayEl?.clientWidth || parent?.clientWidth || (typeof window !== 'undefined' ? window.innerWidth - 68 : 1200);
    const height = overlayEl?.clientHeight || parent?.clientHeight || (typeof window !== 'undefined' ? window.innerHeight - 52 : 750);

    const onScreen: OnScreenCursorItem[] = [];
    const offScreen: OffScreenIndicatorItem[] = [];

    // Safe bounds within workspace overlay (header is outside workspace, toolbar is outside workspace)
    // Add safe padding inside workspace edges:
    // padLeft = 92px ensures the pill (centered with translate(-50%, -50%), width ~130-150px)
    // has its left boundary >= 20px away from the left tool-rail (sidebar), avoiding any clipping or overlap.
    const padLeft = 92;
    const padRight = 85;
    const padTop = 32;
    const padBottom = 72;
    const minX = padLeft;
    const maxX = Math.max(minX + 10, width - padRight);
    const minY = padTop;
    const maxY = Math.max(minY + 10, height - padBottom);
    const cx = width / 2;
    const cy = height / 2;

    for (const p of peers) {
      if (!p.cursor || now - p.cursor.lastUpdate >= 20000) continue;
      const pos = engine.worldToOverlay(p.cursor.x, p.cursor.y, overlayEl);
      const screenX = Math.round(pos.x * 10) / 10;
      const screenY = Math.round(pos.y * 10) / 10;
      const age = now - p.cursor.lastUpdate;
      const opacity = age < 10000 ? 1 : Math.max(0.35, 1 - (age - 10000) / 10000);

      const lastPos = lastScreenPosRef.current.get(p.clientId);
      const isTeleport = lastPos ? (Math.hypot(screenX - lastPos.x, screenY - lastPos.y) > 300) : false;
      lastScreenPosRef.current.set(p.clientId, { x: screenX, y: screenY });
      const isDrawing = Boolean(p.cursor.isDrawing);

      // Check if cursor is visibly inside the overlay workspace
      const isInside = screenX >= 0 && screenX <= width && screenY >= 0 && screenY <= height;

      if (isInside) {
        onScreen.push({
          peer: p,
          screenX,
          screenY,
          opacity,
          isDrawing,
          isTeleport,
          isVisible: true,
        });
      } else {
        // Project ray from overlay center (cx, cy) to (screenX, screenY) onto the safe edge rectangle
        const dx = screenX - cx;
        const dy = screenY - cy;

        let t = 1;
        let side: 'left' | 'right' | 'top' | 'bottom' = dx > 0 ? 'right' : 'left';
        if (Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001) {
          const tx = Math.abs(dx) > 0.001 ? (dx > 0 ? (maxX - cx) / dx : (minX - cx) / dx) : Infinity;
          const ty = Math.abs(dy) > 0.001 ? (dy > 0 ? (maxY - cy) / dy : (minY - cy) / dy) : Infinity;
          if (tx < ty) {
            t = tx;
            side = dx > 0 ? 'right' : 'left';
          } else {
            t = ty;
            side = dy > 0 ? 'bottom' : 'top';
          }
        }

        const edgeX = Math.round((cx + t * dx) * 10) / 10;
        const edgeY = Math.round((cy + t * dy) * 10) / 10;
        const angleDeg = Math.round(Math.atan2(dy, dx) * (180 / Math.PI));

        offScreen.push({
          peer: p,
          edgeX,
          edgeY,
          angleDeg,
          side,
          worldX: p.cursor.x,
          worldY: p.cursor.y,
        });
      }
    }

    return { onScreen, offScreen };
  }, [peers, engine, camera]);

  const activeReactions = useMemo(() => {
    if (!engine) return [];
    const now = Date.now();
    const overlayEl = overlayRef.current;
    const allReactions = [
      ...peers.map(p => p.reaction),
      localReaction,
    ].filter((r): r is NonNullable<typeof r> => Boolean(r && now - r.timestamp < 2800));

    return allReactions.map(r => {
      const pos = engine.worldToOverlay(r.x, r.y, overlayEl);
      return {
        id: r.id,
        emoji: r.emoji,
        screenX: Math.round(pos.x * 10) / 10,
        screenY: Math.round(pos.y * 10) / 10,
      };
    });
  }, [peers, localReaction, engine, camera]);

  const stopPropagation = (e: React.SyntheticEvent) => e.stopPropagation();

  const handleJumpToPeer = (worldX: number, worldY: number, e: React.SyntheticEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!engine) return;
    if (typeof engine.panTo === 'function') {
      engine.panTo(worldX, worldY);
    } else if (typeof engine.setCamera === 'function') {
      engine.setCamera(worldX, worldY, engine.cam?.zoom ?? 1);
    }
  };

  const hasCursors = activeCursors.onScreen.length > 0 || activeCursors.offScreen.length > 0;
  if (!hasCursors && activeReactions.length === 0) return null;

  return (
    <div
      ref={overlayRef}
      className="remote-cursors-layer"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        overflow: 'hidden',
        zIndex: 40,
      }}
      aria-hidden="true"
    >
      {/* On-screen active cursors */}
      {activeCursors.onScreen.map(({ peer, screenX, screenY, opacity, isDrawing, isTeleport }) => (
        <div
          key={peer.clientId}
          ref={el => {
            if (el) cursorNodesRef.current.set(peer.clientId, el);
            else cursorNodesRef.current.delete(peer.clientId);
          }}
          className="remote-cursor-container"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            transform: `translate3d(${screenX}px, ${screenY}px, 0)`,
            transition: isDrawing || isTeleport ? 'none' : 'transform 20ms linear, opacity 250ms ease-out',
            opacity,
            willChange: 'transform, opacity',
            pointerEvents: 'none',
          }}
        >
          {/* Authentic Miro-grade Arrow Cursor Pointer */}
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            className="remote-cursor-pointer"
            style={{
              overflow: 'visible',
              filter: 'drop-shadow(0 2px 5px rgba(0, 0, 0, 0.28))',
            }}
          >
            <path
              d="M0 0L0 16.5L4.5 12.5L8.2 20.5L10.8 19.5L7.2 11.5L13.5 11.5Z"
              fill={peer.user.color}
              stroke="#ffffff"
              strokeWidth="1.5"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </svg>

          {/* Miro-style Anchored Name Badge Tag */}
          <div
            className="remote-cursor-badge"
            style={{
              backgroundColor: peer.user.color,
              color: peer.user.textColor,
            }}
          >
            <span className="remote-cursor-name">{peer.user.name}</span>
          </div>
        </div>
      ))}

      {/* Miro-style Directional Off-Screen Indicators */}
      {activeCursors.offScreen.map(({ peer, edgeX, edgeY, angleDeg, side, worldX, worldY }) => {
        const isArrowOnLeft = side === 'left' || side === 'top';
        const arrowElement = (
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            className="offscreen-collab-arrow"
            style={{
              transform: `rotate(${angleDeg}deg)`,
              transformOrigin: 'center center',
              flexShrink: 0,
              color: peer.user.color,
            }}
            aria-hidden="true"
          >
            <path
              d="M8.5 4.5l7 7.5-7 7.5"
              fill="none"
              stroke="#ffffff"
              strokeWidth="6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M8.5 4.5l7 7.5-7 7.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="3.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        );

        return (
          <div
            key={`offscreen-${peer.clientId}`}
            className={`offscreen-collab-pill offscreen-side-${side}`}
            role="button"
            tabIndex={0}
            title={`Click to jump to ${peer.user.name}`}
            aria-label={`Jump to ${peer.user.name}`}
            onPointerDown={stopPropagation}
            onPointerUp={stopPropagation}
            onMouseDown={stopPropagation}
            onTouchStart={stopPropagation}
            onClick={e => handleJumpToPeer(worldX, worldY, e)}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') {
                handleJumpToPeer(worldX, worldY, e);
              }
            }}
            style={{
              position: 'absolute',
              left: `${edgeX}px`,
              top: `${edgeY}px`,
              transform: 'translate(-50%, -50%)',
              pointerEvents: 'auto',
              cursor: 'pointer',
            }}
          >
            {isArrowOnLeft && arrowElement}

            <div
              className="offscreen-pill-body"
              style={{
                backgroundColor: peer.user.color,
                color: peer.user.textColor,
              }}
            >
              <span className="offscreen-avatar-badge" aria-hidden="true">
                {peer.user.avatarLabel}
              </span>

              <span className="offscreen-collab-name">{peer.user.name}</span>
            </div>

            {!isArrowOnLeft && arrowElement}
          </div>
        );
      })}

      {/* Miro-style Floating Animated Reactions */}
      {activeReactions.map(r => (
        <div
          key={r.id}
          className="floating-reaction"
          style={{
            position: 'absolute',
            left: r.screenX,
            top: r.screenY,
            pointerEvents: 'none',
          }}
        >
          <span className="floating-reaction-emoji">{r.emoji}</span>
        </div>
      ))}
    </div>
  );
}
