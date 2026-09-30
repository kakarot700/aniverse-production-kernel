import type { Metadata, Viewport } from 'next';
import './globals.css';
import './a11y.css';
import './shell.css';
import './pages.css';
import { AppShell } from '@/components/shell/AppShell';
import { THEME_BOOTSTRAP } from '@/lib/theme';

export const metadata: Metadata = {
  title: 'Aniverse — every anime, one calm place',
  description:
    'Search the complete anime catalog, play it through a ranked stream-server registry with automatic failover, and watch together in sync.',
  applicationName: 'Aniverse',
  appleWebApp: { capable: true, title: 'Aniverse', statusBarStyle: 'black-translucent' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // `viewport-fit: cover` is what lets `env(safe-area-inset-*)` return
  // anything other than zero on notched phones. Without it the bottom tab
  // bar sits under the home indicator.
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f7f8fc' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0b11' },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Catalog artwork is served from the AniList and MyAnimeList CDNs. */}
        <link rel="preconnect" href="https://s4.anilist.co" crossOrigin="" />
        <link rel="preconnect" href="https://graphql.anilist.co" crossOrigin="" />
        <link rel="dns-prefetch" href="https://cdn.myanimelist.net" />
        {/* Applies the saved theme before first paint. This has to be a
            blocking inline script: anything deferred, including React itself,
            runs after the browser has already painted the wrong colours. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
