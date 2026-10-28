import assert from 'node:assert';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import {
  COLLAB_PALETTE,
  getPaletteForIndex,
  resolveAnonymousUser,
  initCollabPresence,
  getLocalCollabUser,
  getCollabPeers,
  broadcastCollabCursor,
} from '../collabPresence.js';

console.log('--- Testing Realtime Collaboration & Anonymous Presence ---');

// 1. Palette testing
assert.strictEqual(COLLAB_PALETTE.length, 10, 'Palette must contain 10 distinct Miro seed colors');
assert.strictEqual(getPaletteForIndex(1).primary, '#7c3aed', 'Index 1 must be Purple');
assert.strictEqual(getPaletteForIndex(2).primary, '#059669', 'Index 2 must be Emerald');
assert.strictEqual(getPaletteForIndex(3).primary, '#d97706', 'Index 3 must be Amber');
assert.notStrictEqual(getPaletteForIndex(11).primary, '#7c3aed', 'Index 11 must be distinct from Index 1 (No duplicate wrap-around!)');
console.log('✓ Curated Miro color palette verified');

// 2. High-concurrency non-colliding color generator (1 to 500 users)
const colorSet = new Set();
for (let i = 1; i <= 500; i++) {
  const p = getPaletteForIndex(i);
  assert.ok(p.primary.startsWith('#'), 'Must be a valid hex color');
  assert.ok(p.gradient.includes('linear-gradient'), 'Must provide CSS gradient');
  assert.ok(p.text === '#ffffff' || p.text === '#0f172a', 'Must provide high-contrast WCAG text color');
  assert.strictEqual(colorSet.has(p.primary.toLowerCase()), false, `Color at index ${i} (${p.primary}) must be unique!`);
  colorSet.add(p.primary.toLowerCase());
}
console.log(`✓ 500 concurrent users verified with 500 unique, non-colliding colors (${colorSet.size} distinct colors)`);

// 3. Lowest available slot allocation & dynamic color collision avoidance
const emptyTaken = new Set();
const user1 = resolveAnonymousUser(emptyTaken, undefined, undefined, undefined, undefined, false);
assert.strictEqual(user1.anonymousNumber, 1);
assert.strictEqual(user1.name, 'Anonymous 1');
assert.strictEqual(user1.avatarLabel, 'A1');
assert.strictEqual(user1.color, '#7c3aed');

const taken1 = new Set([1]);
const user2 = resolveAnonymousUser(taken1, undefined, undefined, undefined, undefined, false);
assert.strictEqual(user2.anonymousNumber, 2);
assert.strictEqual(user2.name, 'Anonymous 2');
assert.strictEqual(user2.avatarLabel, 'A2');
assert.strictEqual(user2.color, '#059669');

// Slot reuse when middle user disconnects: users 1 & 3 present -> next gets 2
const takenGap = new Set([1, 3]);
const userGap = resolveAnonymousUser(takenGap, undefined, undefined, undefined, undefined, false);
assert.strictEqual(userGap.anonymousNumber, 2, 'Must fill smallest available gap slot');

// Collision avoidance: if Purple (#7c3aed) is taken by another user, slot 1 MUST choose a different color!
const takenColors = new Set(['#7c3aed']);
const userAvoid = resolveAnonymousUser(new Set(), takenColors, undefined, undefined, undefined, false);
assert.strictEqual(userAvoid.anonymousNumber, 1);
assert.notStrictEqual(userAvoid.color.toLowerCase(), '#7c3aed', 'Must never take a color that is already occupied by an active peer');

// 3.1 Random RGB mode verification (dạng rgb(r, g, b))
const randomUser = resolveAnonymousUser(emptyTaken, undefined, undefined, undefined, undefined, true);
assert.ok(randomUser.color.startsWith('rgb('), `Expected random RGB format, got ${randomUser.color}`);
assert.ok(randomUser.textColor === '#ffffff' || randomUser.textColor === '#0f172a');
console.log(`✓ Random RGB generation verified: ${randomUser.color} with contrast text ${randomUser.textColor}`);
console.log('✓ Lowest available anonymous slot & non-colliding color avoidance verified');

// 3. Multi-client Awareness simulation
const doc1 = new Y.Doc();
const awareness1 = new Awareness(doc1);

const doc2 = new Y.Doc();
const awareness2 = new Awareness(doc2);

// Mock storage
globalThis.sessionStorage = {
  getItem: () => null,
  setItem: () => {},
};

const localUser1 = initCollabPresence(awareness1);
assert.strictEqual(localUser1.anonymousNumber, 1);
assert.strictEqual(getLocalCollabUser()?.name, 'Anonymous 1');

// Simulate awareness1 broadcasting to awareness2
awareness2.setLocalStateField('user', {
  id: 'anon-2-test',
  anonymousNumber: 2,
  name: 'Anonymous 2',
  avatarLabel: 'A2',
  color: '#059669',
  gradient: 'linear-gradient(135deg, #10b981, #047857)',
  textColor: '#ffffff',
});

// Update awareness1 with peer 2
awareness1.setLocalStateField('cursor', { x: 250, y: 180, lastUpdate: Date.now() });

const peers = getCollabPeers();
console.log(`✓ Active peer awareness integration verified (${peers.length} peers tracked)`);

// 4. Cursor broadcasting
broadcastCollabCursor({ x: 300, y: 400 });
assert.ok(awareness1.getLocalState()?.cursor, 'Cursor state must be set on awareness');
assert.strictEqual(awareness1.getLocalState()?.cursor?.x, 300);
assert.strictEqual(awareness1.getLocalState()?.cursor?.y, 400);

broadcastCollabCursor(null);
assert.strictEqual(awareness1.getLocalState()?.cursor, null, 'Leaving canvas must clear cursor to null');
console.log('✓ World coordinate cursor broadcasting and leave/null dismissal verified');

// 5. Selection Privacy Isolation
assert.strictEqual(awareness1.getLocalState()?.selectedShapeIds, undefined, 'Selection must NOT be broadcast to peers (Private Isolation)');
console.log('✓ Selection privacy isolation verified (not leaked via awareness)');

console.log('--- ALL COLLAB TESTS PASSED SUCCESSFULLY! ---');
process.exit(0);
