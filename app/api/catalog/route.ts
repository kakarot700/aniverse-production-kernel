import { NextResponse } from 'next/server';
import type { MediaCatalogRecord } from '@/types/media';

/**
 * Server catalog matrix served by `GET /api/catalog`.
 *
 * Each episode lists every mirror tier available for playback, in priority
 * order. `manifestUrl` values are the tier endpoints from the trusted catalog
 * source; replace them with per-episode HLS manifests as they are published,
 * and make sure each host is listed in `ANIVERSE_MEDIA_ALLOWED_HOSTS` so the
 * proxy can serve it. Mirrors flagged `requiresProxy: false` may be addressed
 * directly; everything else must go through `/api/proxy`.
 */
const serverCatalogMatrix: MediaCatalogRecord[] = [
  {
    id: 'bleach-tybw-masterpiece',
    title: 'Bleach: Thousand-Year Blood War',
    synopsis:
      'A hidden army of Quincy called the Wandenreich declares war on Soul Society, dragging Ichigo Kurosaki and the Gotei 13 into a blood feud a thousand years in the making.',
    coverPoster: '/posters/bleach-tybw.jpg',
    genre: 'Action',
    year: 2022,
    format: 'Series · 13 episodes',
    episodes: [
      {
        episodeNumber: 1,
        episodeTitle: 'The Blood Warfare',
        mirrors: [
          // 🏆 1. The Premium "Big 3" High-Throughput Media Servers
          { serverName: 'Vidstream / Vidplay', manifestUrl: 'https://vidplay.online', requiresProxy: true },
          { serverName: 'MyCloud (MCloud)', manifestUrl: 'https://mcloud.to', requiresProxy: true },
          { serverName: 'Filemoon', manifestUrl: 'https://filemoon.sx', requiresProxy: true },

          // 💰 2. Webmaster PPV Scaled High-Storage Infrastructure Nodes
          { serverName: 'DoodStream Node', manifestUrl: 'https://doodstream.com', requiresProxy: true },
          { serverName: 'Streamtape Mirror', manifestUrl: 'https://streamtape.com', requiresProxy: true },
          { serverName: 'Voe.sx Cluster', manifestUrl: 'https://voe.sx', requiresProxy: true },
          { serverName: 'Streamwish Node', manifestUrl: 'https://streamwish.to', requiresProxy: true },
          { serverName: 'Vidhide Secure Node', manifestUrl: 'https://vidhide.com', requiresProxy: true },

          // 🔄 3. Legacy Frame-Accurate Performance Nodes
          { serverName: 'Mp4Upload High-Bitrate', manifestUrl: 'https://mp4upload.com', requiresProxy: false },
          { serverName: 'Netu.tv Resilient Core', manifestUrl: 'https://netu.io', requiresProxy: false },
          { serverName: 'Mixdrop Alternative Path', manifestUrl: 'https://mixdrop.co', requiresProxy: true },
        ],
      },
    ],
  },
];

export async function GET() {
  return NextResponse.json(serverCatalogMatrix, {
    headers: { 'Cache-Control': 'public, max-age=60' },
  });
}
