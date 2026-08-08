/**
 * tests/integration/mux-signing.test.ts
 *
 * End-to-end test for Mux signed playback URL generation.
 * Generates a signed URL via signMuxPlaybackUrl, decodes the JWT,
 * and verifies the claims are correct.
 *
 * Uses a test RSA keypair (fixed fixture — no real Mux keys needed).
 * The private key is set in process.env.MUX_SIGNING_KEY_PRIVATE (base64-encoded).
 * The public key is used to verify the JWT.
 *
 * This test verifies:
 *   - JWT is RS256-signed
 *   - sub = userId
 *   - aud = 'v'
 *   - kid = keyId
 *   - playback_id claim = playbackId
 *   - lesson_id claim = lessonId
 *   - exp is ~6 hours from now
 *   - Token embeds correctly in the streaming URL
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { generateKeyPairSync } from 'crypto';

// ─── Generate test RSA keypair (2048-bit, fast enough for tests) ──────────────

let testPublicKey: string;
let testPrivateKeyB64: string;
const TEST_KEY_ID = 'test-key-id-12345';

beforeAll(() => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  testPublicKey = publicKey;
  // Mux stores the private key base64-encoded in the env var
  testPrivateKeyB64 = Buffer.from(privateKey).toString('base64');
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('signMuxPlaybackUrl — JWT claims integration test', () => {
  beforeEach(() => {
    // Reset modules so env var changes take effect in dynamic imports
    vi.resetModules();
    // Clean env
    delete process.env.MUX_SIGNING_KEY_ID;
    delete process.env.MUX_SIGNING_KEY_PRIVATE;
  });

  it('generates a valid RS256 JWT with correct claims', async () => {
    // Set env vars with test keypair
    process.env.MUX_SIGNING_KEY_ID = TEST_KEY_ID;
    process.env.MUX_SIGNING_KEY_PRIVATE = testPrivateKeyB64;

    // Import AFTER setting env vars — vi.resetModules() was called in beforeEach
    const { signMuxPlaybackUrl } = await import('@/lib/mux');

    const playbackId = 'mux-playback-id-abc123';
    const userId = 'user-uuid-def456';
    const lessonId = 'lesson-uuid-ghi789';

    const url = signMuxPlaybackUrl(playbackId, userId, lessonId);

    // URL format: https://stream.mux.com/{playbackId}.m3u8?token={jwt}
    expect(url).toMatch(/^https:\/\/stream\.mux\.com\/mux-playback-id-abc123\.m3u8\?token=/);

    // Extract the token
    const token = url.split('token=')[1];
    expect(token).toBeTruthy();

    // Verify and decode with the test public key
    const nowSec = Math.floor(Date.now() / 1000);
    const decoded = jwt.verify(token, testPublicKey, {
      algorithms: ['RS256'],
    }) as jwt.JwtPayload;

    // ── Assert all required claims ────────────────────────────────────────────
    // sub: userId (Supabase user ID for audit trail)
    expect(decoded.sub).toBe(userId);

    // aud: 'v' (Mux audience = video)
    expect(decoded.aud).toBe('v');

    // playback_id: custom claim
    expect(decoded.playback_id).toBe(playbackId);

    // lesson_id: custom claim for audit trail
    expect(decoded.lesson_id).toBe(lessonId);

    // exp: ~6 hours from now (21600 seconds)
    expect(decoded.exp).toBeGreaterThan(nowSec + 21000); // at least 350 min
    expect(decoded.exp).toBeLessThan(nowSec + 22200); // at most 370 min

    // ── Assert JWT header claims ───────────────────────────────────────────────
    const header = jwt.decode(token, { complete: true })?.header;
    expect(header?.alg).toBe('RS256');
    expect(header?.kid).toBe(TEST_KEY_ID);

    // ── Cleanup env ───────────────────────────────────────────────────────────
    delete process.env.MUX_SIGNING_KEY_ID;
    delete process.env.MUX_SIGNING_KEY_PRIVATE;
  });

  it('falls back to unsigned URL when env vars are missing (dev mode)', async () => {
    // Ensure env vars are NOT set
    const savedId = process.env.MUX_SIGNING_KEY_ID;
    const savedKey = process.env.MUX_SIGNING_KEY_PRIVATE;
    delete process.env.MUX_SIGNING_KEY_ID;
    delete process.env.MUX_SIGNING_KEY_PRIVATE;

    const { signMuxPlaybackUrl } = await import('@/lib/mux');

    const url = signMuxPlaybackUrl('playback-xyz', 'user-123', 'lesson-abc');

    // Must be the bare HLS URL — no token appended
    expect(url).toBe('https://stream.mux.com/playback-xyz.m3u8');
    expect(url).not.toContain('token=');

    // Restore
    if (savedId) process.env.MUX_SIGNING_KEY_ID = savedId;
    if (savedKey) process.env.MUX_SIGNING_KEY_PRIVATE = savedKey;
  });

  it('JWT cannot be verified with a different public key (tampering detection)', async () => {
    process.env.MUX_SIGNING_KEY_ID = TEST_KEY_ID;
    process.env.MUX_SIGNING_KEY_PRIVATE = testPrivateKeyB64;

    const { signMuxPlaybackUrl } = await import('@/lib/mux');
    const url = signMuxPlaybackUrl('playback-abc', 'user-123', 'lesson-xyz');
    const token = url.split('token=')[1];

    // Generate a different keypair (different public key)
    const { publicKey: wrongPublicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    // Verification with wrong key must fail
    expect(() => {
      jwt.verify(token, wrongPublicKey, { algorithms: ['RS256'] });
    }).toThrow();

    delete process.env.MUX_SIGNING_KEY_ID;
    delete process.env.MUX_SIGNING_KEY_PRIVATE;
  });
});
