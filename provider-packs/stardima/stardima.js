/**
 * TFlix provider pack: Stardima (stardima.com) — Arabic-dubbed anime/cartoons
 * and movies. See docs/PROVIDER_PACKS.md in the TFlix repo for the contract
 * this implements and the case study this pack was built from.
 *
 * Chain, verified by hand against the live site before writing this file:
 *   1. Show/movie lookup: https://www.stardima.com/search?query=<title> —
 *      server-rendered result cards, either /movie/{id} or
 *      /tvshow/video-{showId}/play/{episodeId}.
 *   2. Episode lookup (TV only): site search returns zero results for most
 *      bare episode numbers (not just low ones — confirmed live, e.g. "827",
 *      "1001", "1077" all return nothing even though the show search itself
 *      works fine), so it's not used for this. Instead: fetch any play page
 *      for the show to scrape its season picker's `data-season-id` list (the
 *      picker is server-rendered but only present if the show has more than
 *      one season — see parseSeasonList), then walk
 *      GET /series/season/{seasonId}?X-Requested-With=XMLHttpRequest, an
 *      undocumented but public JSON endpoint returning that season's
 *      episodes as [{id, episode_number, title, watch_url}]. `watch_url`
 *      points straight at hyperwatching, skipping the play-page fetch
 *      entirely. See the comment above findEpisodeInSeasons for why this
 *      has to check every season rather than stop early.
 *   3. The play page (for a movie) or the `watch_url` above (for an episode)
 *      gives a https://v2.hyperwatching.com/watch/{hash} URL — server-
 *      rendered, no JS execution needed to see it.
 *   4. https://v2.hyperwatching.com/watch/{hash} is a Laravel+Inertia page;
 *      its root <div id="app" data-page="..."> carries a JSON blob with a
 *      `servers` array ({id, name}); a server entry with id 0 means that
 *      mirror isn't available for this video — skip it.
 *   5. https://v2.hyperwatching.com/embed/{hash}/server/{id}/url returns
 *      {"watch_url": "https://strema.top/embed2/?id=<url-encoded real host URL>"}.
 *      strema.top is an ad/popunder wrapper (confirmed: it triggered a fake
 *      "application/pdf" download with no video element on the page) — the
 *      real destination is already sitting in its own `id` query param, so
 *      we read that directly and never load strema.top itself.
 *   6. The real host (lulustream.com / luluvdo.com and kin) serves a JW
 *      Player page whose source config is wrapped in the classic Dean
 *      Edwards P.A.C.K.E.R. format: eval(function(p,a,c,k,e,d){...}(payload,
 *      base,count,'word|dictionary'.split('|'))). This is a deterministic
 *      base-N token substitution, not real obfuscation — reversed below
 *      without executing any of the page's JS. This same host family also
 *      enforces Referer-based hotlink protection (confirmed live against
 *      tnmr.org) — see the `referer` field returned below.
 *
 * Episode numbering: `ctx.episode` is passed through as Stardima's absolute
 * `episode_number` as-is. Verified correct for a long-running show TMDB
 * models as a single season of 1000+ episodes, so TMDB's episode
 * number already *is* the absolute number Stardima uses, and Stardima's own
 * numbering is confirmed globally continuous across a show's first several
 * seasons (season boundaries are an internal Stardima grouping — extra dub
 * batches added later can restart their own local numbering or cover only a
 * sparse subset of the range; findEpisodeInSeasons checks every season
 * rather than assume monotonic ranges). This will NOT hold for a show TMDB
 * genuinely splits into multiple seasons; don't assume it does for a new
 * show without checking TMDB's canonical season structure first (see
 * docs/PROVIDER_PACKS.md).
 */

'use strict';

var URL = require('url').URL;

var STARDIMA_BASE = 'https://www.stardima.com';
var HW_BASE = 'https://v2.hyperwatching.com';

// Tried in this order; hosts earlier in the list have historically been
// simpler/more reliable to extract from than Uqload, which goes last.
var SERVER_PRIORITY = ['Lulustream', 'Streamhg', 'Earnvids', 'Savefiles', 'Goodstream', 'Mixdrop', 'Uqload'];

function stripEpisodePrefix(title) {
  return title.replace(/^\s*\S*\s*الحلقة:\s*\d+\.\s*/, '').trim();
}

// Search result cards look like:
//   <a href="https://www.stardima.com/movie/{id}" ...>...<h3 ...>{title}</h3>
//   <a href="https://www.stardima.com/tvshow/video-{showId}/play/{epId}" ...>...<h3 ...>episode 📺 الحلقة: {n}. {title}</h3>
function parseSearchResults(html) {
  var results = [];
  var re = /<a href="https:\/\/www\.stardima\.com\/(movie\/([a-z0-9]+)|tvshow\/video-(\d+)\/play\/(\d+))"[^>]*>[\s\S]{0,600}?<h3[^>]*>([^<]*)<\/h3>/g;
  var m;
  while ((m = re.exec(html)) !== null) {
    var rawTitle = (m[5] || '').trim();
    if (m[2]) {
      results.push({ type: 'movie', movieId: m[2], title: rawTitle });
    } else {
      results.push({ type: 'tv', showId: m[3], episodeId: m[4], title: stripEpisodePrefix(rawTitle), rawTitle: rawTitle });
    }
  }
  return results;
}

// Search result cards' <h3> text isn't reliably a clean show/movie name —
// confirmed live: for some shows it's an auto-generated filename-style
// string instead (e.g. "www.stardima.com_ShowName.S04.EP126", the same style
// found in some season buckets' episode titles — see absoluteEpisodeNumber).
// A confirmation picker built from that is actively misleading (a user
// can't tell a genuinely wrong match from a garbled-but-right one), so
// candidates are labeled from each show/movie's own landing page <title>
// instead — confirmed live to always be clean, e.g.
// "<Arabic title> | <English title> - ستارديما". Only runs for the (rare,
// once-per-show) disambiguation picker, never the hot path.
async function getCandidateLabel(http, type, id) {
  var url = type === 'movie' ? (STARDIMA_BASE + '/movie/' + id) : (STARDIMA_BASE + '/tvshow/video-' + id);
  try {
    var html = await http.fetchText(url);
    var m = html.match(/<title>([^<]*)<\/title>/);
    if (!m) return null;
    return m[1].replace(/\s*-\s*ستارديما\s*$/, '').trim() || null;
  } catch (e) {
    return null;
  }
}

async function labelCandidates(http, type, candidates) {
  for (var i = 0; i < candidates.length; i++) {
    var clean = await getCandidateLabel(http, type, candidates[i].id);
    if (clean) candidates[i].label = clean;
  }
  return candidates;
}

async function search(http, query) {
  var url = STARDIMA_BASE + '/search?query=' + encodeURIComponent(query);
  var html = await http.fetchText(url);
  return parseSearchResults(html);
}

function buildPlayUrl(item) {
  if (item.type === 'movie') return STARDIMA_BASE + '/play/' + item.movieId;
  return STARDIMA_BASE + '/tvshow/video-' + item.showId + '/play/' + item.episodeId;
}

function buildTvPlayUrlById(showId, playId) {
  return STARDIMA_BASE + '/tvshow/video-' + showId + '/play/' + playId;
}

// The show landing page (no /play/ segment) links straight to episode 1's
// play page for an anonymous session — verified against the live site.
async function getFirstEpisodePlayId(http, showId) {
  var html = await http.fetchText(STARDIMA_BASE + '/tvshow/video-' + showId);
  var m = html.match(new RegExp('tvshow/video-' + showId + '/play/(\\d+)'));
  return m ? parseInt(m[1], 10) : null;
}

function extractHashFromHtml(html, playUrl) {
  var m = html.match(/hyperwatching\.com\/watch\/([a-zA-Z0-9]+)/);
  if (!m) throw new Error('No hyperwatching embed found on ' + playUrl);
  return m[1];
}

async function extractHyperwatchingHash(http, playUrl) {
  var html = await http.fetchText(playUrl);
  return extractHashFromHtml(html, playUrl);
}

// Only a play page's HTML carries the season picker, and only if the show
// has more than one season (the dropdown block is omitted entirely for a
// single-season show — verified live). `data-initial-season-id` on the
// (always-present) episodes-list container is the reliable single-season
// fallback. IDs are internal Stardima season-record ids, unrelated to the
// human-facing season number.
function parseSeasonList(html) {
  var seasons = [];
  var re = /data-season-id="(\d+)" data-season-number="[^"]*"/g;
  var m;
  while ((m = re.exec(html)) !== null) seasons.push(m[1]);
  if (seasons.length === 0) {
    var initial = html.match(/data-initial-season-id="(\d+)"/);
    if (initial) seasons.push(initial[1]);
  }
  return seasons;
}

async function getShowSeasonList(http, showId) {
  var firstPlayId = await getFirstEpisodePlayId(http, showId);
  if (!firstPlayId) return [];
  var html = await http.fetchText(buildTvPlayUrlById(showId, firstPlayId));
  return parseSeasonList(html);
}

// `episode_number` from this endpoint is NOT reliably the absolute number
// this file assumes elsewhere (see header note) — confirmed live: it's
// absolute for a show's first several seasons, but later "season" buckets
// (extra dub batches) reset it to
// a LOCAL count instead (season "6 مدبلج"'s episode_number runs 1-52 while
// its titles read "...EP01-249_", i.e. local episode 1 = absolute 249).
// Locally-numbered seasons can also repeat an episode_number for two
// different absolute episodes (observed: episode_number 3 covering both
// absolute 478 and 480). The title text is the only reliable source across
// every bucket: either a trailing "-<abs>" suffix (the Latin/filename-style
// titles used by locally-numbered seasons) or a leading "<abs>." matching
// episode_number exactly (the Arabic-titled, genuinely-absolute seasons).
function absoluteEpisodeNumber(episodeEntry) {
  var trailing = episodeEntry.title.match(/-(\d+)_?\s*$/);
  if (trailing) return parseInt(trailing[1], 10);
  var leading = episodeEntry.title.match(/^(\d+)/);
  if (leading) return parseInt(leading[1], 10);
  return episodeEntry.episode_number;
}

// There's no reliable way to know which season bucket (if any) holds a
// given absolute number without checking each one — bounded by the show's
// actual season count (worst case ~13 lightweight JSON fetches for a
// long-running show, ~4.5s total measured live), which is both faster and
// strictly more correct than guessing at a play-id offset. Shared by
// findEpisodeInSeasons (stop at first match) and listEpisodes (collect all,
// for episode-availability badges — see module.exports.listEpisodes).
async function fetchAllSeasonEpisodes(http, seasonIds) {
  var all = [];
  for (var i = 0; i < seasonIds.length; i++) {
    var data;
    try {
      data = await http.fetchJson(STARDIMA_BASE + '/series/season/' + seasonIds[i] + '?X-Requested-With=XMLHttpRequest');
    } catch (e) {
      continue;
    }
    var episodes = (data && data.episodes) || [];
    for (var j = 0; j < episodes.length; j++) all.push(episodes[j]);
  }
  return all;
}

async function findEpisodeInSeasons(http, seasonIds, episode) {
  for (var i = 0; i < seasonIds.length; i++) {
    var data;
    try {
      data = await http.fetchJson(STARDIMA_BASE + '/series/season/' + seasonIds[i] + '?X-Requested-With=XMLHttpRequest');
    } catch (e) {
      continue;
    }
    var episodes = (data && data.episodes) || [];
    for (var j = 0; j < episodes.length; j++) {
      if (absoluteEpisodeNumber(episodes[j]) === episode) return episodes[j];
    }
  }
  return null;
}

function decodeHtmlAttr(s) {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, '\'')
    .replace(/&amp;/g, '&');
}

async function getServerList(http, hash) {
  var html = await http.fetchText(HW_BASE + '/watch/' + hash);
  var m = html.match(/id="app" data-page="([^"]+)"/);
  if (!m) throw new Error('No server list found for ' + hash);
  var data = JSON.parse(decodeHtmlAttr(m[1]));
  return (data.props && data.props.video && data.props.video.servers) || [];
}

// Returns the real host URL, bypassing the strema.top ad wrapper by reading
// its own `id` query param rather than loading it.
async function resolveServerUrl(http, hash, serverEntryId) {
  var json = await http.fetchJson(HW_BASE + '/embed/' + hash + '/server/' + serverEntryId + '/url');
  var watchUrl = json.watch_url;
  if (!watchUrl) throw new Error('No watch_url for server ' + serverEntryId);
  try {
    var u = new URL(watchUrl);
    if (u.hostname.indexOf('strema.top') !== -1) {
      var inner = u.searchParams.get('id');
      if (inner) return inner;
    }
  } catch (e) {
    // fall through and use watchUrl as-is
  }
  return watchUrl;
}

// Reverses the Dean Edwards P.A.C.K.E.R. format used by the lulustream/
// luluvdo host family: eval(function(p,a,c,k,e,d){...}(payload,base,count,
// 'dict'.split('|'))). Pure string substitution — nothing here executes any
// of the page's JS.
function unpackJwPlayer(html) {
  var re = /eval\(function\(p,a,c,k,e,d\)\{[\s\S]*?\}\('((?:\\.|[^'\\])*)',(\d+),(\d+),'((?:\\.|[^'\\])*)'\.split\('\|'\)\)\)/;
  var m = html.match(re);
  if (!m) return null;

  function unescapeJs(s) {
    return s.replace(/\\'/g, '\'').replace(/\\\\/g, '\\');
  }

  var payload = unescapeJs(m[1]);
  var base = parseInt(m[2], 10);
  var count = parseInt(m[3], 10);
  var keywords = unescapeJs(m[4]).split('|');

  while (count--) {
    if (keywords[count]) {
      var token = count.toString(base);
      payload = payload.replace(new RegExp('\\b' + token + '\\b', 'g'), keywords[count]);
    }
  }
  return payload;
}

async function extractStreamUrl(http, hostPageUrl) {
  var html = await http.fetchText(hostPageUrl);
  var unpacked = unpackJwPlayer(html);
  var haystack = unpacked || html;
  var m = haystack.match(/https?:\/\/[^"'\\]+\.m3u8[^"'\\]*/);
  if (!m) throw new Error('No m3u8 found on ' + hostPageUrl);
  return m[0];
}

module.exports = {
  id: 'stardima',
  name: 'Stardima',
  description: 'Arabic-dubbed anime/cartoons and movies from stardima.com. Community scrape of an ad-heavy free source — see docs/PROVIDER_PACKS.md.',

  // Both flags describe why this pack, specifically, can offer episode-
  // availability badges — see docs/PROVIDER_PACKS.md's "Optional
  // capabilities" section. fuzzyMatch: resolve() has to guess which
  // Stardima show/movie record corresponds to the TMDB title (see Step 1),
  // so a match can be wrong; only a confirmed one should ever be trusted.
  // supportsAvailability: the catalog is also genuinely incomplete (a real
  // subset of episodes are dubbed at all), which is what listEpisodes below
  // reports on a per-episode basis — most packs (e.g. a direct tmdbId/imdbId
  // API keyed 1:1 with TMDB) have neither trait and shouldn't set these.
  fuzzyMatch: true,
  supportsAvailability: true,

  // Returns every absolute episode number this show has dubbed on Stardima,
  // for episode-availability badges. Only ever called by the app with an
  // already-*confirmed* showId (see resolve()'s Step 1 and forceConfirm) —
  // never speculatively against an unconfirmed guess.
  async listEpisodes(ctx, http) {
    if (!ctx.confirmedShowId) throw new Error('listEpisodes requires a confirmed showId');
    var seasonIds = await getShowSeasonList(http, ctx.confirmedShowId);
    var episodes = await fetchAllSeasonEpisodes(http, seasonIds);
    var numbers = episodes.map(absoluteEpisodeNumber).filter(function (n) { return !isNaN(n); });
    return { episodes: Array.from(new Set(numbers)).sort(function (a, b) { return a - b; }) };
  },

  async resolve(ctx, http) {
    var isTv = Boolean(ctx.isTv);

    // Step 1: identify the show/movie — reuse the cached confirmation if we
    // have one, otherwise search by title and either auto-confirm a single
    // hit or ask the app to prompt the user. `ctx.forceConfirm` (set by the
    // app's "wrong match?" control) ignores any cached confirmation and
    // always surfaces the picker, even for a single hit — the only way a
    // single-candidate auto-match ever becomes a *confirmed* one, which is
    // what episode-availability badges are gated behind (see listEpisodes).
    var target;
    if (ctx.confirmedShowId && !ctx.forceConfirm) {
      target = isTv ? { type: 'tv', showId: ctx.confirmedShowId } : { type: 'movie', movieId: ctx.confirmedShowId };
    } else {
      var results = await search(http, ctx.title);
      var filtered = results.filter(function (r) { return isTv ? r.type === 'tv' : r.type === 'movie'; });

      // Stardima's search ANDs across words in a multi-word query. Episode
      // titles only ever contain the character/franchise name, not the full
      // show title, so a full-title search reliably finds movies but comes
      // up empty for episodes. Retry with just the last word — the most
      // distinctive single token — before giving up.
      if (isTv && filtered.length === 0) {
        var words = String(ctx.title || '').trim().split(/\s+/);
        var lastWord = words[words.length - 1];
        if (lastWord && lastWord !== ctx.title) {
          results = await search(http, lastWord);
          filtered = results.filter(function (r) { return r.type === 'tv'; });
        }
      }

      if (isTv) {
        var seen = {};
        var candidates = [];
        for (var i = 0; i < filtered.length; i++) {
          var r = filtered[i];
          if (!seen[r.showId]) {
            seen[r.showId] = true;
            candidates.push({ id: r.showId, label: r.title });
          }
        }
        if (candidates.length === 0) {
          throw new Error('No matching show found on Stardima for "' + ctx.title + '"');
        }
        if (candidates.length > 1 || ctx.forceConfirm) {
          return { needsConfirmation: true, candidates: await labelCandidates(http, 'tv', candidates), providerName: 'Stardima' };
        }
        target = { type: 'tv', showId: candidates[0].id };
      } else {
        // A movie's TMDB title often carries a subtitle that differs from
        // Stardima's own phrasing (transliteration, translated subtitle,
        // etc. — e.g. a subtitled entry has no exact match on Stardima, but
        // the franchise name alone does, since Stardima's movie titles share
        // that prefix). Retry with
        // just the text before the first colon before giving up.
        if (filtered.length === 0 && ctx.title && ctx.title.indexOf(':') !== -1) {
          var prefix = ctx.title.split(':')[0].trim();
          if (prefix && prefix !== ctx.title) {
            results = await search(http, prefix);
            filtered = results.filter(function (r) { return r.type === 'movie'; });
          }
        }
        if (filtered.length === 0) {
          throw new Error('No matching movie found on Stardima for "' + ctx.title + '"');
        }
        if (filtered.length > 1 || ctx.forceConfirm) {
          var movieCandidates = filtered.map(function (r) { return { id: r.movieId, label: r.title }; });
          return {
            needsConfirmation: true,
            candidates: await labelCandidates(http, 'movie', movieCandidates),
            providerName: 'Stardima'
          };
        }
        target = { type: 'movie', movieId: filtered[0].movieId };
      }
    }

    // Step 2: for a series, locate the specific episode by its absolute
    // number (see the file-header note on episode numbering) using
    // Stardima's own per-season episode-list API — see the comment above
    // findEpisodeInSeasons for why this replaced an earlier search-based
    // lookup (site search turned out to return zero results for most bare
    // episode numbers, not just low ones — confirmed live).
    var hash;
    if (target.type === 'tv') {
      var seasonIds = await getShowSeasonList(http, target.showId);
      if (seasonIds.length === 0) {
        throw new Error('Could not find season list for show ' + target.showId + ' on Stardima');
      }
      var foundEpisode = await findEpisodeInSeasons(http, seasonIds, Number(ctx.episode));
      if (!foundEpisode) {
        throw new Error('Episode ' + ctx.episode + ' not found for show ' + target.showId + ' on Stardima');
      }
      hash = extractHashFromHtml(foundEpisode.watch_url, foundEpisode.watch_url);
    } else {
      hash = await extractHyperwatchingHash(http, buildPlayUrl(target));
    }

    // Step 3: hyperwatching hash -> server list -> chosen host -> m3u8.
    var servers = await getServerList(http, hash);

    var lastError = null;
    for (var p = 0; p < SERVER_PRIORITY.length; p++) {
      var name = SERVER_PRIORITY[p];
      var server = servers.filter(function (s) { return s.name === name && s.id; })[0];
      if (!server) continue;
      try {
        var hostUrl = await resolveServerUrl(http, hash, server.id);
        var streamUrl = await extractStreamUrl(http, hostUrl);
        // Some of these CDN backends (tnmr.org among them, confirmed live)
        // enforce hotlink protection and 403 any request whose Referer isn't
        // the host page the stream was extracted from — including no
        // Referer at all. The relay forwards this on every playlist/segment
        // fetch, not just the master playlist.
        return { streamUrl: streamUrl, subtitles: [], providerName: 'Stardima (' + name + ')', referer: hostUrl };
      } catch (e) {
        lastError = e;
      }
    }

    throw new Error('All Stardima servers failed for this title. Last error: ' + (lastError ? lastError.message : 'no servers available'));
  }
};
