/**
 * Short-lived pairing codes for the phone -> TV handoff. A code authorizes
 * exactly one config-mutating action, then is consumed. This is the only
 * thing standing between "device on the same wifi" and "can make the relay
 * dynamically import and execute a JS file" (or, for the tmdb_key kind, read
 * back an API key the TV then trusts) — treat it as the actual security
 * boundary, not a UX nicety.
 *
 * `kind` distinguishes what the phone page collects: 'provider_pack' (a
 * manifest URL, default) or 'tmdb_key' (a raw TMDB API key string).
 */

import { randomInt } from 'crypto';

const CODE_TTL_MS = 5 * 60 * 1000;
const codes = new Map(); // code -> { expiresAt, used, kind, result }

function generateCode() {
  return String(randomInt(0, 1000000)).padStart(6, '0');
}

export function startPairing(kind = 'provider_pack') {
  // Clear any previous outstanding codes — only one pairing session at a time.
  codes.clear();
  const code = generateCode();
  codes.set(code, { expiresAt: Date.now() + CODE_TTL_MS, used: false, kind, result: null });
  return { code, expiresAt: Date.now() + CODE_TTL_MS };
}

export function isCodeValid(code) {
  const entry = codes.get(code);
  return Boolean(entry && !entry.used && entry.expiresAt > Date.now());
}

export function getPairingKind(code) {
  const entry = codes.get(code);
  return entry ? entry.kind : null;
}

export function consumeCode(code) {
  const entry = codes.get(code);
  if (!entry || entry.used || entry.expiresAt <= Date.now()) return false;
  entry.used = true;
  return true;
}

export function setPairingResult(code, result) {
  const entry = codes.get(code);
  if (entry) entry.result = result;
}

export function getPairingStatus(code) {
  const entry = codes.get(code);
  if (!entry) return { state: 'unknown' };
  if (entry.expiresAt <= Date.now() && !entry.used) return { state: 'expired' };
  if (!entry.used) return { state: 'pending' };
  return { state: 'done', result: entry.result };
}
