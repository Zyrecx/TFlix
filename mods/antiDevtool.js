// Cineby bundles disable-devtool@0.3.8, whose Performance detector false-positives on TV
// hardware and never stops polling (its pc/mobile stop-gate misclassifies Tizen as desktop).
// The console stub below is resolved per-call by the library, so it works even though this
// script runs before disable-devtool initializes. window.open/setTimeout are a safety net in
// case a detector fires anyway.

const nativeLog = console.log.bind(console);
const nativeOpen = window.open;
const nativeSetTimeout = window.setTimeout;

console.log = function () {};
console.table = function () {};
console.clear = function () {};

window.open = function (url, target) {
  if ((!url || url === 'about:blank') && target === '_self') {
    nativeLog('TFlix: blocked disable-devtool blanking attempt');
    return null;
  }
  return nativeOpen.apply(window, arguments);
};

window.close = function () {};

window.setTimeout = function (fn, delay) {
  if (delay === 500 && typeof fn === 'function') {
    try {
      if (/theajack|disable-devtool/i.test(Function.prototype.toString.call(fn))) {
        nativeLog('TFlix: dropped disable-devtool redirect timer');
        return 0;
      }
    } catch (e) {
      // toString can throw on some proxied/bound functions; fall through and schedule normally
    }
  }
  return nativeSetTimeout.apply(window, arguments);
};
