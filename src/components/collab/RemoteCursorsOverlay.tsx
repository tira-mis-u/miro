import { useEffect, useState, useMemo } from 'react';
import type { CanvasEngine } from '../../engine/CanvasEngine';
import {
  getCollabPeers,
  getLocalCollabReaction,
  subscribeCollabPresence,
  type CollabPeer,
  type CollabReaction,
} from '../../store/collabPresence';

export interface RemoteCursorsOverlayProps {
  engine: CanvasEngine | null;
  camera: { x: number; y: number; zoom: number };
}

export function RemoteCursorsOverlay({ engine, camera }: RemoteCursorsOverlayProps) {
  const [peers, setPeers] = useState<CollabPeer[]>(() => getCollabPeers());
  const [localReaction, setLocalReaction] = useState<CollabReaction | null>(() => getLocalCollabReaction());

  useEffect(() => {
    return subscribeCollabPresence(() => {
      setPeers(getCollabPeers());
      setLocalReaction(getLocalCollabReaction());
    });
  }, []);

  const activeCursors = useMemo(() => {
    if (!engine) return [];
    const now = Date.now();
    const width = typeof window !== 'undefined' ? window.innerWidth : 1920;
    const height = typeof window !== 'undefined' ? window.innerHeight : 1080;
    const margin = 160; // Allow smooth entrance/exit

    return peers
      .filter(p => p.cursor && now - p.cursor.lastUpdate < 20000)
      .map(p => {
        const clientPos = engine.worldToClient(p.cursor!.x, p.cursor!.y);
        const age = now - p.cursor!.lastUpdate;
        // Miro-standard idle fading: full opacity for 10s, then gradually fade to 35% before disappearing at 20s
        const opacity = age < 10000 ? 1 : Math.max(0.35, 1 - (age - 10000) / 10000);
        return {
          peer: p,
          screenX: Math.round(clientPos.x * 10) / 10,
          screenY: Math.round(clientPos.y * 10) / 10,
          opacity,
          isVisible: clientPos.x >= -margin && clientPos.x <= width + margin &&
                     clientPos.y >= -margin && clientPos.y <= height + margin,
        };
      })
      .filter(item => item.isVisible);
  }, [peers, engine, camera]);

  const activeReactions = useMemo(() => {
    if (!engine) return [];
    const now = Date.now();
    const list: Array<{ id: string; emoji: string; screenX: number; screenY: number }> = [];

    // Peer reactions
    for (const p of peers) {
      if (p.reaction && now - p.reaction.timestamp < 2800) {
        const clientPos = engine.worldToClient(p.reaction.x, p.reaction.y);
        list.push({
          id: p.reaction.id,
          emoji: p.reaction.emoji,
          screenX: clientPos.x,
          screenY: clientPos.y,
        });
      }
    }

    // Local reaction
    if (localReaction && now - localReaction.timestamp < 2800) {
      const clientPos = engine.worldToClient(localReaction.x, localReaction.y);
      list.push({
        id: localReaction.id,
        emoji: localReaction.emoji,
        screenX: clientPos.x,
        screenY: clientPos.y,
      });
    }

    return list;
  }, [peers, localReaction, engine, camera]);

  if (activeCursors.length === 0 && activeReactions.length === 0) return null;

  return (
    <div
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
      {activeCursors.map(({ peer, screenX, screenY, opacity }) => (
        <div
          key={peer.clientId}
          className="remote-cursor-container"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            transform: `translate3d(${screenX}px, ${screenY}px, 0)`,
            transition: 'transform 60ms linear, opacity 250ms ease-out',
            opacity,
            willChange: 'transform, opacity',
            pointerEvents: 'none',
          }}
        >
          {/* Miro-style SVG Pointer Tip */}
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            className="remote-cursor-pointer"
            style={{
              filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.22))',
              transform: 'translate(-2px, -2px)',
            }}
          >
            <path
              d="M3 3L10.5 21L13.5 13.5L21 10.5L3 3Z"
              fill={peer.user.color}
              stroke="#ffffff"
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
          </svg>

          {/* Miro-style Name Badge Pill */}
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
