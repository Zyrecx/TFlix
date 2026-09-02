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
 * IMPORTANT — this file must stay a single, self-contained CommonJS script.
 * TizenBrew's serviceLauncher.js does NOT run this as a normal Node module:
 * it fetches only this one file's raw text from jsDelivr and executes it
 * with `vm.runInContext(script, sandbox)` (see
 * TizenBrew/service-nextgen/service/utils/serviceLauncher.js). That means:
 *   - No `import`/`export` — `vm.runInContext` compiles a classic script,
 *     not a module; top-level `import` is a SyntaxError there.
 *   - No dynamic `import()` either — it throws "A dynamic import callback
 *     was not specified" unless the host passes `importModuleDynamically`,
 *     which TizenBrew's launcher does not. Provider-pack files are loaded
 *     with `require()` + manual `require.cache` invalidation instead (see
 *     loadCommunityProviders below).
 *   - No `require('./lib/whatever.js')` to sibling files — the `require`
 *     the sandbox exposes is TizenBrew's own, closure-bound to *its*
 *     install directory, not this file's (which doesn't exist on disk in
 *     the first place — only this one file's text was ever fetched). Any
 *     helper code has to live in this file, not a separate module.
 *   - No `__dirname`/`__filename` — those are only injected by Node's
 *     normal CommonJS module wrapper, which `vm.runInContext` bypasses.
 *   - Confirmed live on-device: the sandbox's `process.version` is v12.4.0
 *     (Tizen's bundled Node), so ES2019-ish syntax (async/await, object
 *     spread, optional catch binding, template literals) is fine, but
 *     optional chaining (`?.`), nullish coalescing (`??`), `crypto.randomInt`
 *     (needs 14.10+) and `fs.rmSync` (needs 14.14+) are NOT available and
 *     must be avoided/polyfilled.
 *
 * Providers are plugins, loaded from a community pack a user installs via
 * the pairing flow (see loadCommunityProviders/installPack below). This
 * repo ships with none built in; all direct providers come from a provider
 * pack the user installs (see docs/PROVIDER_PACKS.md). Each provider
 * exports (via `module.exports`, not `export default` — see the note on
 * the sandbox above) { id, name, description, resolve(ctx, http) }.
 *
 * This server binds to all interfaces (not just loopback) so the pairing
 * page can be reached from a phone on the same wifi. Config-mutating actions
 * (installing a provider pack) are gated behind a single-use pairing code
 * shown only on the TV screen — see the pairing section below for that
 * boundary.
 */

'use strict';

var http = require('http');
var https = require('https');
var os = require('os');
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var URL = require('url').URL;

var PORT = 47993;
// Installed provider packs must live outside the package's own install
// directory — TizenBrew appears to serve npm modules from a location that
// isn't writable, so writing here (as an earlier version did) threw
// synchronously during startup and silently killed the whole relay before
// server.listen() ever ran. os.tmpdir() is always writable.
var DATA_DIR = path.join(os.tmpdir(), 'tflix-relay');
var COMMUNITY_DIR = path.join(DATA_DIR, 'providers', 'community');
var PACK_CONFIG_PATH = path.join(DATA_DIR, 'data', 'providerPack.json');

// ---------------------------------------------------------------------------
// HTTP client for provider plugins — plain Node http/https, no browser
// `Origin` header is ever attached, which is the whole reason this exists on
// the serviceFile side rather than in the webview.
// ---------------------------------------------------------------------------

var DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function fetchRaw(targetUrl, headers, redirects) {
  if (headers === undefined) headers = {};
  if (redirects === undefined) redirects = 5;
  return new Promise(function (resolve, reject) {
    var u;
    try {
      u = new URL(targetUrl);
    } catch (e) {
      reject(new Error('Invalid URL: ' + targetUrl));
      return;
    }
    var lib = u.protocol === 'http:' ? http : https;
    var reqHeaders = Object.assign({ 'User-Agent': DESKTOP_UA }, headers);
    var req = lib.get(u, { headers: reqHeaders }, function (res) {
      if ([301, 302, 303, 307, 308].indexOf(res.statusCode) !== -1 && res.headers.location && redirects > 0) {
        res.resume();
        var nextUrl = new URL(res.headers.location, targetUrl).toString();
        fetchRaw(nextUrl, headers, redirects - 1).then(resolve, reject);
        return;
      }
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        resolve({ statusCode: res.statusCode, headers: res.headers, body: Buffer.concat(chunks), finalUrl: targetUrl });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(15000, function () { req.destroy(new Error('Upstream request timed out')); });
  });
}

async function fetchJson(url, headers) {
  var r = await fetchRaw(url, headers);
  if (r.statusCode >= 400 || r.body.length === 0) {
    throw new Error('Upstream ' + url + ' returned HTTP ' + r.statusCode + ' with ' + r.body.length + ' bytes');
  }
  try {
    return JSON.parse(r.body.toString('utf-8'));
  } catch (e) {
    throw new Error('Upstream ' + url + ' returned non-JSON response (HTTP ' + r.statusCode + ')');
  }
}

async function fetchText(url, headers) {
  var r = await fetchRaw(url, headers);
  if (r.statusCode >= 400) {
    throw new Error('Upstream ' + url + ' returned HTTP ' + r.statusCode);
  }
  return r.body.toString('utf-8');
}

// Passed as the second argument to every provider's resolve(ctx, http) — the
// one stable, documented surface a pack author can depend on.
var providerHttp = { fetchRaw: fetchRaw, fetchJson: fetchJson, fetchText: fetchText };

// ---------------------------------------------------------------------------
// Pairing: short-lived codes for the phone -> TV handoff. A code authorizes
// exactly one config-mutating action, then is consumed. This is the actual
// security boundary between "device on the same wifi" and "can make the
// relay install and execute a JS file" (or, for the tmdb_key kind, read back
// an API key the TV then trusts).
// `kind` distinguishes what the phone page collects: 'provider_pack' (a
// manifest URL, default) or 'tmdb_key' (a raw TMDB API key string).
// ---------------------------------------------------------------------------

var CODE_TTL_MS = 5 * 60 * 1000;
var pairingCodes = new Map(); // code -> { expiresAt, used, kind, result }

function generatePairingCode() {
  // crypto.randomInt needs Node 14.10+; this sandbox runs v12.4.0. randomBytes
  // has been available since early Node and gives an equivalent CSPRNG source.
  var n = crypto.randomBytes(4).readUInt32BE(0) % 1000000;
  return String(n).padStart(6, '0');
}

function startPairing(kind) {
  if (kind === undefined) kind = 'provider_pack';
  // Clear any previous outstanding codes — only one pairing session at a time.
  pairingCodes.clear();
  var code = generatePairingCode();
  pairingCodes.set(code, { expiresAt: Date.now() + CODE_TTL_MS, used: false, kind: kind, result: null });
  return { code: code, expiresAt: Date.now() + CODE_TTL_MS };
}

function isCodeValid(code) {
  var entry = pairingCodes.get(code);
  return Boolean(entry && !entry.used && entry.expiresAt > Date.now());
}

function getPairingKind(code) {
  var entry = pairingCodes.get(code);
  return entry ? entry.kind : null;
}

function consumeCode(code) {
  var entry = pairingCodes.get(code);
  if (!entry || entry.used || entry.expiresAt <= Date.now()) return false;
  entry.used = true;
  return true;
}

function setPairingResult(code, result) {
  var entry = pairingCodes.get(code);
  if (entry) entry.result = result;
}

function getPairingStatus(code) {
  var entry = pairingCodes.get(code);
  if (!entry) return { state: 'unknown' };
  if (entry.expiresAt <= Date.now() && !entry.used) return { state: 'expired' };
  if (!entry.used) return { state: 'pending' };
  return { state: 'done', result: entry.result };
}

// ---------------------------------------------------------------------------
// Best-effort Wi-Fi SSID lookup, shown next to the pairing QR code so the
// user can confirm their phone is on the same network — a pure UX nicety,
// not a dependency. Deliberately does NOT use child_process: on at least one
// real TV (Tizen, Node v12.4.0 sandbox) spawning a subprocess here brought
// down the entire TizenBrew background process — not just this request —
// which stayed dead until TizenBrew itself was force-restarted. That's a
// process-level crash outside JS's ability to catch (try/catch around
// execFile did not help), so the fix is to never spawn a child process from
// inside this vm sandbox at all, not just handle the failure more gracefully.
// getWifiSsid() always resolves null; wifiHint() already renders nothing for
// a null ssid, so pairing still works, just without the "you're on wifi X"
// hint.
// ---------------------------------------------------------------------------

async function getWifiSsid() {
  return null;
}

// ---------------------------------------------------------------------------
// Provider packs: externally-hosted bundles of provider plugins (a manifest
// + one .js file per provider), fetched over plain HTTP. Trust model:
// installing a pack means this process will require() and execute arbitrary
// JS from that URL — the pairing flow above is what gates this.
// ---------------------------------------------------------------------------

function ensurePackDirs() {
  fs.mkdirSync(COMMUNITY_DIR, { recursive: true });
  fs.mkdirSync(path.dirname(PACK_CONFIG_PATH), { recursive: true });
}

function isSafeManifestUrl(url) {
  var u;
  try {
    u = new URL(url);
  } catch (e) {
    return false;
  }
  if (['http:', 'https:'].indexOf(u.protocol) === -1) return false;
  var host = u.hostname.toLowerCase();
  // Block loopback (would target the relay's own /resolve /pair etc, a
  // self-request loop) and link-local/metadata addresses. Ordinary private
  // LAN hosts (192.168.x, 10.x) are allowed on purpose — self-hosting a pack
  // on your own network is a legitimate, expected use of this feature.
  if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host === '::1') return false;
  if (host.indexOf('169.254.') === 0 || host === '169.254.169.254') return false;
  return true;
}

function loadPackConfig() {
  ensurePackDirs();
  if (!fs.existsSync(PACK_CONFIG_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(PACK_CONFIG_PATH, 'utf-8'));
  } catch (e) {
    return null;
  }
}

function savePackConfig(config) {
  ensurePackDirs();
  fs.writeFileSync(PACK_CONFIG_PATH, JSON.stringify(config, null, 2));
}

function clearCommunityProviderFiles() {
  ensurePackDirs();
  var files = fs.readdirSync(COMMUNITY_DIR);
  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    // fs.rmSync needs Node 14.14+; this sandbox runs v12.4.0 — these are
    // always plain files (never directories), so unlinkSync is equivalent.
    if (f.slice(-3) === '.js') fs.unlinkSync(path.join(COMMUNITY_DIR, f));
  }
}

// Loads a just-written community provider file with require() (dynamic
// import() throws unconditionally in this vm sandbox — see the file header)
// and forces a fresh read via require.cache invalidation, since the same
// path can be reused across installs.
function requireFresh(absPath) {
  var resolved = require.resolve(absPath);
  delete require.cache[resolved];
  return require(resolved);
}

/**
 * Fetches a manifest + its provider files, writes them to the local cache,
 * and returns { name, installed: [ids], errors: [{id, error}] }.
 */
async function installPack(manifestUrl) {
  if (!isSafeManifestUrl(manifestUrl)) {
    throw new Error('Refusing to install from that URL (must be a public http/https host)');
  }
  var url = manifestUrl.slice(-5) === '.json' ? manifestUrl : manifestUrl.replace(/\/$/, '') + '/manifest.json';
  var manifest = await fetchJson(url);
  if (!manifest || !Array.isArray(manifest.providers)) {
    throw new Error('Manifest must have a "providers" array');
  }

  ensurePackDirs();
  clearCommunityProviderFiles();

  var installed = [];
  var errors = [];
  for (var i = 0; i < manifest.providers.length; i++) {
    var entry = manifest.providers[i];
    try {
      if (!entry || !entry.id || !entry.file) throw new Error('manifest entry missing id/file');
      var fileUrl = new URL(entry.file, url).toString();
      var code = await fetchText(fileUrl);
      var destPath = path.join(COMMUNITY_DIR, entry.id + '.js');
      fs.writeFileSync(destPath, code);

      // Validate it actually loads and exposes the right shape before
      // counting it as installed — catches syntax errors / bad exports early.
      var mod = requireFresh(destPath);
      var provider = mod && mod.default ? mod.default : mod; // tolerate `export default` transpiled output too
      if (!provider || !provider.id || typeof provider.resolve !== 'function') {
        fs.unlinkSync(destPath);
        throw new Error('provider file did not export {id, resolve} via module.exports');
      }
      installed.push(entry.id);
    } catch (e) {
      errors.push({ id: (entry && entry.id) || '(unknown)', error: e.message || String(e) });
    }
  }

  savePackConfig({
    url: manifestUrl,
    name: manifest.name || 'Unnamed pack',
    installedAt: new Date().toISOString(),
    providerIds: installed
  });

  return { name: manifest.name || 'Unnamed pack', installed: installed, errors: errors };
}

function loadCommunityProviders() {
  var found = [];
  if (!fs.existsSync(COMMUNITY_DIR)) return found;
  var files = fs.readdirSync(COMMUNITY_DIR).filter(function (f) { return f.slice(-3) === '.js'; });
  for (var i = 0; i < files.length; i++) {
    var file = files[i];
    try {
      var mod = requireFresh(path.join(COMMUNITY_DIR, file));
      var provider = mod && mod.default ? mod.default : mod;
      if (!provider || !provider.id || typeof provider.resolve !== 'function') {
        console.warn('[hlsRelay] Skipping ' + file + ': missing id/resolve export');
        continue;
      }
      found.push(provider);
    } catch (e) {
      console.error('[hlsRelay] Failed to load provider ' + file + ':', e.message);
    }
  }
  return found;
}

function loadAllProviders() {
  try {
    fs.mkdirSync(COMMUNITY_DIR, { recursive: true });
  } catch (e) {
    // Degrade to "no community providers" rather than take the whole relay
    // down — this only blocks pack installs, not builtin providers/playback.
    console.error('[hlsRelay] Could not create community providers dir:', e.message);
  }

  var community = loadCommunityProviders();
  var registry = new Map();
  for (var i = 0; i < community.length; i++) {
    var provider = community[i];
    registry.set(provider.id, provider);
    var aliases = provider.aliases || [];
    for (var j = 0; j < aliases.length; j++) registry.set(aliases[j], provider);
  }
  var list = Array.from(new Set(registry.values())).map(function (p) {
    return { id: p.id, name: p.name, description: p.description || '' };
  });
  return { registry: registry, list: list };
}

// ---------------------------------------------------------------------------
// LAN address + HLS proxying
// ---------------------------------------------------------------------------

function lanAddress() {
  var ifaces = os.networkInterfaces();
  var candidates = [];
  var names = Object.keys(ifaces);
  for (var i = 0; i < names.length; i++) {
    var list = ifaces[names[i]];
    for (var j = 0; j < list.length; j++) {
      var iface = list[j];
      if (iface.family === 'IPv4' && !iface.internal && iface.address.indexOf('169.254.') !== 0) {
        candidates.push(iface.address);
      }
    }
  }
  // Prefer actual private-LAN ranges over anything else (e.g. Docker/VPN adapters).
  var private192 = candidates.filter(function (a) { return a.indexOf('192.168.') === 0; })[0];
  var private10 = candidates.filter(function (a) { return a.indexOf('10.') === 0; })[0];
  var private172 = candidates.filter(function (a) { return /^172\.(1[6-9]|2\d|3[01])\./.test(a); })[0];
  return private192 || private10 || private172 || candidates[0] || '127.0.0.1';
}

function proxied(absoluteUrl) {
  return 'http://127.0.0.1:' + PORT + '/hls?url=' + encodeURIComponent(absoluteUrl);
}

function rewritePlaylist(text, baseUrl) {
  return text.split('\n').map(function (line) {
    if (line.indexOf('#') === 0) {
      return line.replace(/URI="([^"]+)"/g, function (_m, uri) {
        return 'URI="' + proxied(new URL(uri, baseUrl).toString()) + '"';
      });
    }
    var trimmed = line.trim();
    if (!trimmed) return line;
    return proxied(new URL(trimmed, baseUrl).toString());
  }).join('\n');
}

// ---------------------------------------------------------------------------
// Pairing web pages (served to the phone that scans the QR code)
// ---------------------------------------------------------------------------

function pairingPageShell(title, body) {
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">\n' +
    '<title>' + title + '</title>\n' +
    '<style>\n' +
    'body{font-family:-apple-system,sans-serif;background:#0a0a0f;color:#fff;padding:24px;max-width:480px;margin:0 auto}\n' +
    'h1{font-size:20px}p{color:#a1a1aa;font-size:14px;line-height:1.5}\n' +
    'input{width:100%;padding:12px;border-radius:8px;border:1px solid #333;background:#181824;color:#fff;font-size:15px;box-sizing:border-box;margin-top:12px}\n' +
    'button{width:100%;padding:12px;border-radius:8px;border:0;background:#e50914;color:#fff;font-size:15px;font-weight:700;margin-top:14px}\n' +
    '#status{margin-top:16px;font-size:14px;min-height:20px}\n' +
    '</style></head><body>' + body + '</body></html>';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function wifiHint(ssid) {
  return ssid
    ? '<p style="color:#4ade80;font-size:13px;">📶 TV is on Wi-Fi "<strong>' + escapeHtml(ssid) + '</strong>" — make sure your phone is on the same network.</p>'
    : '';
}

function pairingPageHtml(code, valid, kind, ssid) {
  if (!valid) {
    return pairingPageShell('TFlix Pairing', '<h1>TFlix Pairing</h1><p>This pairing code has expired or was already used. Go back to TFlix on your TV and generate a new QR code.</p>');
  }

  if (kind === 'tmdb_key') {
    return pairingPageShell('TFlix — Add TMDB Key',
      '<h1>Add Your TMDB API Key</h1>\n' +
      '<p>Paste or type your personal TMDB API key. It\'s sent directly to your TV over your local network — nothing else sees it.</p>\n' +
      wifiHint(ssid) + '\n' +
      '<input id="key" type="text" placeholder="Your TMDB API key" autocapitalize="off" autocorrect="off" spellcheck="false" autofocus>\n' +
      '<button id="submit">Save to TV</button>\n' +
      '<div id="status"></div>\n' +
      '<script>\n' +
      'document.getElementById(\'submit\').onclick = async () => {\n' +
      '  const apiKey = document.getElementById(\'key\').value.trim();\n' +
      '  const status = document.getElementById(\'status\');\n' +
      '  if (!apiKey) { status.textContent = \'Enter your API key first.\'; return; }\n' +
      '  status.textContent = \'Sending...\';\n' +
      '  try {\n' +
      '    const res = await fetch(\'/pair/submit\', { method: \'POST\', headers: {\'Content-Type\':\'application/json\'}, body: JSON.stringify({ code: \'' + code + '\', apiKey }) });\n' +
      '    const data = await res.json();\n' +
      '    if (!res.ok) throw new Error(data.error || \'Failed to send key\');\n' +
      '    status.textContent = \'Sent! Check your TV — you can close this page.\';\n' +
      '  } catch (e) {\n' +
      '    status.textContent = \'Error: \' + e.message;\n' +
      '  }\n' +
      '};\n' +
      '</script>\n'
    );
  }

  return pairingPageShell('TFlix Provider Pack',
    '<h1>Add a TFlix Provider Pack</h1>\n' +
    '<p>Paste the manifest URL for the provider pack you want to install. This will download and run code from that source on your TV.</p>\n' +
    wifiHint(ssid) + '\n' +
    '<input id="url" type="url" placeholder="https://example.com/pack/manifest.json" autofocus>\n' +
    '<button id="submit">Install</button>\n' +
    '<div id="status"></div>\n' +
    '<script>\n' +
    'document.getElementById(\'submit\').onclick = async () => {\n' +
    '  const url = document.getElementById(\'url\').value.trim();\n' +
    '  const status = document.getElementById(\'status\');\n' +
    '  if (!url) { status.textContent = \'Enter a URL first.\'; return; }\n' +
    '  status.textContent = \'Installing...\';\n' +
    '  try {\n' +
    '    const res = await fetch(\'/pair/submit\', { method: \'POST\', headers: {\'Content-Type\':\'application/json\'}, body: JSON.stringify({ code: \'' + code + '\', url }) });\n' +
    '    const data = await res.json();\n' +
    '    if (!res.ok) throw new Error(data.error || \'Install failed\');\n' +
    '    status.textContent = \'Installed: \' + data.installed.join(\', \') + (data.errors.length ? (\' (failed: \' + data.errors.map(e=>e.id).join(\', \') + \')\') : \'\') + \'. You can close this page.\';\n' +
    '  } catch (e) {\n' +
    '    status.textContent = \'Error: \' + e.message;\n' +
    '  }\n' +
    '};\n' +
    '</script>\n'
  );
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

async function main() {
  var loaded = loadAllProviders();
  var registry = loaded.registry;
  var list = loaded.list;
  console.log('[hlsRelay] Loaded ' + list.length + ' provider(s): ' + list.map(function (p) { return p.id; }).join(', '));

  var server = http.createServer(function (req, res) {
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
    (async function () {
      try {
        var reqUrl;
        try {
          reqUrl = new URL(req.url, 'http://127.0.0.1:' + PORT);
        } catch (e) {
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
          var providerId = reqUrl.searchParams.get('provider');
          var provider = registry.get(providerId);
          res.setHeader('Content-Type', 'application/json');
          if (!provider) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'No provider registered for "' + providerId + '"' }));
            return;
          }
          try {
            var result = await provider.resolve({
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
              subtitles: (result.subtitles || []).map(function (s) {
                return Object.assign({}, s, { src: proxied(s.src) });
              }),
              providerName: result.providerName
            }));
          } catch (e) {
            res.statusCode = 502;
            res.end(JSON.stringify({ error: e.message || String(e) }));
          }
          return;
        }

        if (reqUrl.pathname === '/hls') {
          var target = reqUrl.searchParams.get('url');
          if (!target) {
            res.statusCode = 400;
            res.end('missing url');
            return;
          }
          try {
            var upstream = await fetchRaw(target);
            if (upstream.statusCode >= 400) {
              res.statusCode = upstream.statusCode;
              res.end('upstream ' + upstream.statusCode);
              return;
            }
            var ct = (upstream.headers['content-type'] || '').toLowerCase();
            var looksLikePlaylist = ct.indexOf('mpegurl') !== -1 || target.split('?')[0].toLowerCase().slice(-5) === '.m3u8';
            if (looksLikePlaylist) {
              res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
              res.end(rewritePlaylist(upstream.body.toString('utf-8'), upstream.finalUrl || target));
            } else {
              res.setHeader('Content-Type', ct || 'application/octet-stream');
              res.end(upstream.body);
            }
          } catch (e) {
            res.statusCode = 502;
            res.end('relay error: ' + (e.message || e));
          }
          return;
        }

        // --- Pairing: phone <-> TV provider pack handoff ---

        if (reqUrl.pathname === '/pair/start' && req.method === 'GET') {
          var kind = reqUrl.searchParams.get('kind') === 'tmdb_key' ? 'tmdb_key' : 'provider_pack';
          var started = startPairing(kind);
          var ssidStart = await getWifiSsid();
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ code: started.code, expiresAt: started.expiresAt, pairUrl: 'http://' + lanAddress() + ':' + PORT + '/pair?code=' + started.code, ssid: ssidStart }));
          return;
        }

        if (reqUrl.pathname === '/pair/status') {
          var statusCode = reqUrl.searchParams.get('code') || '';
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(getPairingStatus(statusCode)));
          return;
        }

        if (reqUrl.pathname === '/pair' && req.method === 'GET') {
          var pairCode = reqUrl.searchParams.get('code') || '';
          var validCode = isCodeValid(pairCode);
          var ssidPair = validCode ? await getWifiSsid() : null;
          res.setHeader('Content-Type', 'text/html');
          res.end(pairingPageHtml(pairCode, validCode, getPairingKind(pairCode), ssidPair));
          return;
        }

        if (reqUrl.pathname === '/pair/submit' && req.method === 'POST') {
          var chunks = [];
          req.on('data', function (c) { chunks.push(c); });
          req.on('end', async function () {
            res.setHeader('Content-Type', 'application/json');
            var body = {};
            try {
              body = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}');
              if (!isCodeValid(body.code)) {
                res.statusCode = 403;
                res.end(JSON.stringify({ error: 'Invalid or expired pairing code' }));
                return;
              }
              var submitKind = getPairingKind(body.code);
              consumeCode(body.code);

              if (submitKind === 'tmdb_key') {
                var apiKey = String(body.apiKey || '').trim();
                if (!apiKey) throw new Error('No API key provided');
                var keyResult = { apiKey: apiKey };
                console.log('[hlsRelay] TMDB key received via phone pairing');
                setPairingResult(body.code, keyResult);
                res.end(JSON.stringify({ ok: true }));
                return;
              }

              var installResult = await installPack(body.url);
              var reloaded = loadAllProviders();
              registry = reloaded.registry;
              list = reloaded.list;
              console.log('[hlsRelay] Provider pack installed: ' + installResult.name + ' -> ' + installResult.installed.join(', '));
              setPairingResult(body.code, installResult);
              res.end(JSON.stringify(installResult));
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
          var remote = (req.socket.remoteAddress || '').replace('::ffff:', '');
          if (['127.0.0.1', '::1', 'localhost'].indexOf(remote) === -1) {
            res.statusCode = 403;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'This endpoint is only available to the app running on this device.' }));
            return;
          }
          var installChunks = [];
          req.on('data', function (c) { installChunks.push(c); });
          req.on('end', async function () {
            res.setHeader('Content-Type', 'application/json');
            try {
              var installBody = JSON.parse(Buffer.concat(installChunks).toString('utf-8') || '{}');
              var directResult = await installPack(installBody.url);
              var directReloaded = loadAllProviders();
              registry = directReloaded.registry;
              list = directReloaded.list;
              console.log('[hlsRelay] Provider pack installed directly: ' + directResult.name + ' -> ' + directResult.installed.join(', '));
              res.end(JSON.stringify(directResult));
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
    })();
  });

  server.on('error', function (e) {
    // Most likely EADDRINUSE from a previous instance that didn't shut down cleanly.
    console.error('[hlsRelay] Failed to start:', e.message);
  });

  server.listen(PORT, '0.0.0.0', function () {
    console.log('[hlsRelay] Listening on http://0.0.0.0:' + PORT + ' (LAN: http://' + lanAddress() + ':' + PORT + ')');
  });
}

main().catch(function (e) {
  console.error('[hlsRelay] Fatal startup error:', e && e.stack ? e.stack : e);
});
