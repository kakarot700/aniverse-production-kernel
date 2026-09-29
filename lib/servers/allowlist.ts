import { parseAllowedHosts } from '@/lib/media-proxy';
import { REFERENCE_STREAM_HOST, isReferenceStreamsEnabled } from './reference-streams';

/**
 * The hostnames `/api/proxy` will fetch from.
 *
 * `ANIVERSE_MEDIA_ALLOWED_HOSTS` is the operator's list. When the built-in
 * Creative-Commons reference streams are enabled, their single host is merged
 * in automatically — otherwise a fresh clone could never play anything and
 * there would be no way to tell a configuration mistake apart from a broken
 * proxy.
 *
 * The merge is additive and narrow: exactly one extra host, and only while
 * reference streams are on (off by default in production).
 */
export function getEffectiveAllowedHosts(env: NodeJS.ProcessEnv = process.env): string[] {
  const configured = parseAllowedHosts(env.ANIVERSE_MEDIA_ALLOWED_HOSTS);
  if (!isReferenceStreamsEnabled(env)) return configured;
  if (configured.includes(REFERENCE_STREAM_HOST)) return configured;
  return [...configured, REFERENCE_STREAM_HOST];
}
