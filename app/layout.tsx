import type { Metadata, Viewport } from 'next';
import './globals.css';
import './a11y.css';

export const metadata: Metadata = {
  title: 'Aniverse — every anime, one calm place',
  description:
    'Search the complete anime catalog, play it through a ranked stream-server registry with automatic failover, and watch together in sync.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#f8fafc',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        {/* Catalog artwork is served from the AniList and MyAnimeList CDNs. */}
        <link rel="preconnect" href="https://s4.anilist.co" crossOrigin="" />
        <link rel="preconnect" href="https://graphql.anilist.co" crossOrigin="" />
        <link rel="dns-prefetch" href="https://cdn.myanimelist.net" />
      </head>
      <body>{children}</body>
    </html>
  );
}
