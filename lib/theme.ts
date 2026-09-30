/**
 * Theme preference.
 *
 * Three states, not two: `system` is the default and it is a real choice, not
 * the absence of one — it means "keep following the OS", including when the
 * OS flips at sunset.
 */

export type ThemePreference = 'system' | 'light' | 'dark';

export const THEME_STORAGE_KEY = 'aniverse:theme';
export const THEME_OPTIONS: ThemePreference[] = ['system', 'light', 'dark'];

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

export function parseThemePreference(value: unknown): ThemePreference {
  return isThemePreference(value) ? value : 'system';
}

/**
 * Resolves a preference to the theme actually in effect.
 * `system` needs the OS signal, passed in so this stays pure.
 */
export function resolveTheme(
  preference: ThemePreference,
  prefersDark: boolean,
): 'light' | 'dark' {
  if (preference === 'light') return 'light';
  if (preference === 'dark') return 'dark';
  return prefersDark ? 'dark' : 'light';
}

/**
 * The `data-theme` attribute value for a preference. `system` deliberately
 * produces no attribute so the CSS `prefers-color-scheme` block governs, and
 * the OS can change it mid-session with no JavaScript involved.
 */
export function themeAttribute(preference: ThemePreference): string | null {
  return preference === 'system' ? null : preference;
}

/**
 * Inline bootstrap, injected into <head>.
 *
 * Must be small, synchronous and total: it runs before anything else, and a
 * throw here would leave the page unstyled. Hence the try/catch around
 * storage access, which is what fails when cookies are blocked.
 */
export const THEME_BOOTSTRAP = `(function(){try{var p=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(p==='dark'||p==='light'){document.documentElement.setAttribute('data-theme',p);}}catch(e){}})();`;

export function readThemePreference(): ThemePreference {
  try {
    return parseThemePreference(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return 'system';
  }
}

export function writeThemePreference(preference: ThemePreference): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Storage disabled; the in-memory choice still applies for this session.
  }

  const attribute = themeAttribute(preference);
  if (attribute) document.documentElement.setAttribute('data-theme', attribute);
  else document.documentElement.removeAttribute('data-theme');
}
