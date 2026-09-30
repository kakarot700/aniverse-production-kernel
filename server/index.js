const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const port = Number(process.env.PORT || 5000);
const consumetBaseUrl = (process.env.CONSUMET_API_URL || 'https://api.consumet.org').replace(/\/$/, '');

// Consumet exposes provider-specific routes. The friendly names are kept in
// one place so changing provider strategy does not change the frontend API.
const SERVER_PROVIDERS = Object.freeze({
  vidcloud: { provider: 'zoro', server: 'vidcloud' },
  streamsb: { provider: 'zoro', server: 'streamsb' },
  vidstreaming: { provider: 'gogoanime', server: 'vidstreaming' },
  filemoon: { provider: 'zoro', server: 'filemoon' },
  xstreamcdn: { provider: 'gogoanime', server: 'xstreamcdn' },
  streamtape: { provider: 'gogoanime', server: 'streamtape' },
  doodstream: { provider: 'gogoanime', server: 'doodstream' },
  okru: { provider: 'gogoanime', server: 'okru' },
});

app.use(cors({ origin: true, methods: ['GET', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Accept'] }));
app.disable('x-powered-by');

function positiveInteger(value, name, max = 5000) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > max) {
    const error = new Error(`${name} must be a positive integer.`);
    error.status = 400;
    throw error;
  }
  return number;
}

function clean(value, maxLength = 80) {
  return String(value || '').trim().toLowerCase().slice(0, maxLength);
}

function pickEpisode(episodes, episodeNumber, language) {
  if (!Array.isArray(episodes)) return null;
  const candidates = episodes.filter((episode) => Number(episode.number) === episodeNumber);
  if (!candidates.length) return null;

  // Providers sometimes expose a distinct dub episode list or mark an episode
  // with a language. Prefer that entry, then fall back to the numbered entry.
  if (language === 'dub') {
    return candidates.find((episode) => episode.isDub === true || /dub/i.test(episode.title || '')) || candidates[0];
  }
  return candidates.find((episode) => episode.isDub !== true) || candidates[0];
}

function sourceUrl(source) {
  return source?.url || source?.file || source?.link || source?.src || null;
}

function sourceHeaders(source, response) {
  const headers = { ...(source?.headers || {}) };
  // Consumet providers commonly return referer/request headers alongside a
  // source. Preserve them for callers without copying unrelated API headers.
  if (source?.referer && !headers.Referer) headers.Referer = source.referer;
  if (source?.origin && !headers.Origin) headers.Origin = source.origin;
  if (response?.headers?.['x-request-headers']) {
    try { Object.assign(headers, JSON.parse(response.headers['x-request-headers'])); } catch (_) { /* ignore malformed provider metadata */ }
  }
  return headers;
}

async function consumetGet(path, params) {
  return axios.get(`${consumetBaseUrl}${path}`, {
    params,
    timeout: Number(process.env.CONSUMET_TIMEOUT_MS || 15000),
    headers: { Accept: 'application/json', 'User-Agent': 'Aniverse-Extractor/1.0' },
    validateStatus: (status) => status >= 200 && status < 500,
  });
}

async function extract({ server, id, episode, language }) {
  const mapping = SERVER_PROVIDERS[server];
  if (!mapping) {
    const error = new Error(`Unsupported server. Use one of: ${Object.keys(SERVER_PROVIDERS).join(', ')}.`);
    error.status = 400;
    throw error;
  }

  const metadataResponse = await consumetGet(`/meta/anilist/${id}`);
  if (metadataResponse.status >= 400) throw new Error(`Consumet metadata request failed with status ${metadataResponse.status}.`);
  const metadata = metadataResponse.data;
  const selectedEpisode = pickEpisode(metadata?.episodes, episode, language);
  if (!selectedEpisode?.id) throw new Error(`Episode ${selectedEpisode ? selectedEpisode.number : 'requested'} was not found.`);

  const watchResponse = await consumetGet(`/anime/${mapping.provider}/watch/${encodeURIComponent(selectedEpisode.id)}`, {
    server: mapping.server,
  });
  if (watchResponse.status >= 400) throw new Error(`Consumet stream request failed with status ${watchResponse.status}.`);

  const payload = watchResponse.data;
  const sources = Array.isArray(payload) ? payload : (payload?.sources || payload?.data?.sources || []);
  const hls = sources.find((source) => /\.m3u8(?:$|[?#])/i.test(sourceUrl(source) || ''));
  const selected = hls || sources.find((source) => sourceUrl(source));
  const url = sourceUrl(selected);
  if (!url) throw new Error('Consumet returned no playable source.');

  return {
    url,
    headers: sourceHeaders(selected, watchResponse),
    type: hls ? 'hls' : 'file',
    server,
    provider: mapping.provider,
    id,
    episode: Number(selectedEpisode.number),
    lang: language,
  };
}

app.get('/api/health', (_request, response) => response.json({ ok: true }));

app.get('/api/extract', async (request, response) => {
  try {
    const server = clean(request.query.server);
    const id = positiveInteger(request.query.id, 'id', 1000000000);
    const episode = positiveInteger(request.query.ep, 'ep');
    const language = clean(request.query.lang, 4);
    if (!['sub', 'dub'].includes(language)) {
      return response.status(400).json({ error: 'lang must be either sub or dub.' });
    }
    const result = await extract({ server, id, episode, language });
    return response.json(result);
  } catch (error) {
    const status = error.status || (axios.isAxiosError(error) ? 502 : 500);
    return response.status(status).json({ error: error.message || 'Stream extraction failed.' });
  }
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Aniverse extractor listening on http://0.0.0.0:${port}`);
});
