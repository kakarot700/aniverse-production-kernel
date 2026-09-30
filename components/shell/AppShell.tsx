'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { PRIMARY_DESTINATIONS, UTILITY_DESTINATIONS, isActivePath, pageTitle } from '@/lib/nav';
import { Icon } from '@/components/shell/NavIcons';
import { SearchOverlay } from '@/components/shell/SearchOverlay';

/**
 * The application shell.
 *
 * Three genuinely different layouts, not one layout that shrinks:
 *
 *   < 768px   compact top bar + bottom tab bar in the thumb zone
 *   768-1199  icon rail (72px), labels as tooltips
 *   >= 1200   full sidebar (248px) with labels
 *
 * The breakpoints come from how the input model changes, not from device
 * names. Below 768 the thumb is the pointer and the bottom of the screen is
 * the reachable zone; above it there is a cursor and the reading position is
 * top-left, which is why the bar moves rather than merely resizing.
 *
 * Search is a persistent affordance in the top bar on every page plus two
 * keyboard shortcuts, rather than a fifth tab — it is the one action people
 * arrive wanting on any screen.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '/';
  const [searchOpen, setSearchOpen] = useState(false);

  const openSearch = useCallback(() => setSearchOpen(true), []);
  const closeSearch = useCallback(() => setSearchOpen(false), []);

  // Global shortcuts. `/` is the convention people bring from every other
  // catalog app; Cmd/Ctrl+K is the command-palette convention. Both are
  // suppressed while typing, or the search box could never contain a slash.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

      if ((event.key === 'k' || event.key === 'K') && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (event.key === '/' && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        setSearchOpen(true);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // A route change must dismiss the overlay, or navigating from a result
  // leaves it covering the page it just opened.
  useEffect(() => {
    setSearchOpen(false);
  }, [pathname]);

  const title = pageTitle(pathname);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <div className="mesh-backdrop" aria-hidden="true" />

      {/* Sidebar: icon rail at 768px, full width at 1200px. Hidden below. */}
      <aside className="app-sidebar" aria-label="Primary">
        <Link className="sidebar-brand" href="/">
          <span className="brand-mark" aria-hidden="true">a</span>
          <span className="sidebar-brand-text">Aniverse</span>
        </Link>

        <nav className="sidebar-nav" aria-label="Main navigation">
          <ul>
            {PRIMARY_DESTINATIONS.map((destination) => {
              const active = isActivePath(destination.href, pathname);
              return (
                <li key={destination.href}>
                  <Link
                    href={destination.href}
                    className={active ? 'sidebar-link is-active' : 'sidebar-link'}
                    aria-current={active ? 'page' : undefined}
                    data-tooltip={destination.label}
                  >
                    <Icon name={destination.icon} />
                    <span className="sidebar-label">{destination.label}</span>
                  </Link>
                </li>
              );
            })}
            <li>
              <button type="button" className="sidebar-link" onClick={openSearch} data-tooltip="Search">
                <Icon name="search" />
                <span className="sidebar-label">Search</span>
                <kbd className="sidebar-kbd">/</kbd>
              </button>
            </li>
          </ul>
        </nav>

        {/* Utility items pinned to the bottom so they never compete with the
            primary set for attention, and never scroll away. */}
        <nav className="sidebar-utility" aria-label="Settings and account">
          <ul>
            {UTILITY_DESTINATIONS.filter((item) => item.icon !== 'search').map((destination) => {
              const active = isActivePath(destination.href, pathname);
              return (
                <li key={destination.href}>
                  <Link
                    href={destination.href}
                    className={active ? 'sidebar-link is-active' : 'sidebar-link'}
                    aria-current={active ? 'page' : undefined}
                    data-tooltip={destination.label}
                  >
                    <Icon name={destination.icon} />
                    <span className="sidebar-label">{destination.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </aside>

      <div className="app-body">
        <header className="app-topbar">
          <Link className="topbar-brand" href="/" aria-label="Aniverse home">
            <span className="brand-mark" aria-hidden="true">a</span>
          </Link>
          <h1 className="topbar-title">{title}</h1>

          {/* Present on every page. Research is consistent that people look
              top-right for search; obvious beats clever. */}
          <button
            type="button"
            className="topbar-search"
            onClick={openSearch}
            aria-label="Search anime"
            aria-keyshortcuts="/ Control+K"
          >
            <Icon name="search" size={20} />
            <span className="topbar-search-text">Search anime</span>
            <kbd className="topbar-kbd">/</kbd>
          </button>
        </header>

        <main id="main-content" className="app-main">
          {children}
        </main>

        <footer className="app-footer">
          <span>© Aniverse · Stories in motion</span>
          <span>Catalog data by AniList &amp; MyAnimeList.</span>
        </footer>
      </div>

      {/* Bottom tab bar: mobile only, in the thumb zone, safe-area padded. */}
      <nav className="app-tabbar" aria-label="Main navigation">
        <ul>
          {PRIMARY_DESTINATIONS.map((destination) => {
            const active = isActivePath(destination.href, pathname);
            return (
              <li key={destination.href}>
                <Link
                  href={destination.href}
                  className={active ? 'tab-link is-active' : 'tab-link'}
                  aria-current={active ? 'page' : undefined}
                >
                  <Icon name={destination.icon} size={24} />
                  <span className="tab-label">{destination.shortLabel ?? destination.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <SearchOverlay open={searchOpen} onClose={closeSearch} />
    </div>
  );
}
