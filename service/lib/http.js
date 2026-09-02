/**
 * Shared HTTP client for provider plugins. Plain Node http/https — no browser
 * `Origin` header is ever attached, which is the whole reason this exists on
 * the serviceFile side rather than in the webview (see hlsRelay.js header).
 */

import http from 'http';
import https from 'https';
import { URL } from 'url';

const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export function fetchRaw(targetUrl, headers = {}, redirects = 5) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(targetUrl);
    } catch {
      reject(new Error(`Invalid URL: ${targetUrl}`));
      return;
    }
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.get(u, { headers: { 'User-Agent': DESKTOP_UA, ...headers } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume();
        const nextUrl = new URL(res.headers.location, targetUrl).toString();
        fetchRaw(nextUrl, headers, redirects - 1).then(resolve, reject);
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: Buffer.concat(chunks), finalUrl: targetUrl }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('Upstream request timed out')));
  });
}

export async function fetchJson(url, headers) {
  const r = await fetchRaw(url, headers);
  if (r.statusCode >= 400 || r.body.length === 0) {
    throw new Error(`Upstream ${url} returned HTTP ${r.statusCode} with ${r.body.length} bytes`);
  }
  try {
    return JSON.parse(r.body.toString('utf-8'));
  } catch {
    throw new Error(`Upstream ${url} returned non-JSON response (HTTP ${r.statusCode})`);
  }
}

export async function fetchText(url, headers) {
  const r = await fetchRaw(url, headers);
  if (r.statusCode >= 400) {
    throw new Error(`Upstream ${url} returned HTTP ${r.statusCode}`);
  }
  return r.body.toString('utf-8');
}
