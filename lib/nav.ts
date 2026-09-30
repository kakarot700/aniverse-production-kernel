/**
 * Navigation model.
 *
 * The destination list and the "which one is active" rule live here as data
 * and pure functions rather than inside JSX, because active-state matching is
 * where navigation quietly breaks: `/settings` must not light up for
 * `/settings-old`, `/` must not light up for everything, and a nested route
 * like `/discover/action` must still highlight Discover.
 *
 * Research-driven shape (streaming IA converges hard here): **four or five
 * primary destinations, no more.** More than five is a sign the information
 * architecture is overloaded, and on mobile it wrecks tap accuracy. Utility
 * destinations — profile, settings, operational pages — are deliberately a
 * separate tier so the two sets never compete for the same attention.
 */

export type NavIcon =
  | 'home'
  | 'compass'
  | 'calendar'
  | 'search'
  | 'user'
  | 'settings'
  | 'server';

export interface NavDestination {
  href: string;
  label: string;
  icon: NavIcon;
  /** Short label for the bottom bar, where horizontal space is scarce. */
  shortLabel?: string;
  /** Primary destinations appear in the mobile tab bar. */
  primary: boolean;
}

/**
 * Exactly four primary destinations. Search is deliberately NOT one of them:
 * it is a persistent affordance in the top bar on every page (users look
 * top-right for search, and a dedicated tab would spend a quarter of the bar
 * on something already one tap away everywhere).
 */
export const NAV_DESTINATIONS: NavDestination[] = [
  { href: '/', label: 'Home', icon: 'home', primary: true },
  { href: '/discover', label: 'Discover', icon: 'compass', primary: true },
  { href: '/schedule', label: 'Schedule', icon: 'calendar', primary: true },
  { href: '/profile', label: 'My list', icon: 'user', shortLabel: 'List', primary: true },
  { href: '/search', label: 'Search', icon: 'search', primary: false },
  { href: '/settings', label: 'Settings', icon: 'settings', primary: false },
  { href: '/servers', label: 'Servers', icon: 'server', primary: false },
];

export const PRIMARY_DESTINATIONS = NAV_DESTINATIONS.filter((item) => item.primary);
export const UTILITY_DESTINATIONS = NAV_DESTINATIONS.filter((item) => !item.primary);

/**
 * Whether `href` should render as the active destination for `pathname`.
 *
 * Root is exact-match only. Everything else matches itself and its children,
 * but only on a path *segment* boundary — a prefix test alone would light up
 * `/settings` for `/settings-old`.
 */
export function isActivePath(href: string, pathname: string): boolean {
  if (!href || !pathname) return false;

  const normalizedPath = normalizePath(pathname);
  const normalizedHref = normalizePath(href);

  if (normalizedHref === '/') return normalizedPath === '/';
  if (normalizedPath === normalizedHref) return true;

  return normalizedPath.startsWith(`${normalizedHref}/`);
}

/** Strips a trailing slash and any query or hash. */
function normalizePath(value: string): string {
  const withoutHash = value.split('#')[0].split('?')[0];
  if (withoutHash.length > 1 && withoutHash.endsWith('/')) return withoutHash.slice(0, -1);
  return withoutHash || '/';
}

/** The destination matching `pathname`, preferring the most specific. */
export function activeDestination(pathname: string): NavDestination | null {
  const matches = NAV_DESTINATIONS.filter((item) => isActivePath(item.href, pathname));
  if (matches.length === 0) return null;
  return matches.reduce((best, item) => (item.href.length > best.href.length ? item : best));
}

/** Page title for the compact mobile top bar. */
export function pageTitle(pathname: string): string {
  return activeDestination(pathname)?.label ?? 'Aniverse';
}
