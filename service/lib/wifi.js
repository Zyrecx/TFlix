/**
 * Best-effort lookup of the Wi-Fi network name (SSID) the TV is currently
 * connected to, shown next to the pairing QR code so the user can confirm
 * their phone is on the same network before scanning. There's no portable
 * Node API for this, so we shell out to whatever the platform provides and
 * swallow any failure — the pairing flow works fine without it, this is a
 * UX nicety, not a dependency.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const TIMEOUT_MS = 1500;

async function tryCmd(cmd, args, parse) {
  try {
    const { stdout } = await execFileAsync(cmd, args, { timeout: TIMEOUT_MS });
    const value = parse(stdout);
    return value && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

export async function getWifiSsid() {
  // Tizen (and most other Linux-based STBs) — try the common tools in order
  // of how likely each is to be present in a stripped-down TV image.
  let ssid = await tryCmd('iwgetid', ['-r'], (out) => out);
  if (ssid) return ssid;

  ssid = await tryCmd(
    'sh',
    ['-c', "nmcli -t -f active,ssid dev wifi 2>/dev/null | awk -F: '$1==\"yes\"{print $2; exit}'"],
    (out) => out
  );
  if (ssid) return ssid;

  ssid = await tryCmd('sh', ['-c', "wpa_cli -i wlan0 status 2>/dev/null | awk -F= '$1==\"ssid\"{print $2}'"], (out) => out);
  return ssid;
}
