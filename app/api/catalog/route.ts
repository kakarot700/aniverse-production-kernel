// Look inside app/api/catalog/route.ts to see this exact mapping:

const serverCatalogMatrix: MediaCatalogRecord[] = [
  {
    id: "bleach-tybw-masterpiece",
    title: "Bleach: Thousand-Year Blood War",
    // ... metadata continues
    episodes: [
      {
        episodeNumber: 1,
        mirrors: [
          // 🏆 1. The Premium "Big 3" High-Throughput Media Servers
          { serverName: "Vidstream / Vidplay", manifestUrl: "https://vidplay.online", requiresProxy: true },
          { serverName: "MyCloud (MCloud)", manifestUrl: "https://mcloud.to", requiresProxy: true },
          { serverName: "Filemoon", manifestUrl: "https://filemoon.sx", requiresProxy: true },
          
          // 💰 2. Webmaster PPV Scaled High-Storage Infrastructure Nodes
          { serverName: "DoodStream Node", manifestUrl: "https://doodstream.com", requiresProxy: true },
          { serverName: "Streamtape Mirror", manifestUrl: "https://streamtape.com", requiresProxy: true },
          { serverName: "Voe.sx Cluster", manifestUrl: "https://voe.sx", requiresProxy: true },
          { serverName: "Streamwish Node", manifestUrl: "https://streamwish.to", requiresProxy: true },
          { serverName: "Vidhide Secure Node", manifestUrl: "https://vidhide.com", requiresProxy: true },
          
          // 🔄 3. Legacy Frame-Accurate Performance Nodes
          { serverName: "Mp4Upload High-Bitrate", manifestUrl: "https://mp4upload.com", requiresProxy: false },
          { serverName: "Netu.tv Resilient Core", manifestUrl: "https://netu.io", requiresProxy: false },
          { serverName: "Mixdrop Alternative Path", manifestUrl: "https://mixdrop.co", requiresProxy: true }
        ]
      }
    ]
  }
];
