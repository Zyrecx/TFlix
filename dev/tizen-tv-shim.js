/**
 * TFlix TV test shim - development only, never bundled into the published package.
 *
 * A desktop keyboard cannot produce the events a Samsung remote sends: Back arrives as
 * keyCode 10009 and the transport keys arrive as e.key === 'MediaPlayPause' and friends.
 * Without this shim most of TFlix's key handling is simply unreachable in a browser, which
 * is why testing on desktop previously only ever exercised the black-screen bug.
 *
 * It also stubs the tizen global and renders a HUD measuring keypress -> focus repaint,
 * so "I can't tell whether the key registered" becomes a number.
 */
(function () {
  if (window.__tflixTvShim) return;
  window.__tflixTvShim = true;

  // Samsung Tizen TVInputDevice key codes.
  var TV_KEYS = {
    Back:                { key: 'Back',                keyCode: 10009 },
    Enter:               { key: 'Enter',               keyCode: 13 },
    MediaPlayPause:      { key: 'MediaPlayPause',      keyCode: 10252 },
    MediaPlay:           { key: 'MediaPlay',           keyCode: 415 },
    MediaPause:          { key: 'MediaPause',          keyCode: 19 },
    MediaStop:           { key: 'MediaStop',           keyCode: 413 },
    MediaFastForward:    { key: 'MediaFastForward',    keyCode: 417 },
    MediaRewind:         { key: 'MediaRewind',         keyCode: 412 },
    MediaTrackNext:      { key: 'MediaTrackNext',      keyCode: 10233 },
    MediaTrackPrevious:  { key: 'MediaTrackPrevious',  keyCode: 10232 }
  };

  // Desktop key -> TV key. Arrows and Enter already match the TV, so they pass through.
  var BINDINGS = {
    Backspace: 'Back',
    b:         'Back',
    p:         'MediaPlayPause',
    ' ':       'MediaPlayPause',
    f:         'MediaFastForward',
    r:         'MediaRewind',
    s:         'MediaStop',
    '.':       'MediaTrackNext',
    ',':       'MediaTrackPrevious'
  };

  // ---- tizen global stub -------------------------------------------------

  if (typeof window.tizen === 'undefined') {
    var registered = [];
    window.tizen = {
      tvinputdevice: {
        registerKey: function (name) { registered.push(name); },
        unregisterKey: function (name) {
          var i = registered.indexOf(name);
          if (i > -1) registered.splice(i, 1);
        },
        getSupportedKeys: function () {
          return Object.keys(TV_KEYS).map(function (k) {
            return { name: k, code: TV_KEYS[k].keyCode };
          });
        },
        __registered: registered
      }
    };
  }

  // ---- HUD ---------------------------------------------------------------

  var hud = document.createElement('div');
  hud.setAttribute('data-tflix-shim', '');
  hud.style.cssText = [
    'position:fixed', 'right:12px', 'bottom:12px', 'z-index:2147483647',
    'background:rgba(0,0,0,.85)', 'color:#0f0', 'font:12px/1.5 monospace',
    'padding:8px 10px', 'border:1px solid #0f0', 'border-radius:4px',
    'pointer-events:none', 'white-space:pre', 'min-width:210px'
  ].join(';');
  var lastKey = '-';
  var lastLatency = '-';
  var focusTarget = '-';

  function renderHud() {
    hud.textContent =
      'TFlix TV shim\n' +
      'key:     ' + lastKey + '\n' +
      'focus:   ' + focusTarget + '\n' +
      'latency: ' + lastLatency;
  }
  renderHud();

  function attachHud() {
    if (document.body) document.body.appendChild(hud);
  }
  if (document.body) attachHud();
  else document.addEventListener('DOMContentLoaded', attachHud);

  // ---- keypress -> focus repaint timing ----------------------------------

  var pressedAt = 0;
  var awaitingPaint = false;

  function describe(el) {
    if (!el) return '-';
    var s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    var cls = (el.className || '').toString().trim().split(/\s+/)[0];
    if (cls && cls !== 'tflix-focused') s += '.' + cls;
    return s.slice(0, 28);
  }

  if (typeof MutationObserver !== 'undefined') {
    var focusObserver = new MutationObserver(function () {
      if (!awaitingPaint) return;
      awaitingPaint = false;
      // rAF fires before paint; the nested call lands just after it.
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          lastLatency = Math.round(performance.now() - pressedAt) + ' ms';
          focusTarget = describe(document.querySelector('.tflix-focused'));
          renderHud();
        });
      });
    });

    var startFocusObserver = function () {
      if (document.body) {
        focusObserver.observe(document.body, {
          subtree: true, attributes: true, attributeFilter: ['class']
        });
      }
    };
    if (document.body) startFocusObserver();
    else document.addEventListener('DOMContentLoaded', startFocusObserver);
  }

  // ---- key translation ---------------------------------------------------

  document.addEventListener('keydown', function (e) {
    if (e.__tflixSynthetic) return;

    // Never hijack typing in a text field.
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;

    pressedAt = performance.now();
    awaitingPaint = true;
    lastLatency = 'measuring…';

    var mapped = BINDINGS[e.key];
    if (!mapped) {
      lastKey = e.key + ' (passthrough)';
      renderHud();
      return;
    }

    e.preventDefault();
    e.stopImmediatePropagation();

    var spec = TV_KEYS[mapped];
    lastKey = e.key + ' -> ' + spec.key + ' (' + spec.keyCode + ')';
    renderHud();

    var synthetic = new KeyboardEvent('keydown', {
      key: spec.key, code: spec.key, bubbles: true, cancelable: true
    });
    // KeyboardEvent ignores keyCode in its init dict, so define it explicitly.
    Object.defineProperty(synthetic, 'keyCode', { get: function () { return spec.keyCode; } });
    Object.defineProperty(synthetic, 'which', { get: function () { return spec.keyCode; } });
    synthetic.__tflixSynthetic = true;

    (document.activeElement || document.body).dispatchEvent(synthetic);
  }, true);

  console.info(
    '[TFlix shim] active. Bindings: ' +
    Object.keys(BINDINGS).map(function (k) {
      return (k === ' ' ? 'Space' : k) + '=' + BINDINGS[k];
    }).join(', ')
  );
})();
