import assert from 'node:assert';
import { encodeBoardToken, decodeBoardToken } from '../boardSecurity.ts';

console.log('--- Testing Board Security & Cryptographic Tokenization ---');

// 1. Basic encode & decode
const original = 'board-1';
const token1 = encodeBoardToken(original);
console.log('Encoded token 1:', token1);
assert(token1.startsWith('brd_'), 'Token should start with "brd_"');
assert(token1.length >= 15, 'Token length should be reasonable');

const decoded1 = decodeBoardToken(token1);
assert.strictEqual(decoded1, original, 'Decoded board ID must match original');
console.log('✓ Basic encode and decode verified');

// 2. Nonce randomization: two tokens for the same ID must be different
const token2 = encodeBoardToken(original);
console.log('Encoded token 2:', token2);
assert.notStrictEqual(token1, token2, 'Two consecutive tokens for the same ID must use distinct nonces');
assert.strictEqual(decodeBoardToken(token2), original, 'Second token also decodes to original');
console.log('✓ Dynamic cryptographic nonce randomization verified');

// 3. Various board names & Unicode support
const complexIds = [
  'project-roadmap-2026',
  'sprint#42_retro!',
  'bảng-thiết-kế-sản-phẩm',
  'uuid-550e8400-e29b-41d4-a716-446655440000',
  'A',
];
for (const id of complexIds) {
  const enc = encodeBoardToken(id);
  const dec = decodeBoardToken(enc);
  assert.strictEqual(dec, id, `Failed roundtrip for ID: ${id}`);
}
console.log('✓ Complex & Unicode board IDs roundtrip verified');

// 4. Malformed tokens handling
assert.strictEqual(decodeBoardToken(''), null, 'Empty string returns null');
assert.strictEqual(decodeBoardToken('invalid-token'), null, 'Invalid prefix returns null');
assert.strictEqual(decodeBoardToken('brd_invalid!@#$'), null, 'Malformed base64 returns null');
assert.strictEqual(decodeBoardToken('brd_AA'), null, 'Truncated token returns null');
console.log('✓ Malformed & malicious token safety verified');

console.log('--- ALL BOARD SECURITY TESTS PASSED! ---');
