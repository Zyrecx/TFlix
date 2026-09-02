# TFlix

**TFlix** is a standalone 10-foot streaming web application for Samsung Smart TVs running **TizenBrew**. It's a self-contained TizenBrew *app* (not a mod injected into another site) — modern Netflix-inspired UI, rich metadata and search powered by your own **TMDB** key, seamless D-Pad navigation, and a pluggable multi-provider streaming engine.

> **Note:** The original TFlix was a TizenBrew mod that wrapped [Cineby.at](https://www.cineby.at). That codebase is archived on the [`v1-legacy`](https://github.com/Zyrecx/TFlix/tree/v1-legacy) branch and is no longer maintained — `main` is the current, standalone app described below.

---

## Features

- **10-Foot TV Remote Navigation** — 2D directional D-Pad navigation, focus indicators, and smooth carousel scrolling.
- **Rich TMDB Catalog & Discovery** — Trending movies, popular series, genres, top rated titles, and full cast/season/episode info.
- **Hybrid Playback Engine** — Native `Hls.js` + HTML5 `<video>` for direct HLS/MP4 sources, with full TV transport controls, and iframe-embed fallback for other sources.
- **Full TV Video OSD Controls** — Play/Pause, ±10s skip, timeline scrubbing, subtitle/audio track selection, resume timestamps, and automatic next-episode.
- **Search** — Uses the TV's own on-screen keyboard (or a paired phone via SmartThings) to type into a focusable search field.
- **Bring Your Own TMDB Key** — Free personal TMDB API key stored locally on the TV; no shared rate limits.
- **Watch History & Watchlist** — Local resume timestamps and a saved watchlist, stored entirely on-device.
- **Guided First-Run Setup** — A short setup tour walks new users through connecting a TMDB key and a streaming provider, including a QR-code phone-pairing flow so you don't have to type a key with a TV remote.
- **No Bundled Streaming Sources** — TFlix ships as a clean player with zero built-in scrapers. Streaming providers are loaded at runtime from a pack you choose — see [Streaming Providers](#streaming-providers) below.

---

## Streaming Providers

TFlix doesn't bundle any streaming sources in this repo or the npm package. Instead:

- **Embed providers** (iframe-based) can be loaded from a community JSON list or your own, via `Settings → Streaming Providers`. See [`providers.example.json`](./providers.example.json) for the schema.
- **Direct HLS providers** (native `Hls.js` playback) come from installable **provider packs** — small plugin bundles fetched at runtime, either by browsing a catalog or scanning a pairing QR code, both in `Settings → Add a Provider Pack`. This keeps any source-specific extraction code out of this repo entirely.

Want to build your own provider pack? See [`docs/PROVIDER_PACKS.md`](./docs/PROVIDER_PACKS.md) for the plugin contract and a working, fully legal example.

---

## Installation on Samsung TV

### Via TizenBrew (Recommended)
1. Open **TizenBrew** on your Samsung TV.
2. Choose to install a module from npm and enter the package name: `@zyrecx/tflix`.
3. Confirm the install.
4. Launch TFlix from your TizenBrew modules menu, and follow the first-run setup tour to connect your TMDB key.

---

## Local Development & Testing (No TV Required)

You can run and test the complete TV experience in Google Chrome or Microsoft Edge on your desktop:

```bash
# 1. Install dependencies
npm install

# 2. Start local development server
npm run dev
```

Open `http://localhost:5173` in your browser. A floating **TV Remote Simulator** will appear on the bottom-right of your screen, allowing you to test D-Pad navigation, media controls, and TMDB features using your keyboard or mouse.

See [dev/README.md](dev/README.md) for full desktop testing documentation, and [LOCAL-TESTING.md](LOCAL-TESTING.md) for the local relay/service testing notes.

---

## Building for Production

To build the optimized static distribution package for TizenBrew:

```bash
npm run build
```

This compiles the app into the `dist/` directory, ready to be packaged by TizenBrew (`packageType: "app"`).

---

## TV Remote Key Controls

| Remote Button | Desktop Key | Action |
| :--- | :--- | :--- |
| **D-Pad Up / Down** | `ArrowUp` / `ArrowDown` | Navigate rows, buttons, and HUD controls |
| **D-Pad Left / Right** | `ArrowLeft` / `ArrowRight` | Navigate carousel / On the seek bar: move a pending ±10s position (preview, not yet applied) |
| **OK / Enter** | `Enter` | Select button / Toggle Play & Pause / On the seek bar: commit the pending seek position |
| **Back / Return (`10009`)** | `Escape` / `b` | Exit player / Close modal / Return to Home |
| **Play / Pause (`MediaPlayPause`)** | `Space` / `p` | Toggle stream playback (Native & Embed) |
| **Fast Forward (`417`)** | `f` | Jump forward +10 seconds |
| **Rewind (`412`)** | `r` | Jump backward -10 seconds |
| **Next Track (`MediaTrackNext`)** | `n` | Jump to Next TV Episode immediately |
| **Stop (`MediaStop`)** | `s` | Stop playback and close player |

---

## License

MIT
