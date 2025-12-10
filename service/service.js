/**
 * TFlix service module
 * Handles communication with TizenBrew and other service-related tasks
 */

// Register keys for media controls using Samsung's TVInputDevice API
// See: https://developer.samsung.com/smarttv/develop/api-references/tizen-web-device-api-references/tvinputdevice-api.html
try {
  // Media control keys
  tizen.tvinputdevice.registerKey('MediaPlayPause');
  tizen.tvinputdevice.registerKey('MediaPlay');
  tizen.tvinputdevice.registerKey('MediaPause');
  tizen.tvinputdevice.registerKey('MediaStop');
  tizen.tvinputdevice.registerKey('MediaFastForward');
  tizen.tvinputdevice.registerKey('MediaRewind');
  tizen.tvinputdevice.registerKey('MediaTrackNext');
  tizen.tvinputdevice.registerKey('MediaTrackPrevious');

  // Navigation and control keys
  tizen.tvinputdevice.registerKey('Back');
  tizen.tvinputdevice.registerKey('Enter');
  tizen.tvinputdevice.registerKey('ArrowUp');
  tizen.tvinputdevice.registerKey('ArrowDown');
  tizen.tvinputdevice.registerKey('ArrowLeft');
  tizen.tvinputdevice.registerKey('ArrowRight');
} catch (e) {
  // Silent error handling - no console logs
}
