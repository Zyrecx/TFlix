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

import { storage } from '../store/storage.js';

const RELAY_BASE = 'http://127.0.0.1:47993';
const RELAY_HEALTH_TIMEOUT_MS = 2000;
// Some provider packs' resolve() chains legitimately take a while (e.g.
// Stardima's TV episode lookup can walk every season of a long-running show
// — up to ~13 sequential requests, ~4.5s measured live).
// 15s was cutting that off mid-chain with a client-side abort, discarding
// the relay's real (and often successful) answer.
const RESOLVE_TIMEOUT_MS = 45000;

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Only a confirmed-reachable relay is cached — a Node serviceFile process
// can still be starting up when the webview finishes loading and makes its
// first request (they start independently), so a failure here doesn't mean
// the relay is actually dead; it may just not be listening *yet*. Caching
// that as permanent (as an earlier version did) meant one early request
// racing the relay's own startup would show "not running" for the rest of
// the session even after the relay came up moments later.
let relayHealthy = null;

export async function isRelayAvailable() {
  if (relayHealthy === true) return true;
  try {
    const res = await fetchWithTimeout(`${RELAY_BASE}/health`, RELAY_HEALTH_TIMEOUT_MS);
    relayHealthy = res.ok;
  } catch {
    relayHealthy = false;
  }
  return relayHealthy;
}

/**
 * Resolves a provider's stream for the requested media via the local relay.
 * Provider rotation on failure is handled by PlayerModal (getNextFallbackProvider) —
 * this must NOT silently substitute a different provider's stream on failure.
 *
 * Returns one of three shapes depending on what the provider pack's resolve()
 * returned:
 *   - { streamUrl, subtitles, ... }      — play natively
 *   - { embedUrl, ... }                  — iframe the resolved URL
 *   - { needsConfirmation, candidates }  — ambiguous title match; caller must
 *     show a picker, then re-call with a 4th `confirmedShowId` argument
 *     (also cache it via storage.setConfirmedShowId so future episodes of
 *     the same show skip the prompt).
 *
 * `forceConfirm`: set true to make a `fuzzyMatch` provider (see getProviders)
 * re-surface its picker even for a single/cached match — the "wrong match?"
 * control uses this to let the user correct (or explicitly ratify) an
 * auto-accepted match after the fact, without asking on every new title.
 */
export async function resolveDirectStream(providerId, media, season = 1, episode = 1, confirmedShowId = null, forceConfirm = false) {
  const available = await isRelayAvailable();
  if (!available) {
    throw new Error('Local stream relay is not running. Direct providers require TizenBrew\'s serviceFile support.');
  }

  const isTv = media.media_type === 'tv' || media.mediaType === 'tv';
  // media.title may carry a "<name> - S<n>E<n>" display suffix appended by
  // episode-card click handlers (DetailsModal/EpisodeDrawer) for the player
  // header — strip it back off before using it as a provider search query.
  const rawTitle = media.title || media.name || '';
  const title = rawTitle.replace(/\s*-\s*S\d+E\d+\s*$/i, '');
  const year = (media.release_date || media.first_air_date || '').split('-')[0] || '';
  const imdbId = media.imdb_id || media.external_ids?.imdb_id || '';
  const cachedShowId = confirmedShowId || storage.getConfirmedShowId(providerId, String(media.id), isTv ? season : null);

  const params = new URLSearchParams({
    provider: providerId,
    tmdbId: String(media.id),
    imdbId,
    title,
    year,
    isTv: isTv ? '1' : '0',
    season: String(season),
    episode: String(episode),
    confirmedShowId: cachedShowId || '',
    forceConfirm: forceConfirm ? '1' : '0'
  });

  const res = await fetchWithTimeout(`${RELAY_BASE}/resolve?${params.toString()}`, RESOLVE_TIMEOUT_MS);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `${providerId} failed to resolve`);
  }

  if (data.needsConfirmation) {
    return { needsConfirmation: true, candidates: data.candidates || [], providerId, providerName: data.providerName };
  }
  if (data.embedUrl) {
    return { embedUrl: data.embedUrl, providerId, providerName: data.providerName };
  }
  if (!data.streamUrl) {
    throw new Error(`${providerId} did not return a stream URL`);
  }
  return { streamUrl: data.streamUrl, subtitles: data.subtitles || [], providerId, providerName: data.providerName };
}

/**
 * Episode-availability badges (see docs/PROVIDER_PACKS.md's "Optional
 * capabilities"). Deliberately requires an already-*confirmed* showId —
 * never resolves one itself — so a badge can only ever appear for an
 * identity the user (or a high-confidence single-candidate match) actually
 * confirmed, never a raw unconfirmed guess. Returns null (not an error) for
 * every case where badges simply don't apply here: relay down, provider
 * doesn't support it, or show not yet confirmed — callers should treat null
 * as "don't show badges," not surface it as a failure.
 */
export async function listAvailableEpisodes(providerId, tmdbId, season = null) {
  const confirmedShowId = storage.getConfirmedShowId(providerId, String(tmdbId), season);
  if (!confirmedShowId) return null;

  const cached = storage.getEpisodeAvailability(providerId, String(tmdbId), season);
  if (cached) return cached;

  const available = await isRelayAvailable();
  if (!available) return null;

  const params = new URLSearchParams({ provider: providerId, confirmedShowId });
  try {
    const res = await fetchWithTimeout(`${RELAY_BASE}/episodes?${params.toString()}`, RESOLVE_TIMEOUT_MS);
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data.episodes)) return null;
    storage.setEpisodeAvailability(providerId, String(tmdbId), data.episodes, season);
    return data.episodes;
  } catch {
    return null;
  }
}

/**
 * Resolves a native-catalog provider's stream for an already-chosen item —
 * see docs/PROVIDER_PACKS.md's "Native catalogs" section. Bypasses all
 * TMDB-anchored matching: `nativeId` is the pack's own id for the movie or
 * episode, straight from listCatalog/search/listNativeEpisodes. Distinct
 * from resolveDirectStream — never called with a tmdbId/title, never caches
 * via storage.setConfirmedShowId (the browse-screen selection already *is*
 * the confirmation), and never subject to fallback-provider rotation
 * (PlayerModal's nativeMode disables that for this flow entirely).
 */
export async function resolveNativeStream(providerId, nativeId, isTv, season = 1, episode = 1) {
  const available = await isRelayAvailable();
  if (!available) {
    throw new Error('Local stream relay is not running. Direct providers require TizenBrew\'s serviceFile support.');
  }

  const params = new URLSearchParams({
    provider: providerId,
    native: '1',
    confirmedShowId: String(nativeId),
    isTv: isTv ? '1' : '0',
    season: String(season),
    episode: String(episode)
  });

  const res = await fetchWithTimeout(`${RELAY_BASE}/resolve?${params.toString()}`, RESOLVE_TIMEOUT_MS);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `${providerId} failed to resolve`);
  }

  if (data.embedUrl) {
    return { embedUrl: data.embedUrl, providerId, providerName: data.providerName };
  }
  if (!data.streamUrl) {
    throw new Error(`${providerId} did not return a stream URL`);
  }
  return { streamUrl: data.streamUrl, subtitles: data.subtitles || [], providerId, providerName: data.providerName };
}

/**
 * Native-catalog browse/search/season/episode-listing thin clients — see
 * docs/PROVIDER_PACKS.md's "Native catalogs" section and the relay's
 * /browse, /search-native, /seasons, /native-episodes endpoints.
 */
export async function browseNativeCatalog(providerId, category, page = 1) {
  const available = await isRelayAvailable();
  if (!available) throw new Error('Local stream relay is not running.');
  const params = new URLSearchParams({ provider: providerId, category, page: String(page) });
  const res = await fetchWithTimeout(`${RELAY_BASE}/browse?${params.toString()}`, RESOLVE_TIMEOUT_MS);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `${providerId} browse failed`);
  return { items: data.items || [], hasMore: Boolean(data.hasMore) };
}

export async function searchNativeCatalog(providerId, query) {
  const available = await isRelayAvailable();
  if (!available) throw new Error('Local stream relay is not running.');
  const params = new URLSearchParams({ provider: providerId, q: query });
  const res = await fetchWithTimeout(`${RELAY_BASE}/search-native?${params.toString()}`, RESOLVE_TIMEOUT_MS);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `${providerId} search failed`);
  return { items: data.items || [] };
}

export async function getNativeSeasons(providerId, nativeId) {
  const available = await isRelayAvailable();
  if (!available) return { seasons: [] };
  const params = new URLSearchParams({ provider: providerId, nativeId });
  const res = await fetchWithTimeout(`${RELAY_BASE}/seasons?${params.toString()}`, RESOLVE_TIMEOUT_MS);
  const data = await res.json();
  if (!res.ok) return { seasons: [] };
  return { seasons: data.seasons || [] };
}

export async function listNativeEpisodes(providerId, nativeId, seasonId = null) {
  const available = await isRelayAvailable();
  if (!available) throw new Error('Local stream relay is not running.');
  const params = new URLSearchParams({ provider: providerId, nativeId });
  if (seasonId) params.set('seasonId', seasonId);
  const res = await fetchWithTimeout(`${RELAY_BASE}/native-episodes?${params.toString()}`, RESOLVE_TIMEOUT_MS);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `${providerId} episode listing failed`);
  return { episodes: data.episodes || [] };
}
