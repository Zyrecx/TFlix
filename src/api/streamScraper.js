/**
 * TFlix Direct HLS Stream Client
 *
 * Thin client for the local hlsRelay service (service/hlsRelay.js). The actual
 * scraping happens there, outside the webview, because every direct-stream
 * provider we've tested either omits CORS headers or rejects requests that
 * carry a browser `Origin` header (unavoidable on any cross-origin fetch/XHR
 * made from here) — see service/hlsRelay.js for the verified per-provider
 * failure modes this works around.
 */

const RELAY_BASE = 'http://127.0.0.1:47993';
const RELAY_HEALTH_TIMEOUT_MS = 2000;
const RESOLVE_TIMEOUT_MS = 15000;

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

let relayHealthy = null; // cache within a session; a dead relay won't come back without a reload

export async function isRelayAvailable() {
  if (relayHealthy !== null) return relayHealthy;
  try {
    const res = await fetchWithTimeout(`${RELAY_BASE}/health`, RELAY_HEALTH_TIMEOUT_MS);
    relayHealthy = res.ok;
  } catch {
    relayHealthy = false;
  }
  return relayHealthy;
}

/**
 * Resolves the HLS stream for the requested provider via the local relay.
 * Provider rotation on failure is handled by PlayerModal (getNextFallbackProvider) —
 * this must NOT silently substitute a different provider's stream on failure.
 */
export async function resolveDirectStream(providerId, media, season = 1, episode = 1) {
  const available = await isRelayAvailable();
  if (!available) {
    throw new Error('Local stream relay is not running. Direct providers require TizenBrew\'s serviceFile support.');
  }

  const isTv = media.media_type === 'tv' || media.mediaType === 'tv';
  const title = media.title || media.name || '';
  const year = (media.release_date || media.first_air_date || '').split('-')[0] || '';
  const imdbId = media.imdb_id || media.external_ids?.imdb_id || '';

  const params = new URLSearchParams({
    provider: providerId,
    tmdbId: String(media.id),
    imdbId,
    title,
    year,
    isTv: isTv ? '1' : '0',
    season: String(season),
    episode: String(episode)
  });

  const res = await fetchWithTimeout(`${RELAY_BASE}/resolve?${params.toString()}`, RESOLVE_TIMEOUT_MS);
  const data = await res.json();
  if (!res.ok || !data.streamUrl) {
    throw new Error(data.error || `${providerId} did not return a stream URL`);
  }
  return { streamUrl: data.streamUrl, subtitles: data.subtitles || [], providerId, providerName: data.providerName };
}
