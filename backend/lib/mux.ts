import Mux from '@mux/mux-node';
import jwt from 'jsonwebtoken';

if (!process.env.MUX_TOKEN_ID || !process.env.MUX_TOKEN_SECRET) {
  // Warn rather than throw — mux may not be configured in dev
  // eslint-disable-next-line no-console
  console.warn('MUX_TOKEN_ID or MUX_TOKEN_SECRET is not set');
}

export const mux = new Mux({
  tokenId: process.env.MUX_TOKEN_ID ?? '',
  tokenSecret: process.env.MUX_TOKEN_SECRET ?? '',
});

/**
 * Signs a Mux playback JWT for a specific viewer + lesson context and returns
 * the full streaming URL (ready to hand to the Mux player).
 *
 * Spec (Phase-1 F2):
 *   - sub: userId (Supabase user ID) — audit trail
 *   - aud: 'v' (Mux audience = video)
 *   - kid: MUX_SIGNING_KEY_ID (set in JWT header via jsonwebtoken options)
 *   - exp: now + 6 hours (21600 seconds)
 *   - playback_id: playbackId (custom claim — allows server-side validation)
 *   - lesson_id: lessonId (custom claim — audit trail)
 *
 * Environment:
 *   MUX_SIGNING_KEY_ID      — Key ID from the Mux dashboard Signing Keys page.
 *   MUX_SIGNING_KEY_PRIVATE — Base64-encoded RSA private key PEM from Mux.
 *                             Decode with Buffer.from(key, 'base64').toString('utf-8')
 *                             before passing to jwt.sign().
 *
 * Returns `https://stream.mux.com/{playbackId}.m3u8?token={jwt}`
 * Falls back to a bare (unsigned) HLS URL in dev when env vars are not set.
 *
 * @param playbackId  — Mux playback ID (from lessons.video_mux_playback_id)
 * @param userId      — Supabase auth.users UUID of the viewer
 * @param lessonId    — UUID of the lesson being played (for audit trail)
 */
export function signMuxPlaybackUrl(playbackId: string, userId: string, lessonId: string): string {
  const signingKeyId = process.env.MUX_SIGNING_KEY_ID;
  const signingKeyPrivate = process.env.MUX_SIGNING_KEY_PRIVATE;

  if (!signingKeyId || !signingKeyPrivate) {
    // Dev fallback: return unsigned URL so local testing still works.
    return `https://stream.mux.com/${playbackId}.m3u8`;
  }

  // MUX_SIGNING_KEY_PRIVATE is stored as a base64-encoded PEM.
  // Decode it before passing to jwt.sign, which expects a raw PEM string.
  const privateKey = Buffer.from(signingKeyPrivate, 'base64').toString('utf-8');

  const nowSec = Math.floor(Date.now() / 1000);

  const token = jwt.sign(
    {
      sub: userId,
      aud: 'v', // Mux audience claim: 'v' = video playback
      exp: nowSec + 21600, // 6 hours
      playback_id: playbackId,
      lesson_id: lessonId,
    },
    privateKey,
    {
      algorithm: 'RS256',
      keyid: signingKeyId, // Sets the `kid` JWT header claim
    }
  );

  return `https://stream.mux.com/${playbackId}.m3u8?token=${token}`;
}
