// ==UserScript==
// @name         TFlix (local dev)
// @namespace    https://github.com/Zyrecx/TFlix
// @version      1.4.2
// @description  Loads the local TFlix build plus the Tizen TV shim for desktop testing
// @match        https://www.cineby.at/*
// @match        https://cineby.at/*
// @match        https://www.cineby.gd/*
// @match        https://cinejoy.to/*
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @connect      localhost
// ==/UserScript==

// Loaded via GM_xmlhttpRequest + eval rather than @require. Tampermonkey caches @require
// resources by URL and does not re-check them on reload - a static cache-busting query string
// only defeats that once, at save time, then goes stale on every later rebuild. Fetching with a
// timestamp computed at *run time* guarantees this always executes today's dist/userScript.js.
//
// Tradeoff: this makes injection async, so it can land a tick or two after document-start rather
// than exactly at it. That's fine for adsControl.js and antiDevtool.js specifically - both patch
// methods that Cineby's own code only calls later (sessionStorage.setItem on ads, console.log
// inside disable-devtool's interval) rather than racing something that runs once at parse time,
// which is why the antiDevtool fix was designed to work "even after the library has already
// initialized" in the first place. Don't assume that holds for future patches without checking.
(function () {
  var BASE = 'http://localhost:8080/';

  function run(path) {
    GM_xmlhttpRequest({
      method: 'GET',
      url: BASE + path + '?t=' + Date.now(),
      onload: function (res) {
        if (res.status !== 200) {
          console.error('[TFlix dev] ' + path + ' -> HTTP ' + res.status + '. Is `npm run dev` running?');
          return;
        }
        try {
          (0, eval)(res.responseText);
        } catch (e) {
          console.error('[TFlix dev] failed to run ' + path, e);
        }
      },
      onerror: function () {
        console.error('[TFlix dev] could not reach ' + BASE + path + '. Is `npm run dev` running on :8080?');
      }
    });
  }

  // Shim first so the tizen stub and key bindings exist before TFlix's own code runs.
  run('dev/tizen-tv-shim.js');
  run('dist/userScript.js');
})();

// Test bindings once loaded (see the HUD, bottom right):
//   arrows / Enter  pass straight through as the TV sends them
//   b or Backspace  Back (10009)
//   p or Space      MediaPlayPause
//   f / r           FastForward / Rewind
//   s               Stop
//   , / .           TrackPrevious / TrackNext
//
// Set CPU throttling to 6x in DevTools > Performance before judging anything;
// a desktop without throttling will make everything look fast.
