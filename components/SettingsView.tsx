'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  THEME_OPTIONS,
  readThemePreference,
  writeThemePreference,
  type ThemePreference,
} from '@/lib/theme';
import {
  DEFAULT_PLAYBACK_SETTINGS,
  readPlaybackSettings,
  writePlaybackSettings,
  type PlaybackSettings,
} from '@/lib/user-data/settings';
import { clearRecentSearches } from '@/lib/user-data/recent-searches';

const THEME_LABELS: Record<ThemePreference, string> = {
  system: 'Match system',
  light: 'Light',
  dark: 'Dark',
};

export function SettingsView() {
  // Storage is read in an effect, never during render: the server has no
  // localStorage, so seeding from it would be a hydration mismatch.
  const [theme, setTheme] = useState<ThemePreference>('system');
  const [playback, setPlayback] = useState<PlaybackSettings>(DEFAULT_PLAYBACK_SETTINGS);
  const [ready, setReady] = useState(false);
  const [cleared, setCleared] = useState(false);

  useEffect(() => {
    setTheme(readThemePreference());
    setPlayback(readPlaybackSettings());
    setReady(true);
  }, []);

  const updateTheme = (next: ThemePreference) => {
    setTheme(next);
    writeThemePreference(next);
  };

  const updatePlayback = (patch: Partial<PlaybackSettings>) => {
    setPlayback((current) => {
      const next = { ...current, ...patch };
      writePlaybackSettings(next);
      return next;
    });
  };

  return (
    <div className="page">
      <header className="page-head">
        <p className="eyebrow">Preferences</p>
        <h2 className="page-title">Settings</h2>
        <p className="page-lede">Saved in this browser. Nothing here is sent anywhere.</p>
      </header>

      <section className="settings-group" aria-labelledby="appearance-title">
        <h3 id="appearance-title">Appearance</h3>

        <div className="setting-row">
          <div className="setting-copy">
            <span className="setting-label">Theme</span>
            <span className="setting-hint">
              “Match system” follows your device, including when it switches at sunset.
            </span>
          </div>
          <div className="segmented" role="radiogroup" aria-label="Theme">
            {THEME_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={theme === option}
                className={theme === option ? 'segment is-active' : 'segment'}
                onClick={() => updateTheme(option)}
                disabled={!ready}
              >
                {THEME_LABELS[option]}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="settings-group" aria-labelledby="playback-title">
        <h3 id="playback-title">Playback</h3>

        <Toggle
          label="Autoplay next episode"
          hint="Starts the following episode when one finishes."
          checked={playback.autoplayNext}
          disabled={!ready}
          onChange={(value) => updatePlayback({ autoplayNext: value })}
        />
        <Toggle
          label="Skip openings automatically"
          hint="Uses AniSkip timestamps where they exist. Falls back to a manual button."
          checked={playback.autoSkipIntro}
          disabled={!ready}
          onChange={(value) => updatePlayback({ autoSkipIntro: value })}
        />
        <Toggle
          label="Touch gestures"
          hint="Double-tap to seek, swipe to scrub and adjust volume. Mouse and keyboard are unaffected."
          checked={playback.gesturesEnabled}
          disabled={!ready}
          onChange={(value) => updatePlayback({ gesturesEnabled: value })}
        />
        <Toggle
          label="Prefer the highest quality"
          hint="Off means the player adapts to your connection, which starts faster and stalls less."
          checked={playback.preferHighestQuality}
          disabled={!ready}
          onChange={(value) => updatePlayback({ preferHighestQuality: value })}
        />

        <div className="setting-row">
          <div className="setting-copy">
            <span className="setting-label">Seek step</span>
            <span className="setting-hint">How far a double-tap or arrow key jumps.</span>
          </div>
          <div className="segmented" role="radiogroup" aria-label="Seek step">
            {[5, 10, 30].map((seconds) => (
              <button
                key={seconds}
                type="button"
                role="radio"
                aria-checked={playback.seekStepSeconds === seconds}
                className={playback.seekStepSeconds === seconds ? 'segment is-active' : 'segment'}
                onClick={() => updatePlayback({ seekStepSeconds: seconds })}
                disabled={!ready}
              >
                {seconds}s
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="settings-group" aria-labelledby="data-title">
        <h3 id="data-title">Your data</h3>
        <p className="setting-hint">
          Watch history, saved titles and these preferences live in this browser’s local storage. They are
          never uploaded. Clearing your browser data removes them.
        </p>
        <div className="setting-actions">
          <button
            type="button"
            className="button-quiet"
            onClick={() => {
              clearRecentSearches();
              setCleared(true);
            }}
          >
            Clear recent searches
          </button>
          <Link className="button-quiet" href="/profile">Manage watch history</Link>
        </div>
        {cleared ? <p className="setting-hint" role="status">Recent searches cleared.</p> : null}
      </section>

      <section className="settings-group" aria-labelledby="advanced-title">
        <h3 id="advanced-title">Advanced</h3>
        <div className="setting-actions">
          <Link className="button-quiet" href="/servers">Stream server registry</Link>
        </div>
      </section>
    </div>
  );
}

interface ToggleProps {
  label: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}

function Toggle({ label, hint, checked, disabled, onChange }: ToggleProps) {
  return (
    <div className="setting-row">
      <div className="setting-copy">
        <span className="setting-label">{label}</span>
        <span className="setting-hint">{hint}</span>
      </div>
      {/* A real checkbox under a styled track: it keeps keyboard support,
          screen-reader semantics and form behaviour for free. */}
      <label className="switch">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span className="switch-track" aria-hidden="true"><span className="switch-thumb" /></span>
        <span className="sr-only">{label}</span>
      </label>
    </div>
  );
}
