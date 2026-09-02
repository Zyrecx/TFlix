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

  // ctx: { tmdbId, imdbId, title, year, isTv, season, episode }
  // http: { fetchJson(url), fetchText(url), fetchRaw(url) } — plain Node
  //       requests (no browser Origin header)
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

`resolve()` must return `{ streamUrl, subtitles?, providerName? }` or throw —
a thrown error triggers TFlix's automatic fallback to the next provider.

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
