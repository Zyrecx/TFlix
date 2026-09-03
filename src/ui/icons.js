/**
 * Standardized icon set (lucide-static) — replaces ad-hoc emoji so the UI
 * renders consistently across TV firmwares/fonts instead of relying on the
 * platform's emoji glyph set (which varies wildly and is often missing/
 * mismatched on Tizen). No CDN — bundled at build time, works fully offline.
 */
import house from 'lucide-static/icons/house.svg?raw';
import film from 'lucide-static/icons/film.svg?raw';
import tv from 'lucide-static/icons/tv.svg?raw';
import bookmark from 'lucide-static/icons/bookmark.svg?raw';
import bookmarkPlus from 'lucide-static/icons/bookmark-plus.svg?raw';
import bookmarkCheck from 'lucide-static/icons/bookmark-check.svg?raw';
import search from 'lucide-static/icons/search.svg?raw';
import settings from 'lucide-static/icons/settings.svg?raw';
import x from 'lucide-static/icons/x.svg?raw';
import play from 'lucide-static/icons/play.svg?raw';
import pause from 'lucide-static/icons/pause.svg?raw';
import skipForward from 'lucide-static/icons/skip-forward.svg?raw';
import rewind from 'lucide-static/icons/rewind.svg?raw';
import fastForward from 'lucide-static/icons/fast-forward.svg?raw';
import captions from 'lucide-static/icons/captions.svg?raw';
import wifi from 'lucide-static/icons/wifi.svg?raw';
import qrCode from 'lucide-static/icons/qr-code.svg?raw';
import smartphone from 'lucide-static/icons/smartphone.svg?raw';
import zap from 'lucide-static/icons/zap.svg?raw';
import rotateCcw from 'lucide-static/icons/rotate-ccw.svg?raw';
import plug from 'lucide-static/icons/plug.svg?raw';
import clock from 'lucide-static/icons/clock.svg?raw';
import flame from 'lucide-static/icons/flame.svg?raw';
import popcorn from 'lucide-static/icons/popcorn.svg?raw';
import star from 'lucide-static/icons/star.svg?raw';
import rocket from 'lucide-static/icons/rocket.svg?raw';
import drama from 'lucide-static/icons/drama.svg?raw';
import satellite from 'lucide-static/icons/satellite.svg?raw';
import chevronLeft from 'lucide-static/icons/chevron-left.svg?raw';
import chevronRight from 'lucide-static/icons/chevron-right.svg?raw';
import chevronDown from 'lucide-static/icons/chevron-down.svg?raw';
import check from 'lucide-static/icons/check.svg?raw';
import plus from 'lucide-static/icons/plus.svg?raw';
import key from 'lucide-static/icons/key.svg?raw';
import listVideo from 'lucide-static/icons/list-video.svg?raw';
import trash2 from 'lucide-static/icons/trash-2.svg?raw';
import refreshCw from 'lucide-static/icons/refresh-cw.svg?raw';
import download from 'lucide-static/icons/download.svg?raw';
import folderOpen from 'lucide-static/icons/folder-open.svg?raw';
import server from 'lucide-static/icons/server.svg?raw';
import circleAlert from 'lucide-static/icons/circle-alert.svg?raw';
import triangleAlert from 'lucide-static/icons/triangle-alert.svg?raw';
import ellipsisVertical from 'lucide-static/icons/ellipsis-vertical.svg?raw';
import loaderCircle from 'lucide-static/icons/loader-circle.svg?raw';
import eye from 'lucide-static/icons/eye.svg?raw';
import eyeOff from 'lucide-static/icons/eye-off.svg?raw';
import info from 'lucide-static/icons/info.svg?raw';
import plugZap from 'lucide-static/icons/plug-zap.svg?raw';
import keyboard from 'lucide-static/icons/keyboard.svg?raw';
import flag from 'lucide-static/icons/flag.svg?raw';

const RAW_ICONS = {
  home: house, film, tv, bookmark, 'bookmark-plus': bookmarkPlus, 'bookmark-check': bookmarkCheck,
  search, settings, x, play, pause, 'skip-forward': skipForward, rewind, 'fast-forward': fastForward,
  captions, wifi, 'qr-code': qrCode, smartphone, zap, 'rotate-ccw': rotateCcw, plug, clock,
  flame, popcorn, star, rocket, drama, satellite, 'chevron-left': chevronLeft, 'chevron-right': chevronRight,
  'chevron-down': chevronDown,
  check, plus, key, 'list-video': listVideo, 'trash-2': trash2, 'refresh-cw': refreshCw, download,
  'folder-open': folderOpen, server, 'circle-alert': circleAlert, 'triangle-alert': triangleAlert,
  'ellipsis-vertical': ellipsisVertical, 'loader-circle': loaderCircle, eye, 'eye-off': eyeOff,
  info, 'plug-zap': plugZap, keyboard, flag
};

/**
 * Returns an inline <svg> markup string for the given icon name.
 * stroke="currentColor" in the source SVGs means color follows CSS `color`.
 */
export function icon(name, { size = 18, className = '' } = {}) {
  const raw = RAW_ICONS[name];
  if (!raw) return '';
  return raw
    .replace(/<!--[\s\S]*?-->\n?/, '')
    .replace(/width="24"/, `width="${size}"`)
    .replace(/height="24"/, `height="${size}"`)
    .replace('class="lucide', `class="icon${className ? ` ${className}` : ''} lucide`)
    .trim();
}
