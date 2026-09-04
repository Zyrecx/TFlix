import { storage } from '../store/storage.js';

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const IMAGE_BASE_URL = 'https://image.tmdb.org/t/p';

// In-memory cache for fast spatial navigation on TV (drops on reload)
const apiCache = new Map();
const MAX_CACHE_ENTRIES = 100;

const TTL = {
  FEED: 5 * 60 * 1000,      // 5 minutes for tabs / rows
  DETAILS: 10 * 60 * 1000,  // 10 minutes for movie / TV details
  SEASON: 15 * 60 * 1000,   // 15 minutes for TV season episode lists (instant switching)
  SEARCH: 2 * 60 * 1000     // 2 minutes for search queries
};

function getFromCache(key) {
  const entry = apiCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    apiCache.delete(key);
    return null;
  }
  return entry.data;
}

function setInCache(key, data, ttlMs) {
  if (ttlMs <= 0) return;
  if (apiCache.size >= MAX_CACHE_ENTRIES) {
    const firstKey = apiCache.keys().next().value;
    if (firstKey !== undefined) {
      apiCache.delete(firstKey);
    }
  }
  apiCache.set(key, {
    data,
    expiresAt: Date.now() + ttlMs
  });
}

// Persisted mirror of FEED-tier entries only (trending/popular/top-rated/
// by-genre — the rows the home screen needs before it can paint anything).
// The in-memory apiCache above is intentionally cleared on every reload; on
// a TV, "reload" also means "app was killed and relaunched", which happens
// far more often than on a desktop tab, so without this every cold start
// re-fetched the whole home screen from TMDB before showing anything. TTL
// stays the same 5 minutes — this only lets an already-fresh response
// survive a relaunch, it doesn't extend how long data is trusted.
const FEED_STORAGE_KEY = 'tflix_tmdb_feed_cache';
const MAX_PERSISTED_FEED_ENTRIES = 40;

function loadPersistedFeedCache() {
  try {
    return JSON.parse(localStorage.getItem(FEED_STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

function getFromPersistedFeedCache(key) {
  const map = loadPersistedFeedCache();
  const entry = map[key];
  if (!entry || Date.now() > entry.expiresAt) return null;
  return entry.data;
}

function setInPersistedFeedCache(key, data, ttlMs) {
  const map = loadPersistedFeedCache();
  map[key] = { data, expiresAt: Date.now() + ttlMs };
  const keys = Object.keys(map);
  if (keys.length > MAX_PERSISTED_FEED_ENTRIES) {
    keys.sort((a, b) => map[a].expiresAt - map[b].expiresAt);
    for (let i = 0; i < keys.length - MAX_PERSISTED_FEED_ENTRIES; i++) delete map[keys[i]];
  }
  try {
    localStorage.setItem(FEED_STORAGE_KEY, JSON.stringify(map));
  } catch (e) {
    // Storage full/unavailable — persistence is a nice-to-have, not required.
  }
}

/**
 * Generic TMDB fetch wrapper with optional in-memory TTL caching
 */
async function tmdbFetch(endpoint, params = {}, ttlMs = 0) {
  const apiKey = storage.getApiKey();
  if (!apiKey) {
    throw new Error('TMDB API Key is required. Please enter your free personal API key in Settings.');
  }

  const cacheKey = `${apiKey}:${endpoint}:${JSON.stringify(params)}`;
  if (ttlMs > 0) {
    const cached = getFromCache(cacheKey);
    if (cached) {
      return cached;
    }
    if (ttlMs === TTL.FEED) {
      const persisted = getFromPersistedFeedCache(cacheKey);
      if (persisted) {
        setInCache(cacheKey, persisted, ttlMs); // warm the in-memory cache too
        return persisted;
      }
    }
  }

  const url = new URL(`${TMDB_BASE_URL}${endpoint}`);
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('language', 'en-US');
  
  Object.entries(params).forEach(([key, val]) => {
    if (val !== undefined && val !== null && val !== '') {
      url.searchParams.set(key, val);
    }
  });

  const response = await fetch(url.toString());
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`TMDB error (${response.status}): ${errorText}`);
  }
  const data = await response.json();

  if (ttlMs > 0) {
    setInCache(cacheKey, data, ttlMs);
    if (ttlMs === TTL.FEED) {
      setInPersistedFeedCache(cacheKey, data, ttlMs);
    }
  }

  return data;
}

export const tmdb = {
  clearCache() {
    apiCache.clear();
    try {
      localStorage.removeItem(FEED_STORAGE_KEY);
    } catch (e) {
      // ignore
    }
  },

  getImageUrl(path, size = 'w342') {
    // Single quotes inside the SVG markup, not double — this is embedded
    // directly into HTML as `<img src="${posterUrl}">` all over the app
    // (MediaRow.js, etc), and a literal `"` here would prematurely close
    // that attribute (verified live: it truncated at `xmlns="`, breaking
    // the image, once native-catalog items with no poster made this path
    // common instead of rare).
    if (!path) return "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='500' height='750' fill='%231a1a1a'><rect width='100%' height='100%'/><text x='50%' y='50%' fill='%23666' font-size='20' font-family='sans-serif' text-anchor='middle' dy='.3em'>No Image</text></svg>";
    if (/^https?:\/\//.test(path)) return path;
    return `${IMAGE_BASE_URL}/${size}${path}`;
  },

  getBackdropUrl(path, size = 'w1280') {
    if (!path) return '';
    if (/^https?:\/\//.test(path)) return path;
    return `${IMAGE_BASE_URL}/${size}${path}`;
  },

  async testApiKey(customKey) {
    try {
      const url = `${TMDB_BASE_URL}/configuration?api_key=${encodeURIComponent(customKey)}`;
      const res = await fetch(url);
      if (res.ok) {
        return { success: true };
      }
      const data = await res.json().catch(() => ({}));
      return { success: false, error: data.status_message || `HTTP ${res.status}` };
    } catch (err) {
      return { success: false, error: err.message || 'Network error' };
    }
  },

  async getTrending(mediaType = 'all', timeWindow = 'week') {
    const data = await tmdbFetch(`/trending/${mediaType}/${timeWindow}`, {}, TTL.FEED);
    return (data.results || []).filter(item => item.poster_path || item.backdrop_path);
  },

  async getPopularMovies(page = 1) {
    const data = await tmdbFetch('/movie/popular', { page }, TTL.FEED);
    return (data.results || []).map(i => ({ ...i, media_type: 'movie' }));
  },

  async getTopRatedMovies(page = 1) {
    const data = await tmdbFetch('/movie/top_rated', { page }, TTL.FEED);
    return (data.results || []).map(i => ({ ...i, media_type: 'movie' }));
  },

  async getPopularTV(page = 1) {
    const data = await tmdbFetch('/tv/popular', { page }, TTL.FEED);
    return (data.results || []).map(i => ({ ...i, media_type: 'tv' }));
  },

  async getTopRatedTV(page = 1) {
    const data = await tmdbFetch('/tv/top_rated', { page }, TTL.FEED);
    return (data.results || []).map(i => ({ ...i, media_type: 'tv' }));
  },

  async getByGenre(mediaType, genreId, page = 1) {
    const endpoint = mediaType === 'tv' ? '/discover/tv' : '/discover/movie';
    const data = await tmdbFetch(endpoint, {
      with_genres: genreId,
      sort_by: 'popularity.desc',
      page
    }, TTL.FEED);
    return (data.results || []).map(i => ({ ...i, media_type: mediaType }));
  },

  async getDetails(mediaType, id) {
    const type = mediaType === 'tv' ? 'tv' : 'movie';
    const data = await tmdbFetch(`/${type}/${id}`, {
      append_to_response: 'credits,similar,videos,external_ids'
    }, TTL.DETAILS);
    data.media_type = type;
    if (!data.imdb_id && data.external_ids && data.external_ids.imdb_id) {
      data.imdb_id = data.external_ids.imdb_id;
    }
    return data;
  },

  async getSeasonDetails(tvId, seasonNumber) {
    const data = await tmdbFetch(`/tv/${tvId}/season/${seasonNumber}`, {}, TTL.SEASON);
    return data.episodes || [];
  },

  async searchMulti(query, page = 1) {
    if (!query || !query.trim()) return [];
    const data = await tmdbFetch('/search/multi', {
      query: query.trim(),
      page,
      include_adult: false
    }, TTL.SEARCH);
    return (data.results || []).filter(
      item => (item.media_type === 'movie' || item.media_type === 'tv') &&
              (item.poster_path || item.backdrop_path)
    );
  }
};
