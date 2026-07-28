# TFlix desktop testing

Lets you exercise TFlix in Chrome instead of reinstalling on the TV for every change.
Nothing in this folder ships to npm (see `.npmignore`).

## Setup

1. From the repo root:

   ```
   npm run dev
   ```

   This builds `dist/` and serves the repo on `http://localhost:8080`.

2. Install [Tampermonkey](https://www.tampermonkey.net/), then create a new script and paste
   the contents of `dev/tflix.dev.user.js`. Approve the `localhost` access prompt Tampermonkey
   shows on first run (needed for `@connect localhost`).

3. Open <https://www.cineby.at/>. A green HUD appears bottom-right when the shim is live.

Every rebuild (`npm run build` or `npm run dev`) is picked up on the next page reload with no
further action — the script fetches `dist/userScript.js` fresh on every load rather than relying
on Tampermonkey's `@require` cache, which does not revalidate on its own and will otherwise keep
serving whatever it first downloaded.

## Why a shim is needed

A desktop keyboard cannot produce what a Samsung remote sends. Back arrives as keyCode
`10009`, and the transport keys arrive as `e.key === 'MediaPlayPause'` and friends — no
physical key generates those. TFlix's key handling is therefore unreachable in a plain
browser, which is why earlier Tampermonkey testing only ever reproduced the black-screen bug
rather than the app itself.

The shim translates desktop keys into the real TV events, stubs the `tizen` global so
`tizen.tvinputdevice.registerKey` resolves, and times keypress → focus repaint.

## Bindings

| Desktop | TV key | keyCode |
|---|---|---|
| arrows, Enter | pass through unchanged | 37–40, 13 |
| `b` / Backspace | Back | 10009 |
| `p` / Space | MediaPlayPause | 10252 |
| `f` | MediaFastForward | 417 |
| `r` | MediaRewind | 412 |
| `s` | MediaStop | 413 |
| `,` / `.` | MediaTrackPrevious / Next | 10232 / 10233 |

Typing inside an input or textarea is never intercepted.

## Reading the HUD

```
TFlix TV shim
key:     b -> Back (10009)
focus:   a.movie-card
latency: 34 ms
```

`latency` is the time from keydown to the paint after `.tflix-focused` moves — the delay you
actually perceive as "did that register?". Watch this number, not the wall clock.

## Throttle the CPU

**Set CPU throttling to 6× in DevTools → Performance before judging performance.** A Tizen TV
SoC is roughly 6–10× slower than a desktop; without throttling everything looks fast and the
regressions that matter on the TV stay invisible.

## What this cannot test

Video decoding and codec support, real remote input latency, GPU compositing behaviour, and
TizenBrew integration itself. Verify those on the TV before a release. For higher fidelity
short of real hardware, Tizen Studio ships a TV emulator running the actual Tizen WebKit.
