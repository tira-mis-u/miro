import type { Awareness } from 'y-protocols/awareness';
import { type BoardUserRole, resolveBoardRoleFromUrl } from './boardSecurity';

export interface CollabUser {
  id: string;
  anonymousNumber: number;
  name: string;
  avatarLabel: string;
  color: string;
  gradient: string;
  textColor: string;
  joinedAt: number;
  role?: BoardUserRole;
}

export interface CollabCursor {
  x: number;
  y: number;
  lastUpdate: number;
  isDrawing?: boolean;
}

export interface CollabReaction {
  id: string;
  emoji: string;
  x: number;
  y: number;
  timestamp: number;
}

export interface CollabPresenter {
  active: boolean;
  startedAt?: number;
  clientId?: number;
  x: number;
  y: number;
  zoom: number;
  presenterName: string;
}

export interface CollabAwarenessState {
  user?: CollabUser;
  cursor?: CollabCursor | null;
  reaction?: CollabReaction | null;
  presenter?: CollabPresenter | null;
  roleOverrides?: Record<number, BoardUserRole>;
}

export interface CollabPeer {
  clientId: number;
  user: CollabUser;
  cursor: CollabCursor | null;
  reaction?: CollabReaction | null;
  presenter?: CollabPresenter | null;
}

export const COLLAB_PALETTE = [
  { id: 1, name: 'Purple',  primary: '#7c3aed', gradient: 'linear-gradient(135deg, #8b5cf6, #6d28d9)', text: '#ffffff' },
  { id: 2, name: 'Emerald', primary: '#059669', gradient: 'linear-gradient(135deg, #10b981, #047857)', text: '#ffffff' },
  { id: 3, name: 'Amber',   primary: '#d97706', gradient: 'linear-gradient(135deg, #f59e0b, #b45309)', text: '#ffffff' },
  { id: 4, name: 'Rose',    primary: '#e11d48', gradient: 'linear-gradient(135deg, #f43f5e, #be123c)', text: '#ffffff' },
  { id: 5, name: 'Blue',    primary: '#2563eb', gradient: 'linear-gradient(135deg, #3b82f6, #1d4ed8)', text: '#ffffff' },
  { id: 6, name: 'Cyan',    primary: '#0891b2', gradient: 'linear-gradient(135deg, #06b6d4, #0e7490)', text: '#ffffff' },
  { id: 7, name: 'Indigo',  primary: '#4f46e5', gradient: 'linear-gradient(135deg, #6366f1, #3730a3)', text: '#ffffff' },
  { id: 8, name: 'Fuchsia', primary: '#c026d3', gradient: 'linear-gradient(135deg, #d946ef, #a21caf)', text: '#ffffff' },
  { id: 9, name: 'Orange',  primary: '#ea580c', gradient: 'linear-gradient(135deg, #f97316, #c2410c)', text: '#ffffff' },
  { id: 10, name: 'Teal',   primary: '#0d9488', gradient: 'linear-gradient(135deg, #14b8a6, #0f766e)', text: '#ffffff' },
];

const STORAGE_KEY_NUM = 'antiwhite_collab_anon_num';
const STORAGE_KEY_COLOR = 'antiwhite_collab_anon_color';

// Golden ratio conjugate (phi - 1) * 360 degrees: ~137.50776405 deg for uniform non-clustering hue spread
const GOLDEN_ANGLE = 137.50776405003785;
export const MAX_DISTINCT_COLORS = 28800; // 3600 hues * 8 lightness/saturation bands

/** Convert HSL (h in [0, 360), s in [0, 100], l in [0, 100]) to 6-char hex */
export function hslToHex(h: number, s: number, l: number): string {
  const normH = ((h % 360) + 360) % 360;
  const sat = Math.max(0, Math.min(100, s)) / 100;
  const lum = Math.max(0, Math.min(100, l)) / 100;

  const c = (1 - Math.abs(2 * lum - 1)) * sat;
  const x = c * (1 - Math.abs(((normH / 60) % 2) - 1));
  const m = lum - c / 2;

  let r = 0, g = 0, b = 0;
  if (normH < 60) { r = c; g = x; }
  else if (normH < 120) { r = x; g = c; }
  else if (normH < 180) { g = c; b = x; }
  else if (normH < 240) { g = x; b = c; }
  else if (normH < 300) { r = x; b = c; }
  else { r = c; b = x; }

  const toHex = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** Compute WCAG 2.1 relative luminance to determine optimal high-contrast text color */
export function getContrastTextColor(colorStr: string): string {
  if (!colorStr) return '#ffffff';
  let r = 0, g = 0, b = 0;

  const rgbMatch = colorStr.match(/rgba?\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgbMatch) {
    r = parseInt(rgbMatch[1], 10) / 255;
    g = parseInt(rgbMatch[2], 10) / 255;
    b = parseInt(rgbMatch[3], 10) / 255;
  } else if (colorStr.startsWith('#')) {
    const clean = colorStr.replace('#', '').trim();
    if (clean.length === 3) {
      r = parseInt(clean[0] + clean[0], 16) / 255;
      g = parseInt(clean[1] + clean[1], 16) / 255;
      b = parseInt(clean[2] + clean[2], 16) / 255;
    } else {
      r = parseInt(clean.slice(0, 2), 16) / 255;
      g = parseInt(clean.slice(2, 4), 16) / 255;
      b = parseInt(clean.slice(4, 6), 16) / 255;
    }
  }

  const R = Number.isFinite(r) ? r : 0;
  const G = Number.isFinite(g) ? g : 0;
  const B = Number.isFinite(b) ? b : 0;
  const lum = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  return lum > 0.62 ? '#0f172a' : '#ffffff';
}

/**
 * Generate a random RGB color in standard "rgb(r, g, b)" format.
 * Tuned with balanced saturation and luminance for crisp whiteboard contrast.
 */
export function getRandomRgbColor(): { primary: string; gradient: string; text: string } {
  let r = 0, g = 0, b = 0;
  for (let attempt = 0; attempt < 15; attempt++) {
    r = Math.floor(Math.random() * 256);
    g = Math.floor(Math.random() * 256);
    b = Math.floor(Math.random() * 256);
    const lum = 0.2126 * (r / 255) + 0.7152 * (g / 255) + 0.0722 * (b / 255);
    // Ensure visibility on light canvas (avoiding washed out pastel white/light yellow)
    if (lum >= 0.12 && lum <= 0.78) {
      break;
    }
  }
  const primary = `rgb(${r}, ${g}, ${b})`;
  const text = getContrastTextColor(primary);
  return {
    primary,
    gradient: `linear-gradient(135deg, ${primary}, ${primary})`,
    text,
  };
}

/**
 * Generate a mathematically distinct, aesthetic color for any index (1 to thousands)
 * using the golden ratio hue distribution and 8 distinct saturation/lightness bands.
 */
export function generateDistinctColor(index: number) {
  if (index >= 1 && index <= COLLAB_PALETTE.length) {
    const seed = COLLAB_PALETTE[index - 1];
    return {
      primary: seed.primary,
      gradient: seed.gradient,
      text: seed.text,
    };
  }

  const offset = index - 1;
  const hue = (offset * GOLDEN_ANGLE) % 360;
  const band = Math.floor(offset / 360) % 8;

  // Curated aesthetic bands optimized for canvas visibility and clear cursor contrast
  const satBands = [78, 85, 72, 88, 70, 82, 75, 86];
  const lumBands = [48, 42, 53, 39, 50, 44, 52, 41];
  const s = satBands[band];
  const l = lumBands[band];

  const primary = hslToHex(hue, s, l);
  const lighter = hslToHex(hue, s, Math.min(88, l + 7));
  const darker = hslToHex(hue, s, Math.max(16, l - 7));
  const gradient = `linear-gradient(135deg, ${lighter}, ${darker})`;
  const text = getContrastTextColor(primary);

  return { primary, gradient, text };
}

export function getPaletteForIndex(index: number) {
  return generateDistinctColor(index);
}

/**
 * Resolve an anonymous user ensuring that:
 * 1. The anonymous number is the lowest available free slot (1, 2, 3...)
 * 2. The color is completely unique and NEVER collides with any currently online peer.
 * 3. Defaults to random RGB color formatted as "rgb(r, g, b)".
 */
export function resolveAnonymousUser(
  takenNumbers: Set<number>,
  takenColors?: Set<string>,
  preferredNum?: number,
  preserveJoinedAt?: number,
  preferredColor?: string,
  useRandomRgb = true
): CollabUser {
  // 1. Resolve lowest available anonymous number
  let chosenNum = preferredNum && preferredNum >= 1 && !takenNumbers.has(preferredNum) ? preferredNum : 0;
  if (!chosenNum) {
    let candidate = 1;
    while (takenNumbers.has(candidate)) {
      candidate++;
    }
    chosenNum = candidate;
  }

  // 2. Resolve unique non-colliding color
  const normalizedTakenColors = new Set<string>();
  if (takenColors) {
    takenColors.forEach(c => {
      if (typeof c === 'string' && c.trim()) {
        normalizedTakenColors.add(c.toLowerCase().trim());
      }
    });
  }

  let selectedPalette: { primary: string; gradient: string; text: string } | null = null;

  // If user previously held a preferredColor in this session and it is still free, keep it
  if (preferredColor && !normalizedTakenColors.has(preferredColor.toLowerCase().trim())) {
    const text = getContrastTextColor(preferredColor);
    selectedPalette = {
      primary: preferredColor,
      gradient: `linear-gradient(135deg, ${preferredColor}, ${preferredColor})`,
      text,
    };
  }

  // Otherwise, if random RGB is enabled (default), generate a random RGB color!
  if (!selectedPalette && useRandomRgb) {
    let candidate = getRandomRgbColor();
    for (let attempts = 0; attempts < 25; attempts++) {
      if (!normalizedTakenColors.has(candidate.primary.toLowerCase())) {
        break;
      }
      candidate = getRandomRgbColor();
    }
    selectedPalette = candidate;
  }

  // Otherwise, fallback to the deterministic palette corresponding to the chosenNum
  if (!selectedPalette) {
    const candidateDefault = generateDistinctColor(chosenNum);
    if (!normalizedTakenColors.has(candidateDefault.primary.toLowerCase())) {
      selectedPalette = candidateDefault;
    } else {
      for (let cand = 1; cand <= MAX_DISTINCT_COLORS; cand++) {
        const pal = generateDistinctColor(cand);
        if (!normalizedTakenColors.has(pal.primary.toLowerCase())) {
          selectedPalette = pal;
          break;
        }
      }

      if (!selectedPalette) {
        selectedPalette = getRandomRgbColor();
      }
    }
  }

  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      window.sessionStorage.setItem(STORAGE_KEY_NUM, String(chosenNum));
      window.sessionStorage.setItem(STORAGE_KEY_COLOR, selectedPalette.primary);
    }
  } catch {
    // Session storage not available
  }

  return {
    id: `anon-${chosenNum}-${Math.random().toString(36).slice(2, 7)}`,
    anonymousNumber: chosenNum,
    name: `Anonymous ${chosenNum}`,
    avatarLabel: `A${chosenNum}`,
    color: selectedPalette.primary,
    gradient: selectedPalette.gradient,
    textColor: selectedPalette.text,
    joinedAt: preserveJoinedAt ?? Date.now(),
    role: resolveBoardRoleFromUrl(),
  };
}

let activeAwareness: Awareness | null = null;
let localCollabUser: CollabUser | null = null;
let changeHandlerAttached = false;
let lastCursorBroadcast = 0;
let pendingCursor: { x: number; y: number; isDrawing?: boolean } | null = null;
let rafHandle: number | null = null;
const listeners = new Set<() => void>();

function notifyListeners() {
  listeners.forEach(fn => fn());
}

function getStoredUserPreferences(): { preferredNum?: number; preferredColor?: string } {
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      const rawNum = window.sessionStorage.getItem(STORAGE_KEY_NUM);
      const preferredNum = rawNum ? parseInt(rawNum, 10) : undefined;
      const rawColor = window.sessionStorage.getItem(STORAGE_KEY_COLOR);
      const preferredColor = rawColor || undefined;
      return { preferredNum: Number.isNaN(preferredNum) ? undefined : preferredNum, preferredColor };
    }
  } catch {}
  return {};
}

export function initCollabPresence(awareness: Awareness): CollabUser {
  activeAwareness = awareness;

  // 1. Gather numbers and colors already taken by other connected peers
  const takenNumbers = new Set<number>();
  const takenColors = new Set<string>();
  const states = awareness.getStates();
  states.forEach((state, clientId) => {
    if (clientId !== awareness.clientID && state && (state as CollabAwarenessState).user) {
      const u = (state as CollabAwarenessState).user!;
      if (typeof u.anonymousNumber === 'number') {
        takenNumbers.add(u.anonymousNumber);
      }
      if (typeof u.color === 'string') {
        takenColors.add(u.color.toLowerCase());
      }
    }
  });

  if (!localCollabUser) {
    const { preferredNum, preferredColor } = getStoredUserPreferences();
    localCollabUser = resolveAnonymousUser(takenNumbers, takenColors, preferredNum, undefined, preferredColor);
  }

  awareness.setLocalStateField('user', localCollabUser);
  awareness.setLocalStateField('cursor', null);

  if (!changeHandlerAttached) {
    changeHandlerAttached = true;
    awareness.on('change', () => {
      if (localCollabUser && activeAwareness) {
        const myId = activeAwareness.clientID;
        const allStates = activeAwareness.getStates();
        let hasConflict = false;
        const otherNumbers = new Set<number>();
        const otherColors = new Set<string>();

        allStates.forEach((st, cid) => {
          if (cid !== myId && st && (st as CollabAwarenessState).user) {
            const otherUser = (st as CollabAwarenessState).user!;
            const num = otherUser.anonymousNumber;
            const col = typeof otherUser.color === 'string' ? otherUser.color.toLowerCase() : '';
            if (typeof num === 'number') otherNumbers.add(num);
            if (col) otherColors.add(col);

            const isNumConflict = num === localCollabUser!.anonymousNumber;
            const isColorConflict = col && col === localCollabUser!.color.toLowerCase();

            if (isNumConflict || isColorConflict) {
              const otherJoinedAt = typeof otherUser.joinedAt === 'number' ? otherUser.joinedAt : 0;
              const myJoinedAt = localCollabUser!.joinedAt;
              if (otherJoinedAt < myJoinedAt || (otherJoinedAt === myJoinedAt && cid < myId)) {
                hasConflict = true;
              }
            }
          }
        });

        if (hasConflict) {
          const reAssigned = resolveAnonymousUser(otherNumbers, otherColors, undefined, localCollabUser.joinedAt);
          localCollabUser = reAssigned;
          activeAwareness.setLocalStateField('user', reAssigned);
        }
      }
      notifyListeners();
    });
  }

  notifyListeners();
  return localCollabUser;
}

export function ensureLocalCollabUser(): CollabUser {
  if (!localCollabUser) {
    const { preferredNum, preferredColor } = getStoredUserPreferences();
    localCollabUser = resolveAnonymousUser(new Set(), new Set(), preferredNum, undefined, preferredColor, !preferredColor);
  }
  return localCollabUser;
}

export function getLocalCollabUser(): CollabUser {
  return ensureLocalCollabUser();
}

export function getLocalCollabReaction(): CollabReaction | null {
  if (!activeAwareness) return null;
  const s = activeAwareness.getLocalState() as CollabAwarenessState | undefined;
  return s?.reaction ?? null;
}

export function getLocalCollabPresenter(): CollabPresenter | null {
  if (!activeAwareness) return null;
  const s = activeAwareness.getLocalState() as CollabAwarenessState | undefined;
  return s?.presenter ?? null;
}

export function getEffectivePeerRole(peerClientId: number, fallbackRole: BoardUserRole = 'editor'): BoardUserRole {
  if (!activeAwareness) return fallbackRole;
  const states = activeAwareness.getStates();
  for (const [, st] of states) {
    const overrides = (st as CollabAwarenessState)?.roleOverrides;
    if (overrides && overrides[peerClientId]) {
      return overrides[peerClientId];
    }
  }
  return fallbackRole;
}

export function broadcastCollabRoleOverride(targetClientId: number, role: BoardUserRole) {
  if (!activeAwareness) return;
  const current = (activeAwareness.getLocalState() as CollabAwarenessState)?.roleOverrides || {};
  activeAwareness.setLocalStateField('roleOverrides', {
    ...current,
    [targetClientId]: role,
  });
  notifyListeners();
}

export function updateLocalCollabRole(role: BoardUserRole) {
  if (localCollabUser) {
    localCollabUser = { ...localCollabUser, role };
  }
  if (activeAwareness) {
    activeAwareness.setLocalStateField('user', localCollabUser);
  }
  notifyListeners();
}

export function getCollabPeers(): CollabPeer[] {
  if (!activeAwareness) return [];
  const myId = activeAwareness.clientID;
  const states = activeAwareness.getStates();
  const peers: CollabPeer[] = [];

  states.forEach((state, clientId) => {
    if (clientId === myId) return;
    const s = state as CollabAwarenessState | undefined;
    if (s && s.user) {
      const effectiveRole = getEffectivePeerRole(clientId, s.user.role ?? 'editor');
      peers.push({
        clientId,
        user: { ...s.user, role: effectiveRole },
        cursor: s.cursor ?? null,
        reaction: s.reaction ?? null,
        presenter: s.presenter ?? null,
      });
    }
  });

  peers.sort((a, b) => a.user.anonymousNumber - b.user.anonymousNumber);
  return peers;
}

export function broadcastCollabReaction(emoji: string, worldPos: { x: number; y: number }) {
  if (!activeAwareness) return;
  const reaction: CollabReaction = {
    id: `react-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    emoji,
    x: Math.round(worldPos.x * 10) / 10,
    y: Math.round(worldPos.y * 10) / 10,
    timestamp: Date.now(),
  };
  activeAwareness.setLocalStateField('reaction', reaction);
  setTimeout(() => {
    if (activeAwareness?.getLocalState()?.reaction?.id === reaction.id) {
      activeAwareness.setLocalStateField('reaction', null);
    }
  }, 2800);
}

export function broadcastCollabPresenter(state: CollabPresenter | null) {
  if (!activeAwareness) return;
  activeAwareness.setLocalStateField('presenter', state);
}

export function broadcastCollabCursor(worldPos: { x: number; y: number } | null, isDrawing = false) {
  if (!activeAwareness) return;

  if (worldPos === null) {
    pendingCursor = null;
    activeAwareness.setLocalStateField('cursor', null);
    return;
  }

  pendingCursor = { ...worldPos, isDrawing };
  const now = performance.now();
  // 60fps throttle (~16ms) for fluid cursor tracking
  if (now - lastCursorBroadcast >= 16) {
    flushPendingCursor();
  } else if (!rafHandle) {
    rafHandle = window.requestAnimationFrame(() => {
      rafHandle = null;
      flushPendingCursor();
    });
  }
}

function flushPendingCursor() {
  if (!activeAwareness || !pendingCursor) return;
  lastCursorBroadcast = performance.now();
  const cursorData: CollabCursor = {
    x: Math.round(pendingCursor.x * 10) / 10,
    y: Math.round(pendingCursor.y * 10) / 10,
    lastUpdate: Date.now(),
    ...(pendingCursor.isDrawing ? { isDrawing: true } : {}),
  };
  activeAwareness.setLocalStateField('cursor', cursorData);
}

export function subscribeCollabPresence(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
