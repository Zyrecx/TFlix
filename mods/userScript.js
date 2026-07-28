// Order matters: adsControl and antiDevtool patch globals the site reads at boot, and
// playerDetection defines window.__tflixPlayerActive before the polyfill's first keydown can
// fire - all must run before anything else touches the page.
import './adsControl.js';
import './antiDevtool.js';
import './playerDetection.js';
import 'whatwg-fetch';
import './spatial-navigation-polyfill.js';
import './ui.js';
import './contentDetector.js';
