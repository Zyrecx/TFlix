// Cineby renders a muted, non-interactive background hero trailer on every /movie/ and /tv/
// detail page, using the exact same <video> tag shape TFlix's MutationObserver-based player
// detection watches for. Without a way to tell the two apart, TFlix treated that decorative
// trailer as if it were the real player: forcing its container fullscreen (z-index 9999,
// covering the Play button and description entirely), bolting on a custom OSD, hijacking arrow
// keys for seek/volume before the user had asked to play anything, and running its
// error-recovery retry loop against a video that was never broken - just still loading.
//
// The real player, once actually launched, is the only element on the page wrapped in this
// class - verified directly against the live site: exactly one match, wraps the <video>, and
// carries a player-specific "hiddenCursor" class alongside it. The hero trailer's wrapper never
// has it.
const REAL_PLAYER_ANCESTOR_SELECTOR = '.cineby-container';

/**
 * Whether `video` is Cineby's actual player, as opposed to the decorative background trailer.
 * Non-Cineby hosts always return true, preserving prior (pre-existing, site-agnostic) behaviour.
 * @param {HTMLVideoElement} video
 * @returns {boolean}
 */
export function isRealCinebyPlayer(video) {
  if (!window.location.hostname.includes('cineby.at')) return true;
  return !!(video && video.closest(REAL_PLAYER_ANCESTOR_SELECTOR));
}

// Generic extension point: spatial-navigation-polyfill.js checks this before moving grid focus
// on an arrow press, so navigation yields to the player's own seek/volume handling while a real
// player is open, instead of both firing for the same keypress. Defined here rather than
// hardcoded into the polyfill so that file stays site-agnostic - only this module needs to know
// what "a player is active" means for a given site.
window.__tflixPlayerActive = function () {
  return !!document.querySelector(REAL_PLAYER_ANCESTOR_SELECTOR + ' video');
};
