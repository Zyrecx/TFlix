# Writing a Provider Pack

TFlix ships with **no built-in streaming sources**. Every "direct" (native
HLS) provider comes from a *provider pack* — a small JSON manifest plus one
`.js` file per provider — that a user installs at runtime, either by
browsing a catalog (`Settings → Browse Provider Packs`) or scanning a QR
code (`Settings → Add a Provider Pack → Add via Phone`). This keeps any
scraping/extraction code for a specific site out of the TFlix repo and npm
package entirely; see the provider-pack section of `service/hlsRelay.js`
for the loader and trust model.

This doc shows the contract with a fully legal, working example — a public
Apple test stream, no scraping involved — so you can see the shape and build
your own pack for a source you have the rights to.

## 1. The provider file

**Provider files must be plain CommonJS — no `import`/`export`, no dynamic
`import()`, no optional chaining (`?.`), no nullish coalescing (`??`).** The
relay loads them with `require()` inside a bare Node `vm` sandbox on the TV
(that's how TizenBrew's serviceFile mechanism actually works, and it can't
do ESM syntax or dynamic import at all), and TVs have shipped with Node as
old as v12.4 — `?.`/`??` need v14+. Async/await, template literals,
destructuring, and object spread are all fine.

Each provider exports an object shaped like this via `module.exports`:

```js
// example-provider.js
module.exports = {
  id: 'example-bipbop',
  name: 'Example (Apple BipBop Test Stream)',
  description: 'Always-available public HLS test stream — for demoing the provider-pack contract only.',

  // ctx: { tmdbId, imdbId, title, year, isTv, season, episode, confirmedShowId }
  // http: { fetchJson(url), fetchText(url), fetchRaw(url, opts?) } — plain
  //       Node requests (no browser Origin header). `opts` on fetchRaw is
  //       either a plain headers object (GET, back-compat) or
  //       { method, headers, body } for a POST/PUT with a body.
  async resolve(ctx, http) {
    // A real provider would look up `ctx.tmdbId`/`ctx.imdbId` against a
    // streaming source's own API here. This demo just returns the same
    // public test stream every time.
    return {
      streamUrl: 'https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_16x9/bipbop_16x9_variant.m3u8',
      subtitles: [], // [{ src, lang, label }]
      providerName: 'BipBop Demo'
    };
  }
};
```

`resolve()` must return one of three shapes, or throw — a thrown error
triggers TFlix's automatic fallback to the next provider:

1. **`{ streamUrl, subtitles?, providerName?, referer? }`** — a raw HLS/MP4
   URL. Played natively (native controls, resume, subtitle rendering).
   Prefer this when the source is extractable without excessive fragility.
   Set `referer` (the page the stream URL was extracted from) when the CDN
   enforces hotlink protection — the relay forwards it as the `Referer`
   header on the master playlist *and* every sub-playlist/segment fetch it
   proxies for that stream. Without it, some hosts (confirmed live:
   lulustream/luluvdo's `tnmr.org` CDN) 403 every request, including ones
   with no Referer at all.

2. **`{ embedUrl, providerName? }`** — a URL to iframe as-is instead of a raw
   stream. Use this when raw extraction would mean chasing an ad-injected or
   frequently-changing wrapper chain (see the Stardima case study below) —
   trading native player features for reliability. `embedUrl` bypasses
   TFlix's HLS-playlist rewriting proxy entirely, since it's an HTML page,
   not a playlist.

3. **`{ needsConfirmation: true, candidates: [{ id, label, year? }], providerName? }`**
   — the title search was ambiguous and you don't want to guess. TFlix shows
   the user a picker and, once they choose, calls `resolve()` again with
   `ctx.confirmedShowId` set to the chosen candidate's `id`. **Skip search
   entirely when `ctx.confirmedShowId` is set** — go straight to that show.
   TFlix caches the choice per (provider, TMDB id), so this fires once per
   show, not once per episode — design your `id` values to be stable across
   calls (e.g. the source site's own internal show id).

### Optional capabilities

These exist for packs shaped like the Stardima case study below — a source
with its own independent, fuzzily-matched, and genuinely incomplete catalog.
A provider keyed directly off `ctx.tmdbId`/`ctx.imdbId` (one request, one
definite yes/no answer) has neither problem and should leave both unset.

- **`fuzzyMatch: true`** — this pack has to guess which of its own catalog
  entries corresponds to the requested title (i.e. it uses the
  `needsConfirmation` flow above). TFlix uses this to show a "wrong match?"
  control during playback, letting the user correct — or explicitly
  ratify — an auto-accepted single-candidate match after the fact, via
  `ctx.forceConfirm: true` (see below), rather than prompting on every new
  title just in case one is wrong.

- **`ctx.forceConfirm`** — when true, `resolve()` must return
  `needsConfirmation` (with candidates) even if there's only one match, or
  a cached `ctx.confirmedShowId` would otherwise apply — the "wrong match?"
  control sets this to force the picker to reappear on demand. Auto-accepting
  a single search result without ever offering this is how a wrong match
  (e.g. two same-franchise titles the site's search doesn't distinguish
  well) can go unnoticed indefinitely.

- **`supportsAvailability: true` + `async listEpisodes(ctx, http)`** — this
  pack's catalog is genuinely incomplete (not every episode is available),
  so TFlix can show a small "not on \[Provider\]" badge in the episode grid.
  `listEpisodes` receives only `{ confirmedShowId }` (TFlix never calls it
  with an unconfirmed guess — a badge based on a wrong identity match is
  worse than no badge) and returns `{ episodes: [absoluteEpisodeNumber, ...] }`
  covering every season/bucket your source might split the catalog into.
  Keep this **season/batch-grained**, not per-episode — fetch each of your
  source's own listing endpoints once and return everything they contain,
  rather than one request per episode number.

### Case study: a source with no TMDB/IMDb id mapping

Some sites (Arabic dub aggregators are a common example) have no external-id
lookup at all — only a text search keyed by their own internal ids, and a
per-title server list that itself points through ad-laden wrapper domains
before reaching the actual host. A resolver for a source like that typically:

1. Searches by `ctx.title` (+ `ctx.year` for movies) against the site's own
   search endpoint.
2. If `ctx.confirmedShowId` is set, skips straight to step 4 using it in
   place of a fresh search result.
3. If the search is ambiguous (multiple plausible titles, or none — don't
   guess), returns `{ needsConfirmation, candidates }`.
4. Loads the matched title's episode/server list and picks a server.
5. If that server is itself a redirect-wrapper domain (ad monetization
   layers are common), look for the *real* destination already sitting in
   that wrapper's own query string (e.g. `?id=<encoded real URL>`) rather
   than following the redirect — it's usually right there, and skipping it
   avoids the ad chain entirely.
6. Extracts the actual `.m3u8`/`.mp4` from that final host's page. Some
   hosts use a simple reversible word-substitution obfuscation on their
   player config (a giant `'a|b|c|...'.split('|')` dictionary swap) rather
   than real packed/eval'd JS — check for that pattern before assuming you
   need a full unpacker.
7. On failure at any step (episode not found, no server worked), **throw**
   rather than resolve the wrong episode — TFlix falls back to the next
   provider automatically.

### Native catalogs (anime/dub sites with their own browse structure)

A source with its own categories, search, and season/episode structure that
doesn't map cleanly onto TMDB (fuzzy title-matching plus season/episode-number
conversion produces wrong matches — "wrong season" is a real pain point) can
opt into **native-catalog mode** instead of being a pure TMDB-id resolver.
A native provider gets a dedicated per-provider browse screen in the app;
playback launched from it bypasses TMDB-anchored matching entirely.

All of the following are properties on the same `module.exports` object as
`resolve()`/`fuzzyMatch`/etc — nothing changes in `manifest.json`. Omit all of
them (or set `catalogMode: 'tmdb'`) for a normal pack — zero behavior change.

```js
module.exports = {
  id: 'example-native',
  // ... resolve()/etc ...

  catalogMode: 'native', // 'tmdb' (default) | 'native'

  // Which content types this source actually has — required for
  // catalogMode: 'native' so the browse screen doesn't imply completeness
  // the source doesn't have.
  catalogTypes: ['tv'], // subset of ['movie', 'tv']

  // Opt out of the app's generic TMDB-art-match fallback for this pack's
  // items (e.g. mismatch risk judged too high). Only meaningful alongside
  // catalogMode: 'native'.
  disableTmdbArtFallback: false,

  // Declares the browse screen's category tabs, in display order. Required
  // for catalogMode: 'native'.
  catalogCategories: [
    { id: 'latest', label: 'Latest' },
    { id: 'movies', label: 'Movies' }
  ],

  // One page of this source's own catalog for a category id from
  // catalogCategories above. `id` is this pack's own internal id for the
  // item — stable across calls, threaded back as ctx.confirmedShowId on
  // playback. `poster`, if present, must be a full absolute URL (the app
  // passes it through its image-URL helper unmodified); omit/null if the
  // source has none — the app's art-fallback chain takes over.
  // Returns: { items: [ { id, title, year?, poster?, type: 'movie'|'tv' } ],
  //            hasMore: boolean }
  async listCatalog(category, page, http) { /* ... */ },

  // Text search against this source's own catalog — feeds the
  // per-provider search box, NOT merged into TFlix's global TMDB search.
  // Same item shape as listCatalog, no pagination (best N results, e.g.
  // capped ~30). Required for catalogMode: 'native'.
  // Returns: { items: [...] }
  async search(query, http) { /* ... */ },

  // Optional. Only needed if a native 'tv' item has its own season
  // structure the browse screen should let the user pick before episodes.
  // Many dub/anime sites flatten everything to one continuous episode list
  // instead — in that case omit this; the browse screen treats "no
  // seasons" as "go straight to listNativeEpisodes".
  // nativeId is the id from listCatalog/search.
  // Returns: { seasons: [ { id, label } ] }
  async getSeasons(nativeId, http) { /* ... */ },

  // Required for catalogMode: 'native' when catalogTypes includes 'tv'.
  // Distinct from supportsAvailability/listEpisodes above — this returns
  // real episode metadata for browsing, not a badge-only bare-number list.
  // seasonId is null when getSeasons is unused. `id` here flows into
  // ctx.confirmedShowId when the user picks an episode. `number` is this
  // pack's own native episode number — may be continuous/absolute, may not
  // match TMDB at all, and that's fine; TMDB is not in this loop.
  // Returns: { episodes: [ { id, number, title?, thumb? } ] }
  async listNativeEpisodes(nativeId, seasonId, http) { /* ... */ }
};
```

**`resolve()` contract addition:** when called from the native browse flow,
`ctx` is `{ native: true, confirmedShowId: <chosen id>, season, episode, isTv,
... }` with `tmdbId`/`imdbId`/`title`/`year` blank/absent — there may be no
TMDB match at all. A `catalogMode: 'native'` pack's `resolve()` should treat
`ctx.native` as sufficient input and skip any TMDB-anchored matching or
season-length-sum conversion entirely (`season`/`episode` here are already
the source's own native numbers). A `catalogMode: 'tmdb'` (default) pack
never receives `ctx.native: true` — the app excludes native providers from
ordinary TMDB-flow rotation entirely, so this only ever happens from the
native browse flow, explicitly.

### A note on episode numbering

`ctx.season`/`ctx.episode` are TMDB's numbers, which for most shows means
per-season numbering. Some sources (again, common for long-running anime dub
sites) number episodes as one continuous run instead. Before writing any
conversion logic, check what TMDB's own canonical season structure for the
show actually is — some long-running series are modeled by TMDB as a single
season already, in which case `ctx.episode` already *is* the absolute number
and no conversion is needed. Don't build a season-length-sum conversion
speculatively; only add it once you've confirmed a specific show actually
needs one.

## 2. The manifest

```json
{
  "name": "My Example Pack",
  "providers": [
    { "id": "example-bipbop", "file": "example-provider.js" }
  ]
}
```

Host both files at a public HTTP(S) URL (a GitHub raw URL, a Gist, your own
server/Worker) and point TFlix at the manifest's URL — either paste it into
`Settings → Custom Provider Repository URL` or hand it out as a pairing QR.

### Sharing code across providers in one pack

If a pack has several providers that all embed the same handful of video
hosts (common — most streaming sites are a thin catalog/search layer wrapped
around a small, reused set of hosting services), duplicate host-extraction
logic in every provider file is a maintenance trap. Add a `"shared"` array
to the manifest naming plain files that get installed into the pack's own
directory unvalidated (no `id`/`resolve` required) so provider files can
`require()` them like normal sibling modules:

```json
{
  "name": "My Example Pack",
  "shared": ["hosts.js"],
  "providers": [
    { "id": "example-site", "file": "example-site.js" }
  ]
}
```

```js
// hosts.js — not a provider itself, just exports helpers
module.exports = {
  async extractVoe(pageUrl, http) { /* ... */ },
  async extractDoodstream(pageUrl, http) { /* ... */ }
};
```

```js
// example-site.js
var hosts = require('./hosts');
module.exports = {
  id: 'example-site',
  // ...
  async resolve(ctx, http) {
    // ... find the embed URL, then:
    return hosts.extractVoe(embedUrl, http);
  }
};
```

This works because provider files (unlike `hlsRelay.js` itself) are written
to real files on disk and loaded with real `require()` — sibling requires
are fine at that layer. `shared` files are fetched/installed the same way
providers are (relative to the manifest URL) but skip the provider-shape
check, and are safe to sit alongside real providers since the loader already
ignores any `.js` file in a pack directory that doesn't export `{id, resolve}`.

## 3. (Optional) Listing it in a catalog

`Settings → Browse Provider Packs` reads a simple index array from
`DEFAULT_PACK_INDEX_URL` (see `src/api/providers.js`):

```json
[
  { "name": "My Example Pack", "description": "One-line pitch", "manifestUrl": "https://.../manifest.json" }
]
```

Point `DEFAULT_PACK_INDEX_URL` at your own hosted index if you want a
one-click browsable catalog instead of manual manifest URLs / QR codes.

## Legal note

What a provider's `resolve()` does — and whether it's lawful for you to
scrape, decrypt, or redistribute a given source — is entirely on the pack
author. TFlix (this repo) is just a player and a plugin loader; it doesn't
bundle, endorse, or vet any pack's content.
