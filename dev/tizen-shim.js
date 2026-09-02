/**
 * Tizen TV API Shim for Desktop Development & Testing
 * Emulates window.tizen APIs in standard desktop browsers (Chrome, Edge, Firefox)
 */

export function setupTizenShim() {
  if (typeof window === 'undefined') return;

  if (!window.tizen) {
    const registeredKeys = new Set();

    window.tizen = {
      tvinputdevice: {
        registerKey(keyName) {
          registeredKeys.add(keyName);
          console.log(`[Tizen Shim] Registered hardware TV key: ${keyName}`);
        },
        unregisterKey(keyName) {
          registeredKeys.delete(keyName);
          console.log(`[Tizen Shim] Unregistered hardware TV key: ${keyName}`);
        },
        getSupportedKeys() {
          return Array.from(registeredKeys);
        }
      },
      application: {
        getCurrentApplication() {
          return {
            appInfo: { id: '@zyrecx/tflix', name: 'TFlix' },
            exit() {
              console.log('[Tizen Shim] tizen.application.getCurrentApplication().exit() called');
              alert('Tizen App Exit Triggered (Would return to TV home screen on Samsung TV)');
            },
            hide() {
              console.log('[Tizen Shim] tizen.application.getCurrentApplication().hide() called');
            }
          };
        }
      }
    };
  }
}
