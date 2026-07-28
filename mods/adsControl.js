// Cineby gates its ad scripts on sessionStorage['ads-enabled-session'] and writes "true"
// on every boot. sessionStorage dies with the tab, so the in-page toggle can never survive
// a TizenBrew relaunch — the TV gets ads every single time.
//
// Patching the Storage prototype (rather than just writing the key once) means the site's
// own boot-time write is coerced too, so this works regardless of whether TFlix runs before
// or after Cineby's bundle initializes.

const ADS_FLAG = 'ads-enabled-session';

const nativeSetItem = Storage.prototype.setItem;

Storage.prototype.setItem = function (key, value) {
  if (key === ADS_FLAG) {
    value = 'false';
  }
  return nativeSetItem.call(this, key, value);
};

try {
  sessionStorage.setItem(ADS_FLAG, 'false');
} catch (e) {
  // sessionStorage can throw in private/partitioned contexts; ads simply stay on.
}
