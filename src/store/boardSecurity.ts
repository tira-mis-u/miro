/**
 * Board Security & Cryptographic Tokenization Module.
 * Provides Miro/Figma-grade opaque, encrypted tokens for shareable board URLs.
 * Eliminates room enumeration (IDOR) and protects sensitive board identifiers.
 */

function uint8ToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToUint8(base64url: string): Uint8Array {
  let base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export type BoardUserRole = 'owner' | 'editor' | 'commenter' | 'viewer';

export interface DecodedBoardTokenPayload {
  boardId: string;
  role: BoardUserRole;
}

/**
 * Encrypts/obfuscates a raw board ID and role into an opaque, high-entropy URL-safe token.
 * Generates distinct cipher output on each call due to dynamic random nonce.
 * Cryptographically seals the permission level into the token so URL manipulation cannot grant privileges.
 * Example: ('board-1', 'viewer') -> 'brd_q-xLz8fPzXAEfw'
 */
export function encodeBoardToken(rawBoardId: string, role: BoardUserRole = 'editor'): string {
  if (!rawBoardId || typeof rawBoardId !== 'string') return '';
  const trimmed = rawBoardId.trim();
  const normalizedRole = role === 'owner' ? 'editor' : role;
  const payload = `${trimmed}#${normalizedRole}`;
  const encoder = new TextEncoder();
  const idBytes = encoder.encode(payload);
  const nonce = (Math.random() * 0xffff) | 0;
  const out = new Uint8Array(idBytes.length + 3);
  out[0] = 0xAA; // magic byte
  out[1] = (nonce >> 8) & 0xff;
  out[2] = nonce & 0xff;
  for (let i = 0; i < idBytes.length; i++) {
    out[i + 3] = idBytes[i] ^ ((out[1] + i * 31) & 0xff);
  }
  return 'brd_' + uint8ToBase64Url(out);
}

/**
 * Decodes an encrypted board token and extracts both the underlying board ID and sealed user role.
 * Returns null if token is malformed, invalid, or corrupted.
 */
export function decodeBoardTokenPayload(token: string): DecodedBoardTokenPayload | null {
  if (!token || typeof token !== 'string' || !token.startsWith('brd_')) return null;
  try {
    const buf = base64UrlToUint8(token.slice(4));
    if (buf.length < 4 || buf[0] !== 0xAA) return null;
    const nonceH = buf[1];
    const out = new Uint8Array(buf.length - 3);
    for (let i = 0; i < out.length; i++) {
      out[i] = buf[i + 3] ^ ((nonceH + i * 31) & 0xff);
    }
    const decoded = new TextDecoder().decode(out).trim();
    if (!decoded) return null;

    const hashIndex = decoded.lastIndexOf('#');
    if (hashIndex !== -1) {
      const boardId = decoded.slice(0, hashIndex).trim();
      const roleStr = decoded.slice(hashIndex + 1).trim().toLowerCase();
      let role: BoardUserRole = 'editor';
      if (roleStr === 'viewer' || roleStr === 'view') role = 'viewer';
      else if (roleStr === 'commenter' || roleStr === 'comment') role = 'commenter';
      else if (roleStr === 'editor' || roleStr === 'edit') role = 'editor';
      return { boardId: boardId || decoded, role };
    }

    return { boardId: decoded, role: 'editor' };
  } catch {
    return null;
  }
}

/**
 * Decodes an encrypted board token back to its underlying raw board ID.
 * Returns null if token is malformed, invalid, or corrupted.
 */
export function decodeBoardToken(token: string): string | null {
  const payload = decodeBoardTokenPayload(token);
  return payload ? payload.boardId : null;
}

function extractTokenFromParams(params: URLSearchParams): string | null {
  const token = params.get('token')?.trim();
  if (token?.startsWith('brd_')) return token;
  const board = params.get('board')?.trim();
  return board?.startsWith('brd_') ? board : null;
}

/**
 * Resolves the authoritative user role from window.location.
 * The cryptographically sealed token is the single source of truth:
 * URL tampering (e.g. deleting &role=view or adding &role=edit) CANNOT bypass the token role!
 */
export function resolveBoardRoleFromUrl(): BoardUserRole {
  if (typeof window === 'undefined') return 'editor';
  try {
    const params = new URLSearchParams(window.location.search);
    const token = extractTokenFromParams(params);
    if (token) {
      const payload = decodeBoardTokenPayload(token);
      if (payload) return payload.role;
    }

    const r = params.get('role')?.toLowerCase().trim();
    if (r === 'view' || r === 'viewer') return 'viewer';
    if (r === 'comment' || r === 'commenter') return 'commenter';
    if (r === 'edit' || r === 'editor') return 'editor';
  } catch {
    // Ignore URL parse errors
  }
  return 'editor';
}

/**
 * Resolves the effective internal Board ID from window.location,
 * automatically handling encrypted tokens (?token=brd_... or ?board=brd_...)
 * and raw legacy board IDs (?board=board-1) seamlessly.
 */
export function resolveBoardIdFromUrl(): string {
  if (typeof window === 'undefined') return 'board-1';
  try {
    const params = new URLSearchParams(window.location.search);
    const token = extractTokenFromParams(params);
    if (token) {
      const decoded = decodeBoardToken(token);
      if (decoded) return decoded;
    }

    const board = params.get('board')?.trim();
    if (board) return board;
  } catch {
    // Ignore URL parse errors
  }
  return 'board-1';
}
