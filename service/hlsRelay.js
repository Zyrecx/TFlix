/**
 * TFlix local HLS relay + provider-pack pairing server.
 *
 * Runs as a TizenBrew `serviceFile` — a plain Node.js process outside the
 * webview's browser sandbox. Browser `fetch`/XHR always attaches an `Origin`
 * header on cross-origin requests, and several direct-stream provider APIs
 * either omit CORS headers entirely or actively reject requests that carry
 * any `Origin` header. Node's http/https client sends neither, so requests
 * made here succeed where the webview's would not.
 *
 * Providers are plugins, loaded from ./providers/*.js and
 * ./providers/community/*.js (installed via the pairing flow — see
 * lib/providerPack.js). This repo ships with none built in; all direct
 * providers come from a provider pack the user installs (see
 * docs/PROVIDER_PACKS.md). Each provider exports
 * { id, name, description, resolve(ctx) }.
 *
 * This server binds to all interfaces (not just loopback) so the pairing
 * page can be reached from a phone on the same wifi. Config-mutating actions
 * (installing a provider pack) are gated behind a single-use pairing code
 * shown only on the TV screen — see lib/pairing.js for that boundary.
 */

import http from 'http';
import os from 'os';
import { URL } from 'url';
import { readdirSync, existsSync, mkdirSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';
import { fetchRaw, fetchJson, fetchText } from './lib/http.js';
import { startPairing, isCodeValid, consumeCode, getPairingStatus, getPairingKind, setPairingResult } from './lib/pairing.js';
import { getWifiSsid } from './lib/wifi.js';
import { installPack, loadPackConfig } from './lib/providerPack.js';

// Passed as the second argument to every provider's resolve(ctx, http) —
// providers (especially community-pack ones, which live at a different
// directory depth than built-ins) must not rely on relative imports into
// this app's internals. This is the one stable, documented surface a pack
// author can depend on.
const providerHttp = { fetchRaw, fetchJson, fetchText };

const PORT = 47993;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Installed provider packs must live outside the package's own install
// directory — TizenBrew appears to serve npm modules from a location that
// isn't writable, so writing here (as an earlier version did) threw
// synchronously during startup and silently killed the whole relay before
// server.listen() ever ran. os.tmpdir() is always writable. Must match the
// same path in lib/providerPack.js.
const DATA_DIR = path.join(os.tmpdir(), 'tflix-relay');

function lanAddress() {
  const ifaces = os.networkInterfaces();
  const candidates = [];
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal && !iface.address.startsWith('169.254.')) {
        candidates.push(iface.address);
      }
    }
  }
  // Prefer actual private-LAN ranges over anything else (e.g. Docker/VPN adapters).
  const private192 = candidates.find((a) => a.startsWith('192.168.'));
  const private10 = candidates.find((a) => a.startsWith('10.'));
  const private172 = candidates.find((a) => /^172\.(1[6-9]|2\d|3[01])\./.test(a));
  return private192 || private10 || private172 || candidates[0] || '127.0.0.1';
}

async function loadProvidersFrom(dir) {
  const found = [];
  if (!existsSync(dir)) return found;
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    try {
      const mod = await import(`${pathToFileURL(path.join(dir, file)).href}?t=${Date.now()}`);
      const provider = mod.default;
      if (!provider || !provider.id || typeof provider.resolve !== 'function') {
        console.warn(`[hlsRelay] Skipping ${file}: missing id/resolve export`);
        continue;
      }
      found.push(provider);
    } catch (e) {
      console.error(`[hlsRelay] Failed to load provider ${file}:`, e.message);
    }
  }
  return found;
}

async function loadAllProviders() {
  const builtinDir = path.join(__dirname, 'providers');
  const communityDir = path.join(DATA_DIR, 'providers', 'community');
  try {
    mkdirSync(communityDir, { recursive: true });
  } catch (e) {
    // Degrade to "no community providers" rather than take the whole relay
    // down — this only blocks pack installs, not builtin providers/playback.
    console.error('[hlsRelay] Could not create community providers dir:', e.message);
  }

  const [builtin, community] = await Promise.all([
    loadProvidersFrom(builtinDir),
    loadProvidersFrom(communityDir)
  ]);

  const registry = new Map();
  // Community providers are installed after builtins and win on id collision
  // (e.g. re-installing the "default" pack updates the same ids) — build the
  // display list from the deduped registry, not by concatenating both scans.
  for (const provider of [...builtin, ...community]) {
    registry.set(provider.id, provider);
    for (const alias of provider.aliases || []) registry.set(alias, provider);
  }
  const list = [...new Set(registry.values())].map((p) => ({ id: p.id, name: p.name, description: p.description || '' }));
  return { registry, list };
}

function proxied(absoluteUrl) {
  return `http://127.0.0.1:${PORT}/hls?url=${encodeURIComponent(absoluteUrl)}`;
}

function rewritePlaylist(text, baseUrl) {
  return text.split('\n').map((line) => {
    if (line.startsWith('#')) {
      return line.replace(/URI="([^"]+)"/g, (_m, uri) => `URI="${proxied(new URL(uri, baseUrl).toString())}"`);
    }
    const trimmed = line.trim();
    if (!trimmed) return line;
    return proxied(new URL(trimmed, baseUrl).toString());
  }).join('\n');
}

function pairingPageShell(title, body) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
body{font-family:-apple-system,sans-serif;background:#0a0a0f;color:#fff;padding:24px;max-width:480px;margin:0 auto}
h1{font-size:20px}p{color:#a1a1aa;font-size:14px;line-height:1.5}
input{width:100%;padding:12px;border-radius:8px;border:1px solid #333;background:#181824;color:#fff;font-size:15px;box-sizing:border-box;margin-top:12px}
button{width:100%;padding:12px;border-radius:8px;border:0;background:#e50914;color:#fff;font-size:15px;font-weight:700;margin-top:14px}
#status{margin-top:16px;font-size:14px;min-height:20px}
</style></head><body>${body}</body></html>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function wifiHint(ssid) {
  return ssid
    ? `<p style="color:#4ade80;font-size:13px;">📶 TV is on Wi-Fi "<strong>${escapeHtml(ssid)}</strong>" — make sure your phone is on the same network.</p>`
    : '';
}

function pairingPageHtml(code, valid, kind, ssid) {
  if (!valid) {
    return pairingPageShell('TFlix Pairing', `<h1>TFlix Pairing</h1><p>This pairing code has expired or was already used. Go back to TFlix on your TV and generate a new QR code.</p>`);
  }

  if (kind === 'tmdb_key') {
    return pairingPageShell('TFlix — Add TMDB Key', `
<h1>Add Your TMDB API Key</h1>
<p>Paste or type your personal TMDB API key. It's sent directly to your TV over your local network — nothing else sees it.</p>
${wifiHint(ssid)}
<input id="key" type="text" placeholder="Your TMDB API key" autocapitalize="off" autocorrect="off" spellcheck="false" autofocus>
<button id="submit">Save to TV</button>
<div id="status"></div>
<script>
document.getElementById('submit').onclick = async () => {
  const apiKey = document.getElementById('key').value.trim();
  const status = document.getElementById('status');
  if (!apiKey) { status.textContent = 'Enter your API key first.'; return; }
  status.textContent = 'Sending...';
  try {
    const res = await fetch('/pair/submit', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ code: '${code}', apiKey }) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to send key');
    status.textContent = 'Sent! Check your TV — you can close this page.';
  } catch (e) {
    status.textContent = 'Error: ' + e.message;
  }
};
</script>
`);
  }

  return pairingPageShell('TFlix Provider Pack', `
<h1>Add a TFlix Provider Pack</h1>
<p>Paste the manifest URL for the provider pack you want to install. This will download and run code from that source on your TV.</p>
${wifiHint(ssid)}
<input id="url" type="url" placeholder="https://example.com/pack/manifest.json" autofocus>
<button id="submit">Install</button>
<div id="status"></div>
<script>
document.getElementById('submit').onclick = async () => {
  const url = document.getElementById('url').value.trim();
  const status = document.getElementById('status');
  if (!url) { status.textContent = 'Enter a URL first.'; return; }
  status.textContent = 'Installing...';
  try {
    const res = await fetch('/pair/submit', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ code: '${code}', url }) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Install failed');
    status.textContent = 'Installed: ' + data.installed.join(', ') + (data.errors.length ? (' (failed: ' + data.errors.map(e=>e.id).join(', ') + ')') : '') + '. You can close this page.';
  } catch (e) {
    status.textContent = 'Error: ' + e.message;
  }
};
</script>
`);
}

async function main() {
  let { registry, list } = await loadAllProviders();
  console.log(`[hlsRelay] Loaded ${list.length} provider(s): ${list.map((p) => p.id).join(', ')}`);

  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // A synchronous throw anywhere below (e.g. a filesystem error reading
    // pack config) would otherwise become an unhandled rejection and take
    // the whole relay process down for every subsequent request too.
    try {

    let reqUrl;
    try {
      reqUrl = new URL(req.url, `http://127.0.0.1:${PORT}`);
    } catch {
      res.statusCode = 400;
      res.end('bad request');
      return;
    }

    if (reqUrl.pathname === '/health') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (reqUrl.pathname === '/providers') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ providers: list, pack: loadPackConfig() }));
      return;
    }

    if (reqUrl.pathname === '/resolve') {
      const providerId = reqUrl.searchParams.get('provider');
      const provider = registry.get(providerId);
      res.setHeader('Content-Type', 'application/json');
      if (!provider) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: `No provider registered for "${providerId}"` }));
        return;
      }
      try {
        const result = await provider.resolve({
          tmdbId: reqUrl.searchParams.get('tmdbId'),
          imdbId: reqUrl.searchParams.get('imdbId') || '',
          title: reqUrl.searchParams.get('title') || '',
          year: reqUrl.searchParams.get('year') || '',
          isTv: reqUrl.searchParams.get('isTv') === '1',
          season: reqUrl.searchParams.get('season') || '1',
          episode: reqUrl.searchParams.get('episode') || '1'
        }, providerHttp);
        res.end(JSON.stringify({
          streamUrl: proxied(result.streamUrl),
          subtitles: (result.subtitles || []).map((s) => ({ ...s, src: proxied(s.src) })),
          providerName: result.providerName
        }));
      } catch (e) {
        res.statusCode = 502;
        res.end(JSON.stringify({ error: e.message || String(e) }));
      }
      return;
    }

    if (reqUrl.pathname === '/hls') {
      const target = reqUrl.searchParams.get('url');
      if (!target) {
        res.statusCode = 400;
        res.end('missing url');
        return;
      }
      try {
        const upstream = await fetchRaw(target);
        if (upstream.statusCode >= 400) {
          res.statusCode = upstream.statusCode;
          res.end(`upstream ${upstream.statusCode}`);
          return;
        }
        const ct = (upstream.headers['content-type'] || '').toLowerCase();
        const looksLikePlaylist = ct.includes('mpegurl') || target.split('?')[0].toLowerCase().endsWith('.m3u8');
        if (looksLikePlaylist) {
          res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
          res.end(rewritePlaylist(upstream.body.toString('utf-8'), upstream.finalUrl || target));
        } else {
          res.setHeader('Content-Type', ct || 'application/octet-stream');
          res.end(upstream.body);
        }
      } catch (e) {
        res.statusCode = 502;
        res.end(`relay error: ${e.message || e}`);
      }
      return;
    }

    // --- Pairing: phone <-> TV provider pack handoff ---

    if (reqUrl.pathname === '/pair/start' && req.method === 'GET') {
      const kind = reqUrl.searchParams.get('kind') === 'tmdb_key' ? 'tmdb_key' : 'provider_pack';
      const { code, expiresAt } = startPairing(kind);
      const ssid = await getWifiSsid();
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ code, expiresAt, pairUrl: `http://${lanAddress()}:${PORT}/pair?code=${code}`, ssid }));
      return;
    }

    if (reqUrl.pathname === '/pair/status') {
      const code = reqUrl.searchParams.get('code') || '';
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(getPairingStatus(code)));
      return;
    }

    if (reqUrl.pathname === '/pair' && req.method === 'GET') {
      const code = reqUrl.searchParams.get('code') || '';
      const valid = isCodeValid(code);
      const ssid = valid ? await getWifiSsid() : null;
      res.setHeader('Content-Type', 'text/html');
      res.end(pairingPageHtml(code, valid, getPairingKind(code), ssid));
      return;
    }

    if (reqUrl.pathname === '/pair/submit' && req.method === 'POST') {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', async () => {
        res.setHeader('Content-Type', 'application/json');
        let body = {};
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}');
          if (!isCodeValid(body.code)) {
            res.statusCode = 403;
            res.end(JSON.stringify({ error: 'Invalid or expired pairing code' }));
            return;
          }
          const kind = getPairingKind(body.code);
          consumeCode(body.code);

          if (kind === 'tmdb_key') {
            const apiKey = String(body.apiKey || '').trim();
            if (!apiKey) throw new Error('No API key provided');
            const result = { apiKey };
            console.log('[hlsRelay] TMDB key received via phone pairing');
            setPairingResult(body.code, result);
            res.end(JSON.stringify({ ok: true }));
            return;
          }

          const result = await installPack(body.url);
          ({ registry, list } = await loadAllProviders());
          console.log(`[hlsRelay] Provider pack installed: ${result.name} -> ${result.installed.join(', ')}`);
          setPairingResult(body.code, result);
          res.end(JSON.stringify(result));
        } catch (e) {
          if (body.code) setPairingResult(body.code, { error: e.message || String(e) });
          res.statusCode = 400;
          res.end(JSON.stringify({ error: e.message || String(e) }));
        }
      });
      return;
    }

    // Direct install: for the webview's own "Browse Packs" UI, installing
    // from the default catalog — no phone/QR round trip needed since the
    // request already originates from this device. Gated to loopback only;
    // a request arriving via the LAN interface (some other device on the
    // wifi) is rejected and must go through the pairing-code flow instead.
    if (reqUrl.pathname === '/packs/install' && req.method === 'POST') {
      const remote = (req.socket.remoteAddress || '').replace('::ffff:', '');
      if (!['127.0.0.1', '::1', 'localhost'].includes(remote)) {
        res.statusCode = 403;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'This endpoint is only available to the app running on this device.' }));
        return;
      }
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', async () => {
        res.setHeader('Content-Type', 'application/json');
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}');
          const result = await installPack(body.url);
          ({ registry, list } = await loadAllProviders());
          console.log(`[hlsRelay] Provider pack installed directly: ${result.name} -> ${result.installed.join(', ')}`);
          res.end(JSON.stringify(result));
        } catch (e) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: e.message || String(e) }));
        }
      });
      return;
    }

    res.statusCode = 404;
    res.end('not found');

    } catch (e) {
      console.error('[hlsRelay] Unhandled request error:', e && e.stack ? e.stack : e);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Internal relay error' }));
      }
    }
  });

  server.on('error', (e) => {
    // Most likely EADDRINUSE from a previous instance that didn't shut down cleanly.
    console.error('[hlsRelay] Failed to start:', e.message);
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[hlsRelay] Listening on http://0.0.0.0:${PORT} (LAN: http://${lanAddress()}:${PORT})`);
  });
}

main().catch((e) => {
  console.error('[hlsRelay] Fatal startup error:', e && e.stack ? e.stack : e);
});
