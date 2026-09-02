/**
 * Loads "provider packs" — externally-hosted bundles of provider plugins
 * (same {id, name, description, resolve} shape as service/providers/*.js) —
 * so scraper/extraction code never has to live in the public TFlix repo.
 * A pack is just a manifest.json + one .js file per provider, fetched over
 * plain HTTP (no browser Origin issue here either, same as everything else
 * in this service).
 *
 * Trust model: installing a pack means this Node process will import and
 * execute arbitrary JS from that URL. The pairing flow (lib/pairing.js) is
 * what gates this — only reachable with a fresh, single-use code shown on
 * the TV screen. Treat a pack URL like a browser extension source: only
 * install packs you trust.
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { fetchJson, fetchText } from './http.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMMUNITY_DIR = path.join(__dirname, '..', 'providers', 'community');
const CONFIG_PATH = path.join(__dirname, '..', 'data', 'providerPack.json');

function ensureDirs() {
  mkdirSync(COMMUNITY_DIR, { recursive: true });
  mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
}

function isSafeManifestUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (!['http:', 'https:'].includes(u.protocol)) return false;
  const host = u.hostname.toLowerCase();
  // Block loopback (would target the relay's own /resolve /pair etc, a
  // self-request loop) and link-local/metadata addresses. Ordinary private
  // LAN hosts (192.168.x, 10.x) are allowed on purpose — self-hosting a pack
  // on your own network is a legitimate, expected use of this feature.
  if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host === '::1') return false;
  if (host.startsWith('169.254.') || host === '169.254.169.254') return false;
  return true;
}

export function loadPackConfig() {
  ensureDirs();
  if (!existsSync(CONFIG_PATH)) return null;
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

function savePackConfig(config) {
  ensureDirs();
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function clearCommunityProviders() {
  ensureDirs();
  for (const f of readdirSync(COMMUNITY_DIR)) {
    if (f.endsWith('.js')) rmSync(path.join(COMMUNITY_DIR, f));
  }
}

/**
 * Fetches a manifest + its provider files, writes them to the local cache,
 * and returns { name, installed: [ids], errors: [{id, error}] }.
 * Does not import them — the relay's loadProviders() picks them up on next
 * (re)load, keeping "fetch" and "execute" as separate, auditable steps.
 */
export async function installPack(manifestUrl) {
  if (!isSafeManifestUrl(manifestUrl)) {
    throw new Error('Refusing to install from that URL (must be a public http/https host)');
  }
  const url = manifestUrl.endsWith('.json') ? manifestUrl : `${manifestUrl.replace(/\/$/, '')}/manifest.json`;
  const manifest = await fetchJson(url);
  if (!manifest || !Array.isArray(manifest.providers)) {
    throw new Error('Manifest must have a "providers" array');
  }

  ensureDirs();
  clearCommunityProviders();

  const installed = [];
  const errors = [];
  for (const entry of manifest.providers) {
    try {
      if (!entry || !entry.id || !entry.file) throw new Error('manifest entry missing id/file');
      const fileUrl = new URL(entry.file, url).toString();
      const code = await fetchText(fileUrl);
      const destPath = path.join(COMMUNITY_DIR, `${entry.id}.js`);
      writeFileSync(destPath, code);

      // Validate it actually imports and exposes the right shape before
      // counting it as installed — catches syntax errors / bad exports early.
      const mod = await import(`${pathToFileURL(destPath).href}?t=${Date.now()}`);
      if (!mod.default || !mod.default.id || typeof mod.default.resolve !== 'function') {
        rmSync(destPath);
        throw new Error('provider file did not export {id, resolve}');
      }
      installed.push(entry.id);
    } catch (e) {
      errors.push({ id: entry?.id || '(unknown)', error: e.message || String(e) });
    }
  }

  savePackConfig({
    url: manifestUrl,
    name: manifest.name || 'Unnamed pack',
    installedAt: new Date().toISOString(),
    providerIds: installed
  });

  return { name: manifest.name || 'Unnamed pack', installed, errors };
}
