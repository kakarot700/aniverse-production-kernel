/**
 * Playback preferences.
 *
 * Stored locally alongside the rest of the library. Defaults are chosen for
 * someone who has never opened this page: adaptive quality rather than
 * highest (it starts faster and stalls less), autoplay on, auto-skip on.
 */

export interface PlaybackSettings {
  autoplayNext: boolean;
  autoSkipIntro: boolean;
  gesturesEnabled: boolean;
  preferHighestQuality: boolean;
  seekStepSeconds: number;
}

export const SETTINGS_STORAGE_KEY = 'aniverse:playback-settings';

export const DEFAULT_PLAYBACK_SETTINGS: PlaybackSettings = {
  autoplayNext: true,
  autoSkipIntro: true,
  gesturesEnabled: true,
  preferHighestQuality: false,
  seekStepSeconds: 10,
};

const ALLOWED_STEPS = [5, 10, 30];

/**
 * Validates whatever came out of storage, field by field.
 *
 * Per-field rather than all-or-nothing: a settings blob written by an older
 * build is missing keys, and discarding the whole thing would silently reset
 * choices the viewer made. Each unusable field falls back on its own.
 */
export function parsePlaybackSettings(raw: unknown): PlaybackSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_PLAYBACK_SETTINGS };
  const input = raw as Record<string, unknown>;

  return {
    autoplayNext: bool(input.autoplayNext, DEFAULT_PLAYBACK_SETTINGS.autoplayNext),
    autoSkipIntro: bool(input.autoSkipIntro, DEFAULT_PLAYBACK_SETTINGS.autoSkipIntro),
    gesturesEnabled: bool(input.gesturesEnabled, DEFAULT_PLAYBACK_SETTINGS.gesturesEnabled),
    preferHighestQuality: bool(
      input.preferHighestQuality,
      DEFAULT_PLAYBACK_SETTINGS.preferHighestQuality,
    ),
    seekStepSeconds: ALLOWED_STEPS.includes(input.seekStepSeconds as number)
      ? (input.seekStepSeconds as number)
      : DEFAULT_PLAYBACK_SETTINGS.seekStepSeconds,
  };
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function readPlaybackSettings(): PlaybackSettings {
  try {
    return parsePlaybackSettings(JSON.parse(window.localStorage.getItem(SETTINGS_STORAGE_KEY) ?? 'null'));
  } catch {
    return { ...DEFAULT_PLAYBACK_SETTINGS };
  }
}

export function writePlaybackSettings(settings: PlaybackSettings): void {
  try {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage disabled; the choice still applies for this session.
  }
}
